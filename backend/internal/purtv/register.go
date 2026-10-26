package purtv

import (
	"net/http"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

// Register mounts the purtv endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	c := newClient(deps)
	mux.HandleFunc("GET /api/purtv/home", c.handleHome)
	mux.HandleFunc("GET /api/purtv/detail", c.handleDetail)
	mux.HandleFunc("GET /api/purtv/series", c.handleSeries)
	mux.HandleFunc("GET /api/purtv/schedule", c.handleSchedule)
	mux.HandleFunc("GET /api/purtv/search", c.handleSearch)
	mux.HandleFunc("GET /api/purtv/genres", c.handleGenres)
	mux.HandleFunc("GET /api/purtv/list", c.handleList)
	mux.HandleFunc("GET /api/purtv/player", c.handlePlayer)
}
