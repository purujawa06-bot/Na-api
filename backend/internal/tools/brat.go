package tools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const bratCDPURL = "wss://light-panda-cdp.onrender.com/"

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

func bratHTML(text string) string {
	// Escape text for safe embedding in JS string; render will set textContent.
	escaped := strconv.QuoteToASCII(text) // returns quoted Go string literal
	// Build a self-contained page mimicking brat "white background" style.
	return fmt.Sprintf(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face {
  font-family: 'arial_narrowregular';
  src: url('https://www.bratgenerator.com/sites/g/files/g2000017981/files/2024-03/arial_narrow-webfont.woff') format('woff');
  font-weight: normal;
  font-style: normal;
}
html, body {
  margin: 0;
  padding: 0;
  width: 512px;
  height: 512px;
  background: #ffffff;
  overflow: hidden;
}
#wrap {
  width: 512px;
  height: 512px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  box-sizing: border-box;
  padding: 28px;
}
#box {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
#text {
  font-family: 'arial_narrowregular', 'Arial Narrow', Arial, sans-serif;
  font-weight: 500;
  color: #000000;
  filter: blur(2px);
  -webkit-filter: blur(2px);
  text-align: justify;
  text-align-last: justify;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.05;
  width: 100%;
  display: block;
}
</style>
</head>
<body>
<div id="wrap"><div id="box"><span id="text"></span></div></div>
<script>
(function(){
  const txt = %s;
  const el = document.getElementById('text');
  el.textContent = txt;
  function fits(size){
    el.style.fontSize = size + 'px';
    // allow layout
    return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.parentElement.clientHeight + 1;
  }
  function fit(){
    const box = document.getElementById('box');
    let lo = 8, hi = 420, best = 8;
    for(let i=0;i<20;i++){
      const mid = Math.floor((lo+hi)/2);
      if(fits(mid)){ best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    el.style.fontSize = best + 'px';
    // if single short line, center looks better
    if(!/\n/.test(txt) && txt.trim().length <= 12){
      el.style.textAlign = 'center';
      el.style.textAlignLast = 'center';
    }
  }
  function ready(){
    fit();
    document.body.setAttribute('data-ready','1');
  }
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(function(){ setTimeout(ready, 60); });
  } else {
    setTimeout(ready, 300);
  }
})();
</script>
</body>
</html>`, escaped)
}

func renderBratImage(ctx context.Context, text string) ([]byte, error) {
	if strings.TrimSpace(text) == "" {
		return nil, fmt.Errorf("Parameter 'text' wajib diisi")
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, bratCDPURL, nil)
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

	page := bratHTML(text)
	// Load content. Prefer Page.setDocumentContent if available, else navigate to data URL.
	encoded := base64.StdEncoding.EncodeToString([]byte(page))
	dataURL := "data:text/html;base64," + encoded
	if _, err := c.call("Page.navigate", map[string]any{"url": dataURL}, sid); err != nil {
		return nil, fmt.Errorf("navigate: %w", err)
	}
	// wait ready
	_ = c.waitFor(sid, "document.body && document.body.getAttribute('data-ready')==='1'", 20*time.Second)
	// extra settle for font/blur rasterization
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(400 * time.Millisecond):
	}

	shot, err := c.call("Page.captureScreenshot", map[string]any{
		"format": "png",
		"clip": map[string]any{
			"x": 0, "y": 0, "width": 512, "height": 512, "scale": 1,
		},
	}, sid)
	if err != nil {
		// fallback: viewport screenshot
		shot, err = c.call("Page.captureScreenshot", map[string]any{"format": "png"}, sid)
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
		// accept JSON or form
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

	ctx, cancel := h.requestContext(r)
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

// avoid unused import if html package not needed elsewhere in this file; keep simple.
// (html package was not used; remove if compiler complains)
var _ = html.EscapeString
