package downloader

import (
	"context"
	"errors"
	"fmt"
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
	ssstikBase = "https://ssstik.io"
	ssstikUA   = webclient.UserAgentChrome
)

var (
	ssstikTokenPattern    = regexp.MustCompile(`tt\s*=\s*'([^']+)'`)
	ssstikIPPattern       = regexp.MustCompile(`(?m)^ip=(.*)$`)
	ssstikLocationPattern = regexp.MustCompile(`(?m)^loc=(.*)$`)
	ssstikVideoPattern    = regexp.MustCompile(`href="(https://tikcdn\.io/ssstik/\d+[^"]*)"\s*class="[^"]*without_watermark[^"]*"`)
	ssstikMP3Pattern      = regexp.MustCompile(`href="(https://tikcdn\.io/ssstik/m/[^"]+)"`)
	ssstikAuthorPattern   = regexp.MustCompile(`<h2>([^<]+)</h2>`)
	ssstikAvatarPattern   = regexp.MustCompile(`<img class="result_author" src="([^"]+)"`)
	ssstikCaptionPattern  = regexp.MustCompile(`(?s)<p class="maintext">(.*?)</p>`)
	ssstikErrorPattern    = regexp.MustCompile(`(?is)<p[^>]*class="[^"]*(?:err|alert|error)[^"]*"[^>]*>(.*?)</p>`)
	ssstikExpiresPattern  = regexp.MustCompile(`[?&]e=(\d+)`)
	ssstikEscaper         = strings.NewReplacer(
		"&amp;", "&",
		"&lt;", "<",
		"&gt;", ">",
		"&quot;", `"`,
		"&#039;", "'",
		"&#39;", "'",
	)
)

// ssstikTrace is the subset of /cdn-cgi/trace used in the debug parameter.
type ssstikTrace struct {
	ip  string
	loc string
}

// tiktokResult mirrors the fields parsed from the ssstik result fragment.
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

// tiktokHostAllowed accepts tiktok.com and its subdomains.
func tiktokHostAllowed(host string) bool { return hostIsDomainOrSubdomain(host, "tiktok.com") }

func (h *handler) produceTiktok(ctx context.Context, rawURL string) (int, any) {
	if invalid := validateDownloadURL(rawURL, tiktokHostAllowed, "URL harus dari domain tiktok.com"); invalid != nil {
		return http.StatusBadRequest, map[string]any{"error": invalid.message}
	}

	result, err := downloadTiktok(ctx, rawURL)
	if err != nil {
		return http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()}
	}

	return http.StatusOK, tiktokResponse{
		Success:      true,
		Source:       "ssstik.io",
		Author:       result.Author,
		Avatar:       result.Avatar,
		Caption:      result.Caption,
		VideoURL:     result.VideoURL,
		VideoExpires: result.VideoExpires,
		MP3URL:       result.MP3URL,
	}
}

// downloadTiktok runs the ssstik.io htmx flow: page token + trace in parallel,
// then the form POST whose HTML fragment is parsed for the download links.
func downloadTiktok(ctx context.Context, tiktokURL string) (*tiktokResult, error) {
	type tokenResult struct {
		token string
		err   error
	}
	type traceResult struct {
		trace ssstikTrace
		err   error
	}

	tokenCh := make(chan tokenResult, 1)
	traceCh := make(chan traceResult, 1)

	go func() {
		token, err := fetchSsstikToken(ctx)
		tokenCh <- tokenResult{token: token, err: err}
	}()
	go func() {
		trace, err := fetchSsstikTrace(ctx)
		traceCh <- traceResult{trace: trace, err: err}
	}()

	tokenOut := <-tokenCh
	traceOut := <-traceCh
	if tokenOut.err != nil {
		return nil, tokenOut.err
	}
	if traceOut.err != nil {
		return nil, traceOut.err
	}

	document, err := postSsstikDownload(ctx, tiktokURL, tokenOut.token, traceOut.trace)
	if err != nil {
		return nil, err
	}

	result := parseSsstikResult(document)
	if result.VideoURL != nil {
		return result, nil
	}

	if match := ssstikErrorPattern.FindStringSubmatch(document); match != nil {
		return nil, fmt.Errorf("Video tidak bisa diunduh: %s", ssstikEscaper.Replace(strings.TrimSpace(match[1])))
	}
	return nil, errors.New("Video tidak ditemukan atau tidak bisa diunduh")
}

// fetchSsstikTrace reads the requester IP and country from Cloudflare's trace.
func fetchSsstikTrace(ctx context.Context) (ssstikTrace, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	body, err := webclient.GetText(reqCtx, ssstikBase+"/cdn-cgi/trace", map[string]string{"User-Agent": ssstikUA})
	if err != nil {
		return ssstikTrace{}, err
	}

	trace := ssstikTrace{}
	if match := ssstikIPPattern.FindStringSubmatch(body); match != nil {
		trace.ip = strings.TrimSpace(match[1])
	}
	if match := ssstikLocationPattern.FindStringSubmatch(body); match != nil {
		trace.loc = strings.TrimSpace(match[1])
	}
	return trace, nil
}

// fetchSsstikToken scrapes the `tt` form token from the Indonesian page.
func fetchSsstikToken(ctx context.Context) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	headers := map[string]string{
		"User-Agent":      ssstikUA,
		"Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
	}
	resp, err := webclient.Get(reqCtx, ssstikBase+"/id", headers)
	if err != nil {
		return "", err
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Gagal ambil halaman ssstik.io (HTTP %d)", resp.StatusCode)
	}

	match := ssstikTokenPattern.FindStringSubmatch(body)
	if match == nil {
		return "", errors.New("Token tt tidak ditemukan di halaman ssstik.io")
	}
	return match[1], nil
}

// postSsstikDownload submits the htmx form and returns the result fragment.
func postSsstikDownload(ctx context.Context, tiktokURL, token string, trace ssstikTrace) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	loc := trace.loc
	if loc == "" {
		loc = "US"
	}
	form := url.Values{
		"id":     {tiktokURL},
		"locale": {"id"},
		"tt":     {token},
		"debug":  {"ab=1&loc=" + loc + "&ip=" + trace.ip},
	}
	headers := map[string]string{
		"User-Agent":     ssstikUA,
		"Accept":         "*/*",
		"Referer":        ssstikBase + "/id",
		"hx-request":     "true",
		"hx-trigger":     "_gcaptcha_pt",
		"hx-target":      "target",
		"hx-current-url": ssstikBase + "/id",
	}

	resp, err := webclient.PostForm(reqCtx, ssstikBase+"/abc?url=dl", form, headers)
	if err != nil {
		return "", err
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("ssstik.io gagal memproses (HTTP %d)", resp.StatusCode)
	}
	return body, nil
}

// parseSsstikResult extracts the download links and metadata from the fragment.
func parseSsstikResult(document string) *tiktokResult {
	result := &tiktokResult{}

	if match := ssstikVideoPattern.FindStringSubmatch(document); match != nil {
		result.VideoURL = pointerString(match[1])
		if expires := ssstikExpiresPattern.FindStringSubmatch(match[1]); expires != nil {
			if seconds, err := strconv.ParseInt(expires[1], 10, 64); err == nil {
				result.VideoExpires = &seconds
			}
		}
	}
	if match := ssstikMP3Pattern.FindStringSubmatch(document); match != nil {
		result.MP3URL = pointerString(match[1])
	}
	if match := ssstikAuthorPattern.FindStringSubmatch(document); match != nil {
		result.Author = pointerString(ssstikEscaper.Replace(strings.TrimSpace(match[1])))
	}
	if match := ssstikAvatarPattern.FindStringSubmatch(document); match != nil {
		result.Avatar = pointerString(match[1])
	}
	if match := ssstikCaptionPattern.FindStringSubmatch(document); match != nil {
		result.Caption = pointerString(ssstikEscaper.Replace(strings.TrimSpace(match[1])))
	}
	return result
}
