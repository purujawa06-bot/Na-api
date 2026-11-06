package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const ytDownloaderBase = "https://ytdownloader.tech"

// ytDownloaderVideo is one advertised video quality from /api/resolve.
type ytDownloaderVideo struct {
	FormatID   string `json:"formatId"`
	Height     int    `json:"height"`
	SizeBytes  int64  `json:"sizeBytes"`
}

// ytDownloaderAudio is the audio payload returned by /api/resolve.
type ytDownloaderAudio struct {
	FormatID     string `json:"formatId"`
	BitrateKbps  int    `json:"bitrateKbps"`
	SizeBytes    int64  `json:"sizeBytes"`
}

// ytDownloaderResolve is the /api/resolve payload.
type ytDownloaderResolve struct {
	VideoID         string             `json:"videoId"`
	Title           string             `json:"title"`
	Channel         string             `json:"channel"`
	DurationSeconds int                `json:"durationSeconds"`
	Video           []ytDownloaderVideo `json:"video"`
	MP3             ytDownloaderAudio  `json:"mp3"`
	M4A             ytDownloaderAudio  `json:"m4a"`
}

// ytDownloaderPrepareStart is the immediate response from POST /api/prepare.
type ytDownloaderPrepareStart struct {
	Job       string `json:"job"`
	ElapsedMs int    `json:"elapsedMs"`
	Error     string `json:"error"`
}

// ytDownloaderPrepareResult is the polled result from GET /api/prepare?job=.
type ytDownloaderPrepareResult struct {
	Status     string `json:"status"`
	URL        string `json:"url"`
	FormatID   string `json:"formatId"`
	Attachment bool   `json:"attachment"`
	SaveURL    string `json:"saveUrl"`
	Error      string `json:"error"`
}

// youtubeQuality mirrors the existing quality list shape.
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

// youtubePayload is the download result produced by the provider.
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

func youtubeHostAllowed(host string) bool {
	return hostIsDomainOrSubdomain(host, "youtube.com") || hostIsDomainOrSubdomain(host, "youtu.be")
}

func (h *handler) produceYoutube(ctx context.Context, rawURL, mediaType, quality string) (status int, payload any) {
	defer func() {
		if recovered := recover(); recovered != nil {
			status = http.StatusInternalServerError
			payload = map[string]any{"success": false, "error": fmt.Sprintf("panic: %v", recovered)}
		}
	}()

	if invalid := validateDownloadURL(rawURL, youtubeHostAllowed, "URL harus dari domain youtube.com atau youtu.be"); invalid != nil {
		return http.StatusBadRequest, map[string]any{"error": invalid.message}
	}

	result, err := h.downloadYoutube(ctx, rawURL, mediaType, quality)
	if err != nil {
		return http.StatusFailedDependency, map[string]any{
			"success": false,
			"error":   err.Error(),
		}
	}
	return http.StatusOK, youtubeResponse{
		Success:        true,
		Source:         "ytdownloader.tech",
		youtubePayload: *result,
	}
}

// fetchYtdownloaderSessionCookie opens the site homepage and captures its
// session cookies, mirroring a browser request.
func fetchYtdownloaderSessionCookie(ctx context.Context) string {
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	resp, err := webclient.Get(reqCtx, ytDownloaderBase+"/", map[string]string{
		"Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
	})
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	_, _ = webclient.ReadBody(resp)

	parts := make([]string, 0, len(resp.Cookies()))
	for _, cookie := range resp.Cookies() {
		parts = append(parts, cookie.Name+"="+cookie.Value)
	}
	return strings.Join(parts, "; ")
}

func (h *handler) downloadYoutube(ctx context.Context, rawURL, mediaType, quality string) (*youtubePayload, error) {
	cookie := fetchYtdownloaderSessionCookie(ctx)
	parsed, err := h.resolveYoutube(ctx, rawURL, cookie)
	if err != nil {
		return nil, err
	}
	if parsed.VideoID == "" {
		return nil, errors.New("Tidak ada data video yang tersedia")
	}

	audioMode := strings.EqualFold(mediaType, "audio")
	var chosen *ytDownloaderVideo
	var chosenAudio *ytDownloaderAudio
	var chosenMedia string
	var qualities []youtubeQuality

	if audioMode {
		chosenMedia = "audio"
		if strings.Contains(strings.ToLower(quality), "m4a") && parsed.M4A.FormatID != "" {
			item := parsed.M4A
			chosenAudio = &item
		} else {
			item := parsed.MP3
			chosenAudio = &item
		}
		if chosenAudio.FormatID == "" {
			return nil, errors.New("Audio tidak tersedia untuk video ini")
		}
		qualities = append(qualities, youtubeQuality{
			Quality: fmt.Sprintf("%dkbps", chosenAudio.BitrateKbps),
			Format:  "MP3",
			Type:    "audio",
			Size:    chosenAudio.SizeBytes,
		})
		if parsed.M4A.FormatID != "" && parsed.M4A.FormatID != parsed.MP3.FormatID {
			qualities = append(qualities, youtubeQuality{
				Quality: fmt.Sprintf("%dkbps", parsed.M4A.BitrateKbps),
				Format:  "M4A",
				Type:    "audio",
				Size:    parsed.M4A.SizeBytes,
			})
		}
	} else {
		chosenMedia = "video"
		if len(parsed.Video) == 0 {
			return nil, errors.New("Tidak ada resource video yang tersedia")
		}
		chosen = pickYoutubeVideo(parsed.Video, quality)
		if chosen == nil {
			return nil, errors.New("Kualitas yang diminta tidak tersedia")
		}
		qualities = make([]youtubeQuality, 0, len(parsed.Video))
		for i := range parsed.Video {
			q := parsed.Video[i]
			qualities = append(qualities, youtubeQuality{
				Quality: fmt.Sprintf("%dp", q.Height),
				Format:  "MP4",
				Type:    "video",
				Size:    q.SizeBytes,
			})
		}
	}

	formatID := ""
	var chosenQuality youtubeQuality
	var chosenSize any
	if audioMode && chosenAudio != nil {
		formatID = chosenAudio.FormatID
		chosenQuality = qualities[0]
		chosenSize = chosenAudio.SizeBytes
	} else if chosen != nil {
		formatID = chosen.FormatID
		for _, q := range qualities {
			if q.Quality == fmt.Sprintf("%dp", chosen.Height) {
				chosenQuality = q
				break
			}
		}
		chosenSize = chosen.SizeBytes
	}

	fallback := make([]string, 0, len(parsed.Video))
	for _, v := range parsed.Video {
		if v.FormatID != formatID {
			fallback = append(fallback, v.FormatID)
		}
	}
	if audioMode {
		fallback = []string{}
	}

	job, err := startYoutubePrepare(ctx, parsed.VideoID, formatID, fallback, chosenMedia, cookie)
	if err != nil {
		return nil, err
	}

	link, err := pollYoutubePrepare(ctx, job, cookie)
	if err != nil {
		return nil, err
	}

	result := &youtubePayload{
		ID:        parsed.VideoID,
		Title:     parsed.Title,
		Thumbnail: "https://i.ytimg.com/vi/" + parsed.VideoID + "/hqdefault.jpg",
		Duration:  parsed.DurationSeconds,
		Qualities: qualities,
		Download: youtubeDownload{
			URL:     link,
			Quality: chosenQuality.Quality,
			Format:  chosenQuality.Format,
			Type:    chosenQuality.Type,
			Size:    chosenSize,
		},
	}
	return result, nil
}

// resolveYoutube calls the YTDownloader metadata endpoint.
func (h *handler) resolveYoutube(ctx context.Context, rawURL, cookie string) (*ytDownloaderResolve, error) {
	headers := map[string]string{
		"Origin":  ytDownloaderBase,
		"Referer": ytDownloaderBase + "/",
		"Accept":  "application/json, text/plain, */*",
	}
	if cookie != "" {
		headers["Cookie"] = cookie
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		resp, err := webclient.PostJSON(reqCtx, ytDownloaderBase+"/api/resolve", map[string]string{"url": rawURL}, headers)
		if err != nil {
			cancel()
			lastErr = err
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
			continue
		}
		body, readErr := webclient.ReadBody(resp)
		cancel()
		if readErr != nil {
			lastErr = readErr
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			msg := strings.TrimSpace(body)
			lastErr = fmt.Errorf("ytdownloader.tech resolve gagal (HTTP %d): %s", resp.StatusCode, msg)
			if resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusTooManyRequests || strings.Contains(strings.ToLower(msg), "busy") {
				time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
				continue
			}
			return nil, lastErr
		}
		var parsed ytDownloaderResolve
		if err := json.Unmarshal([]byte(body), &parsed); err != nil {
			return nil, fmt.Errorf("respons ytdownloader.tech tidak valid: %w", err)
		}
		return &parsed, nil
	}
	if lastErr == nil {
		lastErr = errors.New("ytdownloader.tech resolve gagal tanpa detail")
	}
	return nil, lastErr
}

// startYoutubePrepare starts a server-side download job.
func startYoutubePrepare(ctx context.Context, videoID, formatID string, fallback []string, media, cookie string) (string, error) {
	payload := map[string]any{
		"videoId":           videoID,
		"formatId":          formatID,
		"fallbackFormatIds": fallback,
		"media":             media,
	}
	headers := map[string]string{
		"Origin":  ytDownloaderBase,
		"Referer": ytDownloaderBase + "/",
		"Accept":  "application/json, text/plain, */*",
	}
	if cookie != "" {
		headers["Cookie"] = cookie
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		resp, err := webclient.PostJSON(reqCtx, ytDownloaderBase+"/api/prepare", payload, headers)
		if err != nil {
			cancel()
			lastErr = err
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
			continue
		}
		body, readErr := webclient.ReadBody(resp)
		cancel()
		if readErr != nil {
			lastErr = readErr
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			msg := strings.TrimSpace(body)
			lastErr = fmt.Errorf("ytdownloader.tech prepare gagal (HTTP %d): %s", resp.StatusCode, msg)
			if resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusTooManyRequests || strings.Contains(strings.ToLower(msg), "busy") {
				time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
				continue
			}
			return "", lastErr
		}
		var started ytDownloaderPrepareStart
		if err := json.Unmarshal([]byte(body), &started); err != nil {
			return "", fmt.Errorf("respons prepare tidak valid: %w", err)
		}
		if started.Error != "" {
			lastErr = fmt.Errorf("ytdownloader.tech prepare error: %s", started.Error)
			if strings.Contains(strings.ToLower(started.Error), "busy") {
				time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
				continue
			}
			return "", lastErr
		}
		if started.Job == "" {
			lastErr = errors.New("job id tidak diterima dari ytdownloader.tech")
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
			continue
		}
		return started.Job, nil
	}
	if lastErr == nil {
		lastErr = errors.New("ytdownloader.tech prepare gagal tanpa detail")
	}
	return "", lastErr
}

// pollYoutubePrepare polls until a prepared download URL is ready.
func pollYoutubePrepare(ctx context.Context, job, cookie string) (string, error) {
	deadline := time.Now().Add(90 * time.Second)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if time.Now().After(deadline) {
			return "", errors.New("timeout menunggu link download dari ytdownloader.tech")
		}

		u := ytDownloaderBase + "/api/prepare?job=" + url.QueryEscape(job)
		reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		headers := map[string]string{
			"Origin":  ytDownloaderBase,
			"Referer": ytDownloaderBase + "/",
			"Accept":  "application/json, text/plain, */*",
		}
		if cookie != "" {
			headers["Cookie"] = cookie
		}
		resp, err := webclient.Get(reqCtx, u, headers)
		if err != nil {
			cancel()
			time.Sleep(2 * time.Second)
			continue
		}
		body, err := webclient.ReadBody(resp)
		cancel()
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			time.Sleep(2 * time.Second)
			continue
		}

		var result ytDownloaderPrepareResult
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		if result.Error != "" {
			return "", fmt.Errorf("ytdownloader.tech prepare error: %s", result.Error)
		}
		if result.Status == "ready" && result.URL != "" {
			return result.URL, nil
		}
		time.Sleep(2 * time.Second)
	}
}

// pickYoutubeVideo selects a requested quality or the highest available one.
func pickYoutubeVideo(videos []ytDownloaderVideo, quality string) *ytDownloaderVideo {
	if len(videos) == 0 {
		return nil
	}
	qh := leadingInt(quality)
	if qh > 0 {
		for i := range videos {
			if videos[i].Height == qh {
				return &videos[i]
			}
		}
	}
	best := 0
	for i := range videos {
		if videos[i].Height > videos[best].Height {
			best = i
		}
	}
	return &videos[best]
}

// leadingInt is already provided by helpers.go.