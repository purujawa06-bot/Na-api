// Package downloader ports the media downloader endpoints (Instagram, TikTok,
// YouTube, SoundCloud) and the SoundCloud search/play helpers from the Next.js
// backend. Every upstream flow mirrors lib/{instagram,ssstik,vidssave,
// soundcloud}.js so the JSON contracts stay identical for existing clients.
package downloader

import (
	"net/http"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

// handler holds the shared dependencies for all downloader routes.
type handler struct {
	deps       *app.Deps
	soundcloud soundcloudClient
}

// Register mounts the downloader endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	h := &handler{deps: deps}

	mux.HandleFunc("GET /api/downloader/instagram", h.instagramGET)
	mux.HandleFunc("POST /api/downloader/instagram", h.instagramPOST)
	mux.HandleFunc("GET /api/downloader/tiktok", h.tiktokGET)
	mux.HandleFunc("POST /api/downloader/tiktok", h.tiktokPOST)
	mux.HandleFunc("GET /api/downloader/youtube", h.youtubeGET)
	mux.HandleFunc("POST /api/downloader/youtube", h.youtubePOST)
	mux.HandleFunc("GET /api/downloader/soundcloud", h.soundcloudDownloadGET)
	mux.HandleFunc("POST /api/downloader/soundcloud", h.soundcloudDownloadPOST)
	mux.HandleFunc("GET /api/search/soundcloud", h.soundcloudSearchGET)
	mux.HandleFunc("POST /api/search/soundcloud", h.soundcloudSearchPOST)
	mux.HandleFunc("GET /api/play/soundcloud", h.soundcloudPlayGET)
}
