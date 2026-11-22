package rpg

import (
	"net/http"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

// Register mounts RPG endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	h := newHandler(deps)
	mux.HandleFunc("POST /api/rpg/register", h.register)
	mux.HandleFunc("GET /api/rpg/stats", h.stats)
	mux.HandleFunc("POST /api/rpg/mancing/start", h.mancingStart)
	mux.HandleFunc("POST /api/rpg/mancing/heartbeat", h.mancingHeartbeat)
	mux.HandleFunc("POST /api/rpg/mancing/claim", h.mancingClaim)
	mux.HandleFunc("GET /api/rpg/mancing", h.mancingPage)
	mux.HandleFunc("GET /api/rpg/mancing/state", h.mancingState)
	h.startCleanupWorker()
}
