package downloader

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// cacheTTL mirrors the in-memory TTL used by lib/api-cache.js (7 days). The
// stale-while-revalidate window is not mirrored here: that behaviour is served
// by the CDN, which the shared middleware configures with the matching header.
const cacheTTL = 7 * 24 * time.Hour

// cachedJSON is one stored response. Only 2xx payloads are ever stored, exactly
// like cachedJson() in lib/api-cache.js.
type cachedJSON struct {
	status  int
	payload any
}

// cachedGET serves a GET JSON response through deps.Cache. The producer returns
// the status and payload it wants to send; non-2xx payloads bypass the cache.
func (h *handler) cachedGET(w http.ResponseWriter, r *http.Request, produce func(context.Context) (int, any)) {
	if h.deps == nil || h.deps.Cache == nil {
		status, payload := produce(r.Context())
		httpx.JSON(w, status, payload)
		return
	}

	key := cacheKey(r)
	if raw, ok := h.deps.Cache.Get(key); ok {
		if entry, ok := raw.(cachedJSON); ok {
			w.Header().Set("X-Cache", "HIT")
			httpx.JSON(w, entry.status, entry.payload)
			return
		}
	}

	status, payload := produce(r.Context())
	if status >= http.StatusOK && status < http.StatusMultipleChoices {
		h.deps.Cache.Set(key, cachedJSON{status: status, payload: payload}, cacheTTL)
		w.Header().Set("X-Cache", "MISS")
	}
	httpx.JSON(w, status, payload)
}

// cacheKey builds the same stable key as cacheKeyForRequest(): path plus the
// query parameters sorted by name.
func cacheKey(r *http.Request) string {
	query := r.URL.Query()
	names := make([]string, 0, len(query))
	for name := range query {
		names = append(names, name)
	}
	sort.Strings(names)

	pairs := make([]string, 0, len(query))
	for _, name := range names {
		for _, value := range query[name] {
			pairs = append(pairs, escapeCachePart(name)+"="+escapeCachePart(value))
		}
	}
	key := "GET " + r.URL.Path
	if len(pairs) > 0 {
		key += "?" + strings.Join(pairs, "&")
	}
	return key
}

// escapeCachePart encodes a key fragment like encodeURIComponent (space -> %20).
func escapeCachePart(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

// validationError carries a client-facing message for rejected input.
type validationError struct {
	message string
}

func (e *validationError) Error() string { return e.message }

// downloadURLValidator reports whether a lower-cased hostname is accepted.
type downloadURLValidator func(host string) bool

// validateDownloadURL applies the shared downloader URL rules: required, at
// most 2048 characters, a valid absolute URL, https only, allowlisted host.
func validateDownloadURL(raw string, allowed downloadURLValidator, hostMessage string) *validationError {
	if raw == "" {
		return &validationError{message: "Parameter url wajib diisi"}
	}
	if len(raw) > 2048 {
		return &validationError{message: "URL terlalu panjang"}
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return &validationError{message: "URL tidak valid"}
	}
	if parsed.Scheme != "https" {
		return &validationError{message: "Hanya URL HTTPS yang didukung"}
	}
	if !allowed(strings.ToLower(parsed.Hostname())) {
		return &validationError{message: hostMessage}
	}
	return nil
}

// hostIsDomainOrSubdomain matches "example.com" and "*.example.com".
func hostIsDomainOrSubdomain(host, domain string) bool {
	return host == domain || strings.HasSuffix(host, "."+domain)
}

// decodeBody decodes a JSON object body for POST routes.
func decodeBody(r *http.Request) (map[string]any, error) {
	var body map[string]any
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return nil, err
	}
	if body == nil {
		return nil, fmt.Errorf("body must be a JSON object")
	}
	return body, nil
}

// stringField returns a string field, or "" when it is missing or not a string.
func stringField(body map[string]any, key string) string {
	value, ok := body[key]
	if !ok || value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}

// scalarField stringifies a JSON scalar the way String(value) does in JS.
func scalarField(body map[string]any, key string) string {
	value, ok := body[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(typed)
	default:
		return fmt.Sprint(typed)
	}
}

// parseInt mimics JavaScript parseInt(): leading whitespace and sign are
// accepted, parsing stops at the first non-digit.
func parseInt(raw string, fallback int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	end := 0
	if raw[0] == '+' || raw[0] == '-' {
		end = 1
	}
	start := end
	for end < len(raw) && raw[end] >= '0' && raw[end] <= '9' {
		end++
	}
	if end == start {
		return fallback
	}
	value, err := strconv.Atoi(raw[:end])
	if err != nil {
		return fallback
	}
	return value
}

// leadingInt returns the leading integer of a quality label ("360P" -> 360).
func leadingInt(raw string) int {
	return parseInt(raw, 0)
}

// sleepContext waits for the duration or until the context is cancelled.
func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// pointerString returns nil for an empty string, matching JS `|| null`.
func pointerString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
