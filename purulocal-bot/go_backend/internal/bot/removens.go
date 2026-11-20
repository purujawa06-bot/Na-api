package bot

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
)

const nirkyyPageURL = "https://nirkyy-a.hf.space/"

func (m *Manager) handleRemoveNoiseCommand(ctx context.Context, evt *events.Message) error {
	// batas waktu keseluruhan agar tidak menggantung
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	m.logInfo("removens", "command diterima")

	audioMsg := m.findAudioForRemoveNoise(evt)
	if audioMsg == nil {
		_ = m.sendReply(ctx, evt, "Reply audio/voice note dengan .removens untuk menghapus noise.")
		return nil
	}

	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		m.logError("removens", "client tidak siap")
		_ = m.sendReply(ctx, evt, "Bot belum siap, coba lagi.")
		return nil
	}

	if err := m.sendReply(ctx, evt, "Memproses penghapusan noise, mohon tunggu..."); err != nil {
		m.logWarn("removens", "gagal kirim status awal: "+err.Error())
	}

	m.logInfo("removens", "mulai unduh audio dari WhatsApp")
	type dlRes struct {
		data []byte
		err  error
	}
	dlCh := make(chan dlRes, 1)
	go func() {
		d, e := c.Download(ctx, audioMsg)
		dlCh <- dlRes{data: d, err: e}
	}()
	var data []byte
	var dlErr error
	select {
	case r := <-dlCh:
		data, dlErr = r.data, r.err
	case <-ctx.Done():
		dlErr = fmt.Errorf("timeout mengunduh audio: %w", ctx.Err())
	}
	if dlErr != nil {
		m.logError("removens", "download audio gagal: "+dlErr.Error())
		_ = m.sendReply(ctx, evt, "Gagal mengunduh audio: "+dlErr.Error())
		return nil
	}
	if len(data) == 0 {
		m.logError("removens", "audio kosong")
		_ = m.sendReply(ctx, evt, "Audio kosong atau tidak dapat diunduh.")
		return nil
	}

	mime := strings.TrimSpace(strings.ToLower(audioMsg.GetMimetype()))
	if i := strings.Index(mime, ";"); i >= 0 {
		mime = strings.TrimSpace(mime[:i])
	}
	filename := audioFilenameFromMime(mime)
	m.logInfo("removens", fmt.Sprintf("audio %d bytes mime=%s -> denoise via CDP nirkyy", len(data), mime))

	cleanWav, err := nirkyyDenoiseCDP(ctx, data, filename, mime)
	if err != nil {
		m.logError("removens", "denoise gagal: "+err.Error())
		_ = m.sendReply(ctx, evt, "Gagal menghapus noise: "+err.Error())
		return nil
	}
	m.logInfo("removens", fmt.Sprintf("hasil denoise %d bytes, konversi ke MP3", len(cleanWav)))

	outData := cleanWav
	outMime := "audio/wav"
	outName := "cleaned.wav"
	if mp3, convErr := convertAudioToMP3(ctx, cleanWav); convErr == nil && len(mp3) > 0 {
		outData = mp3
		outMime = "audio/mpeg"
		outName = "cleaned.mp3"
	} else if mp3, convErr := convertAudioViaAPI(ctx, cleanWav, "cleaned.wav", "mp3"); convErr == nil && len(mp3) > 0 {
		outData = mp3
		outMime = "audio/mpeg"
		outName = "cleaned.mp3"
	} else {
		m.logWarn("removens", "konversi MP3 tidak tersedia, kirim WAV")
	}

	// unggah hasil ke tmpfiles untuk dikirim sebagai audio URL
	resultURL, err := uploadToTmpfiles(ctx, outData, outName, outMime)
	if err != nil {
		m.logError("removens", "unggah hasil gagal: "+err.Error())
		_ = m.sendReply(ctx, evt, "Gagal mengunggah hasil: "+err.Error())
		return nil
	}
	m.logInfo("removens", "hasil: "+resultURL)

	res := ExecResult{
		AudioURL: resultURL,
		Mimetype: outMime,
		Caption:  "Hasil penghapusan noise",
	}
	if err := m.sendAudioFromURL(ctx, evt, res); err != nil {
		m.logError("removens", "kirim audio gagal: "+err.Error())
		if err2 := m.sendReply(ctx, evt, "Audio bersih: "+resultURL+"\n\n(Gagal mengirim audio: "+err.Error()+")"); err2 != nil {
			m.logError("removens", "kirim fallback link juga gagal: "+err2.Error())
		}
		return nil
	}
	m.logInfo("removens", "audio hasil terkirim")
	return nil
}

// nirkyyDenoiseCDP: reverse-engineering nirkyy-a.hf.space (Gradio 6.32.0, /gradio_api, fn denoise)
// via remote CDP browser: upload -> /call/denoise -> SSE complete -> fetch hasil.
func nirkyyDenoiseCDP(ctx context.Context, audio []byte, filename, contentType string) ([]byte, error) {
	client, err := cdpDial(ctx, "")
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
	if err := client.WaitFor(sid, `document.readyState === 'complete' || document.readyState === 'interactive'`, 45*time.Second); err != nil {
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
    const bin = atob(inputB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append('files', new Blob([bytes], { type: mime }), filename);
    const up = await fetch('/gradio_api/upload', { method: 'POST', body: fd });
    const upText = await up.text();
    if (!up.ok) return JSON.stringify({ ok:false, step:'upload', status: up.status, body: (upText||'').slice(0,400) });
    let files; try { files = JSON.parse(upText); } catch(e) { files = null; }
    const fpath = Array.isArray(files) ? files[0] : null;
    if (!fpath) return JSON.stringify({ ok:false, step:'upload', body: (upText||'').slice(0,400) });
    const fileUrl = location.origin + '/gradio_api/file=' + fpath;
    const payload = { data: [{ path: fileUrl, url: fileUrl, meta: { _type: 'gradio.FileData' }, orig_name: filename }] };
    const callRes = await fetch('/gradio_api/call/denoise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const callText = await callRes.text();
    if (!callRes.ok) return JSON.stringify({ ok:false, step:'call', status: callRes.status, body: (callText||'').slice(0,400) });
    let eid = null; try { eid = JSON.parse(callText).event_id; } catch(e) {}
    if (!eid) return JSON.stringify({ ok:false, step:'call', body: (callText||'').slice(0,400) });
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
      } else if (ev === 'error') { sseErr = data || 'proses denoise gagal'; }
    }
    if (!outUrl) return JSON.stringify({ ok:false, step:'result', error: sseErr || 'URL hasil tidak ditemukan', body: (sseText||'').slice(0,600) });
    const outRes = await fetch(outUrl);
    if (!outRes.ok) return JSON.stringify({ ok:false, step:'download_result', status: outRes.status, url: outUrl });
    const ab = await outRes.arrayBuffer();
    const outBytes = new Uint8Array(ab);
    let outBin = '';
    const chunk = 0x8000;
    for (let i = 0; i < outBytes.length; i += chunk) {
      outBin += String.fromCharCode.apply(null, outBytes.subarray(i, i + chunk));
    }
    return JSON.stringify({ ok:true, b64: btoa(outBin), size: outBytes.length });
  } catch (e) {
    return JSON.stringify({ ok:false, step:'exception', error: String(e && e.message ? e.message : e) });
  }
})()`, string(inB64JSON), string(nameJSON), string(mimeJSON))

	outStr, err := client.EvalAwait(sid, expr)
	if err != nil {
		return nil, fmt.Errorf("gagal memproses via browser: %w", err)
	}
	var out struct {
		OK     bool   `json:"ok"`
		B64    string `json:"b64"`
		Step   string `json:"step"`
		Error  string `json:"error"`
		Status int    `json:"status"`
		Body   string `json:"body"`
		URL    string `json:"url"`
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
	decoded, err := base64.StdEncoding.DecodeString(out.B64)
	if err != nil {
		return nil, fmt.Errorf("gagal decode hasil: %w", err)
	}
	if len(decoded) == 0 {
		return nil, fmt.Errorf("hasil audio kosong")
	}
	return decoded, nil
}

func convertAudioToMP3(ctx context.Context, wav []byte) ([]byte, error) {
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

// convertAudioViaAPI mencoba konversi via endpoint na-api /api/tools/ffmpeg (NDJSON) sebagai fallback.
func convertAudioViaAPI(ctx context.Context, data []byte, filename, format string) ([]byte, error) {
	const api = "https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/ffmpeg"
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	escaped := strings.ReplaceAll(strings.ReplaceAll(filename, "\\", "_"), "\"", "_")
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escaped))
	h.Set("Content-Type", "audio/wav")
	part, err := w.CreatePart(h)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(data); err != nil {
		return nil, err
	}
	_ = w.WriteField("format", format)
	if err := w.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, api, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		rb, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(rb)))
	}
	rb, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	// parse NDJSON, ambil URL dari event done sukses
	var resultURL string
	for _, line := range strings.Split(string(rb), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ev struct {
			Event   string `json:"event"`
			Success bool   `json:"success"`
			URL     string `json:"url"`
			Error   string `json:"error"`
		}
		if json.Unmarshal([]byte(line), &ev) == nil {
			if ev.Event == "done" && ev.Success && strings.TrimSpace(ev.URL) != "" {
				resultURL = ev.URL
			} else if ev.Event == "done" && !ev.Success && ev.Error != "" {
				return nil, fmt.Errorf("%s", ev.Error)
			}
		}
	}
	if resultURL == "" {
		return nil, fmt.Errorf("URL hasil konversi tidak ditemukan")
	}
	// download hasil
	greq, err := http.NewRequestWithContext(ctx, http.MethodGet, resultURL, nil)
	if err != nil {
		return nil, err
	}
	gresp, err := client.Do(greq)
	if err != nil {
		return nil, err
	}
	defer gresp.Body.Close()
	out, err := io.ReadAll(io.LimitReader(gresp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if gresp.StatusCode < 200 || gresp.StatusCode > 299 || len(out) == 0 {
		return nil, fmt.Errorf("gagal unduh hasil konversi")
	}
	return out, nil
}

func (m *Manager) findAudioForRemoveNoise(evt *events.Message) *waE2E.AudioMessage {
	if evt == nil || evt.Message == nil {
		return nil
	}
	msg := evt.Message
	// 1) audio langsung (jika command dikirim sebagai caption audio - jarang, tapi didukung)
	if a := msg.GetAudioMessage(); a != nil {
		return a
	}
	// 2) reply/quote ke audio atau voice note
	if ci := extractIncomingContextInfo(msg); ci != nil {
		if q := ci.GetQuotedMessage(); q != nil {
			if a := q.GetAudioMessage(); a != nil {
				return a
			}
		}
	}
	return nil
}

func audioFilenameFromMime(mime string) string {
	switch {
	case strings.Contains(mime, "ogg"), strings.Contains(mime, "opus"):
		return "audio.ogg"
	case strings.Contains(mime, "mpeg"), strings.Contains(mime, "mp3"):
		return "audio.mp3"
	case strings.Contains(mime, "mp4"), strings.Contains(mime, "m4a"), strings.Contains(mime, "aac"):
		return "audio.m4a"
	case strings.Contains(mime, "wav"):
		return "audio.wav"
	case strings.Contains(mime, "amr"):
		return "audio.amr"
	default:
		return "audio.bin"
	}
}
