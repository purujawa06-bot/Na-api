package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	pdfleaderBase = "https://api.pdfleader.com"
	pdfleaderUA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

	noiseMaxSourceBytes = 32 << 20 // 32 MiB
	noisePollInterval   = 5 * time.Second
	noisePollTimeout    = 4 * time.Minute
)

type pdfleaderClient struct {
	http    *http.Client
	cookies map[string]string
}

//book_pdfleader_newClient
func newPdfleaderClient() (*pdfleaderClient, error) {
	return &pdfleaderClient{
		http:    &http.Client{Timeout: 60 * time.Second},
		cookies: map[string]string{},
	}, nil
}

func (c *pdfleaderClient) setCookies(resp *http.Response) {
	for _, sc := range resp.Header.Values("Set-Cookie") {
		part := sc
		if i := strings.Index(part, ";"); i >= 0 {
			part = part[:i]
		}
		if j := strings.Index(part, "="); j > 0 {
			name := strings.TrimSpace(part[:j])
			value := part[j+1:]
			if name != "" {
				c.cookies[name] = value
			}
		}
	}
}

func (c *pdfleaderClient) cookieHeader() string {
	if len(c.cookies) == 0 {
		return ""
	}
	parts := make([]string, 0, len(c.cookies))
	for k, v := range c.cookies {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, "; ")
}

func (c *pdfleaderClient) doJSON(ctx context.Context, method, endpoint string, body any) (*http.Response, []byte, error) {
	fullURL := endpoint
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		fullURL = pdfleaderBase + "/" + strings.TrimPrefix(endpoint, "/")
	}
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, fullURL, reader)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("x-pdf-app", "PDFLEADER")
	req.Header.Set("Origin", "https://pdfleader.com")
	req.Header.Set("Referer", "https://pdfleader.com/")
	req.Header.Set("User-Agent", pdfleaderUA)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if ch := c.cookieHeader(); ch != "" {
		req.Header.Set("Cookie", ch)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	c.setCookies(resp)
	data, err := io.ReadAll(io.LimitReader(resp.Body, webclient.MaxBodyBytes))
	resp.Body.Close()
	if err != nil {
		return resp, nil, err
	}
	return resp, data, nil
}

//book_pdfleader_ensureSession
func (c *pdfleaderClient) ensureSession(ctx context.Context) error {
	resp, data, err := c.doJSON(ctx, http.MethodGet, "/api/v1/user/me", nil)
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	if resp.StatusCode != http.StatusUnauthorized {
		return fmt.Errorf("user/me gagal (HTTP %d): %s", resp.StatusCode, snippet(data))
	}
	resp, data, err = c.doJSON(ctx, http.MethodPost, "/api/v1/user/create", map[string]any{})
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("user/create gagal (HTTP %d): %s", resp.StatusCode, snippet(data))
	}
	return nil
}

type uploadLinkItem struct {
	Filename string `json:"filename"`
	URL      string `json:"url"`
	Key      string `json:"key"`
}

//book_pdfleader_getUploadLink
func (c *pdfleaderClient) getUploadLink(ctx context.Context, filename string) (uploadLinkItem, error) {
	resp, data, err := c.doJSON(ctx, http.MethodPost, "/api/v1/files/upload-link", map[string]any{
		"filenames": []string{filename},
	})
	if err != nil {
		return uploadLinkItem{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return uploadLinkItem{}, fmt.Errorf("upload-link gagal (HTTP %d): %s", resp.StatusCode, snippet(data))
	}
	var items []uploadLinkItem
	if err := json.Unmarshal(data, &items); err != nil {
		return uploadLinkItem{}, fmt.Errorf("upload-link respons tidak valid: %w", err)
	}
	if len(items) == 0 || strings.TrimSpace(items[0].URL) == "" {
		return uploadLinkItem{}, fmt.Errorf("upload-link tidak mengembalikan URL")
	}
	return items[0], nil
}

//book_pdfleader_uploadToStorage
func (c *pdfleaderClient) uploadToStorage(ctx context.Context, uploadURL string, body []byte, contentType string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.ContentLength = int64(len(body))
	// Use a client without cookie jar: presigned storage URL must not receive session cookies.
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("upload storage gagal (HTTP %d): %s", resp.StatusCode, snippet(b))
	}
	return nil
}

//book_pdfleader_submitDemo
func (c *pdfleaderClient) submitDemo(ctx context.Context, filename, key string, size int, durationSeconds int) (string, error) {
	resp, data, err := c.doJSON(ctx, http.MethodPost, "/api/v1/noise-remover/demo", map[string]any{
		"filename":         filename,
		"key":              key,
		"size":             size,
		"durationSeconds":  durationSeconds,
		"outputFormat":     "preserve",
		"audioStreamIndex": 0,
	})
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("submit demo gagal (HTTP %d): %s", resp.StatusCode, snippet(data))
	}
	var out struct {
		Success bool   `json:"success"`
		DemoID  string `json:"demoId"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("respons demo tidak valid: %w", err)
	}
	if out.DemoID == "" {
		return "", fmt.Errorf("demoId tidak ditemukan pada respons submit")
	}
	return out.DemoID, nil
}

type demoResult struct {
	Success         bool   `json:"success"`
	OriginalURL     string `json:"originalUrl"`
	URL             string `json:"url"`
	Size            int64  `json:"size"`
	DurationSeconds int    `json:"durationSeconds"`
	Container       string `json:"container"`
	Status          string `json:"status"`
	Error           any    `json:"error"`
}

//book_pdfleader_pollDemo
func (c *pdfleaderClient) pollDemo(ctx context.Context, demoID string) (demoResult, error) {
	deadline := time.Now().Add(noisePollTimeout)
	for {
		resp, data, err := c.doJSON(ctx, http.MethodGet, "/api/v1/noise-remover/demo/"+url.PathEscape(demoID), nil)
		if err != nil {
			return demoResult{}, err
		}
		if resp.StatusCode >= 400 {
			return demoResult{}, fmt.Errorf("poll demo gagal (HTTP %d): %s", resp.StatusCode, snippet(data))
		}
		var out demoResult
		_ = json.Unmarshal(data, &out)
		if strings.TrimSpace(out.URL) != "" {
			return out, nil
		}
		status := strings.ToUpper(strings.TrimSpace(out.Status))
		if status == "FAILED" || status == "ERROR" || out.Error != nil {
			return demoResult{}, fmt.Errorf("demo gagal: %s", snippet(data))
		}
		if time.Now().After(deadline) {
			return demoResult{}, fmt.Errorf("demo kehabisan waktu (timeout polling)")
		}
		if err := sleepContext(ctx, noisePollInterval); err != nil {
			return demoResult{}, err
		}
	}
}

//book_pdfleader_submitFull
func (c *pdfleaderClient) submitFull(ctx context.Context, filename, key string, size int) (map[string]any, int, error) {
	resp, data, err := c.doJSON(ctx, http.MethodPost, "/api/v1/noise-remover/file-uploaded", map[string]any{
		"filename":         filename,
		"key":              key,
		"size":             size,
		"outputFormat":     "preserve",
		"audioStreamIndex": 0,
	})
	if err != nil {
		return nil, 0, err
	}
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	return out, resp.StatusCode, nil
}

//book_pdfleader_pollFull
func (c *pdfleaderClient) pollFull(ctx context.Context, fileID string) (map[string]any, error) {
	deadline := time.Now().Add(noisePollTimeout)
	for {
		// status/progress endpoint
		_, statusData, _ := c.doJSON(ctx, http.MethodPost, "/api/v1/files/"+url.PathEscape(fileID)+"/noise-removed", map[string]any{})
		var statusMap map[string]any
		_ = json.Unmarshal(statusData, &statusMap)
		if ps := strings.ToUpper(toString(statusMap["processing_status"])); ps == "FAILED" {
			return nil, fmt.Errorf("proses noise remover gagal: %s", snippet(statusData))
		}

		// fetch document/result
		resp, data, err := c.doJSON(ctx, http.MethodGet, "/api/v1/files/download/"+url.PathEscape(fileID), nil)
		if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			var doc map[string]any
			if json.Unmarshal(data, &doc) == nil {
				if u := firstNonEmpty(toString(doc["url"]), toString(doc["downloadUrl"]), toString(doc["outputUrl"])); u != "" {
					return doc, nil
				}
				ps := strings.ToUpper(toString(doc["processing_status"]))
				st := strings.ToUpper(toString(doc["status"]))
				if ps == "FAILED" || st == "FAILED" {
					return nil, fmt.Errorf("proses noise remover gagal: %s", snippet(data))
				}
			}
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("proses full kehabisan waktu (timeout polling)")
		}
		if err := sleepContext(ctx, noisePollInterval); err != nil {
			return nil, err
		}
	}
}

//book_tools_noiseRemover
func (h *handlers) noiseRemover(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	rawURL, ok := requireURLField(w, body, "file",
		`Parameter "file" (URL audio/video) wajib diisi`, "URL file tidak valid")
	if !ok {
		return
	}
	mode := "demo"
	if m, ok := stringValue(body, "mode"); ok && m != "" {
		mode = strings.ToLower(m)
	}
	if mode != "demo" && mode != "full" {
		failJSON(w, http.StatusBadRequest, `Parameter "mode" harus "demo" atau "full"`)
		return
	}
	durationSeconds := 30
	if raw, exists := body["duration_seconds"]; exists && isTruthy(raw) {
		if v, ok := parseIntLike(raw); ok {
			durationSeconds = v
		}
	}
	if durationSeconds < 1 {
		durationSeconds = 1
	}
	if durationSeconds > 30 {
		durationSeconds = 30
	}

	flusher, ok := httpx.StartNDJSON(w)
	if !ok {
		return
	}
	emitter := newNDJSONEmitter(w, flusher)
	defer emitter.close()

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengunduh file sumber..."})
	data, filename, contentType, err := downloadNoiseSource(ctx, rawURL, body)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 400})
		return
	}

	client, err := newPdfleaderClient()
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 500})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Membuat sesi pdfleader..."})
	if err := client.ensureSession(ctx); err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal membuat sesi: " + err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Meminta tautan unggah..."})
	link, err := client.getUploadLink(ctx, filename)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502})
		return
	}
	key := strings.TrimSpace(link.Key)
	if key == "" {
		key = fileKeyFromAWSLink(link.URL)
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengunggah file ke storage..."})
	if err := client.uploadToStorage(ctx, link.URL, data, contentType); err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502})
		return
	}
	_ = sleepContext(ctx, 2*time.Second)
	uploadVerify := ""
	if vr, ve := (&http.Client{Timeout: 30 * time.Second}).Get(link.URL); ve == nil {
		vb, _ := io.ReadAll(vr.Body)
		vr.Body.Close()
		head := vb
		if len(head) > 8 {
			head = head[:8]
		}
		uploadVerify = fmt.Sprintf("status=%d ct=%s len=%d head=%x", vr.StatusCode, vr.Header.Get("Content-Type"), len(vb), head)
	} else {
		uploadVerify = "err=" + ve.Error()
	}
	debugInfo := map[string]any{"filename": filename, "key": key, "size": len(data), "contentType": contentType, "link": link, "uploadVerify": uploadVerify}

	if mode == "demo" {
		emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengirim permintaan noise remover (demo)..."})
		demoID, err := client.submitDemo(ctx, filename, key, len(data), durationSeconds)
		if err != nil {
			emitter.stopHeartbeat()
			emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502, "debug": debugInfo})
			return
		}
		debugInfo["demoId"] = demoID
		emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Menunggu hasil demo..."})
		res, err := client.pollDemo(ctx, demoID)
		emitter.stopHeartbeat()
		if err != nil {
			emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502, "debug": debugInfo})
			return
		}
		emitter.emit(map[string]any{
			"event":           "done",
			"success":         true,
			"status":          "success",
			"source":          "pdfleader",
			"mode":            "demo",
			"demoId":          demoID,
			"url":             res.URL,
			"originalUrl":     res.OriginalURL,
			"size":            res.Size,
			"durationSeconds": res.DurationSeconds,
			"container":       res.Container,
			"debug":           debugInfo,
		})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengirim permintaan noise remover (full)..."})
	sub, code, err := client.submitFull(ctx, filename, key, len(data))
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502})
		return
	}
	fileID := firstNonEmpty(toString(sub["fileId"]), toString(sub["id"]))
	if code == http.StatusPaymentRequired || code >= 400 {
		emitter.stopHeartbeat()
		msg := snippetFromAny(sub)
		if msg == "" {
			msg = fmt.Sprintf("submit full gagal (HTTP %d)", code)
		}
		out := map[string]any{"event": "done", "success": false, "status": "error", "error": msg, "httpStatus": code}
		if fileID != "" {
			out["fileId"] = fileID
		}
		emitter.emit(out)
		return
	}
	if fileID == "" {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "fileId tidak ditemukan dari respons submit", "httpStatus": 502})
		return
	}
	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Menunggu hasil pemrosesan..."})
	doc, err := client.pollFull(ctx, fileID)
	emitter.stopHeartbeat()
	if err != nil {
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502})
		return
	}
	out := map[string]any{
		"event":   "done",
		"success": true,
		"status":  "success",
		"source":  "pdfleader",
		"mode":    "full",
		"fileId":  fileID,
	}
	if u := firstNonEmpty(toString(doc["url"]), toString(doc["downloadUrl"]), toString(doc["outputUrl"])); u != "" {
		out["url"] = u
	}
	if v, ok := doc["size"]; ok {
		out["size"] = v
	}
	if v, ok := doc["container"]; ok {
		out["container"] = v
	}
	emitter.emit(out)
}

func downloadNoiseSource(ctx context.Context, rawURL string, body map[string]any) ([]byte, string, string, error) {
	resp, err := webclient.Get(ctx, rawURL, map[string]string{"user-agent": webclient.UserAgentChrome})
	if err != nil {
		return nil, "", "", fmt.Errorf("gagal mengunduh file: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, "", "", fmt.Errorf("gagal mengunduh file (HTTP %d)", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, noiseMaxSourceBytes+1))
	if err != nil {
		return nil, "", "", fmt.Errorf("gagal membaca file: %w", err)
	}
	if len(data) == 0 {
		return nil, "", "", fmt.Errorf("file sumber kosong")
	}
	if len(data) > noiseMaxSourceBytes {
		return nil, "", "", fmt.Errorf("file sumber melebihi batas %d MB", noiseMaxSourceBytes/(1<<20))
	}
	filename := ""
	if v, ok := stringValue(body, "filename"); ok && v != "" {
		filename = v
	} else {
		filename = filenameFromSourceURL(rawURL)
	}
	if filename == "" {
		filename = "audio.wav"
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = mime.TypeByExtension(path.Ext(filename))
	}
	if ct == "" {
		ct = "application/octet-stream"
	}
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return data, filename, ct, nil
}

func filenameFromSourceURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	base := path.Base(strings.TrimRight(parsed.Path, "/"))
	if base == "" || base == "." || base == "/" {
		return ""
	}
	return base
}

func fileKeyFromAWSLink(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	p := strings.TrimPrefix(parsed.Path, "/")
	return p
}

func snippet(data []byte) string {
	s := strings.TrimSpace(string(data))
	if s == "" {
		return ""
	}
	if len(s) > 400 {
		return s[:400]
	}
	return s
}

func snippetFromAny(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return snippet(b)
}

func toString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	case float64:
		// avoid scientific for ints
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprintf("%v", t)
	case int:
		return fmt.Sprintf("%d", t)
	case int64:
		return fmt.Sprintf("%d", t)
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
