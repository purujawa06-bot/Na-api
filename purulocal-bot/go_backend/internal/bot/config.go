package bot

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Config menyimpan konfigurasi dasar bot puruLocal.
type Config struct {
	BotName           string `json:"bot_name"`
	OwnerName         string `json:"owner_name"`
	OwnerNumber       string `json:"owner_number"` // internasional tanpa +
	BotNumber         string `json:"bot_number"`   // boleh sama dengan owner
	BlockSelfChat     bool   `json:"block_self_chat"`
	UpdateManifestURL string `json:"update_manifest_url,omitempty"`
	// Pengaturan setelah login
	ReadChat          bool    `json:"read_chat"`            // bot read chat (mark read)
	TypingBeforeReply bool    `json:"typing_before_reply"`  // bot status mengetik sebelum membalas command
	TypingDelaySec    float64 `json:"typing_delay_sec"`     // detik (default 1.5)
	AntiSpam          bool    `json:"anti_spam"`            // deteksi spam: pesan beruntun cepat -> ban sementara
	AISystemPrompt    string  `json:"ai_system_prompt,omitempty"` // system prompt untuk command .ai
	// Watermark/copyright sticker (.s/.sticker)
	StickerPack   string `json:"sticker_pack,omitempty"`
	StickerAuthor string `json:"sticker_author,omitempty"`
}

func DefaultConfig() Config {
	return Config{BotName: "puruLocal Bot", BlockSelfChat: true, ReadChat: false, TypingBeforeReply: true, TypingDelaySec: 1.5, AntiSpam: true}
}

func (c *Config) Normalize() {
	c.BotName = strings.TrimSpace(c.BotName)
	if c.BotName == "" {
		c.BotName = "puruLocal Bot"
	}
	c.OwnerName = strings.TrimSpace(c.OwnerName)
	c.OwnerNumber = normalizeNumber(c.OwnerNumber)
	c.BotNumber = normalizeNumber(c.BotNumber)
	if c.BotNumber == "" {
		c.BotNumber = c.OwnerNumber
	}
	if c.TypingDelaySec <= 0 {
		c.TypingDelaySec = 1.5
	}
	c.AISystemPrompt = strings.TrimSpace(c.AISystemPrompt)
	c.StickerPack = strings.TrimSpace(c.StickerPack)
	c.StickerAuthor = strings.TrimSpace(c.StickerAuthor)
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.OwnerName) == "" {
		return errors.New("owner_name wajib diisi")
	}
	if c.OwnerNumber == "" {
		return errors.New("owner_number wajib diisi")
	}
	if c.BotNumber == "" {
		return errors.New("bot_number wajib diisi")
	}
	return nil
}

func normalizeNumber(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	out = strings.TrimPrefix(out, "0") // best-effort; user should input intl format
	return out
}

type ConfigStore struct {
	path string
	mu   sync.RWMutex
	cfg  Config
}

func NewConfigStore(path string) (*ConfigStore, error) {
	s := &ConfigStore{path: path, cfg: DefaultConfig()}
	if err := s.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func (s *ConfigStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return err
	}
	cfg.Normalize()
	s.cfg = cfg
	return nil
}

func (s *ConfigStore) Get() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *ConfigStore) Save(cfg Config) error {
	cfg.Normalize()
	if err := cfg.Validate(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path, b, 0o600); err != nil {
		return err
	}
	s.cfg = cfg
	return nil
}