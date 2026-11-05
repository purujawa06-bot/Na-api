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
	payload, err := c.homeWibu(ctx)
	if err != nil {
		writeUpstreamError(w, err)
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
		writeUpstreamError(w, err)
		return
	}
	switch typed := payload.(type) {
	case *detailAnimeResponse:
		typed.Success = true
	case *detailDonghuaResponse:
		typed.Success = true
	default:
		writeUpstreamError(w, errors.New("payload detail tidak dikenali"))
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
		writeUpstreamError(w, err)
		return
	}
	switch typed := payload.(type) {
	case *seriesAnimeResponse:
		typed.Success = true
	case *seriesDonghuaResponse:
		typed.Success = true
	default:
		writeUpstreamError(w, errors.New("payload series tidak dikenali"))
		return
	}
	httpx.OK(w, payload)
}

func (c *client) handleSchedule(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.scheduleWibu(ctx)
	if err != nil {
		writeUpstreamError(w, err)
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
	payload, err := c.searchWibu(ctx, query, page)
	if err != nil {
		writeUpstreamError(w, err)
		return
	}
	payload.Success = true
	httpx.OK(w, payload)
}

func (c *client) handleGenres(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := c.requestContext(r.Context())
	defer cancel()
	payload, err := c.genresWibu(ctx)
	if err != nil {
		writeUpstreamError(w, err)
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
	payload, err := c.listWibu(ctx, genre, page)
	if err != nil {
		writeUpstreamError(w, err)
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
		writeUpstreamError(w, err)
		return
	}
	payload.Success = true
	httpx.OK(w, payload)
}

// detail routes all requests to the wibutime source.
func (c *client) detail(ctx context.Context, rawURL string) (any, error) {
	return c.detailWibu(ctx, rawURL)
}

// series routes all requests to the wibutime source.
func (c *client) series(ctx context.Context, rawURL string) (any, error) {
	return c.seriesWibu(ctx, rawURL)
}

// writeUpstreamError reports a scraper failure as a JSON envelope. It uses
// httpx.UpstreamError so the body survives the Koyeb edge and stays readable
// by JSON clients.
func writeUpstreamError(w http.ResponseWriter, err error) {
	httpx.UpstreamError(w, upstreamMessage(err))
}

// upstreamMessage maps low-level scraper errors to actionable client text.
func upstreamMessage(err error) string {
	switch {
	case err == nil:
		return "Sumber upstream tidak tersedia."
	case errors.Is(err, context.DeadlineExceeded):
		return "Upstream tidak merespons sebelum batas waktu habis. Coba lagi."
	case errors.Is(err, context.Canceled):
		return "Permintaan dibatalkan sebelum upstream selesai."
	default:
		return err.Error()
	}
}
