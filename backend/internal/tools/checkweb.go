package tools

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

func (h *handlers) checkWeb(w http.ResponseWriter, r *http.Request) {
	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "Parameter 'url' wajib diisi",
		})
		return
	}

	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "URL tidak valid",
		})
		return
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "URL harus http/https",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   8 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   8 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	doReq := func(method string) (*http.Response, time.Duration, error) {
		req, err := http.NewRequestWithContext(ctx, method, rawURL, nil)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "*/*")
		start := time.Now()
		resp, err := client.Do(req)
		return resp, time.Since(start), err
	}

	resp, elapsed, err := doReq(http.MethodHead)
	if err != nil {
		// coba GET jika HEAD gagal di level koneksi
		resp, elapsed, err = doReq(http.MethodGet)
	} else if resp != nil && (resp.StatusCode == http.StatusMethodNotAllowed || resp.StatusCode == http.StatusForbidden) {
		resp.Body.Close()
		resp, elapsed, err = doReq(http.MethodGet)
	}

	if err != nil {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"success":          true,
			"url":              rawURL,
			"up":               false,
			"status":           0,
			"status_text":      "",
			"response_time_ms": elapsed.Milliseconds(),
			"error":            err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	up := resp.StatusCode >= 200 && resp.StatusCode < 500
	result := map[string]any{
		"success":          true,
		"url":              rawURL,
		"final_url":        resp.Request.URL.String(),
		"up":               up,
		"status":           resp.StatusCode,
		"status_text":      http.StatusText(resp.StatusCode),
		"response_time_ms": elapsed.Milliseconds(),
		"content_type":     resp.Header.Get("Content-Type"),
	}
	httpx.JSON(w, http.StatusOK, result)
}
