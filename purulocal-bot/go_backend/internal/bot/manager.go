package bot

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
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

func init() {
	// Android (CGO off) sering tidak punya /etc/resolv.conf -> fallback DNS publik
	if runtime.GOOS == "android" || os.Getenv("PURULOCAL_FORCE_DNS") != "" {
		net.DefaultResolver = &net.Resolver{
			PreferGo: true,
			Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
				d := net.Dialer{Timeout: 5 * time.Second}
				if c, err := d.DialContext(ctx, "udp", "8.8.8.8:53"); err == nil {
					return c, nil
				}
				return d.DialContext(ctx, "udp", "1.1.1.1:53")
			},
		}
	}
}

type Status struct {
	Connected bool   `json:"connected"`
	LoggedIn  bool   `json:"logged_in"`
	Paused    bool   `json:"paused"`
	HasSession bool  `json:"has_session"`
	JID       string `json:"jid,omitempty"`
	PushName  string `json:"push_name,omitempty"`
	LastError string `json:"last_error,omitempty"`
}

type Manager struct {
	cfgStore *ConfigStore
	dataDir  string

	mu       sync.RWMutex
	client   *whatsmeow.Client
	qrChan   <-chan whatsmeow.QRChannelItem
	status   Status
	paused   bool
	plugins  *PluginStore
}

func NewManager(configPath, dataDir string) (*Manager, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	cfgStore, err := NewConfigStore(configPath)
	if err != nil {
		return nil, err
	}
	pstore, err := NewPluginStore(filepath.Join(dataDir, "plugins.json"))
	if err != nil {
		return nil, err
	}
	return &Manager{cfgStore: cfgStore, dataDir: dataDir, plugins: pstore}, nil
}

func (m *Manager) Config() Config { return m.cfgStore.Get() }

func (m *Manager) SaveConfig(cfg Config) error { return m.cfgStore.Save(cfg) }

func (m *Manager) Status() Status {
	m.mu.RLock()
	client := m.client
	paused := m.paused
	base := m.status
	m.mu.RUnlock()

	s := base
	s.Paused = paused
	if client != nil {
		s.Connected = client.IsConnected()
		s.LoggedIn = client.IsLoggedIn()
		if client.Store != nil && client.Store.ID != nil {
			s.JID = client.Store.ID.String()
			s.PushName = client.Store.PushName
			s.HasSession = true
		}
	}
	if !s.HasSession {
		if _, err := os.Stat(filepath.Join(m.dataDir, "store.db")); err == nil {
			// cek apakah store menyimpan identitas perangkat (sudah pernah login)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if c, err := m.ensureClient(ctx); err == nil && c != nil && c.Store != nil && c.Store.ID != nil {
				s.HasSession = true
				s.LoggedIn = c.IsLoggedIn()
				s.Connected = c.IsConnected()
				s.JID = c.Store.ID.String()
				s.PushName = c.Store.PushName
			}
		}
	}
	return s
}

func (m *Manager) SetPaused(paused bool) {
	m.mu.Lock()
	m.paused = paused
	m.mu.Unlock()
}

func (m *Manager) IsPaused() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.paused
}

func (m *Manager) Plugins() *PluginStore { return m.plugins }

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
	if m.IsPaused() {
		return
	}
	cfg := m.Config()
	if cfg.BlockSelfChat && evt.Info.IsFromMe {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// read chat (tandai pesan dibaca) jika diaktifkan
	if cfg.ReadChat {
		m.markRead(ctx, evt)
	}

	text := extractText(evt)
	if text == "" {
		return
	}
	cmd, args := parseCommand(text)
	if cmd == "" {
		return
	}

	// typing status sebelum membalas command
	if cfg.TypingBeforeReply {
		m.sendTyping(ctx, evt.Info.Chat, true)
		delay := cfg.TypingDelaySec
		if delay <= 0 {
			delay = 1.5
		}
		time.Sleep(time.Duration(delay * float64(time.Second)))
	}

	reply, ok := m.resolveCommand(ctx, cmd, args, cfg)
	if cfg.TypingBeforeReply {
		m.sendTyping(ctx, evt.Info.Chat, false)
	}
	if !ok || reply == "" {
		return
	}
	_ = m.sendReply(ctx, evt, reply)
}

func (m *Manager) sendTyping(ctx context.Context, chat types.JID, composing bool) {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return
	}
	state := types.ChatPresencePaused
	if composing {
		state = types.ChatPresenceComposing
	}
	_ = c.SendChatPresence(ctx, chat, state, types.ChatPresenceMediaText)
}

func (m *Manager) markRead(ctx context.Context, evt *events.Message) {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return
	}
	ids := []types.MessageID{evt.Info.ID}
	sender := evt.Info.Sender
	if evt.Info.IsGroup {
		_ = c.MarkRead(ctx, ids, evt.Info.Timestamp, evt.Info.Chat, sender)
	} else {
		_ = c.MarkRead(ctx, ids, evt.Info.Timestamp, evt.Info.Chat, types.EmptyJID)
	}
}

func (m *Manager) sendReply(ctx context.Context, evt *events.Message, text string) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}

	// Reply ke pesan yang dituju ketika membalas: jika command adalah reply ke suatu pesan,
	// balas (quote) pesan target tersebut; jika tidak, quote pesan command.
	ctxInfo := buildReplyContext(evt)
	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text:        proto.String(text),
			ContextInfo: ctxInfo,
		},
	}
	_, err := c.SendMessage(ctx, evt.Info.Chat, msg)
	return err
}

func buildReplyContext(evt *events.Message) *waE2E.ContextInfo {
	// Cek apakah pesan masuk ini membalas/menquote pesan lain
	if ci := extractIncomingContextInfo(evt.Message); ci != nil {
		if ci.GetStanzaID() != "" || ci.QuotedMessage != nil {
			return &waE2E.ContextInfo{
				StanzaID:      proto.String(ci.GetStanzaID()),
				Participant:   proto.String(ci.GetParticipant()),
				QuotedMessage: ci.GetQuotedMessage(),
				RemoteJID:     proto.String(ci.GetRemoteJID()),
			}
		}
	}
	// default: quote pesan command itu sendiri
	participant := evt.Info.Sender.String()
	return &waE2E.ContextInfo{
		StanzaID:      proto.String(evt.Info.ID),
		Participant:   proto.String(participant),
		QuotedMessage: evt.Message,
	}
}

func extractIncomingContextInfo(msg *waE2E.Message) *waE2E.ContextInfo {
	if msg == nil {
		return nil
	}
	switch {
	case msg.GetExtendedTextMessage() != nil:
		return msg.GetExtendedTextMessage().GetContextInfo()
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage().GetContextInfo()
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage().GetContextInfo()
	case msg.GetDocumentMessage() != nil:
		return msg.GetDocumentMessage().GetContextInfo()
	case msg.GetAudioMessage() != nil:
		return msg.GetAudioMessage().GetContextInfo()
	case msg.GetStickerMessage() != nil:
		return msg.GetStickerMessage().GetContextInfo()
	case msg.GetButtonsResponseMessage() != nil:
		return msg.GetButtonsResponseMessage().GetContextInfo()
	case msg.GetListResponseMessage() != nil:
		return msg.GetListResponseMessage().GetContextInfo()
	case msg.GetTemplateButtonReplyMessage() != nil:
		return msg.GetTemplateButtonReplyMessage().GetContextInfo()
	case msg.GetInteractiveResponseMessage() != nil:
		return msg.GetInteractiveResponseMessage().GetContextInfo()
	}
	return nil
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

func parseCommand(text string) (cmd, args string) {
	t := strings.TrimSpace(text)
	if t == "" {
		return "", ""
	}
	// dukung prefix simbol umum (., /, !, #, dll) + tanpa prefix
	if len(t) > 0 {
		c := t[0]
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') {
			t = strings.TrimSpace(t[1:])
		}
	}
	if t == "" {
		return "", ""
	}
	parts := strings.Fields(t)
	cmd = strings.ToLower(parts[0])
	if len(parts) > 1 {
		args = strings.TrimSpace(t[len(parts[0]):])
	}
	return cmd, args
}

func (m *Manager) resolveCommand(ctx context.Context, cmd, args string, cfg Config) (string, bool) {
	switch cmd {
	case "ping":
		return "pong 🏓", true
	case "menu":
		return m.buildMenu(cfg), true
	case "owner":
		return fmt.Sprintf("Owner: %s\nNomor: %s", cfg.OwnerName, cfg.OwnerNumber), true
	}
	if m.plugins != nil {
		if reply, ok, err := m.plugins.Handle(ctx, cmd, args, cfg); err == nil && ok {
			return reply, true
		} else if err != nil {
			return "Plugin error: " + err.Error(), true
		}
	}
	return "", false
}

func (m *Manager) buildMenu(cfg Config) string {
	lines := []string{
		"╭─〔 " + cfg.BotName + " 〕",
		"│",
		"├─ ᴜᴍᴜᴍ",
		"│  • .ping",
		"│  • .menu",
		"│  • .owner",
	}

	// Kumpulkan plugin terpasang per kategori
	if m.plugins != nil {
		catMap := map[string][]string{}
		catOrder := []string{}
		for _, p := range m.plugins.ListInstalled() {
			if !p.Enabled || p.Command == "" {
				continue
			}
			cat := strings.TrimSpace(p.Category)
			if cat == "" {
				cat = "Plugin"
			}
			key := strings.ToUpper(cat)
			if _, ok := catMap[key]; !ok {
				catOrder = append(catOrder, key)
				catMap[key] = []string{}
			}
			catMap[key] = append(catMap[key], "│  • ."+p.Command)
		}
		for _, cat := range catOrder {
			lines = append(lines, "│", "├─ "+cat)
			lines = append(lines, catMap[cat]...)
		}
	}

	lines = append(lines, "│", "╰────────")
	return strings.Join(lines, "\n")
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
	var err error
	if c != nil {
		err = c.Logout(ctx)
		c.Disconnect()
	}
	// reset client agar status/sesi benar-benar bersih (kembali ke state login)
	m.mu.Lock()
	m.client = nil
	m.qrChan = nil
	m.paused = false
	m.status = Status{}
	m.mu.Unlock()
	return err
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