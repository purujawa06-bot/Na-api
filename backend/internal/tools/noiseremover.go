package tools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/cdp"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	nirkyyPageURL       = "https://nirkyy-a.hf.space/"
	noiseMaxSourceBytes = 32 << 20 // 32 MiB
	nirkyyTimeout       = 5 * time.Minute
)

//book_tools_noiseRemover
func (h *handlers) noiseRemover(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		failJSON(w, http.StatusBadRequest, "Form multipart tidak valid, gunakan field file")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		failJSON(w, http.StatusBadRequest, `Parameter "file" (audio) wajib diisi`)
		return
	}
	defer file.Close()

	// kompatibilitas param lama (tidak digunakan)
	_ = r.FormValue("mode")
	_ = r.FormValue("duration_seconds")

	flusher, ok := httpx.StartNDJSON(w)
	if !ok {
		return
	}
	emitter := newNDJSONEmitter(w, flusher)
	defer emitter.close()

	ctx, cancel := context.WithTimeout(r.Context(), nirkyyTimeout)
	defer cancel()

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Membaca file..."})
	data, err := io.ReadAll(io.LimitReader(file, noiseMaxSourceBytes+1))
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal membaca file", "httpStatus": 400})
		return
	}
	if len(data) == 0 {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "File kosong", "httpStatus": 400})
		return
	}
	if len(data) > noiseMaxSourceBytes {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": fmt.Sprintf("File melebihi batas %d MB", noiseMaxSourceBytes/(1<<20)), "httpStatus": 400})
		return
	}

	filename := strings.TrimSpace(header.Filename)
	if filename == "" {
		filename = "audio.wav"
	}
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if i := strings.Index(contentType, ";"); i >= 0 {
		contentType = strings.TrimSpace(contentType[:i])
	}
	if contentType == "" || contentType == "application/octet-stream" {
		if ext := path.Ext(filename); ext != "" {
			if mt := mime.TypeByExtension(ext); mt != "" {
				if i := strings.Index(mt, ";"); i >= 0 {
					mt = strings.TrimSpace(mt[:i])
				}
				contentType = mt
			}
		}
	}
	if contentType == "" {
		contentType = "audio/wav"
	}

	emitter.emit(map[string]any{"event": "processing", "status": "running", "message": "Memproses penghapusan noise via browser (nirkyy-a.hf.space)...", "source": "nirkyy-a.hf.space"})
	outData, err := nirkyyDenoiseCDP(ctx, data, filename, contentType)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502})
		return
	}

	// Konversi ke MP3 agar kompatibel sebagai audio WhatsApp (WAV sering tidak tampil/diputar)
	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengonversi hasil ke MP3..."})
	outMime := "audio/wav"
	resultName := "cleaned.wav"
	if mp3Data, convErr := convertWavToMP3(ctx, outData); convErr == nil && len(mp3Data) > 0 {
		outData = mp3Data
		outMime = "audio/mpeg"
		resultName = "cleaned.mp3"
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengunggah hasil..."})
	hostedURL, err := uploadToTmpfiles(ctx, outData, resultName, outMime)
	emitter.stopHeartbeat()
	if err != nil {
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal unggah hasil: " + err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(map[string]any{
		"event":    "done",
		"success":  true,
		"status":   "success",
		"source":   "nirkyy-a.hf.space",
		"url":      hostedURL,
		"size":     len(outData),
		"mimetype": outMime,
		"filename": resultName,
	})
}

// nirkyyDenoiseCDP menjalankan denoise DeepFilterNet via Gradio API dari konteks browser (CDP)
// untuk menghindari 502/503 pada pemanggilan HTTP langsung dari server.
// Alur (reverse-engineered, Gradio 6.32.0, api_prefix /gradio_api, fn denoise):
//  1. Navigasi ke nirkyy-a.hf.space (origin/session browser)
//  2. decode base64 audio input -> upload ke /gradio_api/upload (same-origin)
//  3. POST /gradio_api/call/denoise (FileData) -> event_id
//  4. GET /gradio_api/call/denoise/<event_id> (SSE, event:complete) -> URL file hasil
//  5. fetch file hasil -> base64 audio
func nirkyyDenoiseCDP(ctx context.Context, audio []byte, filename, contentType string) ([]byte, error) {
	client, err := cdp.Dial(ctx, cdp.DefaultEndpoint)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	raw, err := client.Call("Target.createTarget", map[string]any{"url": "about:blank"}, "")
	if err != nil {
		return nil, fmt.Errorf("create target: %w", err)
	}
	var ct struct {
		TargetID string `json:"targetId"`
	}
	if err := json.Unmarshal(raw, &ct); err != nil || ct.TargetID == "" {
		return nil, fmt.Errorf("targetId tidak ditemukan")
	}
	targetID := ct.TargetID
	defer func() { _, _ = client.Call("Target.closeTarget", map[string]any{"targetId": targetID}, "") }()

	raw, err = client.Call("Target.attachToTarget", map[string]any{"targetId": targetID, "flatten": true}, "")
	if err != nil {
		return nil, fmt.Errorf("attach: %w", err)
	}
	var att struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &att); err != nil || att.SessionID == "" {
		return nil, fmt.Errorf("sessionId tidak ditemukan")
	}
	sid := att.SessionID

	_, _ = client.Call("Page.enable", map[string]any{}, sid)
	_, _ = client.Call("Runtime.enable", map[string]any{}, sid)

	if _, err := client.Call("Page.navigate", map[string]any{"url": nirkyyPageURL}, sid); err != nil {
		return nil, fmt.Errorf("navigate: %w", err)
	}
	if err := client.WaitFor(ctx, sid, `document.readyState === 'complete' || document.readyState === 'interactive'`, 45*time.Second); err != nil {
		return nil, fmt.Errorf("halaman nirkyy tidak siap: %w", err)
	}

	b64Input := base64.StdEncoding.EncodeToString(audio)
	inB64JSON, _ := json.Marshal(b64Input)
	nameJSON, _ := json.Marshal(filename)
	mimeJSON, _ := json.Marshal(contentType)
	expr := fmt.Sprintf(`(async () => {
  try {
    const inputB64 = %s;
    const filename = %s;
    const mime = %s || 'audio/wav';
    // decode audio input (dikirim sebagai base64 agar tidak bergantung fetch cross-origin)
    const bin = atob(inputB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // upload ke gradio (same-origin)
    const fd = new FormData();
    fd.append('files', new Blob([bytes], { type: mime }), filename);
    const up = await fetch('/gradio_api/upload', { method: 'POST', body: fd });
    const upText = await up.text();
    if (!up.ok) return JSON.stringify({ ok:false, step:'upload', status: up.status, body: (upText||'').slice(0,400) });
    let files; try { files = JSON.parse(upText); } catch(e) { files = null; }
    const fpath = Array.isArray(files) ? files[0] : null;
    if (!fpath) return JSON.stringify({ ok:false, step:'upload', body: (upText||'').slice(0,400) });
    const fileUrl = location.origin + '/gradio_api/file=' + fpath;
    // panggil denoise
    const payload = { data: [{ path: fileUrl, url: fileUrl, meta: { _type: 'gradio.FileData' }, orig_name: filename }] };
    const callRes = await fetch('/gradio_api/call/denoise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const callText = await callRes.text();
    if (!callRes.ok) return JSON.stringify({ ok:false, step:'call', status: callRes.status, body: (callText||'').slice(0,400) });
    let eid = null; try { eid = JSON.parse(callText).event_id; } catch(e) {}
    if (!eid) return JSON.stringify({ ok:false, step:'call', body: (callText||'').slice(0,400) });
    // SSE hasil
    const sse = await fetch('/gradio_api/call/denoise/' + eid);
    const sseText = await sse.text();
    if (!sse.ok) return JSON.stringify({ ok:false, step:'sse', status: sse.status, body: (sseText||'').slice(0,400) });
    const blocks = String(sseText||'').split('\n\n');
    let outUrl = '';
    let sseErr = '';
    for (const b of blocks) {
      const lines = b.split('\n');
      let ev = '', data = '';
      for (const ln of lines) {
        if (ln.indexOf('event:') === 0) ev = ln.slice(6).trim();
        else if (ln.indexOf('data:') === 0) data += (data ? '\n' : '') + ln.slice(5).trim();
      }
      if (ev === 'complete') {
        try { const arr = JSON.parse(data); if (Array.isArray(arr) && arr[0]) outUrl = arr[0].url || (arr[0].path ? (location.origin + '/gradio_api/file=' + arr[0].path) : ''); } catch(e) {}
      } else if (ev === 'error') {
        sseErr = data || 'proses denoise gagal';
      }
    }
    if (!outUrl) return JSON.stringify({ ok:false, step:'result', error: sseErr || 'URL hasil tidak ditemukan', body: (sseText||'').slice(0,600) });
    // unduh hasil
    const outRes = await fetch(outUrl);
    if (!outRes.ok) return JSON.stringify({ ok:false, step:'download_result', status: outRes.status, url: outUrl });
    const ab = await outRes.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return JSON.stringify({ ok:true, b64: btoa(bin), size: bytes.length });
  } catch (e) {
    return JSON.stringify({ ok:false, step:'exception', error: String(e && e.message ? e.message : e) });
  }
})()`, string(inB64JSON), string(nameJSON), string(mimeJSON))

	outStr, err := client.EvalAwait(sid, expr)
	if err != nil {
		return nil, fmt.Errorf("gagal memproses via browser: %w", err)
	}

	var out struct {
		OK    bool   `json:"ok"`
		B64   string `json:"b64"`
		Size  int    `json:"size"`
		Step  string `json:"step"`
		Error string `json:"error"`
		Status int   `json:"status"`
		Body  string `json:"body"`
		URL   string `json:"url"`
	}
	if err := json.Unmarshal([]byte(outStr), &out); err != nil {
		return nil, fmt.Errorf("respons browser tidak valid: %w", err)
	}
	if !out.OK {
		msg := strings.TrimSpace(out.Error)
		if msg == "" {
			msg = strings.TrimSpace(out.Body)
		}
		if msg == "" {
			msg = "gagal memproses audio"
		}
		if out.Step != "" {
			if out.Status > 0 {
				msg = fmt.Sprintf("%s (%s, HTTP %d)", msg, out.Step, out.Status)
			} else {
				msg = fmt.Sprintf("%s (%s)", msg, out.Step)
			}
		}
		return nil, fmt.Errorf("%s", msg)
	}
	if strings.TrimSpace(out.B64) == "" {
		return nil, fmt.Errorf("hasil audio kosong")
	}
	data, err := base64.StdEncoding.DecodeString(out.B64)
	if err != nil {
		return nil, fmt.Errorf("gagal decode hasil: %w", err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("hasil audio kosong")
	}
	return data, nil
}

func convertWavToMP3(ctx context.Context, wav []byte) ([]byte, error) {
	dir, err := os.MkdirTemp("", "nr-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	inPath := filepath.Join(dir, "in.wav")
	outPath := filepath.Join(dir, "out.mp3")
	if err := os.WriteFile(inPath, wav, 0o600); err != nil {
		return nil, err
	}
	// ffmpeg: konversi ke MP3 (kompatibel audio WhatsApp). -vn buang stream non-audio.
	cmd := exec.CommandContext(ctx, "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "128k", outPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if msg != "" {
			return nil, fmt.Errorf("ffmpeg: %w: %s", err, msg)
		}
		return nil, err
	}
	mp3, err := os.ReadFile(outPath)
	if err != nil {
		return nil, err
	}
	if len(mp3) == 0 {
		return nil, fmt.Errorf("hasil konversi kosong")
	}
	return mp3, nil
}
