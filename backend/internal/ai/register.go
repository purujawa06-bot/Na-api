package ai

import (
	"net/http"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

// handlers carries the shared dependencies needed by the AI endpoints.
type handlers struct {
	deps *app.Deps
}

// Register mounts the AI endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	h := &handlers{deps: deps}
	mux.HandleFunc("GET /api/models", h.listModels)
	mux.HandleFunc("GET /api/chat/completions", h.chatInfo)
	mux.HandleFunc("POST /api/chat/completions", h.chatCompletions)
	mux.HandleFunc("GET /api/search/web", h.searchWebGET)
	mux.HandleFunc("POST /api/search/web", h.searchWebPOST)
}
