package purulocal

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

type handlers struct {
	deps *app.Deps
}

type pluginDef struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Command     string `json:"command"`
	Description string `json:"description"`
	ExecURL     string `json:"exec_url"`
	Server      string `json:"server"`
	Version     string `json:"version"`
	Enabled     bool   `json:"enabled"`
}

func baseURL(r *http.Request) string {
	scheme := "https"
	if r.TLS == nil {
		if xf := r.Header.Get("X-Forwarded-Proto"); xf != "" {
			scheme = xf
		} else if r.Host == "localhost" || strings.HasPrefix(r.Host, "127.0.0.1") || strings.HasPrefix(r.Host, "0.0.0.0") {
			scheme = "http"
		}
	}
	return scheme + "://" + r.Host
}

func (h *handlers) listPlugins(w http.ResponseWriter, r *http.Request) {
	base := baseURL(r)
	// allow override for stable server url in clients
	if q := strings.TrimSpace(r.URL.Query().Get("base")); q != "" {
		base = strings.TrimRight(q, "/")
	}
	exec := base + "/api/purulocal/plugins/exec"
	plugins := []pluginDef{
		{
			ID:          "ai-chat",
			Name:        "AI Chat",
			Command:     "ai",
			Description: "Tanya AI (contoh plugin dari server na-api)",
			ExecURL:     exec,
			Server:      base,
			Version:     "1.0.0",
			Enabled:     true,
		},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "plugins": plugins})
}

func (h *handlers) execPlugin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Command   string `json:"command"`
		PluginID  string `json:"plugin_id"`
		Args      string `json:"args"`
		BotName   string `json:"bot_name"`
		OwnerName string `json:"owner_name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	cmd := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(body.Command, ".")))
	if cmd == "" {
		cmd = strings.ToLower(strings.TrimSpace(body.PluginID))
	}
	args := strings.TrimSpace(body.Args)

	w.Header().Set("Content-Type", "application/json")
	switch cmd {
	case "ai", "ai-chat":
		reply, err := runAI(r, args)
		if err != nil {
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "reply": reply})
	default:
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "plugin command tidak dikenali"})
	}
}

func runAI(r *http.Request, prompt string) (string, error) {
	if strings.TrimSpace(prompt) == "" {
		return "Gunakan: .ai <pertanyaan>", nil
	}
	// Demo plugin: panggil text AI publik ringan; fallback jika gagal.
	client := &http.Client{Timeout: 20 * time.Second}
	endpoint := "https://text.pollinations.ai/" + url.PathEscape(prompt)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "puruLocalBot-Plugin/1.0")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf("🤖 AI\n%s\n\n(Gagal menghubungi server AI: %v)", prompt, err), nil
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4000))
	txt := strings.TrimSpace(string(b))
	if res.StatusCode >= 400 || txt == "" {
		return fmt.Sprintf("🤖 AI\n%s\n\n(Server AI tidak tersedia, coba lagi nanti.)", prompt), nil
	}
	// rapikan sedikit
	if len(txt) > 3000 {
		txt = txt[:3000] + "…"
	}
	return "🤖 " + txt, nil
}