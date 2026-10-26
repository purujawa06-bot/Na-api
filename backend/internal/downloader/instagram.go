package downloader

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	instagramQueryHash = "2b0673e0dc4580674a88d426fe00ea90"
	instagramMediaNote = "Link CDN Instagram kedaluwarsa ±1 jam"
)

var (
	instagramShortcodePattern = regexp.MustCompile(`(?i)instagram\.com/(?:[^/?#]+/)?(?:reels?|p|tv)/([A-Za-z0-9_-]+)`)
	instagramSharePattern     = regexp.MustCompile(`(?i)instagram\.com/share/`)
	instagramCDNPattern       = regexp.MustCompile(`(?i)^https?://[^/]*(?:cdninstagram\.com|fbcdn\.net)`)
	instagramMediaExtPattern  = regexp.MustCompile(`(?i)\.(mp4|jpg|jpeg|png|webp)(?:\?|$)`)
	instagramFileExtPattern   = regexp.MustCompile(`(?i)\.([a-z0-9]{2,5})$`)
	instagramTokenPattern     = regexp.MustCompile(`token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)`)
	instagramXEscapesPattern  = regexp.MustCompile(`\\x([0-9a-fA-F]{2})`)
)

// instasaveMedia is one carousel entry returned by api.instasave.website.
type instasaveMedia struct {
	Type      string  `json:"type"`
	Ext       string  `json:"ext"`
	Filename  *string `json:"filename"`
	URL       string  `json:"url"`
	ProxyURL  string  `json:"proxy_url"`
	ExpiresAt *int64  `json:"expires_at"`
}

// instasaveToken is the JWT payload embedded in an instasave proxy token.
type instasaveToken struct {
	URL      string   `json:"url"`
	Filename string   `json:"filename"`
	Exp      *float64 `json:"exp"`
}

func (h *handler) instagramGET(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	h.cachedGET(w, r, func(ctx context.Context) (int, any) {
		return h.produceInstagram(ctx, rawURL)
	})
}

func (h *handler) instagramPOST(w http.ResponseWriter, r *http.Request) {
	body, err := decodeBody(r)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   `Body harus JSON: {"url": "..."}`,
		})
		return
	}
	status, payload := h.produceInstagram(r.Context(), stringField(body, "url"))
	httpx.JSON(w, status, payload)
}

func (h *handler) produceInstagram(ctx context.Context, rawURL string) (int, any) {
	if invalid := validateDownloadURL(rawURL, instagramHostAllowed, "URL harus dari domain instagram.com"); invalid != nil {
		return http.StatusBadRequest, map[string]any{"success": false, "error": invalid.message}
	}

	payload, source, err := h.downloadInstagram(ctx, rawURL)
	if err != nil {
		return http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()}
	}

	response := make(map[string]any, len(payload)+2)
	for key, value := range payload {
		response[key] = value
	}
	response["success"] = true
	response["source"] = source
	return http.StatusOK, response
}

// instagramHostAllowed accepts instagram.com/instagr.am and their subdomains.
func instagramHostAllowed(host string) bool {
	return hostIsDomainOrSubdomain(host, "instagram.com") || hostIsDomainOrSubdomain(host, "instagr.am")
}

// downloadInstagram tries the kkinstagram embed proxy first and falls back to
// api.instasave.website. The primary error is reported when both fail because
// it is the more relevant one.
func (h *handler) downloadInstagram(ctx context.Context, rawURL string) (map[string]any, string, error) {
	target := rawURL
	if instagramSharePattern.MatchString(target) {
		target = resolveInstagramShareURL(ctx, target)
	}

	shortcode := extractInstagramShortcode(target)
	if shortcode == "" {
		return nil, "", errors.New("Shortcode Instagram tidak ditemukan di URL")
	}

	primary, primaryErr := h.viaKkInstagram(ctx, shortcode)
	if primaryErr == nil {
		return primary, "kkinstagram", nil
	}

	fallback, fallbackErr := h.viaInstasave(ctx, shortcode, target)
	if fallbackErr == nil {
		return fallback, "instasave.website", nil
	}
	return nil, "", primaryErr
}

// extractInstagramShortcode pulls the shortcode out of a post/reel/tv URL.
func extractInstagramShortcode(rawURL string) string {
	match := instagramShortcodePattern.FindStringSubmatch(rawURL)
	if match == nil {
		return ""
	}
	return match[1]
}

// resolveInstagramShareURL follows a /share/ link to its canonical URL.
func resolveInstagramShareURL(ctx context.Context, rawURL string) string {
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodHead, rawURL, nil)
	if err != nil {
		return rawURL
	}
	req.Header.Set("User-Agent", webclient.UserAgentChrome)

	resp, err := webclient.Do(req)
	if err != nil {
		return rawURL
	}
	defer resp.Body.Close()

	if resp.Request != nil && resp.Request.URL != nil {
		return resp.Request.URL.String()
	}
	return rawURL
}

// viaKkInstagram asks kkinstagram to redirect straight to the Instagram CDN. The
// location header must be inspected, hence redirects are not followed.
func (h *handler) viaKkInstagram(ctx context.Context, shortcode string) (map[string]any, error) {
	paths := []string{"reel/" + shortcode, "p/" + shortcode, "tv/" + shortcode}
	tried := make([]string, 0, len(paths))

	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	for _, path := range paths {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://kkinstagram.com/"+path+"/", nil)
		if err != nil {
			tried = append(tried, path+": "+err.Error())
			continue
		}
		req.Header.Set("User-Agent", webclient.UserAgentBot)

		resp, err := client.Do(req)
		if err != nil {
			tried = append(tried, path+": "+err.Error())
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()

		location := resp.Header.Get("Location")
		if resp.StatusCode >= 300 && resp.StatusCode < 400 && instagramCDNPattern.MatchString(location) {
			ext := instagramMediaExt(location)
			if ext == "" {
				// CDN URLs without a suffix are still media: /o1/v/ is video.
				ext = "jpg"
				if strings.Contains(location, "/o1/v/") {
					ext = "mp4"
				}
			}
			kind := instagramMediaKind(ext)
			if kind == "other" {
				label := ext
				if label == "" {
					label = "?"
				}
				tried = append(tried, fmt.Sprintf("%s: tipe media tidak dikenali (%s)", path, label))
				continue
			}
			return map[string]any{
				"shortcode":    shortcode,
				"type":         kind,
				"media_url":    location,
				"expires_note": instagramMediaNote,
			}, nil
		}

		switch {
		case resp.StatusCode == http.StatusGatewayTimeout:
			tried = append(tried, path+": media tidak ditemukan (upstream 504)")
		case location != "" && strings.Contains(location, "instagram.com"):
			// The shortcode is judged invalid, trying other paths is pointless.
			tried = append(tried, path+": shortcode tidak valid")
			return nil, fmt.Errorf("kkinstagram gagal — %s", strings.Join(tried, "; "))
		default:
			tried = append(tried, fmt.Sprintf("%s: HTTP %d", path, resp.StatusCode))
		}
	}

	if len(tried) == 0 {
		return nil, errors.New("kkinstagram gagal")
	}
	return nil, fmt.Errorf("kkinstagram gagal — %s", strings.Join(tried, "; "))
}

// viaInstasave calls the instasave.website media API and decodes the JWT proxy
// tokens found in its JS fragment response.
func (h *handler) viaInstasave(ctx context.Context, shortcode, originalURL string) (map[string]any, error) {
	gqlURL := "https://www.instagram.com/graphql/query?query_hash=" + instagramQueryHash +
		`&variables={"shortcode":"` + shortcode + `"}`

	reqCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	form := url.Values{"url": {originalURL}, "instaLink": {gqlURL}}
	headers := map[string]string{
		"User-Agent": webclient.UserAgentChrome,
		"Referer":    "https://instasave.website/",
		"Origin":     "https://instasave.website",
		"Accept":     "application/json, text/plain, */*",
	}

	resp, err := webclient.PostForm(reqCtx, "https://api.instasave.website/media", form, headers)
	if err != nil {
		return nil, fmt.Errorf("instasave.website tidak dapat dihubungi: %w", err)
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return nil, fmt.Errorf("instasave.website tidak dapat dihubungi: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("instasave.website menolak permintaan (HTTP %d)", resp.StatusCode)
	}

	medias := parseInstasaveMedias(decodeXEscapes(body))
	if len(medias) == 0 {
		return nil, errors.New("Media tidak ditemukan atau akun privat")
	}

	var videos, images []instasaveMedia
	for _, media := range medias {
		switch media.Type {
		case "video":
			videos = append(videos, media)
		case "image":
			images = append(images, media)
		}
	}

	mediaType := "image"
	switch {
	case len(videos) > 1 || len(images) > 1:
		mediaType = "carousel"
	case len(videos) == 1:
		mediaType = "video"
	}

	var thumbnail, videoURL, videoProxyURL any
	if len(images) > 0 {
		thumbnail = images[0].ProxyURL
	}
	if len(videos) > 0 {
		videoURL = videos[0].URL
		videoProxyURL = videos[0].ProxyURL
	}

	return map[string]any{
		"shortcode":       shortcode,
		"type":            mediaType,
		"thumbnail":       thumbnail,
		"video_url":       videoURL,
		"video_proxy_url": videoProxyURL,
		"media_count":     len(medias),
		"medias":          medias,
	}, nil
}

// decodeXEscapes turns JS \xNN escapes into their byte counterparts.
func decodeXEscapes(raw string) string {
	return instagramXEscapesPattern.ReplaceAllStringFunc(raw, func(match string) string {
		value, err := strconv.ParseUint(match[len(match)-2:], 16, 8)
		if err != nil {
			return match
		}
		return string([]byte{byte(value)})
	})
}

// parseInstasaveMedias extracts unique media entries from proxy tokens.
func parseInstasaveMedias(fragment string) []instasaveMedia {
	seen := make(map[string]bool)
	medias := make([]instasaveMedia, 0)

	for _, match := range instagramTokenPattern.FindAllStringSubmatch(fragment, -1) {
		token := match[1]
		payload := decodeInstasaveToken(token)
		if payload == nil || payload.URL == "" || seen[payload.URL] {
			continue
		}
		seen[payload.URL] = true

		source := payload.Filename
		if source == "" {
			source = payload.URL
		}
		ext := ""
		if found := instagramFileExtPattern.FindStringSubmatch(source); found != nil {
			ext = strings.ToLower(found[1])
		}
		kind := instagramMediaKind(ext)
		if kind == "other" {
			continue
		}

		media := instasaveMedia{
			Type:     kind,
			Ext:      ext,
			Filename: pointerString(payload.Filename),
			URL:      payload.URL,
			ProxyURL: "https://cdn.instasave.website/?token=" + token,
		}
		if payload.Exp != nil {
			expiresAt := int64(*payload.Exp * 1000)
			media.ExpiresAt = &expiresAt
		}
		medias = append(medias, media)
	}
	return medias
}

// decodeInstasaveToken decodes the middle segment of a proxy JWT.
func decodeInstasaveToken(token string) *instasaveToken {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil
	}

	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		padded, padErr := base64.URLEncoding.DecodeString(parts[1])
		if padErr != nil {
			return nil
		}
		raw = padded
	}

	var payload instasaveToken
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	return &payload
}

// instagramMediaExt returns the media extension present in a CDN URL.
func instagramMediaExt(rawURL string) string {
	if match := instagramMediaExtPattern.FindStringSubmatch(rawURL); match != nil {
		return strings.ToLower(match[1])
	}
	return ""
}

// instagramMediaKind maps an extension to the response type vocabulary.
func instagramMediaKind(ext string) string {
	switch ext {
	case "mp4":
		return "video"
	case "jpg", "jpeg", "png", "webp":
		return "image"
	default:
		return "other"
	}
}
