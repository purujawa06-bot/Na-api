package bot

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type VIPCode struct {
	Code            string `json:"code"`
	DurationSeconds int64  `json:"duration_seconds"`
	CreatedAt       int64  `json:"created_at"`
	UsedBy          string `json:"used_by,omitempty"`
	UsedAt          int64  `json:"used_at,omitempty"`
}

type FeatureItem struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command,omitempty"`
	Type    string `json:"type"` // builtin, custom, plugin
	VIP     bool   `json:"vip"`
}

type vipData struct {
	FeatureVIP map[string]bool       `json:"feature_vip"`
	Codes      []VIPCode             `json:"codes"`
	Users      map[string]int64      `json:"users"` // userKey -> expiry unix seconds
}

type VIPStore struct {
	path string
	mu   sync.RWMutex
	data vipData
}

func NewVIPStore(path string) (*VIPStore, error) {
	s := &VIPStore{path: path, data: vipData{FeatureVIP: map[string]bool{}, Codes: []VIPCode{}, Users: map[string]int64{}}}
	if err := s.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if s.data.FeatureVIP == nil {
		s.data.FeatureVIP = map[string]bool{}
	}
	if s.data.Users == nil {
		s.data.Users = map[string]int64{}
	}
	return s, nil
}

func (s *VIPStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var d vipData
	if err := json.Unmarshal(b, &d); err != nil {
		return err
	}
	if d.FeatureVIP == nil {
		d.FeatureVIP = map[string]bool{}
	}
	if d.Users == nil {
		d.Users = map[string]int64{}
	}
	s.data = d
	return nil
}

func (s *VIPStore) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o600)
}

func (s *VIPStore) IsFeatureVIP(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.FeatureVIP[id]
}

func (s *VIPStore) SetFeatureVIP(id string, vip bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.FeatureVIP == nil {
		s.data.FeatureVIP = map[string]bool{}
	}
	if vip {
		s.data.FeatureVIP[id] = true
	} else {
		delete(s.data.FeatureVIP, id)
	}
	return s.saveLocked()
}

func (s *VIPStore) IsUserVIP(user string, now time.Time) (bool, int64) {
	user = strings.TrimSpace(user)
	s.mu.RLock()
	exp, ok := s.data.Users[user]
	s.mu.RUnlock()
	if !ok {
		return false, 0
	}
	if now.Unix() >= exp {
		return false, 0
	}
	return true, exp
}

func normalizeVIPCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	var b strings.Builder
	for _, r := range code {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func genVIPCode() (string, error) {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	out := make([]byte, 4)
	for i := 0; i < 4; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			return "", err
		}
		out[i] = chars[n.Int64()]
	}
	return string(out), nil
}

func (s *VIPStore) GenerateCode(durationSeconds int64) (VIPCode, error) {
	if durationSeconds <= 0 {
		return VIPCode{}, errors.New("durasi VIP harus lebih dari 0")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// generate unique 4-char code
	code := ""
	for tries := 0; tries < 20; tries++ {
		c, err := genVIPCode()
		if err != nil {
			return VIPCode{}, err
		}
		used := false
		for _, x := range s.data.Codes {
			if x.Code == c {
				used = true
				break
			}
		}
		if !used {
			code = c
			break
		}
	}
	if code == "" {
		return VIPCode{}, errors.New("gagal membuat kode unik, coba lagi")
	}
	vc := VIPCode{Code: code, DurationSeconds: durationSeconds, CreatedAt: time.Now().Unix()}
	s.data.Codes = append(s.data.Codes, vc)
	if err := s.saveLocked(); err != nil {
		return VIPCode{}, err
	}
	return vc, nil
}

func (s *VIPStore) ListCodes() []VIPCode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]VIPCode, len(s.data.Codes))
	copy(out, s.data.Codes)
	return out
}

func (s *VIPStore) RemoveCode(code string) error {
	code = normalizeVIPCode(code)
	if code == "" {
		return errors.New("kode wajib diisi")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	n := make([]VIPCode, 0, len(s.data.Codes))
	found := false
	for _, c := range s.data.Codes {
		if c.Code == code {
			found = true
			continue
		}
		n = append(n, c)
	}
	if !found {
		return errors.New("kode VIP tidak ditemukan")
	}
	s.data.Codes = n
	return s.saveLocked()
}

func (s *VIPStore) Redeem(user, code string, now time.Time) (expiry int64, err error) {
	user = strings.TrimSpace(user)
	code = normalizeVIPCode(code)
	if len(code) != 4 {
		return 0, errors.New("kode VIP harus 4 karakter")
	}
	if user == "" {
		return 0, errors.New("user tidak valid")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i := range s.data.Codes {
		if s.data.Codes[i].Code == code {
			idx = i
			break
		}
	}
	if idx < 0 {
		return 0, errors.New("kode VIP tidak ditemukan")
	}
	if strings.TrimSpace(s.data.Codes[idx].UsedBy) != "" {
		return 0, errors.New("kode VIP sudah digunakan")
	}
	start := now.Unix()
	if cur, ok := s.data.Users[user]; ok && cur > start {
		start = cur // extend dari sisa aktif
	}
	exp := start + s.data.Codes[idx].DurationSeconds
	if s.data.Users == nil {
		s.data.Users = map[string]int64{}
	}
	s.data.Users[user] = exp
	s.data.Codes[idx].UsedBy = user
	s.data.Codes[idx].UsedAt = now.Unix()
	if err := s.saveLocked(); err != nil {
		return 0, err
	}
	return exp, nil
}

func formatRemaining(sec int64) string {
	if sec <= 0 {
		return "0j 0h"
	}
	days := sec / 86400
	hours := (sec % 86400) / 3600
	mins := (sec % 3600) / 60
	if days > 0 {
		return fmt.Sprintf("%dh %dj", days, hours)
	}
	if hours > 0 {
		return fmt.Sprintf("%dj %dm", hours, mins)
	}
	return fmt.Sprintf("%dm", mins)
}