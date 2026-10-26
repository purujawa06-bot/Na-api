// Package purtv ports the PurTV scraper endpoints, merging the anichin donghua
// source with the samehadaku anime source exactly like the Next.js backend.
package purtv

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// client bundles the upstream endpoints derived from configuration.
type client struct {
	cfProxy    string
	scraperWeb string
	timeout    time.Duration
}

// newClient derives the Cloudflare fallbacks from the shared config.
func newClient(deps *app.Deps) *client {
	proxy := "https://vercel-api-beta-red.vercel.app/api/fetch"
	timeout := 55 * time.Second
	if deps != nil && deps.Config != nil {
		if deps.Config.CloudflareProxy != "" {
			proxy = deps.Config.CloudflareProxy
		}
		if deps.Config.RequestTimeout > 0 {
			timeout = deps.Config.RequestTimeout
		}
	}
	return &client{
		cfProxy:    proxy,
		scraperWeb: scraperWebURL(proxy),
		timeout:    timeout,
	}
}

// scraperWebURL maps any Cloudflare proxy URL to its scraper-web sibling.
func scraperWebURL(proxy string) string {
	base := strings.TrimRight(proxy, "/")
	if index := strings.Index(base, "/api/"); index >= 0 {
		base = base[:index]
	}
	return base + "/api/scraper-web"
}

// requestContext bounds an upstream pipeline to the configured timeout.
func (c *client) requestContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, c.timeout)
}

func (c *client) handleHome(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.home(ctx)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	payload.Success = true
	httpx.OK(w, payload)
}

func (c *client) handleDetail(w http.ResponseWriter, r *http.Request) {
	rawURL := httpx.QueryStr(r, "url", "")
	if rawURL == "" {
		httpx.Error(w, http.StatusBadRequest, "Parameter url wajib diisi.")
		return
	}
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.detail(ctx, rawURL)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	switch typed := payload.(type) {
	case *detailAnimeResponse:
		typed.Success = true
	case *detailDonghuaResponse:
		typed.Success = true
	default:
		httpx.Error(w, http.StatusBadGateway, "unsupported detail payload")
		return
	}
	httpx.OK(w, payload)
}

func (c *client) handleSeries(w http.ResponseWriter, r *http.Request) {
	rawURL := httpx.QueryStr(r, "url", "")
	if rawURL == "" {
		httpx.Error(w, http.StatusBadRequest, "Parameter url wajib diisi.")
		return
	}
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.series(ctx, rawURL)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	switch typed := payload.(type) {
	case *seriesAnimeResponse:
		typed.Success = true
	case *seriesDonghuaResponse:
		typed.Success = true
	default:
		httpx.Error(w, http.StatusBadGateway, "unsupported series payload")
		return
	}
	httpx.OK(w, payload)
}

func (c *client) handleSchedule(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.schedule(ctx)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	payload.Success = true
	httpx.OK(w, payload)
}

func (c *client) handleSearch(w http.ResponseWriter, r *http.Request) {
	query := httpx.QueryStr(r, "q", "")
	if query == "" {
		httpx.Error(w, http.StatusBadRequest, "Parameter q wajib diisi.")
		return
	}
	page := httpx.QueryInt(r, "page", 1, 1, 1_000_000)
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.search(ctx, query, page)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	payload.Success = true
	httpx.OK(w, payload)
}

func (c *client) handleGenres(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.genres(ctx)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	payload.Success = true
	httpx.OK(w, payload)
}

func (c *client) handleList(w http.ResponseWriter, r *http.Request) {
	genre := httpx.QueryStr(r, "genre", "")
	page := httpx.QueryInt(r, "page", 1, 1, 1_000_000)
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.list(ctx, genre, page)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	payload.Success = true
	httpx.OK(w, payload)
}

func (c *client) handlePlayer(w http.ResponseWriter, r *http.Request) {
	post := httpx.QueryStr(r, "post", "")
	nume := httpx.QueryStr(r, "nume", "")
	playerType := httpx.QueryStr(r, "type", "schtml")
	slug := httpx.QueryStr(r, "slug", "")
	if post == "" || nume == "" {
		httpx.Error(w, http.StatusBadRequest, "Parameter post dan nume wajib diisi")
		return
	}
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.player(ctx, post, nume, playerType, slug)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	payload.Success = true
	httpx.OK(w, payload)
}

// detail routes the request to the source matching the URL host.
func (c *client) detail(ctx context.Context, rawURL string) (any, error) {
	if isAnimeURL(rawURL) {
		if animeIsSeriesURL(rawURL) {
			return nil, errors.New("URL seri anime harus dipanggil lewat /api/purtv/series")
		}
		return c.animeDetail(ctx, animeSlug(rawURL))
	}
	return c.donghuaDetail(ctx, rawURL)
}

// series routes the request to the source matching the URL host.
func (c *client) series(ctx context.Context, rawURL string) (any, error) {
	if isAnimeURL(rawURL) {
		return c.animeSeries(ctx, animeSlug(rawURL))
	}
	return c.donghuaSeries(ctx, rawURL)
}
