package purulocal

import (
	"net/http"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

func Register(mux *http.ServeMux, deps *app.Deps) {
	h := &handlers{deps: deps}
	mux.HandleFunc("GET /api/purulocal/plugins", h.listPlugins)
	mux.HandleFunc("POST /api/purulocal/plugins/exec", h.execPlugin)
	mux.HandleFunc("GET /api/purulocal/update-manifest", h.updateManifest)
}