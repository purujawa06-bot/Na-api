package downloader

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime/multipart"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	jjBaseURL       = "https://cc.fgsi.dpdns.org"
	jjCDPURL        = "wss://light-panda-cdp.onrender.com/"
	jjMaxPhotoBytes = 15 << 20 // 15 MB, selaras batas situs
	jjRenderTimeout = 8 * time.Minute
	jjPollInterval  = 5 * time.Second
	jjJobTTL        = 30 * time.Minute
)

// jjTemplate describes one CapCut template scraped from the JJ site.
type jjTemplate struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Slots   int    `json:"slots"`
	Ratio   string `json:"ratio,omitempty"`
	ViewURL string `json:"view_url"`
}

// jjPhoto is one uploaded image held in memory for CDP injection.
type jjPhoto struct {
	Name string
	Mime string
	Data []byte
}

type jjJob struct {
	ID          string      `json:"id"`
	Status      string      `json:"status"` // processing|selesai|gagal|timeout|error
	Success     bool        `json:"success"`
	Source      string      `json:"source"`
	Template    *jjTemplate `json:"template,omitempty"`
	PhotoCount  int         `json:"photo_count"`
	DownloadURL string      `json:"download_url,omitempty"`
	ViewAction  string      `json:"view_action,omitempty"`
	TaskText    string      `json:"task_text,omitempty"`
	Error       string      `json:"error,omitempty"`
	Note        string      `json:"note,omitempty"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

var (
	jjJobsMu sync.RWMutex
	jjJobs   = map[string]*jjJob{}

	reJJSlots = regexp.MustCompile(`(?i)(\d+)\s*foto`)
	reJJRatio = regexp.MustCompile(`(?i)\b(\d+:\d+)\b`)
	reJJView  = regexp.MustCompile(`/view/(\d+)`)
	reJJID    = regexp.MustCompile(`^\d+$`)
)

func jjNewID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("jj%d", time.Now().UnixNano())
	}
	return "jj_" + hex.EncodeToString(b)
}

func jjStoreJob(job *jjJob) {
	jjJobsMu.Lock()
	// cleanup expired
	now := time.Now()
	for id, j := range jjJobs {
		if now.Sub(j.UpdatedAt) > jjJobTTL {
			delete(jjJobs, id)
		}
	}
	jjJobs[job.ID] = job
	jjJobsMu.Unlock()
}

func jjGetJob(id string) *jjJob {
	jjJobsMu.RLock()
	j, ok := jjJobs[id]
	jjJobsMu.RUnlock()
	if !ok {
		return nil
	}
	return j
}

func jjUpdateJob(id string, fn func(*jjJob)) {
	jjJobsMu.Lock()
	if j, ok := jjJobs[id]; ok {
		fn(j)
		j.UpdatedAt = time.Now()
	}
	jjJobsMu.Unlock()
}

func jjJobSnapshot(j *jjJob) map[string]any {
	jjJobsMu.RLock()
	defer jjJobsMu.RUnlock()
	resp := map[string]any{
		"success":     j.Success,
		"job_id":      j.ID,
		"status":      j.Status,
		"source":      j.Source,
		"photo_count": j.PhotoCount,
		"created_at":  j.CreatedAt.Format(time.RFC3339),
		"updated_at":  j.UpdatedAt.Format(time.RFC3339),
	}
	if j.Template != nil {
		resp["template"] = j.Template
	}
	if j.DownloadURL != "" {
		resp["download_url"] = j.DownloadURL
	}
	if j.ViewAction != "" {
		resp["view_action"] = j.ViewAction
	}
	if j.TaskText != "" {
		resp["task_text"] = j.TaskText
	}
	if j.Error != "" {
		resp["error"] = j.Error
	}
	if j.Note != "" {
		resp["note"] = j.Note
	}
	return resp
}

// jjPOST creates a JJ generation job (async). Use GET ?id=... to fetch status/result.
func (h *handler) jjPOST(w http.ResponseWriter, r *http.Request) {
	status, payload := h.createJJJob(r)
	httpx.JSON(w, status, payload)
}

// jjGET returns status/result of a JJ generation job.
func (h *handler) jjGET(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		id = strings.TrimSpace(r.URL.Query().Get("job_id"))
	}
	if id == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Parameter id (job_id) wajib diisi",
		})
		return
	}
	job := jjGetJob(id)
	if job == nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{
			"success": false,
			"error":   "Job tidak ditemukan atau sudah kedaluwarsa",
			"job_id":  id,
		})
		return
	}
	httpx.JSON(w, http.StatusOK, jjJobSnapshot(job))
}

func (h *handler) createJJJob(r *http.Request) (int, any) {
	// multipart body: field file "photos"/"files"/"file" (multiple), opsional "template_id".
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Body harus multipart/form-data dengan field foto (photos/files/file)",
		}
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	templateID := strings.TrimSpace(r.FormValue("template_id"))
	if templateID == "" {
		templateID = strings.TrimSpace(r.FormValue("template"))
	}
	if templateID != "" && !reJJID.MatchString(templateID) {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "template_id tidak valid",
		}
	}

	photos, err := collectJJPhotos(r)
	if err != nil {
		return http.StatusBadRequest, map[string]any{"success": false, "error": err.Error()}
	}
	if len(photos) == 0 {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Minimal 1 foto wajib diunggah (field: photos/files/file)",
		}
	}

	// fetch templates & validate/pick synchronously so client gets fast feedback
	ctxPick, cancelPick := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancelPick()

	templates, err := jjFetchTemplates(ctxPick)
	if err != nil {
		return http.StatusFailedDependency, map[string]any{
			"success": false,
			"error":   "Gagal mengambil daftar template JJ: " + err.Error(),
		}
	}
	if len(templates) == 0 {
		return http.StatusFailedDependency, map[string]any{
			"success": false,
			"error":   "Daftar template JJ kosong/tidak dapat dibaca",
		}
	}

	maxSlots := 0
	for _, t := range templates {
		if t.Slots > maxSlots {
			maxSlots = t.Slots
		}
	}
	if len(photos) > maxSlots {
		return http.StatusBadRequest, map[string]any{
			"success":    false,
			"error":      fmt.Sprintf("Jumlah foto (%d) melebihi slot terbanyak template (%d)", len(photos), maxSlots),
			"max_photos": maxSlots,
		}
	}

	selected, selErr := jjPickTemplate(templates, len(photos), templateID)
	if selErr != nil {
		supported := jjSupportedSlots(templates)
		return http.StatusBadRequest, map[string]any{
			"success":         false,
			"error":           selErr.Error(),
			"photo_count":     len(photos),
			"supported_slots": supported,
			"max_photos":      maxSlots,
		}
	}

	now := time.Now()
	job := &jjJob{
		ID:         jjNewID(),
		Status:     "processing",
		Success:    false,
		Source:     jjBaseURL,
		Template:   &selected,
		PhotoCount: len(photos),
		Note:       "Render berjalan di latar; cek status via GET ?id=. Tautan hasil bertoken/bermasa berlaku.",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	jjStoreJob(job)

	go jjRunJob(job.ID, selected, photos)

	return http.StatusAccepted, jjJobSnapshot(job)
}

func jjRunJob(id string, tpl jjTemplate, photos []jjPhoto) {
	ctx, cancel := context.WithTimeout(context.Background(), jjRenderTimeout+2*time.Minute)
	defer cancel()

	result, genErr := jjGenerate(ctx, tpl, photos)
	jjUpdateJob(id, func(j *jjJob) {
		if genErr != nil {
			j.Status = "error"
			j.Success = false
			j.Error = genErr.Error()
			return
		}
		j.TaskText = result.TaskText
		j.ViewAction = result.ViewURL
		j.DownloadURL = result.DownloadURL
		switch {
		case result.Done && result.DownloadURL != "":
			j.Status = "selesai"
			j.Success = true
			j.Note = "Tautan hasil bertoken/bermasa berlaku; simpan/unduh segera."
		case result.Failed:
			j.Status = "gagal"
			j.Success = false
			if j.Error == "" {
				j.Error = "Proses render gagal"
			}
		default:
			j.Status = "timeout"
			j.Success = false
			j.Error = "Timeout menunggu hasil render"
		}
	})
}

// collectJJPhotos reads uploaded image files from multipart form.
func collectJJPhotos(r *http.Request) ([]jjPhoto, error) {
	var fhs []*multipart.FileHeader
	for _, key := range []string{"photos", "photos[]", "files", "files[]", "file", "file[]"} {
		if r.MultipartForm != nil {
			if v, ok := r.MultipartForm.File[key]; ok {
				fhs = append(fhs, v...)
			}
		}
	}
	if len(fhs) == 0 {
		// fallback: ambil semua file parts
		if r.MultipartForm != nil {
			for _, v := range r.MultipartForm.File {
				fhs = append(fhs, v...)
			}
		}
	}

	photos := make([]jjPhoto, 0, len(fhs))
	for _, fh := range fhs {
		if fh == nil {
			continue
		}
		f, err := fh.Open()
		if err != nil {
			return nil, fmt.Errorf("gagal membaca file %q: %w", fh.Filename, err)
		}
		data, err := io.ReadAll(io.LimitReader(f, jjMaxPhotoBytes+1))
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("gagal membaca file %q: %w", fh.Filename, err)
		}
		if len(data) == 0 {
			continue
		}
		if len(data) > jjMaxPhotoBytes {
			return nil, fmt.Errorf("file %q melebihi %d MB", fh.Filename, jjMaxPhotoBytes>>20)
		}
		mime := strings.ToLower(strings.TrimSpace(fh.Header.Get("Content-Type")))
		if mime == "" || mime == "application/octet-stream" {
			mime = sniffJJMime(data, fh.Filename)
		}
		if !strings.HasPrefix(mime, "image/jpeg") && !strings.HasPrefix(mime, "image/png") {
			return nil, fmt.Errorf("file %q harus gambar JPG/PNG (dapat: %s)", fh.Filename, mime)
		}
		if strings.HasPrefix(mime, "image/jpeg") {
			mime = "image/jpeg"
		} else {
			mime = "image/png"
		}
		name := fh.Filename
		if strings.TrimSpace(name) == "" {
			if mime == "image/png" {
				name = "photo.png"
			} else {
				name = "photo.jpg"
			}
		}
		photos = append(photos, jjPhoto{Name: name, Mime: mime, Data: data})
	}
	return photos, nil
}

func sniffJJMime(data []byte, name string) string {
	ln := strings.ToLower(name)
	switch {
	case strings.HasSuffix(ln, ".png"):
		return "image/png"
	case strings.HasSuffix(ln, ".jpg"), strings.HasSuffix(ln, ".jpeg"):
		return "image/jpeg"
	}
	if len(data) >= 8 && data[0] == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G' {
		return "image/png"
	}
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg"
	}
	return "application/octet-stream"
}

func jjSupportedSlots(ts []jjTemplate) []int {
	seen := map[int]bool{}
	out := []int{}
	for _, t := range ts {
		if t.Slots > 0 && !seen[t.Slots] {
			seen[t.Slots] = true
			out = append(out, t.Slots)
		}
	}
	// simple sort
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func jjPickTemplate(ts []jjTemplate, photoCount int, forceID string) (jjTemplate, error) {
	if forceID != "" {
		for _, t := range ts {
			if t.ID == forceID {
				if t.Slots != photoCount {
					return jjTemplate{}, fmt.Errorf("template %s membutuhkan %d foto, tetapi diterima %d foto", forceID, t.Slots, photoCount)
				}
				return t, nil
			}
		}
		return jjTemplate{}, fmt.Errorf("template_id %s tidak ditemukan", forceID)
	}
	cands := make([]jjTemplate, 0)
	for _, t := range ts {
		if t.Slots == photoCount {
			cands = append(cands, t)
		}
	}
	if len(cands) == 0 {
		return jjTemplate{}, fmt.Errorf("tidak ada template yang cocok untuk %d foto", photoCount)
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(cands))))
	if err != nil {
		return cands[0], nil
	}
	return cands[n.Int64()], nil
}

// --- CDP helpers for JJ ---

func jjFetchTemplates(ctx context.Context) ([]jjTemplate, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, jjCDPURL, nil)
	if err != nil {
		return nil, fmt.Errorf("cdp dial: %w", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")
	c := &cdpClient{conn: conn, ctx: ctx}

	targetID, sid, err := jjNewPage(c, jjBaseURL+"/")
	if err != nil {
		return nil, err
	}
	defer func() { _, _ = c.call("Target.closeTarget", map[string]any{"targetId": targetID}, "") }()

	// tunggu konten termuat
	_ = c.waitFor(ctx, sid, `document.querySelectorAll('a[href*="/view/"]').length > 0`, 25*time.Second)
	_ = sleepCtx(ctx, 1500*time.Millisecond)

	val, err := c.eval(sid, `(function(){
  const as = Array.from(document.querySelectorAll('a[href*="/view/"]'));
  const out = [];
  const seen = {};
  for(const a of as){
    const href = a.getAttribute('href')||'';
    const m = href.match(/\/view\/(\d+)/);
    if(!m) continue;
    const id = m[1];
    if(seen[id]) continue; seen[id]=1;
    const text = (a.innerText||'').replace(/\s+/g,' ').trim();
    const sm = text.match(/(\d+)\s*foto/i);
    const rm = text.match(/\b(\d+:\d+)\b/);
    const slots = sm ? parseInt(sm[1],10) : 0;
    let title = text;
    if(sm){ title = text.replace(/\s*\d+\s*foto.*/i,'').trim() || text; }
    out.push({id:id, title:title, slots:slots, ratio: rm?rm[1]:'', view_url: location.origin + '/view/' + id});
  }
  return JSON.stringify(out);
})()`)
	if err != nil {
		return nil, fmt.Errorf("gagal membaca template: %w", err)
	}
	var items []jjTemplate
	if err := json.Unmarshal([]byte(val), &items); err != nil {
		return nil, fmt.Errorf("parse template gagal: %w", err)
	}
	// filter valid
	out := make([]jjTemplate, 0, len(items))
	for _, it := range items {
		if it.ID == "" || it.Slots <= 0 {
			continue
		}
		if it.ViewURL == "" {
			it.ViewURL = jjBaseURL + "/view/" + it.ID
		}
		out = append(out, it)
	}
	return out, nil
}

type jjGenerateResult struct {
	Done        bool
	Failed      bool
	DownloadURL string
	ViewURL     string
	TaskText    string
}

func jjGenerate(ctx context.Context, tpl jjTemplate, photos []jjPhoto) (jjGenerateResult, error) {
	createURL := jjBaseURL + "/create/" + tpl.ID

	conn, _, err := websocket.Dial(ctx, jjCDPURL, nil)
	if err != nil {
		return jjGenerateResult{}, fmt.Errorf("cdp dial: %w", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")
	c := &cdpClient{conn: conn, ctx: ctx}

	targetID, sid, err := jjNewPage(c, createURL)
	if err != nil {
		return jjGenerateResult{}, err
	}
	defer func() { _, _ = c.call("Target.closeTarget", map[string]any{"targetId": targetID}, "") }()

	// tunggu form upload siap
	if err := c.waitFor(ctx, sid, `!!document.querySelector('input[type=file]')`, 30*time.Second); err != nil {
		return jjGenerateResult{}, fmt.Errorf("halaman create tidak siap: %w", err)
	}
	_ = sleepCtx(ctx, 1500*time.Millisecond)

	// inject file via DataTransfer (file ada di server, bukan FS browser remote)
	payloads := make([]map[string]any, 0, len(photos))
	for _, p := range photos {
		payloads = append(payloads, map[string]any{
			"name": p.Name,
			"mime": p.Mime,
			"b64":  base64.StdEncoding.EncodeToString(p.Data),
		})
	}
	pb, _ := json.Marshal(payloads)
	injectExpr := fmt.Sprintf(`(function(){
  const items = %s;
  const input = document.querySelector('input[type=file]');
  if(!input) return 'NO_INPUT';
  const dt = new DataTransfer();
  for(const it of items){
    const bin = atob(it.b64);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    dt.items.add(new File([bytes], it.name||'photo.jpg', {type: it.mime||'image/jpeg'}));
  }
  input.files = dt.files;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
  return 'FILES='+input.files.length;
})()`, string(pb))
	injectRes, err := c.eval(sid, injectExpr)
	if err != nil {
		return jjGenerateResult{}, fmt.Errorf("gagal inject foto: %w", err)
	}
	if injectRes != fmt.Sprintf("FILES=%d", len(photos)) {
		return jjGenerateResult{}, fmt.Errorf("gagal menyiapkan foto (%s)", injectRes)
	}
	_ = sleepCtx(ctx, 1500*time.Millisecond)

	// submit
	submitRes, err := c.eval(sid, `(function(){
  const b = Array.from(document.querySelectorAll('button')).find(x=>/submit/i.test((x.innerText||x.textContent||'')));
  if(!b) return 'NO_SUBMIT';
  if(b.disabled) return 'DISABLED';
  b.click();
  return 'CLICKED';
})()`)
	if err != nil || submitRes != "CLICKED" {
		if err != nil {
			return jjGenerateResult{}, fmt.Errorf("gagal submit: %w", err)
		}
		return jjGenerateResult{}, fmt.Errorf("gagal submit: %s", submitRes)
	}

	// poll status task
	deadline := time.Now().Add(jjRenderTimeout)
	var last jjGenerateResult
	for time.Now().Before(deadline) {
		if err := sleepCtx(ctx, jjPollInterval); err != nil {
			return last, err
		}
		st, err := jjReadState(c, sid)
		if err != nil {
			continue
		}
		last = st
		if st.Done || st.Failed {
			return st, nil
		}
	}
	return last, nil
}

func jjReadState(c *cdpClient, sid string) (jjGenerateResult, error) {
	expr := `(function(){
  const text = (document.body && document.body.innerText || '').slice(0,8000);
  let task = '';
  const idx = text.indexOf('Task kamu');
  if(idx >= 0) task = text.slice(idx, idx+1200);
  const vids = Array.from(document.querySelectorAll('video,source')).map(v=>v.src||v.currentSrc||'').filter(Boolean);
  const links = Array.from(document.querySelectorAll('a')).map(a=>({href:a.href||'', text:(a.innerText||'').trim()}));
  let dl = '';
  let view = '';
  for(const l of links){
    const h=l.href||''; const t=(l.text||'').toLowerCase();
    if(!dl && (/unduh|download/i.test(t) || /mp4|evercloud|capcut|media/i.test(h)) && /^https?:/i.test(h)) dl=h;
    if(!view && /lihat|view/i.test(t) && /^https?:/i.test(h)) view=h;
  }
  if(!dl){ for(const v of vids){ if(/^https?:/i.test(v)) { dl=v; break; } } }
  const done = /selesai|berhasil/i.test(task) || (!!dl);
  const failed = /gagal|error|failed/i.test(task);
  return JSON.stringify({task:task, dl:dl, view:view, done:done, failed:failed});
})()`
	val, err := c.eval(sid, expr)
	if err != nil {
		return jjGenerateResult{}, err
	}
	var st struct {
		Task   string `json:"task"`
		DL     string `json:"dl"`
		View   string `json:"view"`
		Done   bool   `json:"done"`
		Failed bool   `json:"failed"`
	}
	if err := json.Unmarshal([]byte(val), &st); err != nil {
		return jjGenerateResult{}, err
	}
	return jjGenerateResult{
		Done:        st.Done && st.DL != "",
		Failed:      st.Failed,
		DownloadURL: st.DL,
		ViewURL:     st.View,
		TaskText:    st.Task,
	}, nil
}

func jjNewPage(c *cdpClient, url string) (targetID, sessionID string, err error) {
	raw, err := c.call("Target.createTarget", map[string]any{"url": "about:blank"}, "")
	if err != nil {
		return "", "", fmt.Errorf("create target: %w", err)
	}
	var ct struct {
		TargetID string `json:"targetId"`
	}
	if err := json.Unmarshal(raw, &ct); err != nil || ct.TargetID == "" {
		return "", "", errors.New("targetId tidak ditemukan")
	}
	targetID = ct.TargetID

	raw, err = c.call("Target.attachToTarget", map[string]any{"targetId": targetID, "flatten": true}, "")
	if err != nil {
		_, _ = c.call("Target.closeTarget", map[string]any{"targetId": targetID}, "")
		return "", "", fmt.Errorf("attach: %w", err)
	}
	var att struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &att); err != nil || att.SessionID == "" {
		_, _ = c.call("Target.closeTarget", map[string]any{"targetId": targetID}, "")
		return "", "", errors.New("sessionId tidak ditemukan")
	}
	sessionID = att.SessionID

	_, _ = c.call("Page.enable", map[string]any{}, sessionID)
	_, _ = c.call("Runtime.enable", map[string]any{}, sessionID)
	if _, err := c.call("Page.navigate", map[string]any{"url": url}, sessionID); err != nil {
		_, _ = c.call("Target.closeTarget", map[string]any{"targetId": targetID}, "")
		return "", "", fmt.Errorf("navigate: %w", err)
	}
	_ = sleepCtx(c.ctx, 4000*time.Millisecond)
	return targetID, sessionID, nil
}
