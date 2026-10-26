package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	imgbbBase = "https://imgbb.com"
	imgbbJSON = "https://imgbb.com/json"
	imgbbUA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

	// imgbbMaxFileSize is the free-tier upload limit (32 MiB).
	imgbbMaxFileSize = 32 * 1024 * 1024
)

var imgbbTokenRegex = regexp.MustCompile(`auth_token="([^"]+)"`)

// imgbbResult is the normalized upload result returned to clients.
type imgbbResult struct {
	URL           string  `json:"url"`
	DisplayURL    string  `json:"display_url"`
	ThumbURL      *string `json:"thumb_url"`
	MediumURL     *string `json:"medium_url"`
	ViewerURL     *string `json:"viewer_url"`
	DeleteURL     *string `json:"delete_url"`
	Filename      *string `json:"filename"`
	Mime          *string `json:"mime"`
	Extension     *string `json:"extension"`
	Width         *int    `json:"width"`
	Height        *int    `json:"height"`
	Size          *int    `json:"size"`
	SizeFormatted *string `json:"size_formatted"`
	Expiration    int     `json:"expiration"`
	Title         *string `json:"title"`
}

// imgbbEnvelope mirrors the imgbb JSON upload response.
type imgbbEnvelope struct {
	StatusCode int    `json:"status_code"`
	StatusTxt  string `json:"status_txt"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error"`
	Image *struct {
		URL           string `json:"url"`
		DisplayURL    string `json:"display_url"`
		URLViewer     string `json:"url_viewer"`
		DeleteURL     string `json:"delete_url"`
		Filename      string `json:"filename"`
		ExtensionName string `json:"extension_name"`
		Width         *int   `json:"width"`
		Height        *int   `json:"height"`
		Size          *int   `json:"size"`
		SizeFormatted string `json:"size_formatted"`
		Expiration    *int   `json:"expiration"`
		Title         string `json:"title"`
		Thumb         *struct {
			URL string `json:"url"`
		} `json:"thumb"`
		Medium *struct {
			URL string `json:"url"`
		} `json:"medium"`
		Image *struct {
			Mime string `json:"mime"`
		} `json:"image"`
	} `json:"image"`
}

// optionalString converts an empty string to a nil pointer (JSON null).
func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// fetchImgbbToken scrapes a fresh auth token from the imgbb homepage.
func fetchImgbbToken(ctx context.Context) (string, error) {
	resp, err := webclient.Get(ctx, imgbbBase+"/", map[string]string{
		"user-agent": imgbbUA,
		"accept":     "text/html",
	})
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		resp.Body.Close()
		return "", fmt.Errorf("Gagal ambil halaman imgbb.com (HTTP %d)", resp.StatusCode)
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return "", err
	}
	token := firstMatch(imgbbTokenRegex, body)
	if token == "" {
		return "", fmt.Errorf("auth_token tidak ditemukan di halaman imgbb.com")
	}
	return token, nil
}

// pickImgbbResult validates the upload response and maps it to client fields.
func pickImgbbResult(envelope imgbbEnvelope) (imgbbResult, error) {
	if envelope.StatusCode != http.StatusOK || envelope.Image == nil {
		message := envelope.StatusTxt
		if envelope.Error != nil && envelope.Error.Message != "" {
			message = envelope.Error.Message
		}
		if message == "" {
			message = "Upload ke imgbb gagal"
		}
		return imgbbResult{}, fmt.Errorf("imgbb: %s", message)
	}
	image := envelope.Image
	displayURL := image.DisplayURL
	if displayURL == "" {
		displayURL = image.URL
	}
	expiration := 0
	if image.Expiration != nil {
		expiration = *image.Expiration
	}
	result := imgbbResult{
		URL:           image.URL,
		DisplayURL:    displayURL,
		ThumbURL:      nil,
		MediumURL:     nil,
		ViewerURL:     optionalString(image.URLViewer),
		DeleteURL:     optionalString(image.DeleteURL),
		Filename:      optionalString(image.Filename),
		Mime:          nil,
		Extension:     optionalString(image.ExtensionName),
		Width:         image.Width,
		Height:        image.Height,
		Size:          image.Size,
		SizeFormatted: optionalString(image.SizeFormatted),
		Expiration:    expiration,
		Title:         optionalString(image.Title),
	}
	if image.Thumb != nil {
		result.ThumbURL = optionalString(image.Thumb.URL)
	}
	if image.Medium != nil {
		result.MediumURL = optionalString(image.Medium.URL)
	}
	if image.Image != nil {
		result.Mime = optionalString(image.Image.Mime)
	}
	return result, nil
}

// uploadImageToImgbb pushes raw image bytes to imgbb and returns the result.
func uploadImageToImgbb(ctx context.Context, data []byte, filename, mimetype string) (imgbbResult, error) {
	token, err := fetchImgbbToken(ctx)
	if err != nil {
		return imgbbResult{}, err
	}
	resp, err := postMultipart(ctx, imgbbJSON, [][2]string{
		{"type", "file"},
		{"auth_token", token},
		{"action", "upload"},
		{"timestamp", strconv.FormatInt(time.Now().UnixMilli(), 10)},
	}, &multipartFile{
		field:       "source",
		filename:    filename,
		contentType: mimetype,
		data:        data,
	}, map[string]string{
		"user-agent": imgbbUA,
		"accept":     "application/json",
		"origin":     imgbbBase,
		"referer":    imgbbBase + "/",
	})
	if err != nil {
		return imgbbResult{}, err
	}
	var envelope imgbbEnvelope
	if err := json.NewDecoder(io.LimitReader(resp.Body, webclient.MaxBodyBytes)).Decode(&envelope); err != nil {
		resp.Body.Close()
		return imgbbResult{}, fmt.Errorf("imgbb merespon non-JSON (HTTP %d)", resp.StatusCode)
	}
	resp.Body.Close()
	return pickImgbbResult(envelope)
}

// imgbbUpload handles POST /api/uploader/imggbb.
func (h *handlers) imgbbUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		failJSON(w, http.StatusBadRequest, "Form multipart tidak valid, gunakan field file")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		failJSON(w, http.StatusBadRequest, "Parameter file (gambar) wajib diisi")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, imgbbMaxFileSize+1))
	if err != nil {
		failJSON(w, http.StatusBadGateway, "Gagal membaca file")
		return
	}
	if len(data) == 0 {
		failJSON(w, http.StatusBadRequest, "Parameter file (gambar) wajib diisi")
		return
	}
	if len(data) > imgbbMaxFileSize {
		failJSON(w, http.StatusBadRequest, "File melebihi 32 MB (limit imgbb free)")
		return
	}

	mimetype := header.Header.Get("Content-Type")
	if mimetype == "" {
		mimetype = "application/octet-stream"
	}
	if !strings.HasPrefix(mimetype, "image/") {
		failJSON(w, http.StatusBadRequest, "File harus berupa gambar (jpeg/png/gif/webp/bmp/tiff/heic)")
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()
	result, err := uploadImageToImgbb(ctx, data, header.Filename, mimetype)
	if err != nil {
		failJSON(w, http.StatusBadGateway, errorMessage(err, "Upload ke imgbb gagal"))
		return
	}

	httpx.OK(w, struct {
		Success bool   `json:"success"`
		Source  string `json:"source"`
		imgbbResult
	}{Success: true, Source: "imgbb.com", imgbbResult: result})
}
