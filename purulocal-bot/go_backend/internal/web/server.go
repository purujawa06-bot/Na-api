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
	mux.HandleFunc("POST /api/pause", s.handlePause)
	mux.HandleFunc("POST /api/start", s.handleStart)
	mux.HandleFunc("GET /api/plugins", s.handlePlugins)
	mux.HandleFunc("GET /api/plugins/available", s.handlePluginsAvailable)
	mux.HandleFunc("POST /api/plugins/install", s.handlePluginInstall)
	mux.HandleFunc("POST /api/plugins/remove", s.handlePluginRemove)
	mux.HandleFunc("POST /api/plugins/toggle", s.handlePluginToggle)
	mux.HandleFunc("GET /api/customcmds", s.handleCustomCmds)
	mux.HandleFunc("POST /api/customcmds/add", s.handleCustomCmdAdd)
	mux.HandleFunc("POST /api/customcmds/remove", s.handleCustomCmdRemove)
	mux.HandleFunc("POST /api/customcmds/toggle", s.handleCustomCmdToggle)
	mux.HandleFunc("GET /api/features", s.handleFeatures)
	mux.HandleFunc("POST /api/features/toggle", s.handleFeatureToggle)
	mux.HandleFunc("GET /api/vipcodes", s.handleVIPCodes)
	mux.HandleFunc("POST /api/vipcodes/generate", s.handleVIPCodeGenerate)
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

func (s *Server) handlePause(w http.ResponseWriter, r *http.Request) {
	s.mgr.SetPaused(true)
	writeJSON(w, 200, map[string]any{"ok": true, "status": s.mgr.Status()})
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	s.mgr.SetPaused(false)
	// pastikan terkoneksi jika sudah pernah login
	_ = s.mgr.AutoReconnect(r.Context())
	writeJSON(w, 200, map[string]any{"ok": true, "status": s.mgr.Status()})
}

func (s *Server) handlePlugins(w http.ResponseWriter, r *http.Request) {
	if s.mgr.Plugins() == nil {
		writeJSON(w, 200, map[string]any{"ok": true, "plugins": []any{}})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "plugins": s.mgr.Plugins().ListInstalled()})
}

func (s *Server) handlePluginsAvailable(w http.ResponseWriter, r *http.Request) {
	server := r.URL.Query().Get("server")
	if server == "" {
		server = "https://na-api-nue-api-e7bfd3f4.koyeb.app"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	list, err := bot.FetchAvailable(ctx, server)
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "plugins": list, "server": server})
}

func (s *Server) handlePluginInstall(w http.ResponseWriter, r *http.Request) {
	var p bot.Plugin
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if s.mgr.Plugins() == nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "plugin store tidak tersedia"})
		return
	}
	if err := s.mgr.Plugins().Install(p); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "plugins": s.mgr.Plugins().ListInstalled()})
}

func (s *Server) handlePluginRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if s.mgr.Plugins() == nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "plugin store tidak tersedia"})
		return
	}
	if err := s.mgr.Plugins().Remove(body.ID); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "plugins": s.mgr.Plugins().ListInstalled()})
}

func (s *Server) handlePluginToggle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if s.mgr.Plugins() == nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "plugin store tidak tersedia"})
		return
	}
	if err := s.mgr.Plugins().SetEnabled(body.ID, body.Enabled); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "plugins": s.mgr.Plugins().ListInstalled()})
}

func (s *Server) handleCustomCmds(w http.ResponseWriter, r *http.Request) {
	if s.mgr.CustomCmds() == nil {
		writeJSON(w, 200, map[string]any{"ok": true, "commands": []any{}})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "commands": s.mgr.CustomCmds().List()})
}

func (s *Server) handleCustomCmdAdd(w http.ResponseWriter, r *http.Request) {
	var c bot.CustomCommand
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if s.mgr.CustomCmds() == nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "custom command store tidak tersedia"})
		return
	}
	added, err := s.mgr.CustomCmds().Add(c)
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "command": added, "commands": s.mgr.CustomCmds().List()})
}

func (s *Server) handleCustomCmdRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if s.mgr.CustomCmds() == nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "custom command store tidak tersedia"})
		return
	}
	if err := s.mgr.CustomCmds().Remove(body.ID); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "commands": s.mgr.CustomCmds().List()})
}

func (s *Server) handleCustomCmdToggle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if s.mgr.CustomCmds() == nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "custom command store tidak tersedia"})
		return
	}
	if err := s.mgr.CustomCmds().SetEnabled(body.ID, body.Enabled); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "commands": s.mgr.CustomCmds().List()})
}

func (s *Server) handleFeatures(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "features": s.mgr.ListAllFeatures()})
}

func (s *Server) handleFeatureToggle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID  string `json:"id"`
		VIP bool   `json:"vip"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if s.mgr.VIP() == nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "vip store tidak tersedia"})
		return
	}
	id := strings.TrimSpace(body.ID)
	if id == "" {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "id fitur wajib"})
		return
	}
	if err := s.mgr.VIP().SetFeatureVIP(id, body.VIP); err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "features": s.mgr.ListAllFeatures()})
}

func (s *Server) handleVIPCodes(w http.ResponseWriter, r *http.Request) {
	if s.mgr.VIP() == nil {
		writeJSON(w, 200, map[string]any{"ok": true, "codes": []any{}})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "codes": s.mgr.VIP().ListCodes()})
}

func (s *Server) handleVIPCodeGenerate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DurationSeconds int64 `json:"duration_seconds"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if s.mgr.VIP() == nil {
		writeJSON(w, 500, map[string]any{"ok": false, "error": "vip store tidak tersedia"})
		return
	}
	code, err := s.mgr.VIP().GenerateCode(body.DurationSeconds)
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "code": code, "codes": s.mgr.VIP().ListCodes()})
}