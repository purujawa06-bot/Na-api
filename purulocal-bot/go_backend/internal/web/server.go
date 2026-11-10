package web

import (
	"context"
	"embed"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"purulocal-bot/internal/bot"
)

//go:embed static/*
var staticFS embed.FS

type Server struct {
	addr string
	mgr  *bot.Manager
	srv  *http.Server
}

func NewServer(addr string, mgr *bot.Manager) *Server {
	mux := http.NewServeMux()
	s := &Server{addr: addr, mgr: mgr, srv: &http.Server{Addr: addr, Handler: mux}}

	mux.HandleFunc("GET /", s.handleIndex)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/config", s.handleGetConfig)
	mux.HandleFunc("POST /api/config", s.handleSaveConfig)
	mux.HandleFunc("POST /api/connect/qr", s.handleConnectQR)
	mux.HandleFunc("POST /api/connect/pair", s.handlePair)
	mux.HandleFunc("POST /api/disconnect", s.handleDisconnect)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	return s
}

func (s *Server) Start(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() { errCh <- s.srv.ListenAndServe() }()
	select {
	case <-ctx.Done():
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return s.srv.Shutdown(c)
	case err := <-errCh:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	}
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	b, err := staticFS.ReadFile("static/index.html")
	if err != nil {
		http.Error(w, "ui not found", 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(b)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "status": s.mgr.Status(), "config": s.mgr.Config()})
}

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "config": s.mgr.Config()})
}

func (s *Server) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	var cfg bot.Config
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if err := s.mgr.SaveConfig(cfg); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "config": s.mgr.Config()})
}

// handleConnectQR: stream QR codes via simple polling-less SSE-like JSON lines? easier: long poll returning first code.
// For simplicity: start QR and return the first code received within timeout.
func (s *Server) handleConnectQR(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	codes, err := s.mgr.ConnectQR(ctx)
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	select {
	case code, ok := <-codes:
		if !ok {
			writeJSON(w, 200, map[string]any{"ok": true, "event": "done"})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "event": "code", "qr": code})
	case <-ctx.Done():
		writeJSON(w, 408, map[string]any{"ok": false, "error": "timeout menunggu QR"})
	}
}

func (s *Server) handlePair(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Phone string `json:"phone"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	code, err := s.mgr.PairPhone(ctx, strings.TrimSpace(body.Phone))
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "pairing_code": code})
}

func (s *Server) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	s.mgr.Disconnect()
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.mgr.Logout(r.Context()); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}