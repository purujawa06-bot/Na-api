// Package reader ports the Komiku and DramaBox scraper endpoints from the
// original Next.js backend. Both sites are server-rendered (komiku.org) or
// embed their data in __NEXT_DATA__ (dramabox.com), so plain HTTPS fetching
// plus HTML/JSON parsing is enough — no browser is involved.
package reader

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
	apicache "github.com/purujawa06-bot/na-api/backend/internal/cache"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

// cacheTTL mirrors the shared edge-cache window of the original backend
// (EDGE_CACHE_CONTROL / cachedJson): seven days fresh.
const cacheTTL = 604800 * time.Second

var (
	digitsRe    = regexp.MustCompile(`^\d+$`)
	slugRe      = regexp.MustCompile(`(?i)^[a-z0-9-]+$`)
	genreSlugRe = regexp.MustCompile(`^[a-z0-9-]+$`)
)

// errKomikuNotFound marks a detail page that rendered without a title.
var errKomikuNotFound = errors.New("Komik tidak ditemukan")

// handler carries the shared dependencies for the reader endpoints.
type handler struct {
	deps *app.Deps
}

// Register mounts the reader endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	h := &handler{deps: deps}
	mux.HandleFunc("GET /api/komiku/home", h.komikuHome)
	mux.HandleFunc("GET /api/komiku/detail", h.komikuDetail)
	mux.HandleFunc("GET /api/komiku/chapter", h.komikuChapter)
	mux.HandleFunc("GET /api/komiku/genre", h.komikuGenre)
	mux.HandleFunc("GET /api/komiku/pustaka", h.komikuPustaka)
	mux.HandleFunc("GET /api/komiku/search", h.komikuSearch)
	mux.HandleFunc("GET /api/dramabox/home", h.dramaboxHome)
	mux.HandleFunc("GET /api/dramabox/category", h.dramaboxCategory)
	mux.HandleFunc("GET /api/dramabox/detail", h.dramaboxDetail)
	mux.HandleFunc("GET /api/dramabox/search", h.dramaboxSearch)
	mux.HandleFunc("GET /api/dramabox/stream", h.dramaboxStream)
}

// requestContext bounds upstream work with the configured request timeout.
func (h *handler) requestContext(r *http.Request) (context.Context, context.CancelFunc) {
	timeout := webclient.DefaultTimeout
	if h.deps != nil && h.deps.Config != nil && h.deps.Config.RequestTimeout > 0 {
		timeout = h.deps.Config.RequestTimeout
	}
	return context.WithTimeout(r.Context(), timeout)
}

// cache returns the shared cache, or nil when the dependency is unavailable.
func (h *handler) cache() *apicache.Cache {
	if h.deps == nil {
		return nil
	}
	return h.deps.Cache
}

// cacheGet serves a value from the shared cache or produces and stores it.
func cacheGet[T any](store *apicache.Cache, key string, ttl time.Duration, produce func() (T, error)) (T, error) {
	if store != nil {
		if cached, ok := store.Get(key); ok {
			if value, ok := cached.(T); ok {
				return value, nil
			}
		}
	}
	value, err := produce()
	if err != nil {
		return value, err
	}
	if store != nil {
		store.Set(key, value, ttl)
	}
	return value, nil
}

// cacheKeyForRequest builds a stable key from the request path and sorted
// query parameters, mirroring lib/api-cache.js.
func cacheKeyForRequest(r *http.Request) string {
	query := r.URL.Query()
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	pairs := make([]string, 0, len(keys))
	for _, key := range keys {
		for _, value := range query[key] {
			pairs = append(pairs, encodeURIComponent(key)+"="+encodeURIComponent(value))
		}
	}
	if len(pairs) == 0 {
		return "GET " + r.URL.Path
	}
	return "GET " + r.URL.Path + "?" + strings.Join(pairs, "&")
}

// writeBadRequest writes the `{ "error": message }` envelope used by the
// original routes for invalid query parameters.
func writeBadRequest(w http.ResponseWriter, message string) {
	httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": message})
}

// writeNotFound writes the 404 envelope of the original routes.
func writeNotFound(w http.ResponseWriter, message string) {
	httpx.JSON(w, http.StatusNotFound, map[string]any{"success": false, "error": message})
}

// writeUpstreamError writes the 502 envelope of the original routes.
func writeUpstreamError(w http.ResponseWriter, err error) {
	httpx.JSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
}

// parsePageParam validates the optional page query parameter.
func parsePageParam(raw string, max int) (int, string) {
	if raw == "" {
		return 1, ""
	}
	if !digitsRe.MatchString(raw) {
		return 0, "Parameter page harus berupa angka"
	}
	page, err := strconv.Atoi(raw)
	if err != nil || page < 1 || page > max {
		return 0, "Parameter page di luar jangkauan (1-" + strconv.Itoa(max) + ")"
	}
	return page, ""
}

// localeError is the shared validation message for unsupported locales.
func localeError() string {
	return "locale tidak didukung. Pilihan: " + strings.Join(dramaboxLocales, ", ")
}

// hasLocale reports whether locale is part of DRAMABOX_LOCALES.
func hasLocale(locale string) bool {
	for _, candidate := range dramaboxLocales {
		if candidate == locale {
			return true
		}
	}
	return false
}

// komikuHome handles GET /api/komiku/home.
func (h *handler) komikuHome(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*komikuHomeResponse, error) {
		return fetchKomikuHome(ctx)
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// komikuDetail handles GET /api/komiku/detail?slug=.
func (h *handler) komikuDetail(w http.ResponseWriter, r *http.Request) {
	slug := r.URL.Query().Get("slug")
	if strings.TrimSpace(slug) == "" {
		writeBadRequest(w, "Parameter slug wajib diisi")
		return
	}
	if len(slug) > 300 {
		writeBadRequest(w, "slug terlalu panjang")
		return
	}
	if !slugRe.MatchString(slug) {
		writeBadRequest(w, "slug hanya boleh berisi huruf, angka, dan tanda hubung")
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*komikuDetailResponse, error) {
		result, err := fetchKomikuDetail(ctx, strings.TrimSpace(slug))
		if err != nil {
			return nil, err
		}
		if result.Title == nil {
			// Keep misses out of the cache, matching cachedJson behaviour.
			return nil, errKomikuNotFound
		}
		return result, nil
	})
	if errors.Is(err, errKomikuNotFound) {
		writeNotFound(w, errKomikuNotFound.Error())
		return
	}
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// komikuChapter handles GET /api/komiku/chapter?url=.
func (h *handler) komikuChapter(w http.ResponseWriter, r *http.Request) {
	permalink := r.URL.Query().Get("url")
	if strings.TrimSpace(permalink) == "" {
		writeBadRequest(w, "Parameter url wajib diisi")
		return
	}
	if len(permalink) > 500 {
		writeBadRequest(w, "url terlalu panjang")
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*komikuChapterResponse, error) {
		return fetchKomikuChapter(ctx, strings.TrimSpace(permalink))
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// komikuGenre handles GET /api/komiku/genre?genre=&page=.
func (h *handler) komikuGenre(w http.ResponseWriter, r *http.Request) {
	genre := strings.ToLower(strings.TrimSpace(httpx.QueryStr(r, "genre", "isekai")))
	if len(genre) > 50 || !genreSlugRe.MatchString(genre) {
		writeBadRequest(w, "genre tidak valid (hanya huruf/angka/tanda hubung)")
		return
	}
	page, message := parsePageParam(r.URL.Query().Get("page"), 5000)
	if message != "" {
		writeBadRequest(w, message)
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*komikuGenreResponse, error) {
		return fetchKomikuGenre(ctx, genre, page)
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// komikuPustaka handles GET /api/komiku/pustaka.
func (h *handler) komikuPustaka(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	tipe := strings.ToLower(query.Get("tipe"))
	orderby := strings.ToLower(query.Get("orderby"))
	genre := query.Get("genre")
	genre2 := query.Get("genre2")
	status := strings.ToLower(query.Get("status"))

	if tipe != "" && !containsString(komikuTipes, tipe) {
		writeBadRequest(w, "tipe tidak didukung. Pilihan: "+strings.Join(komikuTipes, ", "))
		return
	}
	if !containsString([]string{"", "modified", "date", "meta_value_num", "rand"}, orderby) {
		writeBadRequest(w, "orderby tidak didukung")
		return
	}
	if !containsString([]string{"", "ongoing", "end"}, status) {
		writeBadRequest(w, "status tidak didukung. Pilihan: ongoing, end")
		return
	}
	if len(genre) > 50 || len(genre2) > 50 {
		writeBadRequest(w, "genre terlalu panjang")
		return
	}
	page, message := parsePageParam(query.Get("page"), 5000)
	if message != "" {
		writeBadRequest(w, message)
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*komikuPustakaResponse, error) {
		return fetchKomikuPustaka(ctx, tipe, orderby, genre, genre2, status, page)
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// komikuSearch handles GET /api/komiku/search?q=&page=.
func (h *handler) komikuSearch(w http.ResponseWriter, r *http.Request) {
	keyword := r.URL.Query().Get("q")
	if strings.TrimSpace(keyword) == "" {
		writeBadRequest(w, "Parameter q (kata kunci) wajib diisi")
		return
	}
	if len(keyword) > 100 {
		writeBadRequest(w, "Kata kunci terlalu panjang")
		return
	}
	page, message := parsePageParam(r.URL.Query().Get("page"), 5000)
	if message != "" {
		writeBadRequest(w, message)
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*komikuSearchResponse, error) {
		return fetchKomikuSearch(ctx, strings.TrimSpace(keyword), page)
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// dramaboxHome handles GET /api/dramabox/home?locale=.
func (h *handler) dramaboxHome(w http.ResponseWriter, r *http.Request) {
	locale := httpx.QueryStr(r, "locale", "in")
	if !hasLocale(locale) {
		writeBadRequest(w, localeError())
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*dramaboxHomeResponse, error) {
		return fetchDramaboxHome(ctx, locale)
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// dramaboxCategory handles GET /api/dramabox/category.
func (h *handler) dramaboxCategory(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	typeID := query.Get("id")
	locale := httpx.QueryStr(r, "locale", "in")

	if typeID != "" && !digitsRe.MatchString(typeID) {
		writeBadRequest(w, "Parameter id harus berupa angka (typeTwoId)")
		return
	}
	page, message := parsePageParam(query.Get("page"), 500)
	if message != "" {
		writeBadRequest(w, message)
		return
	}
	if !hasLocale(locale) {
		writeBadRequest(w, localeError())
		return
	}
	if typeID == "" {
		typeID = "all"
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*dramaboxCategoryResponse, error) {
		return fetchDramaboxCategory(ctx, typeID, page, locale)
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// dramaboxDetail handles GET /api/dramabox/detail?id=&locale=.
func (h *handler) dramaboxDetail(w http.ResponseWriter, r *http.Request) {
	bookID := r.URL.Query().Get("id")
	locale := httpx.QueryStr(r, "locale", "in")

	if !digitsRe.MatchString(bookID) {
		writeBadRequest(w, "Parameter id wajib berupa angka (bookId)")
		return
	}
	if len(bookID) > 20 {
		writeBadRequest(w, "Parameter id terlalu panjang")
		return
	}
	if !hasLocale(locale) {
		writeBadRequest(w, localeError())
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*dramaboxDetailResponse, error) {
		return fetchDramaboxDetail(ctx, bookID, locale)
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// dramaboxSearch handles GET /api/dramabox/search?q=&page=&locale=.
func (h *handler) dramaboxSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	keyword := query.Get("q")
	locale := httpx.QueryStr(r, "locale", "in")

	if strings.TrimSpace(keyword) == "" {
		writeBadRequest(w, "Parameter q (kata kunci) wajib diisi")
		return
	}
	if len(keyword) > 100 {
		writeBadRequest(w, "Kata kunci terlalu panjang")
		return
	}
	page, message := parsePageParam(query.Get("page"), 500)
	if message != "" {
		writeBadRequest(w, message)
		return
	}
	if !hasLocale(locale) {
		writeBadRequest(w, localeError())
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	data, err := cacheGet(h.cache(), cacheKeyForRequest(r), cacheTTL, func() (*dramaboxSearchResponse, error) {
		return fetchDramaboxSearch(ctx, strings.TrimSpace(keyword), page, locale)
	})
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// dramaboxStream handles GET /api/dramabox/stream?id=&chapter=&locale=.
func (h *handler) dramaboxStream(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	bookID := query.Get("id")
	chapterID := query.Get("chapter")
	locale := httpx.QueryStr(r, "locale", "in")

	if !digitsRe.MatchString(bookID) {
		writeBadRequest(w, "Parameter id wajib berupa angka")
		return
	}
	if len(bookID) > 20 {
		writeBadRequest(w, "Parameter id terlalu panjang")
		return
	}
	if !digitsRe.MatchString(chapterID) {
		writeBadRequest(w, "Parameter chapter wajib berupa angka")
		return
	}
	if len(chapterID) > 20 {
		writeBadRequest(w, "Parameter chapter terlalu panjang")
		return
	}
	if !hasLocale(locale) {
		writeBadRequest(w, localeError())
		return
	}

	ctx, cancel := h.requestContext(r)
	defer cancel()

	// Signed mp4 URLs expire, so this endpoint bypasses the shared cache.
	data, err := fetchDramaboxStream(ctx, bookID, chapterID, locale)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	httpx.OK(w, data)
}

// containsString reports whether values contains target.
func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
