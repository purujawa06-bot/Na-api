package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	tikdownBase = "https://tikdown.com"
)

var (
	tikdownCsrfPattern = regexp.MustCompile(`name="csrfToken" value="([^"]+)"`)
)

// tikdown shapes returned by /api/extract.php.
type tikdownUser struct {
	Name     string `json:"name"`
	Username string `json:"username"`
	Avatar   string `json:"avatar"`
}

type tikdownMediaItem struct {
	Index     int    `json:"index"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Quality   string `json:"quality"`
	Extension string `json:"extension"`
	FileSize  string `json:"fileSize"`
	Resolution string `json:"resolution"`
	Duration  string `json:"duration"`
	V5URL     string `json:"v5Url"`
	PreviewURL string `json:"previewUrl"`
	Thumbnail string `json:"thumbnail"`
}

type tikdownResult struct {
	Service     string             `json:"service"`
	ID          string             `json:"id"`
	Title       string             `json:"title"`
	Description string             `json:"description"`
	Thumbnail   string             `json:"thumbnail"`
	PreviewURL  string             `json:"previewUrl"`
	User        tikdownUser        `json:"user"`
	MediaItems  []tikdownMediaItem `json:"mediaItems"`
}

type tikdownExtractResponse struct {
	OK               bool         `json:"ok"`
	RequestID        string       `json:"requestId"`
	Cache            string       `json:"cache"`
	Result           tikdownResult `json:"result"`
	CooldownSeconds  int          `json:"cooldownSeconds"`
	Error            string       `json:"error"`
}

type tikdownTaskResponse struct {
	Status   string `json:"status"`
	FileName string `json:"fileName"`
	FileURL  string `json:"fileUrl"`
	Error    string `json:"error"`
	Percent  string `json:"percent"`
}

// tiktokResult mirrors the normalized fields returned by the downstream provider.
type tiktokResult struct {
	Author       *string `json:"author"`
	Avatar       *string `json:"avatar"`
	Caption      *string `json:"caption"`
	VideoURL     *string `json:"video_url"`
	VideoExpires *int64  `json:"video_expires"`
	MP3URL       *string `json:"mp3_url"`
}

// tiktokResponse is the success envelope of the TikTok downloader.
type tiktokResponse struct {
	Success      bool    `json:"success"`
	Source       string  `json:"source"`
	Author       *string `json:"author"`
	Avatar       *string `json:"avatar"`
	Caption      *string `json:"caption"`
	VideoURL     *string `json:"video_url"`
	VideoExpires *int64  `json:"video_expires"`
	MP3URL       *string `json:"mp3_url"`
}

func (h *handler) tiktokGET(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if r.URL.Query().Get("_diag") == "1" {
		client, err := newTikdownClient()
		if err != nil {
			httpx.JSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "step": "client"})
			return
		}
		token, err := fetchTikdownToken(r.Context(), client)
		if err != nil {
			httpx.JSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "step": "token"})
			return
		}
		rawURL := r.URL.Query().Get("url")
		if rawURL == "" {
			rawURL = "https://www.tiktok.com/@agungdarmawn_/video/7374017020418870534"
		}
		extracted, err := fetchTikdownExtract(r.Context(), client, rawURL, token)
		if err != nil {
			httpx.JSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "step": "extract"})
			return
		}
		if !extracted.OK {
			httpx.JSON(w, http.StatusBadGateway, map[string]any{"error": extracted.Error, "step": "extract_not_ok", "cooldown": extracted.CooldownSeconds})
			return
		}
		var firstV5 string
		if len(extracted.Result.MediaItems) > 0 {
			firstV5 = extracted.Result.MediaItems[0].V5URL
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"status": "extract_ok", "cooldown": extracted.CooldownSeconds, "media_count": len(extracted.Result.MediaItems), "first_v5": firstV5})
		return
	}
	h.cachedGET(w, r, func(ctx context.Context) (int, any) {
		return h.produceTiktok(ctx, rawURL)
	})
}

func (h *handler) tiktokPOST(w http.ResponseWriter, r *http.Request) {
	body, err := decodeBody(r)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": `Body harus JSON: {"url": "..."}`})
		return
	}
	status, payload := h.produceTiktok(r.Context(), stringField(body, "url"))
	httpx.JSON(w, status, payload)
}

func tiktokHostAllowed(host string) bool { return hostIsDomainOrSubdomain(host, "tiktok.com") }

func (h *handler) produceTiktok(ctx context.Context, rawURL string) (status int, payload any) {
	defer func() {
		if recovered := recover(); recovered != nil {
			status = http.StatusInternalServerError
			payload = map[string]any{"success": false, "error": fmt.Sprintf("panic: %v", recovered)}
		}
	}()

	if invalid := validateDownloadURL(rawURL, tiktokHostAllowed, "URL harus dari domain tiktok.com"); invalid != nil {
		return http.StatusBadRequest, map[string]any{"error": invalid.message}
	}

	result, err := downloadTiktok(ctx, rawURL)
	if err != nil {
		return http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()}
	}

	response := tiktokResponse{
		Success: true,
		Source:  "tikdown.com",
	}
	if result.Author != nil {
		response.Author = result.Author
	}
	if result.Avatar != nil {
		response.Avatar = result.Avatar
	}
	if result.Caption != nil {
		response.Caption = result.Caption
	}
	if result.VideoURL != nil {
		response.VideoURL = result.VideoURL
	}
	if result.VideoExpires != nil {
		response.VideoExpires = result.VideoExpires
	}
	if result.MP3URL != nil {
		response.MP3URL = result.MP3URL
	}
	return http.StatusOK, response
}

// downloadTiktok runs the tikdown.com flow: session page + CSRF token,
// extract JSON, then poll the worker v5Url links until they become direct files.
func downloadTiktok(ctx context.Context, tiktokURL string) (*tiktokResult, error) {
	client, err := newTikdownClient()
	if err != nil {
		return nil, err
	}

	token, err := fetchTikdownToken(ctx, client)
	if err != nil {
		return nil, err
	}

	extracted, err := fetchTikdownExtract(ctx, client, tiktokURL, token)
	if err != nil {
		return nil, err
	}
	if !extracted.OK {
		if extracted.Error != "" {
			return nil, fmt.Errorf("tikdown.com gagal memproses: %s", extracted.Error)
		}
		return nil, errors.New("tikdown.com gagal memproses: respons tidak ok")
	}

	result := &tiktokResult{}
	if extracted.Result.User.Name != "" {
		author := extracted.Result.User.Name
		result.Author = &author
	}
	if extracted.Result.User.Username != "" && result.Author == nil {
		author := extracted.Result.User.Username
		result.Author = &author
	}
	if extracted.Result.User.Avatar != "" {
		avatar := extracted.Result.User.Avatar
		result.Avatar = &avatar
	}
	if extracted.Result.Description != "" {
		caption := extracted.Result.Description
		result.Caption = &caption
	}

	findMedia := func(kind string) *tikdownMediaItem {
		for i := range extracted.Result.MediaItems {
			if strings.EqualFold(extracted.Result.MediaItems[i].Type, kind) {
				item := extracted.Result.MediaItems[i]
				return &item
			}
		}
		return nil
	}

	if video := findMedia("video"); video != nil {
		if video.V5URL != "" {
			fileURL, pollErr := pollTikdownMedia(ctx, client, video.V5URL)
			if pollErr == nil && fileURL != "" {
				result.VideoURL = &fileURL
			} else if video.PreviewURL != "" {
				result.VideoURL = &video.PreviewURL
			}
		} else if video.PreviewURL != "" {
			result.VideoURL = &video.PreviewURL
		}
	}

	if audio := findMedia("audio"); audio != nil {
		if audio.V5URL != "" {
			fileURL, pollErr := pollTikdownMedia(ctx, client, audio.V5URL)
			if pollErr == nil && fileURL != "" {
				result.MP3URL = &fileURL
			}
		}
	}

	if result.VideoURL == nil {
		if extracted.Result.PreviewURL != "" {
			preview := extracted.Result.PreviewURL
			result.VideoURL = &preview
		}
	}
	if result.VideoURL == nil {
		return nil, errors.New("Video tidak ditemukan atau tidak bisa diunduh")
	}
	return result, nil
}

func newTikdownClient() (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &http.Client{Jar: jar, Timeout: 60 * time.Second}, nil
}

func fetchTikdownToken(ctx context.Context, client *http.Client) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, tikdownBase+"/id/", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "id-ID,id;q=0.9,en;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Gagal ambil halaman tikdown.com (HTTP %d)", resp.StatusCode)
	}
	match := tikdownCsrfPattern.FindSubmatch(body)
	if match == nil {
		return "", errors.New("Token CSRF tidak ditemukan di halaman tikdown.com")
	}
	return string(match[1]), nil
}

func fetchTikdownExtract(ctx context.Context, client *http.Client, tiktokURL, token string) (*tikdownExtractResponse, error) {
	form := url.Values{}
	form.Set("csrfToken", token)
	form.Set("website", "")
	form.Set("url", tiktokURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tikdownBase+"/api/extract.php", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Origin", tikdownBase)
	req.Header.Set("Referer", tikdownBase+"/id/")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("tikdown.com gagal memproses (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var extracted tikdownExtractResponse
	if err := json.Unmarshal(body, &extracted); err != nil {
		return nil, fmt.Errorf("tikdown.com respons tidak valid: %w", err)
	}
	return &extracted, nil
}

func pollTikdownMedia(ctx context.Context, client *http.Client, v5URL string) (string, error) {
	deadline := time.Now().Add(30 * time.Second)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if time.Now().After(deadline) {
			return "", errors.New("timeout menunggu file tikdown.com")
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, v5URL, nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "application/json, text/plain, */*")

		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return "", err
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return "", fmt.Errorf("tikdown.com worker gagal (HTTP %d)", resp.StatusCode)
		}

		var task tikdownTaskResponse
		if err := json.Unmarshal(body, &task); err != nil {
			return "", fmt.Errorf("tikdown.com worker respons tidak valid: %w", err)
		}
		if strings.EqualFold(task.Status, "completed") && task.FileURL != "" {
			return task.FileURL, nil
		}
		if strings.EqualFold(task.Status, "error") || strings.EqualFold(task.Status, "failed") {
			if task.Error != "" {
				return "", fmt.Errorf("tikdown.com worker error: %s", task.Error)
			}
			return "", errors.New("tikdown.com worker gagal memproses file")
		}

		time.Sleep(1 * time.Second)
	}
}