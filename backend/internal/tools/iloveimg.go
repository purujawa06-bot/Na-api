package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	iloveUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"

	iloveUpscalePage = "https://www.iloveimg.com/upscale-image"
	iloveRemovePage  = "https://www.iloveimg.com/remove-background"
	iloveHTMLPage    = "https://www.iloveimg.com/html-to-image"

	tmpfilesUploadURL = "https://tmpfiles.org/api/v1/upload"
)

var (
	iloveTokenRegex     = regexp.MustCompile(`"token":"([^"]+)"`)
	iloveTaskIDRegex    = regexp.MustCompile(`ilovepdfConfig\.taskId\s*=\s*'([^']+)'`)
	iloveServersRegex   = regexp.MustCompile(`"servers":(\[[^\]]*\])`)
	tmpfilesDirectRegex = regexp.MustCompile(`src="(https://tmpfiles\.org/dl/[^"]+)"`)
	imageExtensionRegex = regexp.MustCompile(`(?i)\.(png|jpe?g|webp|gif|bmp)$`)
)

// iloveSession holds the credentials scraped from an iloveimg page.
type iloveSession struct {
	token  string
	taskID string
	server string
}

// iloveResult is a processed image returned by an iloveimg tool.
type iloveResult struct {
	data     []byte
	mimetype string
	filename string
}

// iloveReferer is sent with every API call, matching the browser behaviour.
const iloveReferer = "https://www.iloveimg.com/"

// iloveHeaders builds the headers required by the iloveimg API.
func iloveHeaders(token, accept string) map[string]string {
	if accept == "" {
		accept = "application/json"
	}
	return map[string]string{
		"user-agent":    iloveUA,
		"accept":        accept,
		"authorization": "Bearer " + token,
		"referer":       iloveReferer,
	}
}

// fetchIloveSession scrapes the auth token, task id and worker server.
func fetchIloveSession(ctx context.Context, pageURL, defaultServer string) (iloveSession, error) {
	resp, err := webclient.Get(ctx, pageURL, map[string]string{"user-agent": iloveUA})
	if err != nil {
		return iloveSession{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		resp.Body.Close()
		return iloveSession{}, fmt.Errorf("Gagal ambil halaman iloveimg (HTTP %d)", resp.StatusCode)
	}
	raw, err := webclient.ReadBody(resp)
	if err != nil {
		return iloveSession{}, err
	}

	token := firstMatch(iloveTokenRegex, raw)
	taskID := firstMatch(iloveTaskIDRegex, raw)
	if token == "" || taskID == "" {
		return iloveSession{}, fmt.Errorf("Token/taskId tidak ditemukan di halaman iloveimg")
	}

	server := defaultServer
	if serversRaw := firstMatch(iloveServersRegex, raw); serversRaw != "" {
		var servers []string
		if json.Unmarshal([]byte(serversRaw), &servers) == nil && len(servers) > 0 && servers[0] != "" {
			server = servers[0]
		}
	}
	return iloveSession{token: token, taskID: taskID, server: server}, nil
}

// firstMatch returns the first capture group of pattern, or an empty string.
func firstMatch(pattern *regexp.Regexp, input string) string {
	match := pattern.FindStringSubmatch(input)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

// downloadImage fetches a public image, falling back to defaultMime when the
// upstream response has no content type.
func downloadImage(ctx context.Context, rawURL, defaultMime string) ([]byte, string, error) {
	resp, err := webclient.Get(ctx, rawURL, map[string]string{"user-agent": iloveUA})
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, "", fmt.Errorf("Gagal mengunduh gambar (HTTP %d)", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, webclient.MaxBodyBytes))
	if err != nil {
		return nil, "", err
	}
	mimetype := resp.Header.Get("Content-Type")
	if mimetype == "" {
		mimetype = defaultMime
	}
	return data, mimetype, nil
}

// multipartFile is the optional file part of a multipart request.
type multipartFile struct {
	field       string
	filename    string
	contentType string
	data        []byte
}

// postMultipart sends a multipart/form-data POST and returns the open response.
func postMultipart(ctx context.Context, rawURL string, fields [][2]string, file *multipartFile, headers map[string]string) (*http.Response, error) {
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	for _, pair := range fields {
		if err := writer.WriteField(pair[0], pair[1]); err != nil {
			return nil, err
		}
	}
	if file != nil {
		partHeader := make(textproto.MIMEHeader)
		partHeader.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`,
			escapeMultipartValue(file.field), escapeMultipartValue(file.filename)))
		contentType := file.contentType
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		partHeader.Set("Content-Type", contentType)
		part, err := writer.CreatePart(partHeader)
		if err != nil {
			return nil, err
		}
		if _, err := part.Write(file.data); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, &buffer)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", webclient.UserAgentChrome)
	}
	return webclient.Do(req)
}

// escapeMultipartValue escapes quotes and backslashes inside header parameters.
func escapeMultipartValue(value string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value)
}

// readStatusBody drains and closes a response, returning a trimmed snippet.
func readStatusBody(resp *http.Response, limit int) string {
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, int64(limit)))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

// filenameFromURL derives the upload filename from the URL's last path segment.
func filenameFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "image"
	}
	name := path.Base(strings.TrimRight(parsed.Path, "/"))
	if name == "" || name == "." || name == "/" {
		return "image"
	}
	return name
}

// iloveUploadFile uploads a file to a task and returns its server filename.
func iloveUploadFile(ctx context.Context, api, token, taskID string, file *multipartFile, includeBody bool) (string, error) {
	resp, err := postMultipart(ctx, api+"/upload",
		[][2]string{{"task", taskID}}, file, iloveHeaders(token, ""))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		if includeBody {
			body := readStatusBody(resp, 2048)
			return "", fmt.Errorf("Upload gagal (HTTP %d): %s", resp.StatusCode, body)
		}
		resp.Body.Close()
		return "", fmt.Errorf("Upload gagal (HTTP %d)", resp.StatusCode)
	}
	var payload struct {
		ServerFilename string `json:"server_filename"`
	}
	if err := webclient.DecodeJSON(resp, &payload); err != nil {
		return "", err
	}
	if payload.ServerFilename == "" {
		return "", fmt.Errorf("server_filename tidak ditemukan dari respons upload")
	}
	return payload.ServerFilename, nil
}

// upscaleImage enlarges an image 2x-4x through iloveimg.
func upscaleImage(ctx context.Context, rawURL string, scale int) (iloveResult, error) {
	session, err := fetchIloveSession(ctx, iloveUpscalePage, "api1g")
	if err != nil {
		return iloveResult{}, err
	}
	data, mimetype, err := downloadImage(ctx, rawURL, "image/png")
	if err != nil {
		return iloveResult{}, err
	}
	filename := filenameFromURL(rawURL)
	api := "https://" + session.server + "/v1"

	serverFilename, err := iloveUploadFile(ctx, api, session.token, session.taskID, &multipartFile{
		field:       "file",
		filename:    filename,
		contentType: mimetype,
		data:        data,
	}, false)
	if err != nil {
		return iloveResult{}, err
	}

	resp, err := postMultipart(ctx, api+"/upscale", [][2]string{
		{"task", session.taskID},
		{"server_filename", serverFilename},
		{"scale", strconv.Itoa(scale)},
	}, nil, iloveHeaders(session.token, "*/*"))
	if err != nil {
		return iloveResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		resp.Body.Close()
		return iloveResult{}, fmt.Errorf("Upscale gagal (HTTP %d)", resp.StatusCode)
	}
	defer resp.Body.Close()
	buffer, err := io.ReadAll(io.LimitReader(resp.Body, webclient.MaxBodyBytes))
	if err != nil {
		return iloveResult{}, err
	}
	mimetype = resp.Header.Get("Content-Type")
	if mimetype == "" {
		mimetype = "image/png"
	}
	return iloveResult{data: buffer, mimetype: mimetype, filename: filename}, nil
}

// removeImageBackground removes an image background through iloveimg.
func removeImageBackground(ctx context.Context, rawURL string) (iloveResult, error) {
	session, err := fetchIloveSession(ctx, iloveRemovePage, "api1g")
	if err != nil {
		return iloveResult{}, err
	}
	data, mimetype, err := downloadImage(ctx, rawURL, "")
	if err != nil {
		return iloveResult{}, err
	}
	filename := filenameFromURL(rawURL)
	if !imageExtensionRegex.MatchString(filename) {
		extension := map[string]string{
			"image/png":  "png",
			"image/jpeg": "jpg",
			"image/webp": "webp",
			"image/gif":  "gif",
		}[mimetype]
		if extension == "" {
			extension = "png"
		}
		base := filename
		if index := strings.Index(filename, "."); index >= 0 {
			base = filename[:index]
		}
		if base == "" {
			base = "image"
		}
		filename = base + "." + extension
	}

	api := "https://" + session.server + "/v1"
	serverFilename, err := iloveUploadFile(ctx, api, session.token, session.taskID, &multipartFile{
		field:       "file",
		filename:    filename,
		contentType: mimetype,
		data:        data,
	}, true)
	if err != nil {
		return iloveResult{}, err
	}

	resp, err := postMultipart(ctx, api+"/removebackground", [][2]string{
		{"task", session.taskID},
		{"server_filename", serverFilename},
	}, nil, iloveHeaders(session.token, ""))
	if err != nil {
		return iloveResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		resp.Body.Close()
		return iloveResult{}, fmt.Errorf("Remove background gagal (HTTP %d)", resp.StatusCode)
	}
	defer resp.Body.Close()
	buffer, err := io.ReadAll(io.LimitReader(resp.Body, webclient.MaxBodyBytes))
	if err != nil {
		return iloveResult{}, err
	}
	base := filename
	if index := strings.Index(filename, "."); index >= 0 {
		base = filename[:index]
	}
	return iloveResult{data: buffer, mimetype: "image/png", filename: base + "_nobg.png"}, nil
}

// htmlToImage renders a public web page into an image through iloveimg.
func htmlToImage(ctx context.Context, rawURL string, viewWidth float64, toFormat string) (iloveResult, error) {
	session, err := fetchIloveSession(ctx, iloveHTMLPage, "api32.ilovepdf.com")
	if err != nil {
		return iloveResult{}, err
	}
	server := session.server
	if !strings.Contains(server, ".") && !strings.HasPrefix(server, "http") {
		server += ".iloveimg.com"
	}
	if !strings.HasPrefix(server, "http") {
		server = "https://" + server
	}
	server = strings.TrimRight(server, "/")
	api := server + "/v1"

	host, err := hostFromURL(rawURL)
	if err != nil {
		return iloveResult{}, err
	}

	resp, err := postMultipart(ctx, api+"/upload", [][2]string{
		{"task", session.taskID},
		{"cloud_file", rawURL},
	}, nil, iloveHeaders(session.token, ""))
	if err != nil {
		return iloveResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body := readStatusBody(resp, 2048)
		return iloveResult{}, fmt.Errorf("Upload gagal (HTTP %d): %s", resp.StatusCode, body)
	}
	var upload struct {
		ServerFilename string `json:"server_filename"`
	}
	if err := webclient.DecodeJSON(resp, &upload); err != nil {
		return iloveResult{}, err
	}
	if upload.ServerFilename == "" {
		return iloveResult{}, fmt.Errorf("server_filename tidak ditemukan dari respons upload")
	}

	processFields := [][2]string{
		{"url", rawURL},
		{"view_width", formatNumber(viewWidth)},
		{"to_format", toFormat},
		{"block_ads", "false"},
		{"remove_popups", "false"},
		{"task", session.taskID},
		{"tool", "htmlimage"},
		{"packaged_filename", "iloveimg-htmled"},
		{"files[0][server_filename]", upload.ServerFilename},
		{"files[0][filename]", host},
		{"files[0][processed]", "true"},
	}
	processResp, err := postMultipart(ctx, api+"/process", processFields, nil, iloveHeaders(session.token, ""))
	if err != nil {
		return iloveResult{}, err
	}
	if processResp.StatusCode < 200 || processResp.StatusCode > 299 {
		body := readStatusBody(processResp, 2048)
		return iloveResult{}, fmt.Errorf("Process gagal (HTTP %d): %s", processResp.StatusCode, body)
	}
	processResp.Body.Close()

	if err := sleepContext(ctx, 1500*time.Millisecond); err != nil {
		return iloveResult{}, err
	}

	downloadURL := api + "/download/" + session.taskID
	downloadHeaders := map[string]string{
		"user-agent":    iloveUA,
		"authorization": "Bearer " + session.token,
		"referer":       iloveReferer,
	}
	downloadResp, err := webclient.Get(ctx, downloadURL, downloadHeaders)
	if err != nil {
		return iloveResult{}, err
	}
	for attempt := 0; (downloadResp.StatusCode < 200 || downloadResp.StatusCode > 299) && attempt < 5; attempt++ {
		downloadResp.Body.Close()
		if err := sleepContext(ctx, 1500*time.Millisecond); err != nil {
			return iloveResult{}, err
		}
		downloadResp, err = webclient.Get(ctx, downloadURL, downloadHeaders)
		if err != nil {
			return iloveResult{}, err
		}
	}
	if downloadResp.StatusCode < 200 || downloadResp.StatusCode > 299 {
		status := downloadResp.StatusCode
		downloadResp.Body.Close()
		return iloveResult{}, fmt.Errorf("Download hasil gagal (HTTP %d)", status)
	}
	defer downloadResp.Body.Close()
	buffer, err := io.ReadAll(io.LimitReader(downloadResp.Body, webclient.MaxBodyBytes))
	if err != nil {
		return iloveResult{}, err
	}
	contentType := downloadResp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	extension := map[string]string{
		"image/jpeg":    "jpg",
		"image/png":     "png",
		"image/webp":    "webp",
		"image/gif":     "gif",
		"image/svg+xml": "svg",
	}[contentType]
	if extension == "" {
		extension = toFormat
	}
	return iloveResult{data: buffer, mimetype: contentType, filename: host + "." + extension}, nil
}

// uploadToTmpfiles hosts an image on tmpfiles.org and resolves the direct URL.
func uploadToTmpfiles(ctx context.Context, data []byte, filename, mimetype string) (string, error) {
	resp, err := postMultipart(ctx, tmpfilesUploadURL, nil, &multipartFile{
		field:       "file",
		filename:    filename,
		contentType: mimetype,
		data:        data,
	}, nil)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		resp.Body.Close()
		return "", fmt.Errorf("Upload tmpfiles gagal (HTTP %d)", resp.StatusCode)
	}
	var payload struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := webclient.DecodeJSON(resp, &payload); err != nil {
		return "", err
	}
	if payload.Data.URL == "" {
		return "", fmt.Errorf("Gagal mengambil link gambar langsung dari tmpfiles")
	}

	page, err := webclient.Get(ctx, payload.Data.URL, map[string]string{"user-agent": "Mozilla/5.0"})
	if err != nil {
		return "", err
	}
	if page.StatusCode < 200 || page.StatusCode > 299 {
		page.Body.Close()
		return "", fmt.Errorf("Gagal mengambil link gambar langsung dari tmpfiles")
	}
	html, err := webclient.ReadBody(page)
	if err != nil {
		return "", err
	}
	if direct := firstMatch(tmpfilesDirectRegex, html); direct != "" {
		return direct, nil
	}
	return "", fmt.Errorf("Gagal mengambil link gambar langsung dari tmpfiles")
}

// sleepContext waits for the duration or until the context is cancelled.
func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// upscaler handles POST /api/tools-image/upscaler.
func (h *handlers) upscaler(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	rawURL, ok := requireURLField(w, body, "file",
		`Parameter "file" (URL gambar) wajib diisi`, "URL file tidak valid")
	if !ok {
		return
	}
	scale := 2
	if parsed, valid := parseIntLike(body["scale"]); valid && (parsed == 2 || parsed == 3 || parsed == 4) {
		scale = parsed
	}

	flusher, ok := httpx.StartNDJSON(w)
	if !ok {
		return
	}
	emitter := newNDJSONEmitter(w, flusher)
	defer emitter.close()
	emitter.startHeartbeat(heartbeatInterval, func() any {
		return streamEvent{Event: "processing", Status: "running"}
	})

	ctx, cancel := h.requestContext(r)
	defer cancel()

	result, err := upscaleImage(ctx, rawURL, scale)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(doneEvent{Event: "done", Success: false, Status: "error", Error: err.Error(), HTTPStatus: 502})
		return
	}
	emitter.emit(streamEvent{Event: "uploading", Status: "running", Message: "Mengunggah hasil ke tmpfiles.org..."})

	base := result.filename
	if index := strings.Index(base, "."); index >= 0 {
		base = base[:index]
	}
	downloadName := fmt.Sprintf("%s_%dx.png", base, scale)
	hostedURL, err := uploadToTmpfiles(ctx, result.data, downloadName, result.mimetype)
	emitter.stopHeartbeat()
	if err != nil {
		emitter.emit(doneEvent{Event: "done", Success: false, Status: "error", Error: err.Error(), HTTPStatus: 502})
		return
	}
	emitter.emit(doneEvent{
		Event:   "done",
		Success: true,
		Status:  "success",
		Source:  "iloveimg",
		Scale:   scale,
		URL:     hostedURL,
	})
}

// removeBackground handles POST /api/tools-image/remove-background.
func (h *handlers) removeBackground(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	rawURL, ok := requireURLField(w, body, "file",
		`Parameter "file" (URL gambar) wajib diisi`, "URL file tidak valid")
	if !ok {
		return
	}

	flusher, ok := httpx.StartNDJSON(w)
	if !ok {
		return
	}
	emitter := newNDJSONEmitter(w, flusher)
	defer emitter.close()
	emitter.startHeartbeat(heartbeatInterval, func() any {
		return streamEvent{Event: "processing", Status: "running"}
	})
	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Menghapus latar belakang gambar..."})

	ctx, cancel := h.requestContext(r)
	defer cancel()

	result, err := removeImageBackground(ctx, rawURL)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(doneEvent{Event: "done", Success: false, Status: "error", Error: err.Error(), HTTPStatus: 502})
		return
	}
	emitter.emit(streamEvent{Event: "uploading", Status: "running", Message: "Mengunggah hasil ke tmpfiles.org..."})
	hostedURL, err := uploadToTmpfiles(ctx, result.data, result.filename, result.mimetype)
	emitter.stopHeartbeat()
	if err != nil {
		emitter.emit(doneEvent{Event: "done", Success: false, Status: "error", Error: err.Error(), HTTPStatus: 502})
		return
	}
	emitter.emit(doneEvent{
		Event:    "done",
		Success:  true,
		Status:   "success",
		Source:   "iloveimg",
		URL:      hostedURL,
		Filename: result.filename,
		Mimetype: result.mimetype,
	})
}

// htmlToImage handles POST /api/tools-image/html-to-image.
func (h *handlers) htmlToImage(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	rawURL, ok := requireURLField(w, body, "file",
		`Parameter "file" (URL halaman web) wajib diisi`, "URL tidak valid")
	if !ok {
		return
	}

	viewWidth := 1920.0
	if raw, exists := body["view_width"]; exists && isTruthy(raw) {
		if parsed, valid := numberOf(raw); valid {
			viewWidth = parsed
		}
	}
	toFormat := "jpg"
	if format, valid := stringValue(body, "to_format"); valid && (format == "jpg" || format == "svg") {
		toFormat = format
	}

	flusher, ok := httpx.StartNDJSON(w)
	if !ok {
		return
	}
	emitter := newNDJSONEmitter(w, flusher)
	defer emitter.close()
	emitter.startHeartbeat(heartbeatInterval, func() any {
		return streamEvent{Event: "processing", Status: "running"}
	})
	emitter.emit(streamEvent{Event: "processing", Status: "running", Message: "Mengkonversi halaman web menjadi gambar..."})

	ctx, cancel := h.requestContext(r)
	defer cancel()

	result, err := htmlToImage(ctx, rawURL, viewWidth, toFormat)
	if err != nil {
		emitter.stopHeartbeat()
		emitter.emit(doneEvent{Event: "done", Success: false, Status: "error", Error: err.Error(), HTTPStatus: 502})
		return
	}
	emitter.emit(streamEvent{Event: "uploading", Status: "running", Message: "Mengunggah hasil ke tmpfiles.org..."})
	hostedURL, err := uploadToTmpfiles(ctx, result.data, result.filename, result.mimetype)
	emitter.stopHeartbeat()
	if err != nil {
		emitter.emit(doneEvent{Event: "done", Success: false, Status: "error", Error: err.Error(), HTTPStatus: 502})
		return
	}
	emitter.emit(doneEvent{
		Event:    "done",
		Success:  true,
		Status:   "success",
		Source:   "iloveimg",
		URL:      hostedURL,
		Filename: result.filename,
		Mimetype: result.mimetype,
	})
}
