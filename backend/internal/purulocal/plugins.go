package purulocal

import (
	"bufio"
	"bytes"
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
	Category    string `json:"category,omitempty"`
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
			Category:    "AI",
			Description: "Tanya AI (chat/completions na-api)",
			ExecURL:     exec,
			Server:      base,
			Version:     "1.1.0",
			Enabled:     true,
		},
		{
			ID:          "music-play",
			Name:        "Play Music",
			Command:     "play",
			Category:    "Music",
			Description: "Cari & putar musik dari SoundCloud (.play <judul>)",
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
	case "play", "music-play":
		reply, err := runPlay(r, args)
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
	base := strings.TrimRight(baseURL(r), "/")
	// jika diakses lokal, fallback ke backend publik Koyeb
	if strings.Contains(base, "127.0.0.1") || strings.Contains(base, "localhost") {
		base = "https://na-api-nue-api-e7bfd3f4.koyeb.app"
	}
	endpoint := base + "/api/chat/completions"
	payload := map[string]any{
		"model": "auto",
		"messages": []map[string]any{
			{"role": "user", "content": prompt},
		},
		"stream": true,
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 60 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "🤖 Gagal menghubungi AI: " + err.Error(), nil
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		rb, _ := io.ReadAll(io.LimitReader(res.Body, 2000))
		return "🤖 AI error: " + strings.TrimSpace(string(rb)), nil
	}
	// baca SSE stream dan gabungkan delta.content
	var out strings.Builder
	sc := bufio.NewScanner(res.Body)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			if data == "[DONE]" {
				break
			}
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) > 0 {
			c := chunk.Choices[0].Delta.Content
			if c != "" {
				out.WriteString(c)
			}
		}
	}
	txt := strings.TrimSpace(out.String())
	if txt == "" {
		return "🤖 (AI tidak mengembalikan jawaban)", nil
	}
	if len(txt) > 3500 {
		txt = txt[:3500] + "…"
	}
	return "🤖 " + txt, nil
}

func runPlay(r *http.Request, query string) (string, error) {
	if strings.TrimSpace(query) == "" {
		return "Gunakan: .play <judul lagu>", nil
	}
	base := strings.TrimRight(baseURL(r), "/")
	if strings.Contains(base, "127.0.0.1") || strings.Contains(base, "localhost") {
		base = "https://na-api-nue-api-e7bfd3f4.koyeb.app"
	}
	endpoint := base + "/api/play/soundcloud?q=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "Gagal mencari musik: " + err.Error(), nil
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 400 {
		return "Gagal mencari musik: " + strings.TrimSpace(string(rb)), nil
	}
	var j struct {
		Success bool `json:"success"`
		Query   string `json:"query"`
		Track   struct {
			Title        string `json:"title"`
			Author       string `json:"author"`
			DurationMs   int64  `json:"duration_ms"`
			PermalinkURL string `json:"permalink_url"`
			StreamURL    string `json:"stream_url"`
		} `json:"track"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rb, &j); err != nil {
		return "Hasil musik tidak dapat dibaca.", nil
	}
	if !j.Success || j.Track.Title == "" {
		if j.Error != "" {
			return "Gagal: " + j.Error, nil
		}
		return "Lagu tidak ditemukan.", nil
	}
	dur := ""
	if j.Track.DurationMs > 0 {
		sec := j.Track.DurationMs / 1000
		dur = fmt.Sprintf(" (%d:%02d)", sec/60, sec%60)
	}
	lines := []string{
		"🎵 " + j.Track.Title + dur,
	}
	if j.Track.Author != "" {
		lines = append(lines, "👤 "+j.Track.Author)
	}
	if j.Track.PermalinkURL != "" {
		lines = append(lines, "🔗 "+j.Track.PermalinkURL)
	}
	if j.Track.StreamURL != "" {
		lines = append(lines, "▶️ "+j.Track.StreamURL)
	}
	return strings.Join(lines, "\n"), nil
}