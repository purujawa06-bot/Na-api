package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	tikwmBase      = "https://tikwm.com"
	lightpandaCDP  = "wss://light-panda-cdp.onrender.com/"
	ssstikPageURL  = "https://ssstik.io/en-1"
)

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

	result, source, err := h.downloadTiktok(ctx, rawURL)
	if err != nil {
		return http.StatusFailedDependency, map[string]any{
			"success": false,
			"error":   err.Error(),
		}
	}

	return http.StatusOK, tiktokResponse{
		Success:      true,
		Source:       source,
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

// downloadTiktok tries tikwm.com first, then falls back to browser automation
// (Lightpanda CDP + ssstik.io) when direct upstream access is blocked.
func (h *handler) downloadTiktok(ctx context.Context, rawURL string) (tiktokResult, string, error) {
	if result, err := h.viaTikwm(ctx, rawURL); err == nil {
		return result, tikwmBase, nil
	} else if result, cdpErr := h.viaLightpandaSsstik(ctx, rawURL); cdpErr == nil {
		return result, "ssstik.io (cdp)", nil
	} else {
		return tiktokResult{}, "", fmt.Errorf("tikwm: %v; cdp(ssstik): %v", err, cdpErr)
	}
}

// viaTikwm tries tikwm.com via several request variants and normalises
// the fields into tiktokResult. Multiple attempts improve resilience when a
// particular method is blocked from datacenter egress.
func (h *handler) viaTikwm(ctx context.Context, rawURL string) (tiktokResult, error) {
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

// --- CDP (Lightpanda) fallback via ssstik.io browser interaction ---

type cdpClient struct {
	conn *websocket.Conn
	ctx  context.Context
	id   int
}

type cdpMsg struct {
	ID        int             `json:"id,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Method    string          `json:"method,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (c *cdpClient) call(method string, params any, sessionID string) (json.RawMessage, error) {
	c.id++
	msg := map[string]any{"id": c.id, "method": method}
	if params != nil {
		msg["params"] = params
	}
	if sessionID != "" {
		msg["sessionId"] = sessionID
	}
	if err := wsjson.Write(c.ctx, c.conn, msg); err != nil {
		return nil, err
	}
	for {
		var resp cdpMsg
		if err := wsjson.Read(c.ctx, c.conn, &resp); err != nil {
			return nil, err
		}
		if resp.ID == c.id {
			if resp.Error != nil {
				return nil, errors.New(resp.Error.Message)
			}
			return resp.Result, nil
		}
		// ignore events
	}
}

func (c *cdpClient) eval(sessionID, expression string) (string, error) {
	raw, err := c.call("Runtime.evaluate", map[string]any{
		"expression":    expression,
		"returnByValue": true,
		"awaitPromise":  false,
	}, sessionID)
	if err != nil {
		return "", err
	}
	var out struct {
		Result struct {
			Value any `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	switch v := out.Result.Value.(type) {
	case string:
		return v, nil
	case nil:
		return "", nil
	default:
		b, _ := json.Marshal(v)
		return string(b), nil
	}
}

type ssstikExtract struct {
	VideoURL string `json:"video"`
	MP3URL   string `json:"mp3"`
	Author   string `json:"author"`
	Caption  string `json:"caption"`
}

var reCaptionClean = regexp.MustCompile(`\s+`)

func (h *handler) viaLightpandaSsstik(ctx context.Context, rawURL string) (tiktokResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, lightpandaCDP, nil)
	if err != nil {
		return tiktokResult{}, fmt.Errorf("cdp dial: %w", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")
	c := &cdpClient{conn: conn, ctx: ctx}

	raw, err := c.call("Target.createTarget", map[string]any{"url": "about:blank"}, "")
	if err != nil {
		return tiktokResult{}, fmt.Errorf("create target: %w", err)
	}
	var ct struct {
		TargetID string `json:"targetId"`
	}
	if err := json.Unmarshal(raw, &ct); err != nil || ct.TargetID == "" {
		return tiktokResult{}, errors.New("targetId tidak ditemukan")
	}
	targetID := ct.TargetID
	// tutup hanya target milik request ini (jangan global-close semua page:
	// endpoint lain, mis. generator JJ, bisa sedang memakai CDP yang sama).
	defer func() { _, _ = c.call("Target.closeTarget", map[string]any{"targetId": targetID}, "") }()

	raw, err = c.call("Target.attachToTarget", map[string]any{"targetId": targetID, "flatten": true}, "")
	if err != nil {
		return tiktokResult{}, fmt.Errorf("attach: %w", err)
	}
	var att struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &att); err != nil || att.SessionID == "" {
		return tiktokResult{}, errors.New("sessionId tidak ditemukan")
	}
	sid := att.SessionID

	_, _ = c.call("Page.enable", map[string]any{}, sid)
	_, _ = c.call("Runtime.enable", map[string]any{}, sid)

	if _, err := c.call("Page.navigate", map[string]any{"url": ssstikPageURL}, sid); err != nil {
		return tiktokResult{}, fmt.Errorf("navigate: %w", err)
	}

	// wait page ready and input present
	if err := c.waitFor(ctx, sid, `!!document.querySelector('#main_page_text')`, 15*time.Second); err != nil {
		return tiktokResult{}, fmt.Errorf("ssstik tidak siap: %w", err)
	}

	// fill input and submit
	submitJS := fmt.Sprintf(`(()=>{const i=document.querySelector('#main_page_text'); if(!i) return 'noinput';
i.focus(); i.value=%q; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));
const b=document.querySelector('#submit'); if(b){b.click(); return 'clicked';}
const f=document.querySelector('form'); if(f){try{f.requestSubmit?f.requestSubmit():f.submit();}catch(e){f.submit();} return 'submitted';}
return 'nobtn';})()`, rawURL)
	act, _ := c.eval(sid, submitJS)
	if act == "noinput" || act == "nobtn" || act == "" {
		return tiktokResult{}, fmt.Errorf("gagal submit form ssstik (%s)", act)
	}

	// poll for result links
	extractJS := `(()=>{const norm=s=>(s||'').replace(/\s+/g,' ').trim();
const as=Array.from(document.querySelectorAll('a')).map(a=>({t:norm(a.innerText||a.textContent),h:a.href||''}));
let video='', mp3='';
for(const a of as){
  const t=(a.t||'').toLowerCase();
  if(!a.h) continue;
  if(!mp3 && (t.includes('download mp3') || t.includes('mp3'))) mp3=a.h;
  if(!video && (t.includes('without watermark') || t.includes('download server') || t.includes('hd'))) { if(!/mp3/i.test(a.h)) video=a.h; }
}
if(!video){
  for(const a of as){ if(a.h && (a.h.includes('tikcdn.io/ssstik/') || a.h.includes('ssscdn.io/')) && !/\/m\//.test(a.h) && !/mp3/i.test(a.h)) { video=a.h; break; } }
}
if(!mp3){
  for(const a of as){ if(a.h && (/\/m\//.test(a.h) || /mp3/i.test(a.h)) && (a.h.includes('tikcdn.io')||a.h.includes('ssscdn.io'))) { mp3=a.h; break; } }
}
let author='', caption='';
const txt = document.body ? document.body.innerText : '';
const lines = txt.split('\n').map(norm).filter(Boolean);
const wi = lines.findIndex(l=>/without watermark/i.test(l));
if(wi>0){ caption = lines[wi-1]||''; if(wi-2>=0) author = lines[wi-2]||''; }
return JSON.stringify({video, mp3, author, caption});})()`

	var ex ssstikExtract
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		if err := sleepCtx(ctx, 2500*time.Millisecond); err != nil {
			return tiktokResult{}, err
		}
		val, err := c.eval(sid, extractJS)
		if err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(val), &ex)
		if strings.TrimSpace(ex.VideoURL) != "" || strings.TrimSpace(ex.MP3URL) != "" {
			break
		}
	}
	ex.VideoURL = strings.TrimSpace(ex.VideoURL)
	ex.MP3URL = strings.TrimSpace(ex.MP3URL)
	ex.Author = strings.TrimSpace(ex.Author)
	ex.Caption = strings.TrimSpace(reCaptionClean.ReplaceAllString(ex.Caption, " "))
	if ex.VideoURL == "" && ex.MP3URL == "" {
		return tiktokResult{}, errors.New("tautan unduhan tidak ditemukan dari ssstik")
	}

	result := tiktokResult{
		Author:  pointerString(ex.Author),
		Caption: pointerString(ex.Caption),
	}
	if ex.VideoURL != "" {
		v := ex.VideoURL
		result.VideoURL = &v
	}
	if ex.MP3URL != "" {
		m := ex.MP3URL
		result.MP3URL = &m
	}
	return result, nil
}

func (c *cdpClient) waitFor(ctx context.Context, sessionID, jsExpr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		v, err := c.eval(sessionID, jsExpr)
		if err == nil && (v == "true" || v == "1") {
			return nil
		}
		if err := sleepCtx(ctx, 500*time.Millisecond); err != nil {
			return err
		}
	}
	return fmt.Errorf("timeout menunggu kondisi")
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
