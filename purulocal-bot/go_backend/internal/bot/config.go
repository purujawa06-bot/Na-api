package bot

import (
	"crypto/rand"
	"encoding/hex"
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
	LoadingReact      bool    `json:"loading_react"`        // react emoji saat memproses command
	AISystemPrompt    string  `json:"ai_system_prompt,omitempty"` // system prompt untuk command .ai
	// Watermark/copyright sticker (.s/.sticker)
	StickerPack   string `json:"sticker_pack,omitempty"`
	StickerAuthor string `json:"sticker_author,omitempty"`
	// Network
	Port FlexString `json:"port,omitempty"` // port atau alamat bind UI/API, mis. "5333" atau "0.0.0.0:5333"
	// Cloud-first sync (direct Firebase RTDB)
	RTDBURL    string `json:"rtdb_url,omitempty"`    // Firebase RTDB URL
	DeviceCode string `json:"device_code,omitempty"` // kode unik device (immutable, auto-generate)
}

// FlexString menerima string atau angka saat unmarshal JSON.
type FlexString string

func (s *FlexString) UnmarshalJSON(b []byte) error {
	if len(b) == 0 || string(b) == "null" {
		*s = ""
		return nil
	}
	var str string
	if err := json.Unmarshal(b, &str); err == nil {
		*s = FlexString(str)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err == nil {
		*s = FlexString(n.String())
		return nil
	}
	var v interface{}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*s = FlexString(strings.TrimSpace(strings.Trim(strings.ReplaceAll(fmtAny(v), "\n", ""), "\"")))
	return nil
}

func fmtAny(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		// hindari notasi ilmiah untuk port
		if x == float64(int64(x)) {
			return strconvFormatInt(int64(x))
		}
		return jsonNumberString(x)
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

func strconvFormatInt(n int64) string { return fmtInt(n) }
func fmtInt(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func jsonNumberString(f float64) string {
	b, _ := json.Marshal(f)
	return string(b)
}

func DefaultConfig() Config {
	return Config{BotName: "puruLocal Bot", BlockSelfChat: true, ReadChat: false, TypingBeforeReply: true, TypingDelaySec: 1.5, AntiSpam: true, LoadingReact: false}
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
	c.Port = FlexString(strings.TrimSpace(string(c.Port)))
	c.RTDBURL = strings.TrimRight(strings.TrimSpace(c.RTDBURL), "/")
	c.DeviceCode = strings.TrimSpace(c.DeviceCode)
}

func (c Config) CloudSyncReady() bool {
	return strings.TrimSpace(c.RTDBURL) != "" && strings.TrimSpace(c.DeviceCode) != ""
}

// ListenAddr mengembalikan alamat bind dari field Port.
// - kosong => ""
// - "5333" (hanya port) => "0.0.0.0:5333"
// - "127.0.0.1:5333" (sudah host:port) => apa adanya
func (c Config) ListenAddr() string {
	p := strings.TrimSpace(string(c.Port))
	if p == "" {
		return ""
	}
	if strings.Contains(p, ":") {
		return p
	}
	// hanya angka/port
	return "0.0.0.0:" + p
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

func (s *ConfigStore) Path() string { return s.path }

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
	// device_code harus persisten & immutable: generate sekali saat RTDBURL ada
	if cfg.RTDBURL != "" && cfg.DeviceCode == "" {
		cfg.DeviceCode = generateDeviceCode()
		// simpan segera agar stabil
		_ = s.saveLocked(cfg)
	}
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
	// device_code immutable: pertahankan yang sudah ada
	if existing := strings.TrimSpace(s.cfg.DeviceCode); existing != "" {
		cfg.DeviceCode = existing
	}
	// generate sekali jika RTDBURL diset dan belum punya code
	if cfg.RTDBURL != "" && strings.TrimSpace(cfg.DeviceCode) == "" {
		cfg.DeviceCode = generateDeviceCode()
	}
	if err := s.saveLocked(cfg); err != nil {
		return err
	}
	s.cfg = cfg
	return nil
}

func (s *ConfigStore) saveLocked(cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o600)
}

//book_generateDeviceCode
func generateDeviceCode() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return hex.EncodeToString(buf)
	}
	// fallback (sangat jarang)
	return hex.EncodeToString([]byte(strings.ReplaceAll(fmtIntFallback(), "-", "")))
}

func fmtIntFallback() string {
	return "devfallback"
}

// EnsureDeviceCode memastikan device_code ada (persisten) bila RTDBURL terisi.
// Mengembalikan config terbaru; aman dipanggil berulang.
func (s *ConfigStore) EnsureDeviceCode() (Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg := s.cfg
	cfg.Normalize()
	if cfg.RTDBURL == "" || strings.TrimSpace(cfg.DeviceCode) != "" {
		s.cfg = cfg
		return cfg, nil
	}
	cfg.DeviceCode = generateDeviceCode()
	if err := s.saveLocked(cfg); err != nil {
		return cfg, err
	}
	s.cfg = cfg
	return cfg, nil
}