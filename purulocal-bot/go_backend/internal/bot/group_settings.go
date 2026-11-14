package bot

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type WelcomeCfg struct {
	Enabled bool   `json:"enabled"`
	Text    string `json:"text,omitempty"`
}

type GoodbyeCfg struct {
	Enabled bool   `json:"enabled"`
	Text    string `json:"text,omitempty"`
}

type GroupSetting struct {
	Antilink bool       `json:"antilink"`
	Welcome  WelcomeCfg `json:"welcome"`
	Goodbye  GoodbyeCfg `json:"goodbye"`
}

type GroupSettingsData struct {
	Groups map[string]GroupSetting `json:"groups"`
}

type GroupSettingsStore struct {
	path string
	mu   sync.RWMutex
	data GroupSettingsData
}

func NewGroupSettingsStore(path string) (*GroupSettingsStore, error) {
	s := &GroupSettingsStore{
		path: path,
		data: GroupSettingsData{Groups: map[string]GroupSetting{}},
	}
	if err := s.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func (s *GroupSettingsStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var d GroupSettingsData
	if err := json.Unmarshal(b, &d); err != nil {
		return err
	}
	if d.Groups == nil {
		d.Groups = map[string]GroupSetting{}
	}
	s.data = d
	return nil
}

func (s *GroupSettingsStore) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o600)
}

func normGroupKey(chat string) string {
	return strings.TrimSpace(chat)
}

func (s *GroupSettingsStore) Get(chat string) GroupSetting {
	s.mu.RLock()
	defer s.mu.RUnlock()
	chat = normGroupKey(chat)
	if chat == "" || s.data.Groups == nil {
		return GroupSetting{}
	}
	gs, ok := s.data.Groups[chat]
	if !ok {
		return GroupSetting{}
	}
	return gs
}

func (s *GroupSettingsStore) set(chat string, fn func(*GroupSetting)) error {
	chat = normGroupKey(chat)
	if chat == "" {
		return errors.New("id grup tidak valid")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Groups == nil {
		s.data.Groups = map[string]GroupSetting{}
	}
	gs := s.data.Groups[chat]
	fn(&gs)
	s.data.Groups[chat] = gs
	return s.saveLocked()
}

func (s *GroupSettingsStore) SetAntilink(chat string, on bool) (GroupSetting, error) {
	var out GroupSetting
	err := s.set(chat, func(gs *GroupSetting) {
		gs.Antilink = on
		out = *gs
	})
	return out, err
}

func (s *GroupSettingsStore) SetWelcomeEnabled(chat string, on bool) (GroupSetting, error) {
	var out GroupSetting
	err := s.set(chat, func(gs *GroupSetting) {
		gs.Welcome.Enabled = on
		out = *gs
	})
	return out, err
}

func (s *GroupSettingsStore) SetWelcomeText(chat string, text string) (GroupSetting, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return GroupSetting{}, errors.New("teks welcome tidak boleh kosong")
	}
	var out GroupSetting
	err := s.set(chat, func(gs *GroupSetting) {
		gs.Welcome.Text = text
		out = *gs
	})
	return out, err
}

func (s *GroupSettingsStore) SetGoodbyeEnabled(chat string, on bool) (GroupSetting, error) {
	var out GroupSetting
	err := s.set(chat, func(gs *GroupSetting) {
		gs.Goodbye.Enabled = on
		out = *gs
	})
	return out, err
}

func (s *GroupSettingsStore) SetGoodbyeText(chat string, text string) (GroupSetting, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return GroupSetting{}, errors.New("teks goodbye tidak boleh kosong")
	}
	var out GroupSetting
	err := s.set(chat, func(gs *GroupSetting) {
		gs.Goodbye.Text = text
		out = *gs
	})
	return out, err
}
