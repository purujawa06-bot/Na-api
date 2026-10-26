// Command server runs the Na-api backend written in Go.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/agenttools"
	"github.com/purujawa06-bot/na-api/backend/internal/ai"
	"github.com/purujawa06-bot/na-api/backend/internal/app"
	"github.com/purujawa06-bot/na-api/backend/internal/cache"
	"github.com/purujawa06-bot/na-api/backend/internal/config"
	"github.com/purujawa06-bot/na-api/backend/internal/content"
	"github.com/purujawa06-bot/na-api/backend/internal/db"
	"github.com/purujawa06-bot/na-api/backend/internal/deepseek"
	"github.com/purujawa06-bot/na-api/backend/internal/downloader"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/purtv"
	"github.com/purujawa06-bot/na-api/backend/internal/reader"
	"github.com/purujawa06-bot/na-api/backend/internal/settings"
	"github.com/purujawa06-bot/na-api/backend/internal/tools"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	store := db.Open(ctx, cfg.PGURL)
	cancel()
	if store.Err != nil {
		log.Printf("[startup] database disabled: %v", store.Err)
	}
	defer store.Close()

	deps := &app.Deps{
		Config:   cfg,
		DB:       store,
		Cache:    cache.New(300),
		Settings: settings.New(store),
	}

	mux := http.NewServeMux()
	ai.Register(mux, deps)
	agenttools.Register(mux, deps)
	content.Register(mux, deps)
	deepseek.Register(mux, deps)
	downloader.Register(mux, deps)
	purtv.Register(mux, deps)
	reader.Register(mux, deps)
	tools.Register(mux, deps)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"status":   "ok",
			"database": store.Available(),
		})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		httpx.Error(w, http.StatusNotFound, "Not Found")
	})

	server := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           withMiddleware(mux),
		ReadHeaderTimeout: 15 * time.Second,
		// Streaming endpoints (chat, NDJSON tools) outlive the default timeout.
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}

	go func() {
		log.Printf("[startup] Na-api Go backend listening on %s (backend url %s)", server.Addr, cfg.BackendURL)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[fatal] server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("[shutdown] forced close: %v", err)
	}
	log.Println("[shutdown] backend stopped")
}
