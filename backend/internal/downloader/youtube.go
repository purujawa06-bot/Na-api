package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	vidssaveAPIBase = "https://api.vidssave.com/api/contentsite_api"
	vidssaveAuth    = "20250901majwlqo"
	vidssaveDomain  = "api-ak.vidssave.com"
	// vidssavePollBudget bounds the download-link polling, as in lib/vidssave.js.
	vidssavePollBudget = 40 * time.Second
	// vidssavePollInterval matches the 2.5s sleep between polls.
	vidssavePollInterval = 2500 * time.Millisecond
	// e2bGapNote documents the one source that was not ported: lib/e2b-yt.js
	// drives a yt-dlp sandbox through the E2B SDK, which is not vendored here.
	e2bGapNote = "sandbox E2B belum tersedia di backend Go (butuh SDK @e2b/code-interpreter)"
)

// vidssaveResource is one downloadable quality of a parsed video.
type vidssaveResource struct {
	ResourceContent string `json:"resource_content"`
	Quality         string `json:"quality"`
	Format          string `json:"format"`
	Type            string `json:"type"`
	Size            any    `json:"size"`
}

// vidssaveMedia is the media/parse payload.
type vidssaveMedia struct {
	ID        any                `json:"id"`
	Title     string             `json:"title"`
	Thumbnail string             `json:"thumbnail"`
	Duration  any                `json:"duration"`
	Resources []vidssaveResource `json:"resources"`
}

// vidssaveEnvelope is the common response shape of the vidssave API.
type vidssaveEnvelope struct {
	Status     float64         `json:"status"`
	Msg        any             `json:"msg"`
	StatusCode any             `json:"status_code"`
	Data       json.RawMessage `json:"data"`
}

// youtubeQuality is one entry of the advertised quality list.
type youtubeQuality struct {
	Quality string `json:"quality"`
	Format  string `json:"format"`
	Type    string `json:"type"`
	Size    any    `json:"size"`
}

// youtubeDownload is the selected download target.
type youtubeDownload struct {
	URL     string `json:"url"`
	Quality string `json:"quality"`
	Format  string `json:"format"`
	Type    string `json:"type"`
	Size    any    `json:"size"`
}

// youtubePayload is the download result produced by vidssave.
type youtubePayload struct {
	ID        any              `json:"id"`
	Title     string           `json:"title"`
	Thumbnail string           `json:"thumbnail"`
	Duration  any              `json:"duration"`
	Qualities []youtubeQuality `json:"qualities"`
	Download  youtubeDownload  `json:"download"`
}

// youtubeResponse is the success envelope of the YouTube downloader.
type youtubeResponse struct {
	Success      bool   `json:"success"`
	Source       string `json:"source"`
	FallbackFrom string `json:"fallbackFrom,omitempty"`
	youtubePayload
}

func (h *handler) youtubeGET(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	mediaType := r.URL.Query().Get("type")
	quality := r.URL.Query().Get("quality")
	h.cachedGET(w, r, func(ctx context.Context) (int, any) {
		return h.produceYoutube(ctx, rawURL, mediaType, quality)
	})
}

func (h *handler) youtubePOST(w http.ResponseWriter, r *http.Request) {
	body, err := decodeBody(r)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": `Body harus JSON: {"url": "..."}`})
		return
	}
	status, payload := h.produceYoutube(
		r.Context(),
		stringField(body, "url"),
		stringField(body, "type"),
		stringField(body, "quality"),
	)
	httpx.JSON(w, status, payload)
}

// youtubeHostAllowed accepts youtube.com and youtu.be with their subdomains.
func youtubeHostAllowed(host string) bool {
	return hostIsDomainOrSubdomain(host, "youtube.com") || hostIsDomainOrSubdomain(host, "youtu.be")
}

func (h *handler) produceYoutube(ctx context.Context, rawURL, mediaType, quality string) (int, any) {
	if invalid := validateDownloadURL(rawURL, youtubeHostAllowed, "URL harus dari domain youtube.com atau youtu.be"); invalid != nil {
		return http.StatusBadRequest, map[string]any{"error": invalid.message}
	}

	result, err := h.downloadYoutube(ctx, rawURL, mediaType, quality)
	if err != nil {
		// The original route always reports both sources in the failure text.
		return http.StatusBadGateway, map[string]any{
			"success": false,
			"error":   fmt.Sprintf("E2B: %s | vidssave: %s", e2bGapNote, err.Error()),
		}
	}

	return http.StatusOK, youtubeResponse{
		Success:        true,
		Source:         "vidssave.com",
		FallbackFrom:   e2bGapNote,
		youtubePayload: *result,
	}
}

// downloadYoutube parses the URL with vidssave and resolves one download link.
func (h *handler) downloadYoutube(ctx context.Context, rawURL, mediaType, quality string) (*youtubePayload, error) {
	parsed, err := h.parseYoutube(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	if len(parsed.Resources) == 0 {
		return nil, errors.New("Tidak ada resource yang tersedia untuk URL ini")
	}

	if mediaType != "audio" {
		mediaType = "video"
	}
	picked := pickVidssaveResource(parsed.Resources, mediaType, quality)
	if picked == nil {
		return nil, errors.New("Kualitas yang diminta tidak tersedia")
	}

	link, err := h.resolveVidssaveLink(ctx, picked.ResourceContent)
	if err != nil {
		return nil, err
	}

	qualities := make([]youtubeQuality, 0, len(parsed.Resources))
	for _, resource := range parsed.Resources {
		qualities = append(qualities, youtubeQuality{
			Quality: resource.Quality,
			Format:  resource.Format,
			Type:    resource.Type,
			Size:    resource.Size,
		})
	}

	return &youtubePayload{
		ID:        parsed.ID,
		Title:     parsed.Title,
		Thumbnail: parsed.Thumbnail,
		Duration:  parsed.Duration,
		Qualities: qualities,
		Download: youtubeDownload{
			URL:     link,
			Quality: picked.Quality,
			Format:  picked.Format,
			Type:    picked.Type,
			Size:    picked.Size,
		},
	}, nil
}

// parseYoutube asks vidssave for the metadata and quality list.
func (h *handler) parseYoutube(ctx context.Context, rawURL string) (*vidssaveMedia, error) {
	data, err := h.postVidssaveForm(ctx, "media/parse", url.Values{
		"origin": {"source"},
		"link":   {rawURL},
	})
	if err != nil {
		return nil, err
	}

	var media vidssaveMedia
	if err := decodeNumberAware(data, &media); err != nil {
		return nil, fmt.Errorf("respons vidssave tidak dapat dibaca: %w", err)
	}
	return &media, nil
}

// resolveVidssaveLink starts a download task and polls for the final link.
func (h *handler) resolveVidssaveLink(ctx context.Context, resourceContent string) (string, error) {
	data, err := h.postVidssaveForm(ctx, "media/download", url.Values{
		"request":    {resourceContent},
		"no_encrypt": {"1"},
	})
	if err != nil {
		return "", err
	}

	var started struct {
		TaskID json.Number `json:"task_id"`
	}
	if err := decodeNumberAware(data, &started); err != nil {
		return "", errors.New("task_id tidak diterima dari vidssave")
	}
	taskID := started.TaskID.String()
	if taskID == "" {
		return "", errors.New("task_id tidak diterima dari vidssave")
	}

	queryURL := vidssaveAPIBase + "/media/download_query?" + url.Values{
		"auth":    {vidssaveAuth},
		"domain":  {vidssaveDomain},
		"task_id": {taskID},
	}.Encode()

	deadline := time.Now().Add(vidssavePollBudget)
	for time.Now().Before(deadline) {
		if err := sleepContext(ctx, vidssavePollInterval); err != nil {
			return "", err
		}

		text, err := fetchVidssaveQuery(ctx, queryURL)
		if err != nil {
			continue // transient poll failure, retry on the next tick
		}
		dataLine := firstSSEDataLine(text)
		if dataLine == "" {
			continue
		}

		payload, err := decodeNumberAwareMap([]byte(dataLine))
		if err != nil {
			continue
		}
		if link, ok := payload["download_link"].(string); ok && link != "" {
			return link, nil
		}
		if status, ok := payload["status"]; ok && statusIsSet(status) {
			if _, hasProgress := payload["progress"]; !hasProgress {
				return "", fmt.Errorf("Download gagal di sisi vidssave: %v", status)
			}
		}
	}
	return "", errors.New("Timeout menunggu link download dari vidssave")
}

// postVidssaveForm posts the mandatory auth/domain pair plus extra fields and
// returns the raw `data` object.
func (h *handler) postVidssaveForm(ctx context.Context, path string, extra url.Values) (json.RawMessage, error) {
	form := url.Values{
		"auth":   {vidssaveAuth},
		"domain": {vidssaveDomain},
	}
	for key, values := range extra {
		form[key] = values
	}

	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	headers := map[string]string{
		"Origin":     "https://id.vidssave.com",
		"Referer":    "https://id.vidssave.com/",
		"User-Agent": webclient.UserAgentChrome,
	}
	resp, err := webclient.PostForm(reqCtx, vidssaveAPIBase+"/"+path, form, headers)
	if err != nil {
		return nil, err
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return nil, err
	}

	var envelope vidssaveEnvelope
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		return nil, fmt.Errorf("Respons tidak valid dari vidssave (%s): HTTP %d", path, resp.StatusCode)
	}
	if envelope.Status != 1 {
		return nil, errors.New(vidssaveErrorMessage(envelope.Msg, envelope.StatusCode, path))
	}
	return envelope.Data, nil
}

// vidssaveErrorMessage mirrors `json.msg || json.status_code || default`.
func vidssaveErrorMessage(message, statusCode any, path string) string {
	if text := nonEmptyString(message); text != "" {
		return text
	}
	if text := nonEmptyString(statusCode); text != "" {
		return text
	}
	return fmt.Sprintf("Upstream menolak permintaan (%s)", path)
}

// nonEmptyString renders a JSON scalar the way a truthy JS value would.
func nonEmptyString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case float64:
		if typed == 0 {
			return ""
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		if !typed {
			return ""
		}
		return "true"
	default:
		return fmt.Sprint(typed)
	}
}

// fetchVidssaveQuery performs one poll of the SSE-ish download query endpoint.
func fetchVidssaveQuery(ctx context.Context, queryURL string) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	headers := map[string]string{
		"Referer":    "https://id.vidssave.com/",
		"User-Agent": webclient.UserAgentChrome,
	}
	resp, err := webclient.Get(reqCtx, queryURL, headers)
	if err != nil {
		return "", err
	}
	return webclient.ReadBody(resp)
}

// firstSSEDataLine returns the payload of the first `data:` line.
func firstSSEDataLine(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "data:") {
			return strings.TrimSpace(line[len("data:"):])
		}
	}
	return ""
}

// statusIsSet reports whether an SSE status value is truthy in JS terms.
func statusIsSet(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case string:
		return typed != ""
	case json.Number:
		return typed.String() != "" && typed.String() != "0"
	case bool:
		return typed
	default:
		return true
	}
}

// pickVidssaveResource selects a resource by type/quality with the same
// fallbacks as lib/vidssave.js (prefer MP4 up to 1080p, then highest quality).
func pickVidssaveResource(resources []vidssaveResource, mediaType, quality string) *vidssaveResource {
	pool := make([]vidssaveResource, 0, len(resources))
	for _, resource := range resources {
		if resource.Type == mediaType {
			pool = append(pool, resource)
		}
	}
	if len(pool) == 0 {
		pool = append(pool, resources...)
	}

	if quality != "" {
		for index := range pool {
			if strings.EqualFold(pool[index].Quality, quality) {
				return &pool[index]
			}
		}
	}

	sensible := make([]vidssaveResource, 0, len(pool))
	for _, resource := range pool {
		if leadingInt(resource.Quality) <= 1080 && resource.Format == "MP4" {
			sensible = append(sensible, resource)
		}
	}
	if len(sensible) > 0 {
		pool = sensible
	}
	if len(pool) == 0 {
		return nil
	}

	best := 0
	for index := range pool {
		if leadingInt(pool[index].Quality) > leadingInt(pool[best].Quality) {
			best = index
		}
	}
	return &pool[best]
}

// decodeNumberAware decodes JSON keeping numbers as json.Number so IDs and
// sizes survive round-tripping without precision loss.
func decodeNumberAware(raw []byte, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	return decoder.Decode(target)
}

// decodeNumberAwareMap decodes a JSON object with json.Number values.
func decodeNumberAwareMap(raw []byte) (map[string]any, error) {
	var payload map[string]any
	if err := decodeNumberAware(raw, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}
