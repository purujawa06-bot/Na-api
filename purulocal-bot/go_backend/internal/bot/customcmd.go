package bot

import (
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

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type CustomCommand struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Command      string `json:"command"`
	Category     string `json:"category,omitempty"`
	Enabled      bool   `json:"enabled"`
	ResponseType string `json:"response_type"` // text, photo, video, music
	ResponseText string `json:"response_text,omitempty"`
	MediaURL     string `json:"media_url,omitempty"`
	Caption      string `json:"caption,omitempty"`
}

type CustomCommandStore struct {
	path string
	mu   sync.RWMutex
	list []CustomCommand
}

func NewCustomCommandStore(path string) (*CustomCommandStore, error) {
	s := &CustomCommandStore{path: path}
	if err := s.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func (s *CustomCommandStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var list []CustomCommand
	if err := json.Unmarshal(b, &list); err != nil {
		return err
	}
	for i := range list {
		list[i].Command = normalizeCmd(list[i].Command)
	}
	s.list = list
	return nil
}

func (s *CustomCommandStore) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o600)
}

func (s *CustomCommandStore) List() []CustomCommand {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]CustomCommand, len(s.list))
	copy(out, s.list)
	return out
}

func (s *CustomCommandStore) Add(c CustomCommand) (CustomCommand, error) {
	c.Command = normalizeCmd(c.Command)
	c.Name = strings.TrimSpace(c.Name)
	c.Category = strings.TrimSpace(c.Category)
	c.ResponseType = strings.ToLower(strings.TrimSpace(c.ResponseType))
	c.ResponseText = strings.TrimSpace(c.ResponseText)
	c.MediaURL = strings.TrimSpace(c.MediaURL)
	c.Caption = strings.TrimSpace(c.Caption)
	if c.Command == "" {
		return CustomCommand{}, errors.New("command wajib diisi")
	}
	if c.Name == "" {
		c.Name = c.Command
	}
	switch c.ResponseType {
	case "text":
		if c.ResponseText == "" {
			return CustomCommand{}, errors.New("respon teks wajib diisi")
		}
	case "photo", "video", "music":
		if c.MediaURL == "" {
			return CustomCommand{}, errors.New("URL media wajib diisi")
		}
	default:
		return CustomCommand{}, errors.New("tipe respon tidak valid")
	}
	c.ID = "cc_" + c.Command + "_" + fmt.Sprintf("%d", time.Now().UnixNano())
	c.Enabled = true
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, x := range s.list {
		if normalizeCmd(x.Command) == c.Command {
			return CustomCommand{}, errors.New("command sudah ada")
		}
	}
	s.list = append(s.list, c)
	if err := s.saveLocked(); err != nil {
		return CustomCommand{}, err
	}
	return c, nil
}

func (s *CustomCommandStore) Remove(id string) error {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	n := make([]CustomCommand, 0, len(s.list))
	found := false
	for _, c := range s.list {
		if c.ID == id || normalizeCmd(c.Command) == normalizeCmd(id) {
			found = true
			continue
		}
		n = append(n, c)
	}
	if !found {
		return errors.New("custom command tidak ditemukan")
	}
	s.list = n
	return s.saveLocked()
}

func (s *CustomCommandStore) SetEnabled(id string, enabled bool) error {
	id = strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.list {
		if s.list[i].ID == id || normalizeCmd(s.list[i].Command) == normalizeCmd(id) {
			s.list[i].Enabled = enabled
			return s.saveLocked()
		}
	}
	return errors.New("custom command tidak ditemukan")
}

func (s *CustomCommandStore) Find(cmd string) (CustomCommand, bool) {
	cmd = normalizeCmd(cmd)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, c := range s.list {
		if c.Enabled && normalizeCmd(c.Command) == cmd {
			return c, true
		}
	}
	return CustomCommand{}, false
}

func (m *Manager) sendImageFromURL(ctx context.Context, evt *events.Message, url, caption string) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	hc := &http.Client{Timeout: 90 * time.Second}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("download image: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 25<<20))
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return errors.New("gambar kosong")
	}
	uploaded, err := c.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		return err
	}
	mime := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if i := strings.Index(mime, ";"); i >= 0 {
		mime = strings.TrimSpace(mime[:i])
	}
	if !strings.HasPrefix(mime, "image/") {
		mime = "image/jpeg"
	}
	img := &waE2E.ImageMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mime),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		Caption:       proto.String(strings.TrimSpace(caption)),
		ContextInfo:   buildReplyContext(evt),
	}
	_, err = c.SendMessage(ctx, evt.Info.Chat, &waE2E.Message{ImageMessage: img})
	return err
}

func (m *Manager) handleCustomCommand(ctx context.Context, evt *events.Message, cc CustomCommand) bool {
	switch strings.ToLower(cc.ResponseType) {
	case "text":
		_ = m.sendReply(ctx, evt, cc.ResponseText)
		return true
	case "photo":
		if err := m.sendImageFromURL(ctx, evt, cc.MediaURL, cc.Caption); err != nil {
			_ = m.sendReply(ctx, evt, "Gagal mengirim foto: "+err.Error())
		}
		return true
	case "video":
		res := ExecResult{VideoURL: cc.MediaURL, Caption: cc.Caption, Mimetype: "video/mp4"}
		if err := m.sendVideoFromURL(ctx, evt, res); err != nil {
			_ = m.sendReply(ctx, evt, "Gagal mengirim video: "+err.Error())
		}
		return true
	case "music":
		res := ExecResult{AudioURL: cc.MediaURL, Mimetype: "audio/mpeg"}
		if err := m.sendAudioFromURL(ctx, evt, res); err != nil {
			_ = m.sendReply(ctx, evt, "Gagal mengirim audio: "+err.Error())
		}
		return true
	}
	return false
}
