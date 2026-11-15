package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mxschmitt/playwright-go"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const bratSiteURL = "https://www.bratgenerator.com/"

func bratCDPEndpoints() []string {
	return []string{"wss://light-panda-cdp.onrender.com/"}
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
		if attempt == 0 {
			select {
			case <-ctx.Done():
			case <-time.After(1200 * time.Millisecond):
			}
		}
	}
	return nil, lastErr
}

func renderBratImageOnce(ctx context.Context, text string) ([]byte, error) {
	pw, err := playwright.Run()
	if err != nil {
		return nil, fmt.Errorf("playwright run: %w", err)
	}
	defer func() { _ = pw.Stop() }()

	var browser playwright.Browser
	var dialErr error
	for _, endpoint := range bratCDPEndpoints() {
		b, err := pw.Chromium.ConnectOverCDP(endpoint)
		if err == nil {
			browser = b
			break
		}
		dialErr = err
	}
	if browser == nil {
		if dialErr != nil {
			return nil, fmt.Errorf("cdp connect: %w", dialErr)
		}
		return nil, fmt.Errorf("cdp connect: no endpoint available")
	}
	defer func() { _ = browser.Close() }()

	var contextOpts playwright.BrowserNewContextOptions
	contextOpts.Viewport = &playwright.Size{Width: 512, Height: 512}
	bctx, err := browser.NewContext(contextOpts)
	if err != nil {
		return nil, fmt.Errorf("new context: %w", err)
	}
	defer func() { _ = bctx.Close() }()

	page, err := bctx.NewPage()
	if err != nil {
		return nil, fmt.Errorf("new page: %w", err)
	}
	defer func() { _ = page.Close() }()

	page.SetDefaultTimeout(30000)
	if _, err := page.Goto(bratSiteURL, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(45000),
	}); err != nil {
		return nil, fmt.Errorf("navigate: %w", err)
	}

	// 2) click white theme toggle
	toggle := page.Locator("#toggleButtonWhite")
	if err := toggle.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(30000),
	}); err == nil {
		_ = toggle.Click(playwright.LocatorClickOptions{Timeout: playwright.Float(10000)})
	} else {
		_, _ = page.Evaluate(`() => { try{ setupTheme('white'); }catch(e){} }`)
	}

	// 3) input text
	input := page.Locator("#textInput")
	if err := input.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(15000),
	}); err == nil {
		_ = input.Click(playwright.LocatorClickOptions{Timeout: playwright.Float(5000)})
		_ = input.Fill(text, playwright.LocatorFillOptions{Timeout: playwright.Float(10000)})
		// dispatch input/change for handlers relying on events
		_, _ = input.Evaluate(`(el, txt) => { el.value = txt; try{ el.dispatchEvent(new Event('input', {bubbles:true})); }catch(e){} try{ el.dispatchEvent(new Event('change', {bubbles:true})); }catch(e){} }`, text)
	}

	// Wait until text is applied/fitted
	textJSON, _ := json.Marshal(text)
	_, _ = page.WaitForFunction(fmt.Sprintf(`() => { var want = %s; var el = document.querySelector('#textOverlay .textFitted') || document.getElementById('textOverlay'); if(!el) return false; var t=(el.textContent||'').trim(); return t.length>0 && t===String(want).trim(); }`, string(textJSON)), nil, playwright.PageWaitForFunctionOptions{Timeout: playwright.Float(10000)})
	_ = page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle, Timeout: playwright.Float(5000)})
	time.Sleep(800 * time.Millisecond)

	// 4) screenshot #memeContainer (512x512)
	container := page.Locator("#memeContainer")
	if err := container.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(15000),
	}); err != nil {
		return nil, fmt.Errorf("memeContainer tidak ditemukan: %w", err)
	}

	box, err := container.BoundingBox()
	if err != nil || box == nil || box.Width <= 0 || box.Height <= 0 {
		return nil, fmt.Errorf("ukuran memeContainer tidak valid")
	}
	clip := &playwright.Rect{X: box.X, Y: box.Y, Width: box.Width, Height: box.Height}
	img, err := page.Screenshot(playwright.PageScreenshotOptions{
		Type: playwright.ScreenshotTypePng,
		Clip: clip,
	})
	if err != nil {
		return nil, fmt.Errorf("screenshot: %w", err)
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
	_ = ctx // playwright-go API is synchronous; context used for outer timeout budget
	img, err := renderBratImage(r.Context(), text)
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
