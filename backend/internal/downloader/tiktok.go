package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

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
	Title  string      `json:"title"`
	Play   string      `json:"play"`
	Music  string      `json:"music"`
	Author tikwmAuthor `json:"author"`
}

type tikwmResponse struct {
	Code int       `json:"code"`
	Msg  string    `json:"msg"`
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
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   `Body harus JSON: {"url": "..."}`,
		})
		return
	}

	status, payload := h.produceTiktok(r.Context(), stringField(body, "url"))
	httpx.JSON(w, status, payload)
}

// produceTiktok validates the URL and returns the JSON envelope for either
// transport. Upstream failures are returned as 424 (not 5xx) so edge proxies
// like Koyeb do not replace the JSON body with a generic error page.
func (h *handler) produceTiktok(ctx context.Context, rawURL string) (int, any) {
	if invalid := validateDownloadURL(rawURL, tiktokHostAllowed, "URL harus dari domain tiktok.com"); invalid != nil {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   invalid.message,
		}
	}

	result, err := h.downloadTiktok(ctx, rawURL)
	if err != nil {
		return http.StatusFailedDependency, map[string]any{
			"success": false,
			"error":   err.Error(),
		}
	}

	return http.StatusOK, tiktokResponse{
		Success:      true,
		Source:       tikwmBase,
		Author:       result.Author,
		Avatar:       result.Avatar,
		Caption:      result.Caption,
		VideoURL:     result.VideoURL,
		VideoExpires: result.VideoExpires,
		MP3URL:       result.MP3URL,
	}
}

// tiktokHostAllowed accepts tiktok.com and its subdomains.
func tiktokHostAllowed(host string) bool {
	return hostIsDomainOrSubdomain(host, "tiktok.com")
}

// downloadTiktok tries tikwm.com via several request variants and normalises
// the fields into tiktokResult. Multiple attempts improve resilience when a
// particular method is blocked from datacenter egress.
func (h *handler) downloadTiktok(ctx context.Context, rawURL string) (tiktokResult, error) {
	headers := map[string]string{
		"User-Agent":      webclient.UserAgentChrome,
		"Accept":          "application/json, text/plain, */*",
		"Accept-Language": "en-US,en;q=0.9",
		"Referer":         tikwmBase + "/",
		"Origin":          tikwmBase,
	}
	form := url.Values{"url": {rawURL}, "hd": {"1"}}

	type attempt struct {
		label string
		fn    func(context.Context) (*http.Response, error)
	}
	attempts := []attempt{
		{
			label: "tikwm GET",
			fn: func(ctx context.Context) (*http.Response, error) {
				return webclient.Get(ctx, tikwmBase+"/api/?url="+url.QueryEscape(rawURL)+"&hd=1", headers)
			},
		},
		{
			label: "tikwm GET www",
			fn: func(ctx context.Context) (*http.Response, error) {
				return webclient.Get(ctx, "https://www.tikwm.com/api/?url="+url.QueryEscape(rawURL)+"&hd=1", headers)
			},
		},
		{
			label: "tikwm POST",
			fn: func(ctx context.Context) (*http.Response, error) {
				return webclient.PostForm(ctx, tikwmBase+"/api/", form, headers)
			},
		},
		{
			label: "tikwm POST www",
			fn: func(ctx context.Context) (*http.Response, error) {
				return webclient.PostForm(ctx, "https://www.tikwm.com/api/", form, headers)
			},
		},
	}

	var errs []string
	for _, a := range attempts {
		resp, err := a.fn(ctx)
		if err != nil {
			errs = append(errs, a.label+": "+err.Error())
			continue
		}
		body, err := webclient.ReadBody(resp)
		if err != nil {
			errs = append(errs, a.label+": "+err.Error())
			continue
		}

		result, err := parseTikwmBody(resp.StatusCode, body)
		if err == nil {
			return result, nil
		}
		errs = append(errs, a.label+": "+err.Error())
	}

	if len(errs) == 0 {
		return tiktokResult{}, errors.New("tikwm.com gagal memproses permintaan")
	}
	return tiktokResult{}, errors.New(strings.Join(errs, "; "))
}

// parseTikwmBody validates an upstream response and converts it to tiktokResult.
func parseTikwmBody(status int, body string) (tiktokResult, error) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return tiktokResult{}, fmt.Errorf("respons kosong (HTTP %d)", status)
	}
	if webclient.IsBlocked(trimmed) {
		return tiktokResult{}, fmt.Errorf("diblokir/challenge upstream (HTTP %d)", status)
	}

	if !strings.HasPrefix(trimmed, "{") {
		snippet := trimmed
		if len(snippet) > 160 {
			snippet = snippet[:160]
		}
		if status < 200 || status >= 300 {
			return tiktokResult{}, fmt.Errorf("HTTP %d respons non-JSON: %s", status, snippet)
		}
		return tiktokResult{}, fmt.Errorf("respons non-JSON: %s", snippet)
	}

	var resp tikwmResponse
	if err := json.Unmarshal([]byte(trimmed), &resp); err != nil {
		if status < 200 || status >= 300 {
			return tiktokResult{}, fmt.Errorf("HTTP %d respons tidak valid: %w", status, err)
		}
		return tiktokResult{}, fmt.Errorf("respons tidak valid: %w", err)
	}

	if resp.Code != 0 || resp.Data.Play == "" {
		message := strings.TrimSpace(resp.Msg)
		if message == "" {
			message = "video tidak ditemukan atau sedang diproses"
		}
		if status < 200 || status >= 300 {
			message = fmt.Sprintf("HTTP %d: %s", status, message)
		}
		return tiktokResult{}, errors.New(message)
	}

	result := tiktokResult{
		Caption: pointerString(resp.Data.Title),
	}
	if resp.Data.Author.Nickname != "" {
		nickname := resp.Data.Author.Nickname
		result.Author = &nickname
	}
	if resp.Data.Author.Avatar != "" {
		avatar := resp.Data.Author.Avatar
		result.Avatar = &avatar
	}
	if resp.Data.Play != "" {
		video := resp.Data.Play
		result.VideoURL = &video
	}
	if resp.Data.Music != "" {
		music := resp.Data.Music
		result.MP3URL = &music
	}
	return result, nil
}
