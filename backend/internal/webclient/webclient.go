// Package webclient wraps outbound HTTP calls with sensible defaults: browser
// user agents, request timeouts, and helpers for the common request shapes used
// by the scrapers.
package webclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultTimeout bounds a single upstream request.
const DefaultTimeout = 45 * time.Second

// MaxBodyBytes caps how much of an upstream response is read (16 MiB).
const MaxBodyBytes = 16 << 20

const (
	// UserAgentChrome is the browser UA most upstream sites expect.
	UserAgentChrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
	// UserAgentBot is a crawler UA accepted by embed proxies.
	UserAgentBot = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"
)

// Client is the shared HTTP client. Redirects are followed except when a caller
// builds its own request with CheckRedirect overridden.
var Client = &http.Client{Timeout: DefaultTimeout}

// Get performs a GET request with the provided headers.
func Get(ctx context.Context, rawURL string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	applyHeaders(req, headers)
	return Client.Do(req)
}

// PostForm performs an application/x-www-form-urlencoded POST.
func PostForm(ctx context.Context, rawURL string, form url.Values, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	applyHeaders(req, headers)
	return Client.Do(req)
}

// PostJSON performs a JSON POST.
func PostJSON(ctx context.Context, rawURL string, payload any, headers map[string]string) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	applyHeaders(req, headers)
	return Client.Do(req)
}

// Do sends an already-built request.
func Do(req *http.Request) (*http.Response, error) { return Client.Do(req) }

// ReadBody reads the response body (capped) and closes it.
func ReadBody(resp *http.Response) (string, error) {
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, MaxBodyBytes))
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// GetText fetches a URL and returns its body as text.
func GetText(ctx context.Context, rawURL string, headers map[string]string) (string, error) {
	resp, err := Get(ctx, rawURL, headers)
	if err != nil {
		return "", err
	}
	return ReadBody(resp)
}

// DecodeJSON decodes a JSON response body into target.
func DecodeJSON(resp *http.Response, target any) error {
	defer resp.Body.Close()
	return json.NewDecoder(io.LimitReader(resp.Body, MaxBodyBytes)).Decode(target)
}

// IsBlocked reports whether a page is a Cloudflare interstitial/challenge.
func IsBlocked(body string) bool {
	lower := strings.ToLower(body)
	return strings.Contains(lower, "just a moment") ||
		strings.Contains(lower, "challenge-error-text") ||
		strings.Contains(lower, "cf-chl-")
}

// StatusError builds a descriptive error for a non-2xx upstream response.
func StatusError(service string, status int, body string) error {
	snippet := strings.TrimSpace(body)
	if len(snippet) > 200 {
		snippet = snippet[:200]
	}
	return fmt.Errorf("%s responded with HTTP %d: %s", service, status, snippet)
}

// applyHeaders copies caller headers onto the request and fills a default UA.
func applyHeaders(req *http.Request, headers map[string]string) {
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", UserAgentChrome)
	}
	req.Header.Set("Accept-Language", "id-ID,id;q=0.9,en;q=0.8")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
}
