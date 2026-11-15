package tools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const bratSiteURL = "https://www.bratgenerator.com/"

type bratCDP struct {
	conn *websocket.Conn
	ctx  context.Context
	id   int
}

type bratCDPMsg struct {
	ID     int             `json:"id,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (c *bratCDP) call(method string, params any, sessionID string) (json.RawMessage, error) {
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
		var resp bratCDPMsg
		if err := wsjson.Read(c.ctx, c.conn, &resp); err != nil {
			return nil, err
		}
		if resp.ID == c.id {
			if resp.Error != nil {
				return nil, errors.New(resp.Error.Message)
			}
			return resp.Result, nil
		}
	}
}

func (c *bratCDP) eval(sessionID, expression string) (string, error) {
	raw, err := c.call("Runtime.evaluate", map[string]any{
		"expression":    expression,
		"returnByValue": true,
		"awaitPromise":  true,
	}, sessionID)
	if err != nil {
		return "", err
	}
	var out struct {
		Result struct {
			Value any `json:"value"`
		} `json:"result"`
		ExceptionDetails any `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	if out.ExceptionDetails != nil {
		b, _ := json.Marshal(out.ExceptionDetails)
		return "", fmt.Errorf("eval exception: %s", string(b))
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

func (c *bratCDP) waitFor(sessionID, jsExpr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		v, err := c.eval(sessionID, jsExpr)
		if err == nil && (v == "true" || v == "1") {
			return nil
		}
		select {
		case <-c.ctx.Done():
			return c.ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
	}
	return fmt.Errorf("timeout menunggu kondisi")
}

func renderBratImage(ctx context.Context, text string) ([]byte, error) {
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("Parameter 'text' wajib diisi")
	}
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		img, err := renderBratImageOnce(ctx, text)
		if err == nil {
			return img, nil
		}
		lastErr = err
		// retry on transient connection errors
		if attempt == 0 {
			select {
			case <-ctx.Done():
				return nil, lastErr
			case <-time.After(1200 * time.Millisecond):
			}
		}
	}
	return nil, lastErr
}

func bratCDPEndpoints() []string {
	if v := strings.TrimSpace(os.Getenv("BRAT_CDP_URL")); v != "" {
		return []string{v}
	}
	// Try full browser first (better fonts/blur), then Lightpanda as fallback.
	seen := map[string]bool{}
	var out []string
	add := func(u string) {
		u = strings.TrimSpace(u)
		if u != "" && !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	add(os.Getenv("CDP_WS_URL"))
	add(os.Getenv("BING_CDP_URL"))
	add("wss://browser-yq20.onrender.com/")
	add("wss://light-panda-cdp.onrender.com/")
	return out
}

func renderBratImageOnce(ctx context.Context, text string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 110*time.Second)
	defer cancel()

	var lastDialErr error
	var conn *websocket.Conn
	for _, endpoint := range bratCDPEndpoints() {
		cn, _, err := websocket.Dial(ctx, endpoint, nil)
		if err == nil {
			conn = cn
			break
		}
		lastDialErr = err
	}
	if conn == nil {
		if lastDialErr != nil {
			return nil, fmt.Errorf("cdp dial: %w", lastDialErr)
		}
		return nil, fmt.Errorf("cdp dial: no endpoint available")
	}
	if err != nil {
		return nil, fmt.Errorf("cdp dial: %w", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")
	c := &bratCDP{conn: conn, ctx: ctx}

	raw, err := c.call("Target.createTarget", map[string]any{"url": "about:blank"}, "")
	if err != nil {
		return nil, fmt.Errorf("create target: %w", err)
	}
	var ct struct {
		TargetID string `json:"targetId"`
	}
	if err := json.Unmarshal(raw, &ct); err != nil || ct.TargetID == "" {
		return nil, errors.New("targetId tidak ditemukan")
	}
	targetID := ct.TargetID
	defer func() { _, _ = c.call("Target.closeTarget", map[string]any{"targetId": targetID}, "") }()

	raw, err = c.call("Target.attachToTarget", map[string]any{"targetId": targetID, "flatten": true}, "")
	if err != nil {
		return nil, fmt.Errorf("attach: %w", err)
	}
	var att struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &att); err != nil || att.SessionID == "" {
		return nil, errors.New("sessionId tidak ditemukan")
	}
	sid := att.SessionID

	_, _ = c.call("Page.enable", map[string]any{}, sid)
	_, _ = c.call("Runtime.enable", map[string]any{}, sid)
	_, _ = c.call("Emulation.setDeviceMetricsOverride", map[string]any{
		"width": 512, "height": 512, "deviceScaleFactor": 1, "mobile": false,
	}, sid)

	if _, err := c.call("Page.navigate", map[string]any{"url": bratSiteURL}, sid); err != nil {
		return nil, fmt.Errorf("navigate: %w", err)
	}

	// Wait for site scripts (setupTheme/textFit) to be ready.
	if err := c.waitFor(sid, "typeof setupTheme==='function' && typeof textFit==='function'", 30*time.Second); err != nil {
		return nil, fmt.Errorf("halaman brat tidak siap: %w", err)
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(800 * time.Millisecond):
	}

	textJS, _ := json.Marshal(text)
	// Apply white theme using site's own logic, then set custom text and re-fit.
	setupExpr := fmt.Sprintf(`(function(){
  var txt = %s;
  try{ if(typeof setupTheme==='function') setupTheme('white'); }catch(e){}
  var inp = document.getElementById('textInput');
  var overlay = document.getElementById('textOverlay');
  // Set text through the site's own handler path for consistent fitting/structure
  if(inp){
    inp.value = txt;
    try{ inp.dispatchEvent(new Event('input', {bubbles:true})); }catch(e){
      if(overlay){ overlay.innerText = txt; }
      try{ if(typeof textFit==='function' && overlay) textFit(overlay, {maxFontSize: 75}); }catch(e2){}
    }
  } else if(overlay){
    overlay.innerText = txt;
    try{ if(typeof textFit==='function') textFit(overlay, {maxFontSize: 75}); }catch(e){}
  }
  // Keep white background clean; hide placeholder/strike images
  var memeImage = document.getElementById('memeImage');
  var memeStrike = document.getElementById('memeImageStrike');
  if(memeImage){ memeImage.style.display = 'none'; }
  if(memeStrike){ memeStrike.style.display = 'none'; }

  // Isolate meme container for a clean 512x512 capture (white background)
  var cont = document.getElementById('memeContainer');
  if(cont){
    cont.style.width = '512px';
    cont.style.height = '512px';
    cont.style.minHeight = '512px';
    cont.style.maxHeight = '512px';
    cont.style.margin = '0';
    cont.style.background = '#ffffff';
    cont.style.display = 'flex';
    cont.style.alignItems = 'center';
    cont.style.justifyContent = 'center';
    cont.style.position = 'fixed';
    cont.style.left = '0';
    cont.style.top = '0';
    cont.style.zIndex = '999999';
  }
  document.body.style.margin = '0';
  document.body.style.background = '#ffffff';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.background = '#ffffff';

  // Hide everything else so capture is just the brat output
  Array.from(document.body.children).forEach(function(c){
    if(cont && (c === cont || c.contains(cont))) return;
    c.style.display = 'none';
  });
  // Remove UI overlays/blurbs if any inside or near container
  var blurb = document.getElementById('screenshot-blurb'); if(blurb) blurb.style.display='none';
  return 'ok';
})()`, string(textJS))
	if _, err := c.eval(sid, setupExpr); err != nil {
		return nil, fmt.Errorf("gagal menyiapkan render: %w", err)
	}

	// allow layout/fonts to settle
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(1500 * time.Millisecond):
	}
	_ = c.waitFor(sid, "document.readyState === 'complete'", 5*time.Second)

	// Viewport is 512x512; capture full viewport for a stable 512x512 image.
	shot, err := c.call("Page.captureScreenshot", map[string]any{
		"format": "png",
	}, sid)
	if err != nil {
		// fallback: fixed clip
		shot, err = c.call("Page.captureScreenshot", map[string]any{
			"format": "png",
			"clip":   map[string]any{"x": 0, "y": 0, "width": 512, "height": 512, "scale": 1},
		}, sid)
		if err != nil {
			return nil, fmt.Errorf("screenshot: %w", err)
		}
	}
	var sc struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(shot, &sc); err != nil || sc.Data == "" {
		return nil, errors.New("data screenshot kosong")
	}
	img, err := base64.StdEncoding.DecodeString(sc.Data)
	if err != nil {
		return nil, fmt.Errorf("decode screenshot: %w", err)
	}
	return img, nil
}

func (h *handlers) brat(w http.ResponseWriter, r *http.Request) {
	text := strings.TrimSpace(r.URL.Query().Get("text"))
	if text == "" && r.Method == http.MethodPost {
		if ct := r.Header.Get("Content-Type"); strings.Contains(strings.ToLower(ct), "application/json") {
			if body, ok := decodeBody(w, r); ok {
				if v, ok := stringValue(body, "text"); ok {
					text = v
				}
			} else {
				return
			}
		} else {
			_ = r.ParseForm()
			text = strings.TrimSpace(r.FormValue("text"))
		}
	}
	if text == "" {
		httpx.Error(w, http.StatusBadRequest, "Parameter 'text' wajib diisi")
		return
	}

	// Brat rendering via CDP can take longer than the default request timeout.
	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	img, err := renderBratImage(ctx, text)
	if err != nil {
		httpx.UpstreamError(w, "Gagal membuat gambar brat: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=300, s-maxage=300")
	w.Header().Set("Content-Length", strconv.Itoa(len(img)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(img)
}
