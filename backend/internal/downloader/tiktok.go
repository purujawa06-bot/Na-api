package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/cdp"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	ssstikPageURL = "https://ssstik.io/"
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

// produceTiktok validates the URL and returns the JSON envelope.
func (h *handler) produceTiktok(ctx context.Context, rawURL string) (int, any) {
	if invalid := validateDownloadURL(rawURL, tiktokHostAllowed, "URL harus dari domain tiktok.com"); invalid != nil {
		return http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   invalid.message,
		}
	}

	result, err := h.viaSsstikCDP(ctx, rawURL)
	if err != nil {
		return http.StatusFailedDependency, map[string]any{
			"success": false,
			"error":   err.Error(),
		}
	}

	return http.StatusOK, tiktokResponse{
		Success:      true,
		Source:       "ssstik.io (cdp)",
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

type ssstikExtract struct {
	VideoURL string `json:"video"`
	MP3URL   string `json:"mp3"`
	Author   string `json:"author"`
	Caption  string `json:"caption"`
	Avatar   string `json:"avatar"`
}

var reCaptionClean = regexp.MustCompile(`\s+`)

// viaSsstikCDP resolves a TikTok URL via ssstik's internal endpoint from within
// a CDP browser context (no UI click/scroll). The page is loaded to establish
// origin/session, then /abc?url=dl is called directly via fetch.
func (h *handler) viaSsstikCDP(ctx context.Context, rawURL string) (tiktokResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	client, err := cdp.Dial(ctx, cdp.DefaultEndpoint)
	if err != nil {
		return tiktokResult{}, err
	}
	defer client.Close()

	raw, err := client.Call("Target.createTarget", map[string]any{"url": "about:blank"}, "")
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
	defer func() { _, _ = client.Call("Target.closeTarget", map[string]any{"targetId": targetID}, "") }()

	raw, err = client.Call("Target.attachToTarget", map[string]any{"targetId": targetID, "flatten": true}, "")
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

	_, _ = client.Call("Page.enable", map[string]any{}, sid)
	_, _ = client.Call("Runtime.enable", map[string]any{}, sid)

	if _, err := client.Call("Page.navigate", map[string]any{"url": ssstikPageURL}, sid); err != nil {
		return tiktokResult{}, fmt.Errorf("navigate: %w", err)
	}

	if err := client.WaitFor(ctx, sid, `document.readyState === 'complete' || document.readyState === 'interactive'`, 30*time.Second); err != nil {
		return tiktokResult{}, fmt.Errorf("ssstik tidak siap: %w", err)
	}

	urlJSON, _ := json.Marshal(rawURL)
	expr := fmt.Sprintf(`(async () => {
  try {
    const id = %s;
    const params = new URLSearchParams();
    params.set('id', id);
    params.set('locale', 'en');
    // ambil token/field tersembunyi dari form bila ada (reverse-engineer API ssstik)
    const form = document.querySelector('#_gcaptcha_pt, form[hx-post], form[action*="abc"]') || document.querySelector('form');
    if (form) {
      const fd = new FormData(form);
      for (const [k, v] of fd.entries()) {
        if (k && k !== 'id' && !params.has(k)) params.set(k, v);
      }
    }
    if (!params.has('tt')) params.set('tt', 'RFBFa3Bi');
    const hxTarget = form ? (form.getAttribute('hx-target') || 'target') : 'target';
    const hxTrigger = form ? (form.getAttribute('hx-trigger') || form.id || '_gcaptcha_pt') : '_gcaptcha_pt';
    const resp = await fetch('/abc?url=dl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'HX-Request': 'true',
        'HX-Target': hxTarget,
        'HX-Current-URL': location.href,
        'HX-Trigger': hxTrigger
      },
      body: params.toString(),
      credentials: 'include'
    });
    const html = await resp.text();
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const as = Array.from(doc.querySelectorAll('a')).map(a => ({ t: norm(a.innerText || a.textContent), h: a.getAttribute('href') || '' }));
    let video = '', mp3 = '';
    for (const a of as) {
      const t = (a.t || '').toLowerCase();
      if (!a.h) continue;
      if (!mp3 && (t.includes('download mp3') || t.includes('mp3'))) mp3 = a.h;
      if (!video && (t.includes('without watermark') || t.includes('download server') || t.includes('hd'))) { if (!/mp3/i.test(a.h)) video = a.h; }
    }
    if (!video) {
      for (const a of as) { if (a.h && (a.h.includes('tikcdn.io/ssstik/') || a.h.includes('ssscdn.io/')) && !/\/m\//.test(a.h) && !/mp3/i.test(a.h)) { video = a.h; break; } }
    }
    if (!mp3) {
      for (const a of as) { if (a.h && (/\/m\//.test(a.h) || /mp3/i.test(a.h)) && (a.h.includes('tikcdn.io') || a.h.includes('ssscdn.io'))) { mp3 = a.h; break; } }
    }
    let author = '', caption = '';
    const txt = doc.body ? (doc.body.innerText || '') : '';
    const lines = txt.split('\n').map(norm).filter(Boolean);
    const wi = lines.findIndex(l => /without watermark/i.test(l));
    if (wi > 0) { caption = lines[wi - 1] || ''; if (wi - 2 >= 0) author = lines[wi - 2] || ''; }
    let avatar = (doc.querySelector('img.result_author') || {}).getAttribute ? (doc.querySelector('img.result_author').getAttribute('src') || '') : '';
    if (!author || !caption) {
      const h2 = norm((doc.querySelector('h2') || {}).innerText || (doc.querySelector('h2') || {}).textContent);
      const h3 = norm((doc.querySelector('h3') || {}).innerText || (doc.querySelector('h3') || {}).textContent);
      const p = norm((doc.querySelector('.maintext') || doc.querySelector('p') || {}).innerText || (doc.querySelector('.maintext') || doc.querySelector('p') || {}).textContent);
      const avatarAlt = norm((doc.querySelector('img.result_author') || {}).getAttribute ? (doc.querySelector('img.result_author').getAttribute('alt') || '') : '');
      if (!author && (h2 || h3 || avatarAlt)) author = h2 || h3 || avatarAlt;
      if (!caption && p) caption = p;
    }
    return JSON.stringify({ ok: resp.ok, status: resp.status, video, mp3, author, caption, avatar, empty: !video && !mp3, len: html.length });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message || e) });
  }
})()`, string(urlJSON))

	out, err := client.EvalAwait(sid, expr)
	if err != nil {
		return tiktokResult{}, fmt.Errorf("gagal memanggil API ssstik: %w", err)
	}

	var ex struct {
		OK      bool   `json:"ok"`
		Status  int    `json:"status"`
		Error   string `json:"error"`
		Video   string `json:"video"`
		MP3     string `json:"mp3"`
		Author  string `json:"author"`
		Caption string `json:"caption"`
		Avatar  string `json:"avatar"`
		Empty   bool   `json:"empty"`
		Len     int    `json:"len"`
	}
	if err := json.Unmarshal([]byte(out), &ex); err != nil {
		return tiktokResult{}, fmt.Errorf("respons API ssstik tidak valid: %w", err)
	}
	if ex.Error != "" {
		return tiktokResult{}, fmt.Errorf("ssstik: %s", ex.Error)
	}

	ex.Video = strings.TrimSpace(ex.Video)
	ex.MP3 = strings.TrimSpace(ex.MP3)
	ex.Author = strings.TrimSpace(ex.Author)
	ex.Caption = strings.TrimSpace(reCaptionClean.ReplaceAllString(ex.Caption, " "))
	ex.Avatar = strings.TrimSpace(ex.Avatar)
	if ex.Video == "" && ex.MP3 == "" {
		return tiktokResult{}, fmt.Errorf("tautan unduhan tidak ditemukan dari ssstik (status %d)", ex.Status)
	}

	result := tiktokResult{
		Author:  pointerString(ex.Author),
		Caption: pointerString(ex.Caption),
		Avatar:  pointerString(ex.Avatar),
	}
	if ex.Video != "" {
		v := ex.Video
		result.VideoURL = &v
	}
	if ex.MP3 != "" {
		m := ex.MP3
		result.MP3URL = &m
	}
	return result, nil
}
