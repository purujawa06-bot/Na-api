package bot

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AIHistoryStore struct {
	path string
	mu   sync.RWMutex
	data map[string][]ChatMessage // userKey -> messages
}

func NewAIHistoryStore(path string) (*AIHistoryStore, error) {
	s := &AIHistoryStore{path: path, data: map[string][]ChatMessage{}}
	if err := s.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func (s *AIHistoryStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var d map[string][]ChatMessage
	if err := json.Unmarshal(b, &d); err != nil {
		return err
	}
	if d == nil {
		d = map[string][]ChatMessage{}
	}
	s.data = d
	return nil
}

func (s *AIHistoryStore) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o600)
}

func (s *AIHistoryStore) Get(user string) []ChatMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()
	msgs := s.data[user]
	out := make([]ChatMessage, len(msgs))
	copy(out, msgs)
	return out
}

func (s *AIHistoryStore) Set(user string, msgs []ChatMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data == nil {
		s.data = map[string][]ChatMessage{}
	}
	s.data[user] = msgs
	return s.saveLocked()
}

func estimateTokens(msgs []ChatMessage) int {
	totalChars := 0
	for _, m := range msgs {
		totalChars += len(m.Content) + len(m.Role) + 8
	}
	// estimasi kasar ~4 karakter per token
	t := totalChars / 4
	if t < 1 && totalChars > 0 {
		t = 1
	}
	return t
}

// CompactIfNeeded melakukan auto-compact jika estimasi token > threshold (default 6000).
// Strategi: pertahankan pesan-pesan terbaru, gabungkan pesan lama menjadi satu ringkasan singkat.
func CompactIfNeeded(msgs []ChatMessage, threshold int) []ChatMessage {
	if threshold <= 0 {
		threshold = 6000
	}
	if estimateTokens(msgs) <= threshold {
		return msgs
	}
	// target setelah compact: sisakan ruang (sekitar 70% threshold)
	target := (threshold * 70) / 100
	// selalu pertahankan minimal beberapa pesan terakhir
	keepRecent := 6
	if len(msgs) <= 2 {
		return msgs
	}
	if keepRecent > len(msgs)-1 {
		keepRecent = len(msgs) - 1
	}

	for estimateTokens(msgs) > target && len(msgs) > keepRecent+1 {
		// ringkas separuh awal (kecuali sudah berbentuk ringkasan) menjadi 1 pesan ringkasan
		cut := len(msgs) - keepRecent
		if cut < 2 {
			cut = 2
		}
		if cut > len(msgs)-1 {
			cut = len(msgs) - 1
		}
		old := msgs[:cut]
		recent := msgs[cut:]
		summary := buildSummary(old)
		msgs = append([]ChatMessage{{Role: "assistant", Content: summary}}, recent...)
		// jika masih kepanjangan, kurangi recent yang dipertahankan secara bertahap
		if estimateTokens(msgs) > target && keepRecent > 2 {
			keepRecent -= 2
		}
	}
	// hard trim jika masih di atas threshold
	for estimateTokens(msgs) > threshold && len(msgs) > 2 {
		msgs = msgs[1:]
	}
	return msgs
}

func buildSummary(msgs []ChatMessage) string {
	var b strings.Builder
	b.WriteString("[Ringkasan percakapan sebelumnya]\n")
	limit := 1800
	used := 0
	for _, m := range msgs {
		role := m.Role
		if role == "" {
			role = "user"
		}
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}
		// hindari menyertakan ringkasan lama secara berulang penuh
		if strings.HasPrefix(content, "[Ringkasan percakapan sebelumnya]") {
			content = strings.TrimPrefix(content, "[Ringkasan percakapan sebelumnya]")
			content = strings.TrimSpace(content)
		}
		if len(content) > 300 {
			content = content[:300] + "…"
		}
		line := "- " + role + ": " + content + "\n"
		if used+len(line) > limit {
			b.WriteString("- ... (dipadatkan)\n")
			break
		}
		b.WriteString(line)
		used += len(line)
	}
	return strings.TrimSpace(b.String())
}
