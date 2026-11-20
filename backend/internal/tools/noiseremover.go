package tools

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	nirkyyBase          = "https://nirkyy-a.hf.space"
	nirkyyUploadURL     = nirkyyBase + "/gradio_api/upload"
	nirkyyCallURL       = nirkyyBase + "/gradio_api/call/denoise"
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

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengunggah audio ke nirkyy-a.hf.space..."})
	uploadedPath, err := nirkyyUpload(ctx, data, filename, contentType)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal unggah ke layanan: " + err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Memproses penghapusan noise..."})
	resultURL, resultName, err := nirkyyDenoise(ctx, uploadedPath, filename)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengunduh hasil..."})
	outData, outMime, err := nirkyyDownload(ctx, resultURL)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal mengunduh hasil: " + err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengunggah hasil..."})
	if resultName == "" {
		resultName = "cleaned.wav"
	}
	if outMime == "" {
		outMime = "audio/wav"
	}
	hostedURL, err := uploadToTmpfiles(ctx, outData, resultName, outMime)
	emitter.stopHeartbeat()
	if err != nil {
		emitter.emit(map[string]any{"event": "done", "success": false, "status": "error", "error": "Gagal unggah hasil: " + err.Error(), "httpStatus": 502})
		return
	}

	emitter.emit(map[string]any{
		"event":   "done",
		"success": true,
		"status":  "success",
		"source":  "nirkyy-a.hf.space",
		"url":     hostedURL,
		"size":    len(outData),
	})
}

func nirkyyUpload(ctx context.Context, data []byte, filename, contentType string) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("files", filename)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, nirkyyUploadURL, &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("upload gagal (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var arr []string
	if err := json.Unmarshal(body, &arr); err == nil && len(arr) > 0 && strings.TrimSpace(arr[0]) != "" {
		return strings.TrimSpace(arr[0]), nil
	}
	var obj struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(body, &obj); err == nil && strings.TrimSpace(obj.Path) != "" {
		return strings.TrimSpace(obj.Path), nil
	}
	return "", fmt.Errorf("respons upload tidak valid: %s", strings.TrimSpace(string(body)))
}

func nirkyyDenoise(ctx context.Context, uploadedPath, origName string) (string, string, error) {
	payload := map[string]any{
		"data": []any{
			map[string]any{
				"path":      uploadedPath,
				"meta":      map[string]any{"_type": "gradio.FileData"},
				"orig_name": origName,
			},
		},
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, nirkyyCallURL, bytes.NewReader(b))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", "", fmt.Errorf("gagal memulai proses (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var call struct {
		EventID string `json:"event_id"`
	}
	if err := json.Unmarshal(body, &call); err != nil || strings.TrimSpace(call.EventID) == "" {
		return "", "", fmt.Errorf("event_id tidak ditemukan: %s", strings.TrimSpace(string(body)))
	}

	sseURL := nirkyyCallURL + "/" + call.EventID
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, sseURL, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "text/event-stream")
	sseResp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer sseResp.Body.Close()
	if sseResp.StatusCode < 200 || sseResp.StatusCode > 299 {
		sb, _ := io.ReadAll(io.LimitReader(sseResp.Body, 2<<20))
		return "", "", fmt.Errorf("gagal membaca status proses (HTTP %d): %s", sseResp.StatusCode, strings.TrimSpace(string(sb)))
	}

	type fileData struct {
		Path     string `json:"path"`
		URL      string `json:"url"`
		OrigName string `json:"orig_name"`
	}

	scanner := bufio.NewScanner(sseResp.Body)
	// allow larger SSE data lines
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 2*1024*1024)
	var curEvent string
	var dataLines []string
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if curEvent != "" || len(dataLines) > 0 {
				dataStr := strings.Join(dataLines, "\n")
				switch curEvent {
				case "complete":
					var arr []fileData
					if err := json.Unmarshal([]byte(dataStr), &arr); err == nil && len(arr) > 0 {
						u := strings.TrimSpace(arr[0].URL)
						if u == "" && strings.TrimSpace(arr[0].Path) != "" {
							u = nirkyyBase + "/gradio_api/file=" + arr[0].Path
						}
						if u == "" {
							return "", "", fmt.Errorf("URL hasil tidak ditemukan")
						}
						return u, arr[0].OrigName, nil
					}
					return "", "", fmt.Errorf("respons hasil tidak valid")
				case "error":
					msg := strings.TrimSpace(dataStr)
					if msg == "" {
						msg = "proses denoise gagal"
					}
					return "", "", fmt.Errorf("%s", msg)
				}
			}
			curEvent = ""
			dataLines = nil
			continue
		}
		if strings.HasPrefix(line, "event:") {
			curEvent = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			continue
		}
	}
	if err := scanner.Err(); err != nil {
		return "", "", fmt.Errorf("gagal membaca stream: %w", err)
	}
	return "", "", fmt.Errorf("stream selesai tanpa hasil")
}

func nirkyyDownload(ctx context.Context, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, noiseMaxSourceBytes+1))
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, "", fmt.Errorf("unduh hasil gagal (HTTP %d)", resp.StatusCode)
	}
	if len(data) > noiseMaxSourceBytes {
		return nil, "", fmt.Errorf("hasil melebihi batas ukuran")
	}
	ct := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return data, ct, nil
}
