package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Plugin struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Command     string `json:"command"` // tanpa prefix, mis: "ai"
	Category    string `json:"category,omitempty"`
	Description string `json:"description,omitempty"`
	ExecURL     string `json:"exec_url"`         // endpoint eksekusi di server na-api
	Server      string `json:"server,omitempty"` // base server sumber plugin
	Version     string `json:"version,omitempty"`
	Enabled     bool   `json:"enabled"`
}

type PluginStore struct {
	path string
	mu   sync.RWMutex
	list []Plugin
}

func NewPluginStore(path string) (*PluginStore, error) {
	s := &PluginStore{path: path}
	if err := s.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func (s *PluginStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var list []Plugin
	if err := json.Unmarshal(b, &list); err != nil {
		return err
	}
	for i := range list {
		list[i].Command = normalizeCmd(list[i].Command)
	}
	s.list = list
	return nil
}

func (s *PluginStore) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o600)
}

func (s *PluginStore) ListInstalled() []Plugin {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Plugin, len(s.list))
	copy(out, s.list)
	return out
}

func pluginCmdMatches(p Plugin, cmd string) bool {
	pc := normalizeCmd(p.Command)
	cmd = normalizeCmd(cmd)
	if pc == cmd {
		return true
	}
	// alias: .tiktok -> plugin command .tt
	if pc == "tt" && cmd == "tiktok" {
		return true
	}
	return false
}

func (s *PluginStore) HasCommand(cmd string) bool {
	cmd = normalizeCmd(cmd)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := range s.list {
		if s.list[i].Enabled && pluginCmdMatches(s.list[i], cmd) {
			return true
		}
	}
	return false
}

func (s *PluginStore) Install(p Plugin) error {
	p.Command = normalizeCmd(p.Command)
	p.ID = strings.TrimSpace(p.ID)
	if p.ID == "" {
		p.ID = p.Command
	}
	if p.Command == "" {
		return errors.New("command plugin wajib")
	}
	if strings.TrimSpace(p.ExecURL) == "" {
		return errors.New("exec_url plugin wajib")
	}
	p.Enabled = true
	s.mu.Lock()
	defer s.mu.Unlock()
	replaced := false
	for i := range s.list {
		if s.list[i].ID == p.ID || s.list[i].Command == p.Command {
			s.list[i] = p
			replaced = true
			break
		}
	}
	if !replaced {
		s.list = append(s.list, p)
	}
	return s.saveLocked()
}

func (s *PluginStore) Remove(id string) error {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	n := make([]Plugin, 0, len(s.list))
	found := false
	for _, p := range s.list {
		if p.ID == id || p.Command == normalizeCmd(id) {
			found = true
			continue
		}
		n = append(n, p)
	}
	if !found {
		return errors.New("plugin tidak ditemukan")
	}
	s.list = n
	return s.saveLocked()
}

func (s *PluginStore) SetEnabled(id string, enabled bool) error {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.list {
		if s.list[i].ID == id || s.list[i].Command == normalizeCmd(id) {
			s.list[i].Enabled = enabled
			return s.saveLocked()
		}
	}
	return errors.New("plugin tidak ditemukan")
}

type ExecResult struct {
	Reply        string `json:"reply"`
	Notice       string `json:"notice,omitempty"`
	AudioURL     string `json:"audio_url,omitempty"`
	Title        string `json:"title,omitempty"`
	PermalinkURL string `json:"permalink_url,omitempty"`
	Mimetype     string `json:"mimetype,omitempty"`
	DurationSec  uint32 `json:"duration_sec,omitempty"`
	ContactName  string `json:"contact_name,omitempty"`
	ContactVCard string `json:"contact_vcard,omitempty"`
}

func (s *PluginStore) Handle(ctx context.Context, cmd, args, user string, cfg Config, messages []ChatMessage) (ExecResult, bool, error) {
	cmd = normalizeCmd(cmd)
	s.mu.RLock()
	var p *Plugin
	for i := range s.list {
		if s.list[i].Enabled && pluginCmdMatches(s.list[i], cmd) {
			cp := s.list[i]
			p = &cp
			break
		}
	}
	s.mu.RUnlock()
	if p == nil {
		return ExecResult{}, false, nil
	}
	// kirim command efektif agar server mengeksekusi handler yang tepat (alias)
	execCmd := cmd
	res, err := execPlugin(ctx, *p, args, user, cfg, messages, execCmd)
	return res, true, err
}

func execPlugin(ctx context.Context, p Plugin, args, user string, cfg Config, messages []ChatMessage, cmdOverride ...string) (ExecResult, error) {
	command := p.Command
	if len(cmdOverride) > 0 && strings.TrimSpace(cmdOverride[0]) != "" {
		command = cmdOverride[0]
	}
	body := map[string]any{
		"command":          command,
		"args":             args,
		"bot_name":         cfg.BotName,
		"owner_name":       cfg.OwnerName,
		"owner_number":     cfg.OwnerNumber,
		"plugin_id":        p.ID,
		"user":             user,
		"ai_system_prompt": strings.TrimSpace(cfg.AISystemPrompt),
	}
	if len(messages) > 0 {
		msgs := make([]map[string]any, 0, len(messages))
		for _, m := range messages {
			msgs = append(msgs, map[string]any{"role": m.Role, "content": m.Content})
		}
		body["messages"] = msgs
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.ExecURL, bytes.NewReader(b))
	if err != nil {
		return ExecResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	// .ai dengan riwayat bisa lebih lama
	timeout := 20 * time.Second
	if normalizeCmd(p.Command) == "ai" {
		timeout = 60 * time.Second
	}
	client := &http.Client{Timeout: timeout}
	res, err := client.Do(req)
	if err != nil {
		return ExecResult{}, err
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	ct := res.Header.Get("Content-Type")
	if strings.Contains(ct, "application/json") {
		var j map[string]any
		if err := json.Unmarshal(rb, &j); err == nil {
			if errStr, ok := j["error"].(string); ok && errStr != "" && j["ok"] == false {
				return ExecResult{}, fmt.Errorf("%s", errStr)
			}
			out := ExecResult{}
			if v, ok := j["reply"].(string); ok {
				out.Reply = v
			} else if v, ok := j["result"].(string); ok {
				out.Reply = v
			} else if v, ok := j["message"].(string); ok {
				out.Reply = v
			}
			if v, ok := j["notice"].(string); ok {
				out.Notice = v
			}
			if v, ok := j["audio_url"].(string); ok {
				out.AudioURL = v
			}
			if v, ok := j["title"].(string); ok {
				out.Title = v
			}
			if v, ok := j["permalink_url"].(string); ok {
				out.PermalinkURL = v
			}
			if v, ok := j["mimetype"].(string); ok {
				out.Mimetype = v
			}
			switch v := j["duration_sec"].(type) {
			case float64:
				if v > 0 {
					out.DurationSec = uint32(v)
				}
			case int:
				if v > 0 {
					out.DurationSec = uint32(v)
				}
			case int64:
				if v > 0 {
					out.DurationSec = uint32(v)
				}
			}
			if out.Reply != "" || out.AudioURL != "" || out.Notice != "" {
				return out, nil
			}
			if errStr, ok := j["error"].(string); ok && errStr != "" {
				return ExecResult{}, fmt.Errorf("%s", errStr)
			}
		}
	}
	txt := strings.TrimSpace(string(rb))
	if res.StatusCode >= 400 {
		if txt == "" {
			txt = res.Status
		}
		return ExecResult{}, fmt.Errorf("%s", txt)
	}
	return ExecResult{Reply: txt}, nil
}

// FetchAvailable mengambil daftar plugin yang tersedia dari server na-api.
func FetchAvailable(ctx context.Context, serverBase string) ([]Plugin, error) {
	serverBase = strings.TrimRight(strings.TrimSpace(serverBase), "/")
	if serverBase == "" {
		return nil, errors.New("server plugin kosong")
	}
	url := serverBase + "/api/purulocal/plugins"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("gagal fetch plugin: %s", strings.TrimSpace(string(rb)))
	}
	var out struct {
		Plugins []Plugin `json:"plugins"`
	}
	if err := json.Unmarshal(rb, &out); err != nil {
		// coba array langsung
		var arr []Plugin
		if err2 := json.Unmarshal(rb, &arr); err2 == nil {
			for i := range arr {
				if arr[i].Server == "" {
					arr[i].Server = serverBase
				}
			}
			return arr, nil
		}
		return nil, err
	}
	for i := range out.Plugins {
		if out.Plugins[i].Server == "" {
			out.Plugins[i].Server = serverBase
		}
	}
	return out.Plugins, nil
}

func normalizeCmd(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, ".")
	s = strings.TrimPrefix(s, "/")
	return s
}