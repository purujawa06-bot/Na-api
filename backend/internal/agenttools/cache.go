package agenttools

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	// agentToolsTTL is the fresh window used by cachedJson for the two
	// cacheable GET endpoints (find-skills and web-fetch).
	agentToolsTTL = 7 * 24 * time.Hour
	// agentToolsStale is the extra stale-while-revalidate window.
	agentToolsStale = 24 * time.Hour
)

// cachedBody is the value stored in app.Deps.Cache. FreshUntil separates the
// fresh window from the stale window because cache.Cache only knows a single
// TTL.
type cachedBody struct {
	Status     int
	Body       []byte
	FreshUntil time.Time
}

// cacheKeyForRequest builds a stable key from the request path and its sorted
// query parameters, mirroring cacheKeyForRequest in lib/api-cache.js.
func cacheKeyForRequest(r *http.Request) string {
	query := r.URL.Query()
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var builder strings.Builder
	builder.WriteString("GET ")
	builder.WriteString(r.URL.Path)
	first := true
	for _, key := range keys {
		for _, value := range query[key] {
			if first {
				builder.WriteByte('?')
				first = false
			} else {
				builder.WriteByte('&')
			}
			builder.WriteString(url.QueryEscape(key))
			builder.WriteByte('=')
			builder.WriteString(url.QueryEscape(value))
		}
	}
	return builder.String()
}

// marshalJSON encodes a payload without HTML escaping and appends a newline,
// matching httpx.JSON output so cached and live responses are byte-identical.
func marshalJSON(payload any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// respondCached implements the small subset of cachedJson used by the ported
// endpoints: fresh entries are served as HIT, entries inside the stale window
// are served as STALE, and only 2xx responses are stored.
func (s *server) respondCached(
	w http.ResponseWriter,
	r *http.Request,
	ttl time.Duration,
	stale time.Duration,
	produce func() (int, any),
) {
	key := cacheKeyForRequest(r)
	now := time.Now()

	if s.deps.Cache != nil {
		if value, ok := s.deps.Cache.Get(key); ok {
			if entry, ok := value.(cachedBody); ok {
				hit := "STALE"
				if now.Before(entry.FreshUntil) {
					hit = "HIT"
				}
				writeCachedBody(w, entry, hit)
				return
			}
		}
	}

	status, payload := produce()
	body, err := marshalJSON(payload)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Gagal menyusun respons JSON")
		return
	}
	if status >= 200 && status < 300 && s.deps.Cache != nil {
		s.deps.Cache.Set(key, cachedBody{
			Status:     status,
			Body:       body,
			FreshUntil: now.Add(ttl),
		}, ttl+stale)
	}
	hit := "MISS"
	if status < 200 || status >= 300 {
		hit = ""
	}
	writeCachedBody(w, cachedBody{Status: status, Body: body}, hit)
}

func writeCachedBody(w http.ResponseWriter, entry cachedBody, hit string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if hit != "" {
		w.Header().Set("X-Cache", hit)
	}
	w.WriteHeader(entry.Status)
	_, _ = w.Write(entry.Body)
}
