// Command server runs the Na-api backend written in Go.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"

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

	app := fiber.New(fiber.Config{
		AppName: "na-api",
		// Uploads and JSON bodies share the same fasthttp limit; the default
		// 4 MiB is too small for the image tools.
		BodyLimit:    64 << 20,
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	})
	// One catch-all bridge keeps the existing net/http routing and middleware
	// while Fiber owns the connection handling.
	app.Use(fiberBridge{handler: withMiddleware(mux)}.Serve)

	addr := ":" + strconv.Itoa(cfg.Port)
	var shuttingDown atomic.Bool
	go func() {
		log.Printf("[startup] Na-api Go backend (fiber) listening on %s (backend url %s)", addr, cfg.BackendURL)
		if err := app.Listen(addr, fiber.ListenConfig{DisableStartupMessage: true}); err != nil && !shuttingDown.Load() {
			log.Fatalf("[fatal] server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shuttingDown.Store(true)
	if err := app.ShutdownWithTimeout(20 * time.Second); err != nil {
		log.Printf("[shutdown] forced close: %v", err)
	}
	log.Println("[shutdown] backend stopped")
}
