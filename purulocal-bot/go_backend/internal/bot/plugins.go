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

func (s *PluginStore) Handle(ctx context.Context, cmd, args string, cfg Config) (string, bool, error) {
	cmd = normalizeCmd(cmd)
	s.mu.RLock()
	var p *Plugin
	for i := range s.list {
		if s.list[i].Enabled && s.list[i].Command == cmd {
			cp := s.list[i]
			p = &cp
			break
		}
	}
	s.mu.RUnlock()
	if p == nil {
		return "", false, nil
	}
	reply, err := execPlugin(ctx, *p, args, cfg)
	return reply, true, err
}

func execPlugin(ctx context.Context, p Plugin, args string, cfg Config) (string, error) {
	body := map[string]any{
		"command":    p.Command,
		"args":       args,
		"bot_name":   cfg.BotName,
		"owner_name": cfg.OwnerName,
		"owner_number": cfg.OwnerNumber,
		"plugin_id":  p.ID,
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.ExecURL, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	ct := res.Header.Get("Content-Type")
	if strings.Contains(ct, "application/json") {
		var j map[string]any
		if err := json.Unmarshal(rb, &j); err == nil {
			if v, ok := j["reply"].(string); ok && v != "" {
				return v, nil
			}
			if v, ok := j["result"].(string); ok && v != "" {
				return v, nil
			}
			if v, ok := j["message"].(string); ok && v != "" {
				return v, nil
			}
			if errStr, ok := j["error"].(string); ok && errStr != "" {
				return "", fmt.Errorf("%s", errStr)
			}
		}
	}
	txt := strings.TrimSpace(string(rb))
	if res.StatusCode >= 400 {
		if txt == "" {
			txt = res.Status
		}
		return "", fmt.Errorf("%s", txt)
	}
	return txt, nil
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