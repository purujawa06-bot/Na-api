package tools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/cdp"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	vocalRemoverPage    = "https://vocalremover.org/"
	noiseMaxSourceBytes = 32 << 20 // 32 MiB
	vocalPollInterval   = 5 * time.Second
	vocalPollTimeout    = 5 * time.Minute
	vocalChunkSize      = 256 * 1024 // 256 KiB chunks for base64 injection over CDP
)

// vocalRemoverTracks holds the separated tracks extracted from the page.
type vocalRemoverTracks struct {
	InstrumentalB64  string `json:"instrumentalB64"`
	InstrumentalMime string `json:"instrumentalMime"`
	InstrumentalName string `json:"instrumentalName"`
	VocalsB64        string `json:"vocalsB64"`
	VocalsMime       string `json:"vocalsMime"`
	VocalsName       string `json:"vocalsName"`
	Error            string `json:"error"`
	Ready            bool   `json:"ready"`
}

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
		failJSON(w, http.StatusBadRequest, `Parameter "file" (audio/video) wajib diisi`)
		return
	}
	defer file.Close()

	// mode/duration_seconds diterima untuk kompatibilitas (dulu pdfleader) tapi tidak digunakan.
	_ = r.FormValue("mode")
	_ = r.FormValue("duration_seconds")

	flusher, ok := httpx.StartNDJSON(w)
	if !ok {
		return
	}
	emitter := newNDJSONEmitter(w, flusher)
	defer emitter.close()

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Minute)
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
		contentType = "audio/mpeg"
	}

	client, err := cdp.Dial(ctx, cdp.DefaultEndpoint)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal terhubung ke browser CDP: " + err.Error(), "httpStatus": 502})
		return
	}
	defer client.Close()

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Membuka vocalremover.org..."})

	raw, err := client.Call("Target.createTarget", map[string]any{"url": "about:blank"}, "")
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal membuat target: " + err.Error(), "httpStatus": 502})
		return
	}
	var ct struct {
		TargetID string `json:"targetId"`
	}
	if err := json.Unmarshal(raw, &ct); err != nil || ct.TargetID == "" {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "targetId tidak ditemukan", "httpStatus": 502})
		return
	}
	defer func() { _, _ = client.Call("Target.closeTarget", map[string]any{"targetId": ct.TargetID}, "") }()

	raw, err = client.Call("Target.attachToTarget", map[string]any{"targetId": ct.TargetID, "flatten": true}, "")
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal attach target: " + err.Error(), "httpStatus": 502})
		return
	}
	var att struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &att); err != nil || att.SessionID == "" {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "sessionId tidak ditemukan", "httpStatus": 502})
		return
	}
	sid := att.SessionID

	_, _ = client.Call("Page.enable", map[string]any{}, sid)
	_, _ = client.Call("Runtime.enable", map[string]any{}, sid)
	if _, err := client.Call("Page.navigate", map[string]any{"url": vocalRemoverPage}, sid); err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal navigasi: " + err.Error(), "httpStatus": 502})
		return
	}
	if err := client.WaitFor(ctx, sid, `document.readyState === 'complete' || document.readyState === 'interactive'`, 30*time.Second); err != nil {
		// lanjutkan, sebagian browser remote bisa lambat melapor
		_ = cdp.SleepCtx(ctx, 3*time.Second)
	} else {
		_ = cdp.SleepCtx(ctx, 3*time.Second)
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Memuat file ke pemroses..."})
	if err := injectFileToVocalRemover(client, sid, filename, contentType, data); err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal memuat file: " + err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Memproses pemisahan vokal & musik..."})
	tracks, err := waitVocalRemoverResult(ctx, client, sid, vocalPollTimeout)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengunggah hasil..."})
	out := map[string]any{
		"event":   "done",
		"success": true,
		"status":  "success",
		"source":  "vocalremover.org",
	}

	if tracks.InstrumentalB64 != "" {
		raw, decErr := base64.StdEncoding.DecodeString(tracks.InstrumentalB64)
		if decErr != nil {
			emitter.stopHeartbeat()
			emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal mendekode hasil instrumental", "httpStatus": 502})
			return
		}
		name := tracks.InstrumentalName
		if name == "" {
			name = "instrumental.wav"
		}
		mime := tracks.InstrumentalMime
		if mime == "" {
			mime = "audio/wav"
		}
		url, upErr := uploadToTmpfiles(ctx, raw, name, mime)
		if upErr != nil {
			emitter.stopHeartbeat()
			emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal unggah instrumental: " + upErr.Error(), "httpStatus": 502})
			return
		}
		out["url"] = url
		out["instrumental_url"] = url
		out["instrumental_size"] = len(raw)
	}
	if tracks.VocalsB64 != "" {
		raw, decErr := base64.StdEncoding.DecodeString(tracks.VocalsB64)
		if decErr == nil && len(raw) > 0 {
			name := tracks.VocalsName
			if name == "" {
				name = "vocals.wav"
			}
			mime := tracks.VocalsMime
			if mime == "" {
				mime = "audio/wav"
			}
			if url, upErr := uploadToTmpfiles(ctx, raw, name, mime); upErr == nil {
				out["vocals_url"] = url
				out["vocals_size"] = len(raw)
			}
		}
	}

	if _, ok := out["url"]; !ok {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Tidak ada hasil audio yang berhasil diekstrak", "httpStatus": 502})
		return
	}

	emitter.stopHeartbeat()
	emitter.emit(out)
}

// injectFileToVocalRemover mengirim file ke halaman vocalremover.org via CDP.
func injectFileToVocalRemover(client *cdp.Client, sid, filename, contentType string, data []byte) error {
	b64 := base64.StdEncoding.EncodeToString(data)
	// init buffer
	if _, err := client.Eval(sid, `window.__naFile = {name:"",type:"",b64:""};`); err != nil {
		return err
	}
	// chunked append to avoid huge single evaluate expression issues
	for i := 0; i < len(b64); i += vocalChunkSize {
		end := i + vocalChunkSize
		if end > len(b64) {
			end = len(b64)
		}
		chunk, _ := json.Marshal(b64[i:end])
		if _, err := client.Eval(sid, `window.__naFile.b64 += `+string(chunk)+`;`); err != nil {
			return fmt.Errorf("gagal kirim chunk data: %w", err)
		}
	}
	nameJSON, _ := json.Marshal(filename)
	typeJSON, _ := json.Marshal(contentType)
	script := `(async()=>{
  try{
    const meta = window.__naFile || {};
    const b64 = meta.b64 || "";
    const name = ` + string(nameJSON) + `;
    const type = ` + string(typeJSON) + `;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const file = new File([bytes], name, {type: type || 'audio/mpeg'});
    const input = document.querySelector('input[type=file]');
    if(!input) return JSON.stringify({ok:false,err:'input file tidak ditemukan'});
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    try{ window.__naFile.b64 = ""; }catch(e){}
    return JSON.stringify({ok:true,size:file.size});
  }catch(e){ return JSON.stringify({ok:false,err:String(e&&e.message||e)}); }
})()`
	res, err := client.EvalAwait(sid, script)
	if err != nil {
		return err
	}
	var out struct {
		OK  bool   `json:"ok"`
		Err string `json:"err"`
	}
	if err := json.Unmarshal([]byte(res), &out); err != nil {
		return fmt.Errorf("respons inject tidak valid: %w", err)
	}
	if !out.OK {
		if out.Err == "" {
			out.Err = "gagal menyuntikkan file"
		}
		return fmt.Errorf("%s", out.Err)
	}
	return nil
}

// waitVocalRemoverResult mem-poll halaman hingga hasil pemisahan siap lalu mengekstraknya.
func waitVocalRemoverResult(ctx context.Context, client *cdp.Client, sid string, timeout time.Duration) (vocalRemoverTracks, error) {
	deadline := time.Now().Add(timeout)
	// beri waktu awal untuk app memulai proses
	if err := sleepContext(ctx, 8*time.Second); err != nil {
		return vocalRemoverTracks{}, err
	}

	checkScript := `(async()=>{
  try{
    const text = (document.body && (document.body.innerText||document.body.textContent)||'').toLowerCase();
    const anchors = Array.from(document.querySelectorAll('a'));
    const audios = Array.from(document.querySelectorAll('audio'));
    const blobLinks = anchors.filter(a => (a.href||'').startsWith('blob:'));
    const blobAudios = audios.filter(a => ((a.currentSrc||a.src)||'').startsWith('blob:'));
    const hasError = /error|gagal|failed|could not|unsupported|too (short|long)|sorry/i.test(text);
    const hasProgress = !!document.querySelector('progress,[role="progressbar"],[class*="progress"],[class*="loading"],[class*="spinner"]');
    // heuristik siap: ada blob audio/link (hasil unduhan) atau tombol/link save/download muncul setelah halaman berganti
    const saveLike = anchors.filter(a => /save|download|simpan|unduh/i.test((a.innerText||a.textContent||'') + ' ' + (a.download||'') + ' ' + (a.className||'')));
    const ready = (blobLinks.length + blobAudios.length) >= 1 || (saveLike.length >= 1 && blobAudios.length >= 1) || (blobAudios.length >= 2) || (blobLinks.length >= 2);
    if (ready) {
      async function toB64(url){
        try{
          const r = await fetch(url);
          const b = await r.blob();
          return await new Promise((res,rej)=>{
            const fr = new FileReader();
            fr.onload = () => { const s = String(fr.result||''); const i = s.indexOf(','); res({b64: i>=0?s.slice(i+1):s, mime: b.type||'audio/wav'}); };
            fr.onerror = () => rej(fr.error||new Error('read fail'));
            fr.readAsDataURL(b);
          });
        }catch(e){ return null; }
      }
      // kumpulkan kandidat (url,label,prefer music/instrumental)
      const candidates = [];
      for (const a of anchors) {
        const href = a.href||'';
        if (!href.startsWith('blob:') && !a.download) continue;
        const label = ((a.innerText||a.textContent||'') + ' ' + (a.download||'') + ' ' + (a.getAttribute('aria-label')||'')).toLowerCase();
        candidates.push({url: href, label, dl: a.download||''});
      }
      for (const au of audios) {
        const u = au.currentSrc||au.src||'';
        if (!u.startsWith('blob:')) continue;
        const ctxText = ((au.closest('section,div,article')||{}).innerText||'').toLowerCase();
        candidates.push({url: u, label: ctxText, dl: ''});
      }
      // dedupe by url
      const seen = new Set();
      const uniq = [];
      for (const c of candidates){ if(!c.url || seen.has(c.url)) continue; seen.add(c.url); uniq.push(c); }
      function isVocal(lbl){ return /vocal|voice|acapella|vokal|suara/.test(lbl); }
      function isMusic(lbl){ return /music|instrumental|karaoke|musik|no vocal|without vocal|minus/.test(lbl); }
      let music = uniq.find(c=>isMusic(c.label) && c.url.startsWith('blob:')) || uniq.find(c=>!isVocal(c.label) && c.url.startsWith('blob:')) || uniq[0];
      let vocal = uniq.find(c=>isVocal(c.label) && c.url.startsWith('blob:') && (!music || c.url!==music.url)) || uniq.find(c=>c.url.startsWith('blob:') && (!music || c.url!==music.url));
      const out = {ready:true};
      if (music && music.url.startsWith('blob:')) {
        const r = await toB64(music.url);
        if (r) { out.instrumentalB64=r.b64; out.instrumentalMime=r.mime; out.instrumentalName=music.dl||'instrumental.wav'; }
      }
      if (vocal && vocal.url.startsWith('blob:')) {
        const r = await toB64(vocal.url);
        if (r) { out.vocalsB64=r.b64; out.vocalsMime=r.mime; out.vocalsName=vocal.dl||'vocals.wav'; }
      }
      if (!out.instrumentalB64 && !out.vocalsB64) { return JSON.stringify({ready:false, waiting:true, hasProgress, note:'blob found but extract failed'}); }
      return JSON.stringify(out);
    }
    if (hasError && !hasProgress) return JSON.stringify({ready:false, error:'Situs vocalremover.org melaporkan error atau format tidak didukung'});
    return JSON.stringify({ready:false, hasProgress});
  }catch(e){ return JSON.stringify({ready:false, error:String(e&&e.message||e)}); }
})()`

	for {
		if ctx.Err() != nil {
			return vocalRemoverTracks{}, fmt.Errorf("proses dibatalkan/timeout")
		}
		if time.Now().After(deadline) {
			return vocalRemoverTracks{}, fmt.Errorf("proses vocal remover kehabisan waktu (timeout)")
		}
		res, err := client.EvalAwait(sid, checkScript)
		if err != nil {
			// satu kali gagal eval bisa transient; coba lanjut selama belum deadline
			if time.Now().After(deadline) {
				return vocalRemoverTracks{}, fmt.Errorf("gagal membaca status halaman: %w", err)
			}
		} else {
			var tr vocalRemoverTracks
			if jerr := json.Unmarshal([]byte(res), &tr); jerr == nil {
				if tr.Error != "" {
					return vocalRemoverTracks{}, fmt.Errorf("%s", tr.Error)
				}
				if tr.Ready && (tr.InstrumentalB64 != "" || tr.VocalsB64 != "") {
					return tr, nil
				}
			}
		}
		if err := sleepContext(ctx, vocalPollInterval); err != nil {
			return vocalRemoverTracks{}, err
		}
	}
}
