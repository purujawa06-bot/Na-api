package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const tikwmBase = "https://tikwm.com"

// tiktokResult keeps the normalized fields returned by the provider.
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

type tikwmAuthor struct {
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

type tikwmData struct {
	Title    string     `json:"title"`
	Cover    string     `json:"cover"`
	Play     string     `json:"play"`
	Music    string     `json:"music"`
	Author   tikwmAuthor `json:"author"`
}

type tikwmResponse struct {
	Code int      `json:"code"`
	Msg  string   `json:"msg"`
	Data tikwmData `json:"data"`
}

func (h *handler) tiktokGET(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
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

func (h *handler) produceTiktok(ctx context.Context, rawURL string) (int, any) {
	if invalid := validateDownloadURL(rawURL, tiktokHostAllowed, "URL harus dari domain tiktok.com"); invalid != nil {
		return http.StatusBadRequest, map[string]any{"error": invalid.message}
	}

	result, err := downloadTiktok(ctx, rawURL)
	if err != nil {
		return http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()}
	}

	response := tiktokResponse{
		Success: true,
		Source:  "tikwm.com",
	}
	response.Author = result.Author
	response.Avatar = result.Avatar
	response.Caption = result.Caption
	response.VideoURL = result.VideoURL
	response.VideoExpires = result.VideoExpires
	response.MP3URL = result.MP3URL
	return http.StatusOK, response
}

// downloadTiktok uses the TikWM GET API, which returns direct media links
// without the CSRF/worker polling flow required by other providers.
func downloadTiktok(ctx context.Context, tiktokURL string) (*tiktokResult, error) {
	reqURL := tikwmBase + "/api/?url=" + url.QueryEscape(tiktokURL)
	body, err := webclient.GetText(ctx, reqURL, map[string]string{
		"User-Agent": webclient.UserAgentChrome,
		"Accept":     "application/json, text/plain, */*",
	})
	if err != nil {
		return nil, err
	}

	var parsed tikwmResponse
	if err := jsonUnmarshal([]byte(body), &parsed); err != nil {
		return nil, fmt.Errorf("tikwm.com respons tidak valid: %w", err)
	}
	if parsed.Code != 0 {
		if parsed.Msg != "" {
			return nil, fmt.Errorf("tikwm.com gagal memproses: %s", parsed.Msg)
		}
		return nil, errors.New("tikwm.com gagal memproses video")
	}
	if parsed.Data.Play == "" {
		return nil, errors.New("Video tidak ditemukan atau tidak bisa diunduh")
	}

	result := &tiktokResult{}
	if parsed.Data.Author.Nickname != "" {
		author := parsed.Data.Author.Nickname
		result.Author = &author
	}
	if parsed.Data.Author.Avatar != "" {
		avatar := parsed.Data.Author.Avatar
		result.Avatar = &avatar
	}
	if parsed.Data.Title != "" {
		caption := parsed.Data.Title
		result.Caption = &caption
	}
	play := parsed.Data.Play
	result.VideoURL = &play
	if parsed.Data.Music != "" {
		music := parsed.Data.Music
		result.MP3URL = &music
	}
	return result, nil
}

// jsonUnmarshal small wrapper kept for consistency.
func jsonUnmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
}