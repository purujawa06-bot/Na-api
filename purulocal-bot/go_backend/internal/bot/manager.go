package bot

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	_ "modernc.org/sqlite"
	"google.golang.org/protobuf/proto"
)

type Status struct {
	Connected bool   `json:"connected"`
	LoggedIn  bool   `json:"logged_in"`
	JID       string `json:"jid,omitempty"`
	PushName  string `json:"push_name,omitempty"`
	LastError string `json:"last_error,omitempty"`
}

type Manager struct {
	cfgStore *ConfigStore
	dataDir  string

	mu      sync.RWMutex
	client  *whatsmeow.Client
	qrChan  <-chan whatsmeow.QRChannelItem
	status  Status
}

func NewManager(configPath, dataDir string) (*Manager, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	cfgStore, err := NewConfigStore(configPath)
	if err != nil {
		return nil, err
	}
	return &Manager{cfgStore: cfgStore, dataDir: dataDir}, nil
}

func (m *Manager) Config() Config { return m.cfgStore.Get() }

func (m *Manager) SaveConfig(cfg Config) error { return m.cfgStore.Save(cfg) }

func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s := m.status
	if m.client != nil {
		s.Connected = m.client.IsConnected()
		s.LoggedIn = m.client.IsLoggedIn()
		if m.client.Store != nil && m.client.Store.ID != nil {
			s.JID = m.client.Store.ID.String()
			s.PushName = m.client.Store.PushName
		}
	}
	return s
}

func (m *Manager) ensureClient(ctx context.Context) (*whatsmeow.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client != nil {
		return m.client, nil
	}
	dbPath := filepath.Join(m.dataDir, "store.db")
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", filepath.ToSlash(dbPath))
	dbLog := waLog.Stdout("Database", "WARN", true)
	container, err := sqlstore.New(ctx, "sqlite", dsn, dbLog)
	if err != nil {
		return nil, err
	}
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, err
	}
	clientLog := waLog.Stdout("Client", "INFO", true)
	client := whatsmeow.NewClient(deviceStore, clientLog)
	client.AddEventHandler(m.eventHandler)
	m.client = client
	return client, nil
}

func (m *Manager) eventHandler(evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		m.onMessage(v)
	case *events.Disconnected:
		m.mu.Lock()
		m.status.LastError = "disconnected"
		m.mu.Unlock()
	}
}

func (m *Manager) onMessage(evt *events.Message) {
	cfg := m.Config()
	if cfg.BlockSelfChat && evt.Info.IsFromMe {
		return // proteksi: bot tidak chat/merespon diri sendiri
	}
	text := extractText(evt)
	if text == "" {
		return
	}
	reply, ok := handleCommand(text, cfg)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = m.sendText(ctx, evt.Info.Chat, reply)
}

func (m *Manager) sendText(ctx context.Context, to types.JID, text string) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}
	_, err := c.SendMessage(ctx, to, &waE2E.Message{Conversation: proto.String(text)})
	return err
}

func extractText(evt *events.Message) string {
	msg := evt.Message
	if msg == nil {
		return ""
	}
	switch {
	case msg.GetConversation() != "":
		return msg.GetConversation()
	case msg.GetExtendedTextMessage() != nil:
		return msg.GetExtendedTextMessage().GetText()
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage().GetCaption()
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage().GetCaption()
	}
	return ""
}

func handleCommand(text string, cfg Config) (string, bool) {
	t := strings.TrimSpace(text)
	if t == "" {
		return "", false
	}
	// dukung prefix simbol umum (., /, !, #, dll) + tanpa prefix
	body := strings.ToLower(t)
	if len(body) > 0 {
		c := body[0]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') {
			body = strings.TrimSpace(body[1:])
		}
	}
	switch body {
	case "ping":
		return fmt.Sprintf("pong 🏓\n%s aktif", cfg.BotName), true
	case "menu":
		menu := fmt.Sprintf(
			"╭─〔 %s 〕\n"+
				"│ Owner : %s\n"+
				"│ Bot   : %s\n"+
				"├─〔 Menu 〕\n"+
				"│ • .ping / /ping - cek respon bot\n"+
				"│ • .menu - tampilkan menu\n"+
				"├─〔 Info 〕\n"+
				"│ • Prefix: semua simbol (., /, !, dll)\n"+
				"│ • Block self chat: %v\n"+
				"╰────────────",
			cfg.BotName, cfg.OwnerName, cfg.BotNumber, cfg.BlockSelfChat,
		)
		return menu, true
	default:
		return "", false
	}
}

// ConnectQR memulai login via QR. Mengembalikan channel kode QR (string).
func (m *Manager) ConnectQR(ctx context.Context) (<-chan string, error) {
	client, err := m.ensureClient(ctx)
	if err != nil {
		return nil, err
	}
	if client.IsLoggedIn() {
		return nil, errors.New("sudah login")
	}
	qrChan, _ := client.GetQRChannel(ctx)
	if err := client.Connect(); err != nil {
		return nil, err
	}
	out := make(chan string, 8)
	go func() {
		defer close(out)
		for item := range qrChan {
			switch item.Event {
			case "code":
				out <- item.Code
			case "success", "timeout":
				return
			}
		}
	}()
	m.mu.Lock()
	m.qrChan = qrChan
	m.mu.Unlock()
	return out, nil
}

// PairPhone meminta pairing code untuk nomor (format internasional tanpa +).
func (m *Manager) PairPhone(ctx context.Context, phone string) (string, error) {
	client, err := m.ensureClient(ctx)
	if err != nil {
		return "", err
	}
	if phone == "" {
		phone = m.Config().BotNumber
	}
	phone = normalizeNumber(phone)
	if phone == "" {
		return "", errors.New("nomor bot kosong")
	}
	if !client.IsConnected() {
		if err := client.Connect(); err != nil {
			return "", err
		}
		// beri waktu socket siap
		select {
		case <-time.After(1 * time.Second):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	code, err := client.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		return "", err
	}
	return code, nil
}

func (m *Manager) Disconnect() {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c != nil {
		c.Disconnect()
	}
}

func (m *Manager) Logout(ctx context.Context) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return nil
	}
	return c.Logout(ctx)
}

func (m *Manager) AutoReconnect(ctx context.Context) error {
	client, err := m.ensureClient(ctx)
	if err != nil {
		return err
	}
	if client.Store != nil && client.Store.ID != nil {
		// sudah pernah login, coba connect ulang (sesi lokal tersimpan di store.db)
		return client.Connect()
	}
	return nil
}

func (m *Manager) Close() error {
	m.Disconnect()
	return nil
}

// SelfJID helper (opsional) untuk cek nomor sendiri.
func (m *Manager) SelfJID() *types.JID {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.client != nil && m.client.Store != nil {
		return m.client.Store.ID
	}
	return nil
}