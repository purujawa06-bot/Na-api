// Package agenttools ports the agent-tools endpoints (skills.sh search and
// install, paginated web fetch), the chess/maia proxy, and the upstream
// diagnostics probe from the Next.js backend.
package agenttools

import (
	"net/http"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

// server groups the handlers so they can share the dependency container.
type server struct {
	deps *app.Deps
}

// Register mounts the agenttools endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	s := &server{deps: deps}

	mux.HandleFunc("GET /api/agent-tools/find-skills", s.handleFindSkills)
	mux.HandleFunc("GET /api/agent-tools/install-skills", s.handleInstallSkills)
	mux.HandleFunc("POST /api/agent-tools/install-skills", s.handleInstallSkills)
	mux.HandleFunc("GET /api/agent-tools/web-fetch", s.handleWebFetch)
	mux.HandleFunc("POST /api/agent-tools/web-fetch", s.handleWebFetch)
	mux.HandleFunc("GET /api/chess/maia", s.handleMaia)
	mux.HandleFunc("GET /api/_diag/upstream", s.handleUpstreamDiag)
}
