package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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

type jjStoredPhoto struct {
	Name string
	Mime string
	Data []byte
}

type Manager struct {
	cfgStore *ConfigStore
	dataDir  string

	mu         sync.RWMutex
	client     *whatsmeow.Client
	qrChan     <-chan whatsmeow.QRChannelItem
	status     Status
	paused     bool
	plugins    *PluginStore
	aiHist     *AIHistoryStore
	customCmds *CustomCommandStore
	vip        *VIPStore
	logger     *Logger
	group      *GroupSettingsStore

	spamMu      sync.Mutex
	lastMsgAt   map[string]time.Time
	bannedUntil map[string]time.Time

	jjMu       sync.Mutex
	jjUploads  map[string][]jjStoredPhoto // key: chat|sender
	jjSelected map[string][]int           // 1-based indices terpilih
	jjExpiry   map[string]time.Time
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
	ahist, err := NewAIHistoryStore(filepath.Join(dataDir, "ai_history.json"))
	if err != nil {
		return nil, err
	}
	ccstore, err := NewCustomCommandStore(filepath.Join(dataDir, "custom_commands.json"))
	if err != nil {
		return nil, err
	}
	vstore, err := NewVIPStore(filepath.Join(dataDir, "vip.json"))
	if err != nil {
		return nil, err
	}
	gstore, err := NewGroupSettingsStore(filepath.Join(dataDir, "group_settings.json"))
	if err != nil {
		return nil, err
	}
	return &Manager{
		cfgStore:    cfgStore,
		dataDir:     dataDir,
		plugins:     pstore,
		aiHist:      ahist,
		customCmds:  ccstore,
		vip:         vstore,
		logger:      NewLogger(300),
		group:       gstore,
		lastMsgAt:   map[string]time.Time{},
		bannedUntil: map[string]time.Time{},
		jjUploads:   map[string][]jjStoredPhoto{},
		jjSelected:  map[string][]int{},
		jjExpiry:    map[string]time.Time{},
	}, nil
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

func (m *Manager) CustomCmds() *CustomCommandStore { return m.customCmds }

func (m *Manager) VIP() *VIPStore { return m.vip }

func (m *Manager) Logger() *Logger { return m.logger }

func (m *Manager) GroupSettings() *GroupSettingsStore { return m.group }

func (m *Manager) logError(source, msg string) {
	if m != nil && m.logger != nil {
		m.logger.Error(source, msg)
	}
}

func (m *Manager) logWarn(source, msg string) {
	if m != nil && m.logger != nil {
		m.logger.Warn(source, msg)
	}
}

func truncateLog(s string, max int) string {
	s = strings.Join(strings.Fields(strings.TrimSpace(s)), " ")
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "..."
}

func (m *Manager) isFeatureAllowed(featureID, user string) bool {
	if m.vip == nil || strings.TrimSpace(featureID) == "" {
		return true
	}
	if !m.vip.IsFeatureVIP(featureID) {
		return true
	}
	ok, _ := m.vip.IsUserVIP(user, time.Now())
	return ok
}

func (m *Manager) vipDeniedReply() ExecResult {
	return ExecResult{Reply: "*Fitur VIP*\nFitur ini khusus VIP.\nGunakan *.vip* <kode> untuk aktivasi."}
}

func (m *Manager) ListAllFeatures() []FeatureItem {
	items := []FeatureItem{}
	isVIP := func(id string) bool {
		if m.vip == nil {
			return false
		}
		return m.vip.IsFeatureVIP(id)
	}
	// built-ins
	builtins := []struct{ id, name, cmd string }{
		{"builtin:ping", "Ping", "ping"},
		{"builtin:menu", "Menu", "menu"},
		{"builtin:owner", "Owner", "owner"},
		{"builtin:sticker", "Sticker", "sticker"},
		{"builtin:vip", "VIP Redeem", "vip"},
		{"builtin:stats", "Stats", "stats"},
		{"builtin:logs", "Logs", "logs"},
		{"builtin:antilink", "Antilink", "antilink"},
		{"builtin:welcome", "Welcome", "welcome"},
		{"builtin:setwelcome", "Set Welcome", "setwelcome"},
		{"builtin:goodbye", "Goodbye", "goodbye"},
		{"builtin:setgoodbye", "Set Goodbye", "setgoodbye"},
		{"builtin:tagall", "Tagall", "tagall"},
		{"builtin:hidetag", "Hidetag", "hidetag"},
	}
	for _, b := range builtins {
		items = append(items, FeatureItem{ID: b.id, Name: b.name, Command: b.cmd, Type: "builtin", VIP: isVIP(b.id)})
	}
	if m.customCmds != nil {
		for _, c := range m.customCmds.List() {
			id := "custom:" + c.ID
			name := strings.TrimSpace(c.Name)
			if name == "" {
				name = c.Command
			}
			items = append(items, FeatureItem{ID: id, Name: name, Command: c.Command, Type: "custom", VIP: isVIP(id)})
		}
	}
	if m.plugins != nil {
		for _, p := range m.plugins.ListInstalled() {
			id := "plugin:" + p.ID
			name := strings.TrimSpace(p.Name)
			if name == "" {
				name = p.Command
			}
			items = append(items, FeatureItem{ID: id, Name: name, Command: p.Command, Type: "plugin", VIP: isVIP(id)})
		}
	}
	return items
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
		// proses command secara bersamaan (tidak mengantri) agar user berbeda bisa paralel
		go m.onMessage(v)
	case *events.GroupInfo:
		go m.onGroupInfo(v)
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
	// abaikan pesan usang (> 5 menit), mis. pesan yang masuk saat bot offline
	if !evt.Info.Timestamp.IsZero() && time.Since(evt.Info.Timestamp) > 5*time.Minute {
		return
	}

	// Anti-spam (opsional): pesan dari user yang sama dalam jeda sangat cepat -> ban 10 detik
	if cfg.AntiSpam {
		userKey := evt.Info.Sender.String()
		if userKey == "" {
			userKey = evt.Info.Chat.String()
		}
		action := m.checkAntiSpam(userKey, time.Now())
		if action == spamBanned {
			// masih dalam masa ban -> abaikan tanpa balasan
			return
		}
		if action == spamTriggered {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = m.sendReply(ctx, evt, "⚠️ Spam terdeteksi. Kamu dibanned sementara 10 detik.")
			return
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// read chat (tandai pesan dibaca) jika diaktifkan
	if cfg.ReadChat {
		m.markRead(ctx, evt)
	}

	text := extractText(evt)
	// simpan foto yang diupload ke galeri sementara JJ (tanpa react/command)
	if evt.Message != nil && evt.Message.GetImageMessage() != nil {
		m.jjCaptureUpload(ctx, evt)
	}
	if text == "" {
		return
	}
	// Antilink (grup): deteksi & tindak sebelum memproses command
	if evt.Info.IsGroup && m.enforceAntilink(evt, text) {
		return
	}
	cmd, args := parseCommand(text)
	if cmd == "" {
		return
	}

	// react emoji saat memproses command (opsional) - dikirim hanya saat command dikenali
	reacted := false
	stopReact := func() {
		if !reacted {
			return
		}
		reacted = false
		time.Sleep(time.Duration(500+rand.IntN(501)) * time.Millisecond)
		rctx, rcancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer rcancel()
		m.sendReaction(rctx, evt, "")
	}
	maybeReact := func() {
		if !cfg.LoadingReact || reacted {
			return
		}
		m.sendReaction(ctx, evt, "⏳")
		reacted = true
	}

	// typing status sebelum membalas command (untuk command yang diproses)
	doTyping := func() {
		if cfg.TypingBeforeReply {
			m.sendTyping(ctx, evt.Info.Chat, true)
			delay := cfg.TypingDelaySec
			if delay <= 0 {
				delay = 1.5
			}
			time.Sleep(time.Duration(delay * float64(time.Second)))
		}
	}

	userKey := evt.Info.Sender.String()
	if userKey == "" {
		userKey = evt.Info.Chat.String()
	}

	// kumpulkan kandidat ID pengirim (termasuk resolusi LID<->PN) untuk owner/izin
	senderIDs := []string{userKey, evt.Info.Sender.String(), evt.Info.SenderAlt.String()}
	resolvedPN := ""
	resolvedLID := ""
	if c := m.client; c != nil && c.Store != nil {
		tryResolve := func(j types.JID) {
			if j.IsEmpty() {
				return
			}
			if alt, err := c.Store.GetAltJID(ctx, j); err == nil && !alt.IsEmpty() {
				s := alt.String()
				senderIDs = append(senderIDs, s)
				if alt.Server == types.DefaultUserServer || alt.Server == "s.whatsapp.net" {
					resolvedPN = s
				} else if alt.Server == types.HiddenUserServer || alt.Server == "lid" {
					resolvedLID = s
				}
			}
		}
		tryResolve(evt.Info.Sender)
		tryResolve(evt.Info.SenderAlt)
		if evt.Info.Sender.Server == types.DefaultUserServer {
			resolvedPN = evt.Info.Sender.String()
		}
		if evt.Info.SenderAlt.Server == types.DefaultUserServer && resolvedPN == "" {
			resolvedPN = evt.Info.SenderAlt.String()
		}
	}
	senderIDs = append(senderIDs, "pn:"+evt.Info.PushName, "resolved_pn:"+resolvedPN, "resolved_lid:"+resolvedLID)

	// built-in: sticker dari image (kirim/reply image dengan caption .s/.sticker)
	if cmd == "s" || cmd == "sticker" {
		maybeReact()
		doTyping()
		defer stopReact()
		if cfg.TypingBeforeReply {
			m.sendTyping(ctx, evt.Info.Chat, false)
		}
		if !m.isFeatureAllowed("builtin:sticker", userKey) {
			_ = m.sendReply(ctx, evt, m.vipDeniedReply().Reply)
			return
		}
		_ = m.handleStickerCommand(ctx, evt, cfg)
		return
	}

	// fitur JJ (lokal/plugin): pilih/hapus/reset/jj/jjgc
	if m.isJJCommand(cmd) {
		maybeReact()
		doTyping()
		defer stopReact()
		if cfg.TypingBeforeReply {
			m.sendTyping(ctx, evt.Info.Chat, false)
		}
		m.handleJJFeatureCommand(ctx, evt, cmd, args, cfg)
		return
	}

	// custom commands (lokal)
	if m.customCmds != nil {
		if cc, okc := m.customCmds.Find(cmd); okc {
			maybeReact()
			doTyping()
			defer stopReact()
			if cfg.TypingBeforeReply {
				m.sendTyping(ctx, evt.Info.Chat, false)
			}
			if !m.isFeatureAllowed("custom:"+cc.ID, userKey) {
				_ = m.sendReply(ctx, evt, m.vipDeniedReply().Reply)
				return
			}
			m.handleCustomCommand(ctx, evt, cc)
			return
		}
	}

	// group management commands (butuh konteks evt/chat)
	if isGroupMgmtCommand(cmd) {
		maybeReact()
		doTyping()
		defer stopReact()
		if cfg.TypingBeforeReply {
			m.sendTyping(ctx, evt.Info.Chat, false)
		}
		if res, ok := m.handleGroupMgmtCommand(ctx, evt, cmd, args, userKey, cfg, senderIDs...); ok {
			if strings.TrimSpace(res.Reply) != "" {
				_ = m.sendReply(ctx, evt, res.Reply)
			}
			return
		}
	}

	// resolve command (builtin/plugin) - react hanya jika dikenali
	// cek cepat apakah command mungkin dikenal sebelum react?
	res, ok := m.resolveCommand(ctx, cmd, args, userKey, cfg, senderIDs...)
	if !ok {
		return
	}
	maybeReact()
	doTyping()
	defer stopReact()
	if cfg.TypingBeforeReply {
		m.sendTyping(ctx, evt.Info.Chat, false)
	}
	// catat indikasi kegagalan dari hasil plugin/command untuk debug (mis. gagal download tiktok)
	if txt := strings.TrimSpace(res.Reply + " " + res.Caption); txt != "" && strings.Contains(strings.ToLower(txt), "gagal") {
		m.logWarn("command."+cmd, "reply mengindikasikan kegagalan: "+truncateLog(txt, 300))
	}
	// kirim video (mis. .tt/.tiktok): video siap putar + caption info (tanpa link)
	if strings.TrimSpace(res.VideoURL) != "" {
		if err := m.sendVideoFromURL(ctx, evt, res); err != nil {
			m.logError("send.video", "cmd="+cmd+" err="+err.Error())
			fb := strings.TrimSpace(res.Caption)
			if fb == "" {
				fb = strings.TrimSpace(res.Reply)
			}
			if fb == "" {
				fb = "Gagal mengirim video."
			} else {
				fb = fb + "\n\n(Gagal mengirim video)"
			}
			_ = m.sendReply(ctx, evt, fb)
		}
		return
	}
	// kirim audio (mis. .play): 1) info judul, jeda 1 detik, 2) audio
	if strings.TrimSpace(res.AudioURL) != "" {
		info := strings.TrimSpace(res.Reply)
		if info != "" {
			_ = m.sendReply(ctx, evt, info)
		}
		time.Sleep(1 * time.Second)
		if err := m.sendAudioFromURL(ctx, evt, res); err != nil {
			m.logError("send.audio", "cmd="+cmd+" err="+err.Error())
			// fallback teks jika gagal kirim audio
			fb := info
			if fb == "" {
				fb = "Gagal mengirim audio."
			} else {
				fb = fb + "\n\n(Gagal mengirim audio)"
			}
			_ = m.sendReply(ctx, evt, fb)
		}
		return
	}
	if strings.TrimSpace(res.ContactVCard) != "" {
		_ = m.sendContact(ctx, evt, res)
		return
	}
	replyText := strings.TrimSpace(res.Reply)
	if replyText == "" {
		replyText = strings.TrimSpace(res.Caption)
	}
	if replyText == "" {
		return
	}
	_ = m.sendReply(ctx, evt, replyText)
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

func (m *Manager) sendReaction(ctx context.Context, evt *events.Message, emoji string) {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil || evt == nil {
		return
	}
	msg := c.BuildReaction(evt.Info.Chat, evt.Info.Sender, evt.Info.ID, emoji)
	_, _ = c.SendMessage(ctx, evt.Info.Chat, msg)
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

func (m *Manager) sendContact(ctx context.Context, evt *events.Message, res ExecResult) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}
	msg := &waE2E.Message{
		ContactMessage: &waE2E.ContactMessage{
			DisplayName: proto.String(strings.TrimSpace(res.ContactName)),
			Vcard:       proto.String(res.ContactVCard),
			ContextInfo: buildReplyContext(evt),
		},
	}
	_, err := c.SendMessage(ctx, evt.Info.Chat, msg)
	return err
}

func buildOwnerVCard(name, number string) string {
	name = strings.TrimSpace(name)
	num := normalizeNumber(number)
	waid := num
	full := num
	if num != "" && !strings.HasPrefix(num, "+") {
		full = "+" + num
	}
	return strings.Join([]string{
		"BEGIN:VCARD",
		"VERSION:3.0",
		"FN:" + name,
		fmt.Sprintf("TEL;type=CELL;type=VOICE;waid=%s:%s", waid, full),
		"END:VCARD",
	}, "\n")
}

func isOwner(userKey, ownerNumber string) bool {
	return isOwnerAny(ownerNumber, userKey)
}

func isOwnerAny(ownerNumber string, userKeys ...string) bool {
	ownerDigits := ""
	for _, r := range ownerNumber {
		if r >= '0' && r <= '9' {
			ownerDigits += string(r)
		}
	}
	if ownerDigits == "" {
		return false
	}
	trim := func(s string) string {
		s = strings.TrimLeft(s, "0")
		s = strings.TrimPrefix(s, "62")
		s = strings.TrimLeft(s, "0")
		return s
	}
	oCore := trim(ownerDigits)
	for _, userKey := range userKeys {
		if strings.TrimSpace(userKey) == "" {
			continue
		}
		// ambil bagian user dari JID (sebelum @) dan buang suffix device (:n)
		uk := userKey
		if i := strings.Index(uk, "@"); i >= 0 {
			uk = uk[:i]
		}
		if i := strings.Index(uk, ":"); i >= 0 {
			uk = uk[:i]
		}
		userDigits := ""
		for _, r := range uk {
			if r >= '0' && r <= '9' {
				userDigits += string(r)
			}
		}
		if userDigits == "" {
			for _, r := range userKey {
				if r >= '0' && r <= '9' {
					userDigits += string(r)
				}
			}
		}
		if userDigits == "" {
			continue
		}
		uCore := trim(userDigits)
		if uCore != "" && oCore != "" && uCore == oCore {
			return true
		}
		// fallback: kecocokan langsung/suffix pada digit penuh
		if userDigits == ownerDigits || strings.HasSuffix(userDigits, ownerDigits) || strings.HasSuffix(ownerDigits, userDigits) {
			return true
		}
	}
	return false
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

func (m *Manager) sendAudioFromURL(ctx context.Context, evt *events.Message, res ExecResult) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, res.AudioURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
	hc := &http.Client{Timeout: 90 * time.Second}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("download audio: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 25<<20)) // batas ~25MB
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("audio kosong (HTTP %d)", resp.StatusCode)
	}
	uploaded, err := c.Upload(ctx, data, whatsmeow.MediaAudio)
	if err != nil {
		return err
	}
	mime := strings.TrimSpace(res.Mimetype)
	if mime == "" {
		mime = "audio/mpeg"
	}
	audio := &waE2E.AudioMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mime),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		PTT:           proto.Bool(false),
		ContextInfo:   buildReplyContext(evt),
	}
	if res.DurationSec > 0 {
		audio.Seconds = proto.Uint32(res.DurationSec)
	}
	_, err = c.SendMessage(ctx, evt.Info.Chat, &waE2E.Message{AudioMessage: audio})
	if err != nil {
		return err
	}
	return nil
}

func (m *Manager) sendVideoFromURL(ctx context.Context, evt *events.Message, res ExecResult) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, res.VideoURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
	// beberapa CDN TikTok/ssstik memerlukan referer/origin agar tidak mengembalikan body kosong
	if strings.Contains(res.VideoURL, "tiktok") || strings.Contains(res.VideoURL, "ssstik") || strings.Contains(res.VideoURL, "tikcdn") || strings.Contains(res.VideoURL, "ssscdn") {
		req.Header.Set("Referer", "https://www.tiktok.com/")
		req.Header.Set("Origin", "https://www.tiktok.com")
	}
	hc := &http.Client{Timeout: 120 * time.Second}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("download video: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 50<<20)) // batas ~50MB
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("video kosong (HTTP %d, ct=%s)", resp.StatusCode, strings.TrimSpace(resp.Header.Get("Content-Type")))
	}
	uploaded, err := c.Upload(ctx, data, whatsmeow.MediaVideo)
	if err != nil {
		return err
	}
	mime := strings.TrimSpace(res.Mimetype)
	if mime == "" {
		mime = "video/mp4"
	}
	caption := strings.TrimSpace(res.Caption)
	if caption == "" {
		caption = strings.TrimSpace(res.Reply)
	}
	video := &waE2E.VideoMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mime),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		Caption:       proto.String(caption),
		ContextInfo:   buildReplyContext(evt),
	}
	_, err = c.SendMessage(ctx, evt.Info.Chat, &waE2E.Message{VideoMessage: video})
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

func (m *Manager) resolveCommand(ctx context.Context, cmd, args, userKey string, cfg Config, senderIDs ...string) (ExecResult, bool) {
	switch cmd {
	case "ping":
		if !m.isFeatureAllowed("builtin:ping", userKey) {
			return m.vipDeniedReply(), true
		}
		return ExecResult{Reply: "pong"}, true
	case "menu":
		if !m.isFeatureAllowed("builtin:menu", userKey) {
			return m.vipDeniedReply(), true
		}
		return ExecResult{Reply: m.buildMenu(cfg)}, true
	case "owner":
		if !m.isFeatureAllowed("builtin:owner", userKey) {
			return m.vipDeniedReply(), true
		}
		return ExecResult{
			ContactName:  cfg.OwnerName,
			ContactVCard: buildOwnerVCard(cfg.OwnerName, cfg.OwnerNumber),
		}, true
	case "vip":
		if !m.isFeatureAllowed("builtin:vip", userKey) {
			return m.vipDeniedReply(), true
		}
		code := normalizeVIPCode(args)
		if len(code) != 4 {
			return ExecResult{Reply: "*VIP*\nGunakan: *.vip* <kode 4 karakter>"}, true
		}
		if m.vip == nil {
			return ExecResult{Reply: "*VIP*\nFitur VIP tidak tersedia."}, true
		}
		exp, err := m.vip.Redeem(userKey, code, time.Now())
		if err != nil {
			return ExecResult{Reply: "*Gagal Redeem VIP*\n" + err.Error()}, true
		}
		remain := exp - time.Now().Unix()
		return ExecResult{Reply: "*VIP Aktif*\n*Sisa:* " + formatRemaining(remain)}, true
	case "stats":
		if !m.isFeatureAllowed("builtin:stats", userKey) {
			return m.vipDeniedReply(), true
		}
		debugLines := []string{}
		pushName := ""
		senderID := ""
		senderAltID := ""
		resolvedPN := ""
		resolvedLID := ""
		for _, id := range senderIDs {
			switch {
			case strings.HasPrefix(id, "pn:"):
				if pushName == "" {
					pushName = strings.TrimPrefix(id, "pn:")
				}
			case strings.HasPrefix(id, "resolved_pn:"):
				if resolvedPN == "" {
					resolvedPN = strings.TrimPrefix(id, "resolved_pn:")
				}
			case strings.HasPrefix(id, "resolved_lid:"):
				if resolvedLID == "" {
					resolvedLID = strings.TrimPrefix(id, "resolved_lid:")
				}
			case senderID == "":
				senderID = id
			case senderAltID == "" && id != senderID:
				senderAltID = id
			}
		}
		debugLines = append(debugLines, "UserKey: "+userKey)
		if senderID != "" {
			debugLines = append(debugLines, "Sender: "+senderID)
		}
		if senderAltID != "" {
			debugLines = append(debugLines, "SenderAlt: "+senderAltID)
		}
		if resolvedPN != "" {
			debugLines = append(debugLines, "ResolvedPN: "+resolvedPN)
		}
		if resolvedLID != "" {
			debugLines = append(debugLines, "ResolvedLID: "+resolvedLID)
		}
		if strings.TrimSpace(pushName) != "" {
			debugLines = append(debugLines, "Username: "+strings.TrimSpace(pushName))
		}
		debugBlock := "\n\n*Debug*\n" + strings.Join(debugLines, "\n")
		if m.vip == nil {
			return ExecResult{Reply: "*Status:* Bukan VIP" + debugBlock}, true
		}
		ok, exp := m.vip.IsUserVIP(userKey, time.Now())
		if !ok {
			return ExecResult{Reply: "*Status:* Bukan VIP" + debugBlock}, true
		}
		remain := exp - time.Now().Unix()
		return ExecResult{Reply: "*Status:* VIP\n*Sisa:* " + formatRemaining(remain) + debugBlock}, true
	case "logs":
		ids := senderIDs
		if len(ids) == 0 {
			ids = []string{userKey}
		}
		if !isOwnerAny(cfg.OwnerNumber, ids...) {
			return ExecResult{Reply: "Perintah ini khusus owner."}, true
		}
		return ExecResult{Reply: m.formatLogsForOwner()}, true
	}
	if m.plugins != nil {
		if p, okp := m.plugins.Find(cmd); okp {
			if !m.isFeatureAllowed("plugin:"+p.ID, userKey) {
				return m.vipDeniedReply(), true
			}
		}
		// .ai: ingat percakapan masing-masing user + auto-compact di ambang 6k token
		// hanya jika plugin .ai terpasang & aktif; jika dihapus tidak boleh membalas
		if normalizeCmd(cmd) == "ai" && m.aiHist != nil && m.plugins.HasCommand("ai") {
			prompt := strings.TrimSpace(args)
			if prompt == "" {
				return ExecResult{Reply: "Gunakan: .ai <pertanyaan>"}, true
			}
			hist := m.aiHist.Get(userKey)
			hist = append(hist, ChatMessage{Role: "user", Content: prompt})
			hist = CompactIfNeeded(hist, 6000)
			res, ok, err := m.plugins.Handle(ctx, cmd, args, userKey, cfg, hist)
			if err != nil {
				m.logError("plugin."+cmd, err.Error())
				return ExecResult{Reply: "Plugin error: " + err.Error()}, true
			}
			if ok {
				if strings.TrimSpace(res.Reply) != "" {
					hist = append(hist, ChatMessage{Role: "assistant", Content: res.Reply})
					hist = CompactIfNeeded(hist, 6000)
					_ = m.aiHist.Set(userKey, hist)
				}
				return res, true
			}
		}
		if res, ok, err := m.plugins.Handle(ctx, cmd, args, userKey, cfg, nil); err == nil && ok {
			return res, true
		} else if err != nil {
			m.logError("plugin."+cmd, err.Error())
			return ExecResult{Reply: "Plugin error: " + err.Error()}, true
		}
	}
	return ExecResult{}, false
}

func (m *Manager) formatLogsForOwner() string {
	if m == nil || m.logger == nil {
		return "*Logs*\nLogger tidak tersedia."
	}
	entries := m.logger.List()
	if len(entries) == 0 {
		return "*Logs*\nBelum ada log. (Bisa lihat juga di halaman Logger)"
	}
	// ambil terbaru, batasi ukuran pesan
	start := 0
	if len(entries) > 40 {
		start = len(entries) - 40
	}
	lines := []string{"*Logs (terbaru)*"}
	for i := len(entries) - 1; i >= start; i-- {
		e := entries[i]
		lvl := strings.ToUpper(strings.TrimSpace(e.Level))
		if lvl == "" {
			lvl = "INFO"
		}
		line := fmt.Sprintf("[%s][%s][%s] %s", e.Time, lvl, e.Source, strings.TrimSpace(e.Message))
		lines = append(lines, line)
	}
	out := strings.Join(lines, "\n")
	// batasi agar aman di WA
	r := []rune(out)
	if len(r) > 3500 {
		out = string(r[:3500]) + "\n...(dipotong, lihat halaman Logger untuk lengkap)"
	}
	return out
}

func menuSmallCaps(s string) string {
	// konversi ke gaya teks submenu menu (small caps unicode) agar konsisten
	s = strings.ToUpper(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		switch r {
		case 'A':
			b.WriteRune('\u1d00')
		case 'B':
			b.WriteRune('\u0299')
		case 'C':
			b.WriteRune('\u1d04')
		case 'D':
			b.WriteRune('\u1d05')
		case 'E':
			b.WriteRune('\u1d07')
		case 'F':
			b.WriteRune('\ua730')
		case 'G':
			b.WriteRune('\u0262')
		case 'H':
			b.WriteRune('\u029c')
		case 'I':
			b.WriteRune('\u026a')
		case 'J':
			b.WriteRune('\u1d0a')
		case 'K':
			b.WriteRune('\u1d0b')
		case 'L':
			b.WriteRune('\u029f')
		case 'M':
			b.WriteRune('\u1d0d')
		case 'N':
			b.WriteRune('\u0274')
		case 'O':
			b.WriteRune('\u1d0f')
		case 'P':
			b.WriteRune('\u1d18')
		case 'Q':
			b.WriteRune('\u01eb')
		case 'R':
			b.WriteRune('\u0280')
		case 'S':
			b.WriteRune('\ua731')
		case 'T':
			b.WriteRune('\u1d1b')
		case 'U':
			b.WriteRune('\u1d1c')
		case 'V':
			b.WriteRune('\u1d20')
		case 'W':
			b.WriteRune('\u1d21')
		case 'X':
			b.WriteRune('x')
		case 'Y':
			b.WriteRune('\u028f')
		case 'Z':
			b.WriteRune('\u1d22')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (m *Manager) buildMenu(cfg Config) string {
	botName := strings.TrimSpace(cfg.BotName)
	if botName == "" {
		botName = "PuruBot"
	}
	var b strings.Builder
	b.WriteString("╭─〔 " + botName + " 〕\n")
	b.WriteString("│\n")
	b.WriteString("├─ ᴜᴍᴜᴍ\n")
	b.WriteString("│  • .ping\n")
	b.WriteString("│  • .menu\n")
	b.WriteString("│  • .owner\n")
	b.WriteString("│  • .vip\n")
	b.WriteString("│  • .stats\n")
	b.WriteString("│\n")
	b.WriteString("├─ ꜱᴛɪᴄᴋᴇʀ\n")
	b.WriteString("│  • .sticker\n")
	b.WriteString("│\n")
	b.WriteString("├─ ᴊᴊ\n")
	b.WriteString("│  • .jj\n")
	b.WriteString("│  • .jjgc\n")
	b.WriteString("│  • .pilih\n")
	b.WriteString("│  • .reset\n")
	b.WriteString("│\n")
	b.WriteString("├─ ᴏᴡɴᴇʀ\n")
	b.WriteString("│  • .logs\n")

	// Custom commands (aktif) per kategori
	if m.customCmds != nil {
		catMap := map[string][]string{}
		catLabel := map[string]string{}
		catOrder := []string{}
		for _, c := range m.customCmds.List() {
			if !c.Enabled || strings.TrimSpace(c.Command) == "" {
				continue
			}
			cmdName := strings.ToLower(strings.TrimSpace(c.Command))
			cat := strings.TrimSpace(c.Category)
			if cat == "" {
				cat = "Custom"
			}
			key := strings.ToUpper(cat)
			if _, ok := catMap[key]; !ok {
				catOrder = append(catOrder, key)
				catMap[key] = []string{}
				catLabel[key] = menuSmallCaps(cat)
			}
			catMap[key] = append(catMap[key], "│  • ."+cmdName)
		}
		for _, key := range catOrder {
			b.WriteString("│\n")
			b.WriteString("├─ " + catLabel[key] + "\n")
			for _, line := range catMap[key] {
				b.WriteString(line + "\n")
			}
		}
	}

	// Plugin terpasang per kategori (kecuali JJ lokal agar tidak duplikat)
	if m.plugins != nil {
		catMap := map[string][]string{}
		catLabel := map[string]string{}
		catOrder := []string{}
		for _, p := range m.plugins.ListInstalled() {
			if !p.Enabled || p.Command == "" {
				continue
			}
			cmdName := strings.ToLower(strings.TrimSpace(p.Command))
			if cmdName == "jj" || cmdName == "jjgc" {
				continue
			}
			cat := strings.TrimSpace(p.Category)
			if cat == "" {
				cat = "Plugin"
			}
			if cmdName == "play" {
				cat = "Downloader"
			}
			key := strings.ToUpper(cat)
			label := "│  • ." + cmdName
			if _, ok := catMap[key]; !ok {
				catOrder = append(catOrder, key)
				catMap[key] = []string{}
				catLabel[key] = menuSmallCaps(cat)
			}
			catMap[key] = append(catMap[key], label)
		}
		for _, key := range catOrder {
			b.WriteString("│\n")
			b.WriteString("├─ " + catLabel[key] + "\n")
			for _, line := range catMap[key] {
				b.WriteString(line + "\n")
			}
		}
	}

	b.WriteString("│\n")
	b.WriteString("├─ ɢʀᴏᴜᴘ ᴍᴀɴᴀɢᴇᴍᴇɴᴛ\n")
	b.WriteString("│  • .antilink on/off\n")
	b.WriteString("│  • .welcome on/off\n")
	b.WriteString("│  • .setwelcome <text>\n")
	b.WriteString("│  • .goodbye on/off\n")
	b.WriteString("│  • .setgoodbye <text>\n")
	b.WriteString("│  • .tagall <text>\n")
	b.WriteString("│  • .hidetag <text>\n")
	b.WriteString("│\n")
	b.WriteString("╰────────")
	return b.String()
}

type spamAction int

const (
	spamOK spamAction = iota
	spamTriggered
	spamBanned
)

func (m *Manager) checkAntiSpam(user string, now time.Time) spamAction {
	user = strings.TrimSpace(user)
	if user == "" {
		return spamOK
	}
	const (
		spamWindow = 500 * time.Millisecond
		banDur     = 10 * time.Second
	)
	m.spamMu.Lock()
	defer m.spamMu.Unlock()

	if until, ok := m.bannedUntil[user]; ok {
		if now.Before(until) {
			return spamBanned
		}
		delete(m.bannedUntil, user)
	}
	if last, ok := m.lastMsgAt[user]; ok {
		if now.Sub(last) < spamWindow {
			m.bannedUntil[user] = now.Add(banDur)
			m.lastMsgAt[user] = now
			return spamTriggered
		}
	}
	m.lastMsgAt[user] = now

	// best-effort cleanup agar map tidak tumbuh tanpa batas
	if len(m.lastMsgAt) > 2000 {
		cutoff := now.Add(-2 * time.Minute)
		for k, t := range m.lastMsgAt {
			if t.Before(cutoff) {
				delete(m.lastMsgAt, k)
			}
		}
		for k, t := range m.bannedUntil {
			if now.After(t) {
				delete(m.bannedUntil, k)
			}
		}
	}
	return spamOK
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


// ===== Group management helpers & commands =====

var antilinkRegex = regexp.MustCompile(`(?i)(https?://\S+|www\.\S+|chat\.whatsapp\.com/\S*|wa\.me/\S+|t\.me/\S+|bit\.ly/\S+)`)

func isGroupMgmtCommand(cmd string) bool {
	switch strings.ToLower(strings.TrimSpace(cmd)) {
	case "antilink", "welcome", "setwelcome", "goodbye", "setgoodbye", "tagall", "hidetag":
		return true
	}
	return false
}

func hasLink(text string) bool {
	return antilinkRegex.MatchString(strings.TrimSpace(text))
}

func (m *Manager) isGroupAdmin(ctx context.Context, chat, sender types.JID) bool {
	if chat.IsEmpty() || sender.IsEmpty() {
		return false
	}
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return false
	}
	info, err := c.GetGroupInfo(ctx, chat)
	if err != nil || info == nil {
		return false
	}
	sUser := sender.User
	for _, p := range info.Participants {
		if p.JID.User == sUser || p.JID.String() == sender.String() {
			if p.IsAdmin || p.IsSuperAdmin {
				return true
			}
		}
	}
	return false
}

func (m *Manager) getGroupParticipants(ctx context.Context, chat types.JID) ([]types.JID, error) {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return nil, errors.New("client not ready")
	}
	info, err := c.GetGroupInfo(ctx, chat)
	if err != nil {
		return nil, err
	}
	if info == nil {
		return nil, errors.New("info grup tidak ditemukan")
	}
	out := make([]types.JID, 0, len(info.Participants))
	for _, p := range info.Participants {
		if !p.JID.IsEmpty() {
			out = append(out, p.JID)
		}
	}
	return out, nil
}

func (m *Manager) canManageGroup(ctx context.Context, evt *events.Message, cfg Config, senderIDs ...string) (bool, string) {
	if evt == nil || !evt.Info.IsGroup {
		return false, "*【 GROUP 】*\n\nPerintah ini hanya dapat digunakan di dalam grup."
	}
	if isOwnerAny(cfg.OwnerNumber, senderIDs...) {
		return true, ""
	}
	if m.isGroupAdmin(ctx, evt.Info.Chat, evt.Info.Sender) {
		return true, ""
	}
	return false, "*【 AKSES DITOLAK 】*\n\nPerintah ini khusus admin grup atau owner."
}

func (m *Manager) sendTextWithMentions(ctx context.Context, to types.JID, text string, mentions []types.JID) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}
	if len(mentions) == 0 {
		_, err := c.SendMessage(ctx, to, &waE2E.Message{Conversation: proto.String(text)})
		return err
	}
	ms := make([]string, 0, len(mentions))
	seen := map[string]bool{}
	for _, j := range mentions {
		s := j.String()
		if strings.TrimSpace(s) == "" || seen[s] {
			continue
		}
		seen[s] = true
		ms = append(ms, s)
	}
	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String(text),
			ContextInfo: &waE2E.ContextInfo{
				MentionedJID: ms,
			},
		},
	}
	_, err := c.SendMessage(ctx, to, msg)
	return err
}

func renderGroupTemplate(tpl string, user types.JID, groupName string) string {
	tag := "@" + user.User
	if strings.TrimSpace(user.User) == "" {
		tag = "@" + strings.Split(user.String(), "@")[0]
	}
	tpl = strings.ReplaceAll(tpl, "@user", tag)
	tpl = strings.ReplaceAll(tpl, "{user}", tag)
	tpl = strings.ReplaceAll(tpl, "{name}", tag)
	tpl = strings.ReplaceAll(tpl, "{group}", groupName)
	return strings.TrimSpace(tpl)
}

func groupNameFromInfo(info *types.GroupInfo, fallback types.JID) string {
	if info != nil {
		if strings.TrimSpace(info.Name) != "" {
			return info.Name
		}
	}
	return fallback.User
}

func (m *Manager) onGroupInfo(evt *events.GroupInfo) {
	if m == nil || evt == nil || m.IsPaused() || m.group == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	chat := evt.JID
	gs := m.group.Get(chat.String())

	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	groupName := chat.User
	if c != nil {
		if info, err := c.GetGroupInfo(ctx, chat); err == nil && info != nil {
			groupName = groupNameFromInfo(info, chat)
		}
	}

	// Welcome: join/add
	if gs.Welcome.Enabled && len(evt.Join) > 0 {
		for _, u := range evt.Join {
			if u.IsEmpty() {
				continue
			}
			tpl := strings.TrimSpace(gs.Welcome.Text)
			if tpl == "" {
				tpl = "*【 WELCOME 】*\n\nHalo @user, selamat datang di *{group}*!\nJangan lupa baca deskripsi grup ya."
			}
			msg := renderGroupTemplate(tpl, u, groupName)
			_ = m.sendTextWithMentions(ctx, chat, msg, []types.JID{u})
		}
	}

	// Goodbye: leave/remove
	if gs.Goodbye.Enabled && len(evt.Leave) > 0 {
		for _, u := range evt.Leave {
			if u.IsEmpty() {
				continue
			}
			tpl := strings.TrimSpace(gs.Goodbye.Text)
			if tpl == "" {
				tpl = "*【 GOODBYE 】*\n\n@user telah keluar dari *{group}*. Sampai jumpa!"
			}
			msg := renderGroupTemplate(tpl, u, groupName)
			_ = m.sendTextWithMentions(ctx, chat, msg, []types.JID{u})
		}
	}
}

func (m *Manager) enforceAntilink(evt *events.Message, text string) bool {
	if evt == nil || !evt.Info.IsGroup || strings.TrimSpace(text) == "" || m.group == nil {
		return false
	}
	gs := m.group.Get(evt.Info.Chat.String())
	if !gs.Antilink || !hasLink(text) {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cfg := m.Config()
	senderIDs := []string{evt.Info.Sender.String(), evt.Info.SenderAlt.String()}
	if isOwnerAny(cfg.OwnerNumber, senderIDs...) || m.isGroupAdmin(ctx, evt.Info.Chat, evt.Info.Sender) {
		return false
	}

	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return false
	}

	revoked := false
	rev := c.BuildRevoke(evt.Info.Chat, evt.Info.Sender, evt.Info.ID)
	if rev != nil {
		if _, err := c.SendMessage(ctx, evt.Info.Chat, rev); err == nil {
			revoked = true
		}
	}

	mention := "@" + evt.Info.Sender.User
	warn := "*【 ANTILINK 】*\n\nTerdeteksi " + mention + " mengirim link.\n"
	if revoked {
		warn += "Pesan dihapus karena antilink aktif."
	} else {
		warn += "Antilink aktif. (Bot gagal menghapus pesan, pastikan bot admin.)"
	}
	_ = m.sendTextWithMentions(ctx, evt.Info.Chat, warn, []types.JID{evt.Info.Sender})
	return true
}

func onOffArg(args string) (bool, bool) {
	a := strings.ToLower(strings.TrimSpace(args))
	switch a {
	case "on", "1", "true", "enable", "aktif":
		return true, true
	case "off", "0", "false", "disable", "nonaktif", "mati":
		return false, true
	}
	return false, false
}

func statusWord(on bool) string {
	if on {
		return "*AKTIF*"
	}
	return "*NONAKTIF*"
}

func (m *Manager) handleGroupMgmtCommand(ctx context.Context, evt *events.Message, cmd, args, userKey string, cfg Config, senderIDs ...string) (ExecResult, bool) {
	cmd = strings.ToLower(strings.TrimSpace(cmd))
	if !isGroupMgmtCommand(cmd) {
		return ExecResult{}, false
	}

	// VIP/feature gate untuk builtin terkait
	feat := "builtin:" + cmd
	if !m.isFeatureAllowed(feat, userKey) {
		return m.vipDeniedReply(), true
	}

	if ok, deny := m.canManageGroup(ctx, evt, cfg, senderIDs...); !ok {
		return ExecResult{Reply: deny}, true
	}
	if m.group == nil {
		return ExecResult{Reply: "*【 GROUP 】*\n\nFitur group management tidak tersedia."}, true
	}

	chatID := evt.Info.Chat.String()
	switch cmd {
	case "antilink":
		if on, ok := onOffArg(args); ok {
			gs, err := m.group.SetAntilink(chatID, on)
			if err != nil {
				return ExecResult{Reply: "*【 ANTILINK 】*\n\nGagal menyimpan pengaturan: " + err.Error()}, true
			}
			return ExecResult{Reply: "*【 ANTILINK 】*\n\nStatus: " + statusWord(gs.Antilink)}, true
		}
		gs := m.group.Get(chatID)
		return ExecResult{Reply: "*【 ANTILINK 】*\n\nStatus: " + statusWord(gs.Antilink) + "\n\n*Penggunaan:*\n.antilink on/off"}, true
	case "welcome":
		if on, ok := onOffArg(args); ok {
			gs, err := m.group.SetWelcomeEnabled(chatID, on)
			if err != nil {
				return ExecResult{Reply: "*【 WELCOME 】*\n\nGagal menyimpan pengaturan: " + err.Error()}, true
			}
			return ExecResult{Reply: "*【 WELCOME 】*\n\nStatus: " + statusWord(gs.Welcome.Enabled)}, true
		}
		gs := m.group.Get(chatID)
		return ExecResult{Reply: "*【 WELCOME 】*\n\nStatus: " + statusWord(gs.Welcome.Enabled) + "\n\n*Penggunaan:*\n.welcome on/off\n.setwelcome <text>"}, true
	case "setwelcome":
		text := strings.TrimSpace(args)
		if text == "" {
			return ExecResult{Reply: "*【 WELCOME 】*\n\nKirim teks welcome yang diinginkan.\n\n*Penggunaan:*\n.setwelcome <text>\n\n*Placeholder:* @user, {group}\n*Contoh:* .setwelcome Halo @user, selamat datang di {group}!"}, true
		}
		_, err := m.group.SetWelcomeText(chatID, text)
		if err != nil {
			return ExecResult{Reply: "*【 WELCOME 】*\n\nGagal menyimpan: " + err.Error()}, true
		}
		return ExecResult{Reply: "*【 WELCOME 】*\n\nTeks welcome berhasil disimpan.\n*Placeholder:* @user, {group}"}, true
	case "goodbye":
		if on, ok := onOffArg(args); ok {
			gs, err := m.group.SetGoodbyeEnabled(chatID, on)
			if err != nil {
				return ExecResult{Reply: "*【 GOODBYE 】*\n\nGagal menyimpan pengaturan: " + err.Error()}, true
			}
			return ExecResult{Reply: "*【 GOODBYE 】*\n\nStatus: " + statusWord(gs.Goodbye.Enabled)}, true
		}
		gs := m.group.Get(chatID)
		return ExecResult{Reply: "*【 GOODBYE 】*\n\nStatus: " + statusWord(gs.Goodbye.Enabled) + "\n\n*Penggunaan:*\n.goodbye on/off\n.setgoodbye <text>"}, true
	case "setgoodbye":
		text := strings.TrimSpace(args)
		if text == "" {
			return ExecResult{Reply: "*【 GOODBYE 】*\n\nKirim teks goodbye yang diinginkan.\n\n*Penggunaan:*\n.setgoodbye <text>\n\n*Placeholder:* @user, {group}\n*Contoh:* .setgoodbye Selamat tinggal @user dari {group}"}, true
		}
		_, err := m.group.SetGoodbyeText(chatID, text)
		if err != nil {
			return ExecResult{Reply: "*【 GOODBYE 】*\n\nGagal menyimpan: " + err.Error()}, true
		}
		return ExecResult{Reply: "*【 GOODBYE 】*\n\nTeks goodbye berhasil disimpan.\n*Placeholder:* @user, {group}"}, true
	case "tagall":
		parts, err := m.getGroupParticipants(ctx, evt.Info.Chat)
		if err != nil || len(parts) == 0 {
			return ExecResult{Reply: "*【 TAGALL 】*\n\nGagal mengambil daftar anggota grup."}, true
		}
		msgText := strings.TrimSpace(args)
		if msgText == "" {
			msgText = "Halo semuanya!"
		}
		var b strings.Builder
		b.WriteString("*【 TAGALL 】*\n\n")
		b.WriteString("*Pesan:* ")
		b.WriteString(msgText)
		b.WriteString("\n\n")
		for _, p := range parts {
			b.WriteString("• @")
			b.WriteString(p.User)
			b.WriteString("\n")
		}
		if err := m.sendTextWithMentions(ctx, evt.Info.Chat, strings.TrimSpace(b.String()), parts); err != nil {
			return ExecResult{Reply: "*【 TAGALL 】*\n\nGagal mengirim pesan: " + err.Error()}, true
		}
		return ExecResult{Reply: ""}, true
	case "hidetag":
		parts, err := m.getGroupParticipants(ctx, evt.Info.Chat)
		if err != nil || len(parts) == 0 {
			return ExecResult{Reply: "*【 HIDETAG 】*\n\nGagal mengambil daftar anggota grup."}, true
		}
		msgText := strings.TrimSpace(args)
		if msgText == "" {
			msgText = "*【 HIDETAG 】*\n\nPengumuman untuk semua anggota."
		}
		if err := m.sendTextWithMentions(ctx, evt.Info.Chat, msgText, parts); err != nil {
			return ExecResult{Reply: "*【 HIDETAG 】*\n\nGagal mengirim pesan: " + err.Error()}, true
		}
		return ExecResult{Reply: ""}, true
	}

	return ExecResult{}, false
}


func (m *Manager) jjKey(chat, user string) string {
	if strings.TrimSpace(user) == "" {
		user = "unknown"
	}
	return chat + "|" + user
}

func (m *Manager) jjTouchLocked(key string) {
	m.jjExpiry[key] = time.Now().Add(5 * time.Minute)
}

func (m *Manager) jjCleanupLocked(key string) bool {
	if exp, ok := m.jjExpiry[key]; ok && !exp.IsZero() && time.Now().After(exp) {
		delete(m.jjUploads, key)
		delete(m.jjSelected, key)
		delete(m.jjExpiry, key)
		return true
	}
	return false
}

func (m *Manager) jjCaptureUpload(ctx context.Context, evt *events.Message) {
	msg := evt.Message
	if msg == nil {
		return
	}
	img := msg.GetImageMessage()
	if img == nil {
		return
	}
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return
	}
	data, err := c.Download(ctx, img)
	if err != nil || len(data) == 0 {
		return
	}
	mime := strings.TrimSpace(img.GetMimetype())
	if mime == "" {
		mime = http.DetectContentType(data)
	}
	ext := ".jpg"
	if strings.Contains(mime, "png") {
		ext = ".png"
	} else if strings.Contains(mime, "webp") {
		ext = ".webp"
	}
	key := m.jjKey(evt.Info.Chat.String(), evt.Info.Sender.String())
	photo := jjStoredPhoto{Name: fmt.Sprintf("foto%s", ext), Mime: mime, Data: data}
	m.jjMu.Lock()
	defer m.jjMu.Unlock()
	m.jjCleanupLocked(key)
	list := append(m.jjUploads[key], photo)
	// batasi maksimal 20 foto per user/chat
	if len(list) > 20 {
		list = list[len(list)-20:]
		// reset seleksi jika indeks tidak valid lagi
		m.jjSelected[key] = nil
	}
	// beri nama urut
	for i := range list {
		e := ".jpg"
		if strings.Contains(list[i].Mime, "png") {
			e = ".png"
		} else if strings.Contains(list[i].Mime, "webp") {
			e = ".webp"
		}
		list[i].Name = fmt.Sprintf("foto%d%s", i+1, e)
	}
	m.jjUploads[key] = list
	m.jjTouchLocked(key)
}

func (m *Manager) jjGetPool(key string) []jjStoredPhoto {
	m.jjMu.Lock()
	defer m.jjMu.Unlock()
	m.jjCleanupLocked(key)
	src := m.jjUploads[key]
	out := make([]jjStoredPhoto, len(src))
	copy(out, src)
	return out
}

func (m *Manager) jjGetSelected(key string) []int {
	m.jjMu.Lock()
	defer m.jjMu.Unlock()
	m.jjCleanupLocked(key)
	src := m.jjSelected[key]
	out := make([]int, len(src))
	copy(out, src)
	return out
}

func (m *Manager) jjReset(key string) {
	m.jjMu.Lock()
	defer m.jjMu.Unlock()
	delete(m.jjUploads, key)
	delete(m.jjSelected, key)
	delete(m.jjExpiry, key)
}

func (m *Manager) jjSelect(key string, idxs []int) ([]int, error) {
	m.jjMu.Lock()
	defer m.jjMu.Unlock()
	m.jjCleanupLocked(key)
	pool := m.jjUploads[key]
	if len(pool) == 0 {
		return nil, errors.New("Belum ada foto yang diunggah. Kirim foto terlebih dahulu, lalu pilih dengan .pilih")
	}
	seen := map[int]bool{}
	var sel []int
	if len(idxs) == 0 {
		// pilih semua
		for i := 1; i <= len(pool); i++ {
			sel = append(sel, i)
		}
	} else {
		for _, n := range idxs {
			if n < 1 || n > len(pool) {
				return nil, fmt.Errorf("Nomor foto %d tidak valid. Tersedia 1-%d.", n, len(pool))
			}
			if !seen[n] {
				seen[n] = true
				sel = append(sel, n)
			}
		}
	}
	m.jjSelected[key] = sel
	m.jjTouchLocked(key)
	return sel, nil
}

func (m *Manager) jjHandlePilih(ctx context.Context, evt *events.Message, args string) {
	key := m.jjKey(evt.Info.Chat.String(), evt.Info.Sender.String())
	pool := m.jjGetPool(key)
	if len(pool) == 0 {
		_ = m.sendReply(ctx, evt, "📸 Belum ada foto yang diunggah.\n\nKirim foto yang ingin dijadikan JJ, lalu gunakan *.pilih* untuk memilihnya.\nContoh: *.pilih* (pilih semua) atau *.pilih 1 3*")
		return
	}
	nums := parseJJNumbers(args)
	sel, err := m.jjSelect(key, nums)
	if err != nil {
		_ = m.sendReply(ctx, evt, "⚠️ "+err.Error())
		return
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("✅ Berhasil memilih %d foto dari %d foto yang tersedia.\n\n", len(sel), len(pool)))
	for i, n := range sel {
		b.WriteString(fmt.Sprintf("• Foto ke-%d (upload #%d) dipilih\n", i+1, n))
	}
	b.WriteString("\nKetik *.jj* untuk membuat video, atau *.pilih 1 2* untuk mengubah pilihan. Ketik *.reset* untuk menghapus semua foto.")
	_ = m.sendReply(ctx, evt, b.String())
}

func (m *Manager) jjHandleReset(ctx context.Context, evt *events.Message) {
	key := m.jjKey(evt.Info.Chat.String(), evt.Info.Sender.String())
	m.jjReset(key)
	_ = m.sendReply(ctx, evt, "🗑️ Daftar foto JJ sudah dikosongkan.\n\nKirim foto baru lalu pilih dengan *.pilih* jika ingin membuat video JJ.")
}

func parseJJNumbers(args string) []int {
	args = strings.TrimSpace(args)
	if args == "" || strings.EqualFold(args, "all") || strings.EqualFold(args, "semua") {
		return nil // nil = pilih semua
	}
	// ganti koma dengan spasi
	repl := strings.NewReplacer(",", " ", ";", " ")
	args = repl.Replace(args)
	parts := strings.Fields(args)
	var nums []int
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		var n int
		for _, r := range p {
			if r < '0' || r > '9' {
				n = -1
				break
			}
			n = n*10 + int(r-'0')
		}
		if n > 0 {
			nums = append(nums, n)
		}
	}
	if len(nums) == 0 {
		return nil
	}
	return nums
}

func (m *Manager) jjSelectedPhotos(key string) ([]jjStoredPhoto, error) {
	m.jjMu.Lock()
	m.jjCleanupLocked(key)
	pool := append([]jjStoredPhoto(nil), m.jjUploads[key]...)
	sel := append([]int(nil), m.jjSelected[key]...)
	m.jjMu.Unlock()
	if len(pool) == 0 {
		return nil, errors.New("Belum ada foto yang diunggah. Kirim foto dulu, lalu pilih dengan *.pilih* dan jalankan *.jj*.")
	}
	if len(sel) == 0 {
		return nil, errors.New("Belum ada foto yang dipilih. Gunakan *.pilih* (pilih semua) atau *.pilih 1 2* untuk memilih foto, lalu jalankan *.jj*.")
	}
	var out []jjStoredPhoto
	for _, n := range sel {
		if n >= 1 && n <= len(pool) {
			p := pool[n-1]
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("Pilihan foto tidak valid. Silakan *.reset* lalu unggah dan pilih foto kembali.")
	}
	return out, nil
}

func (m *Manager) handleJJCommand(ctx context.Context, evt *events.Message, cfg Config, args string) error {
	_ = cfg
	_ = args
	key := m.jjKey(evt.Info.Chat.String(), evt.Info.Sender.String())
	photos, err := m.jjSelectedPhotos(key)
	if err != nil {
		_ = m.sendReply(ctx, evt, "📸 "+err.Error())
		return nil
	}

	_ = m.sendReply(ctx, evt, fmt.Sprintf("🎬 Sedang memproses %d foto menjadi video JJ...\nMohon tunggu sebentar, proses render bisa memakan waktu beberapa menit.", len(photos)))

	base := "https://na-api-nue-api-e7bfd3f4.koyeb.app"
	ups := make([]jjPhotoUpload, 0, len(photos))
	for _, p := range photos {
		ups = append(ups, jjPhotoUpload{name: p.Name, mime: p.Mime, data: p.Data})
	}
	jobID, tpl, err := m.jjCreateJob(ctx, base, ups, "")
	if err != nil {
		_ = m.sendReply(ctx, evt, "❌ Gagal memulai pembuatan video JJ.\n\n*Alasan:* "+err.Error())
		return nil
	}
	_ = tpl

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = m.sendReply(ctx, evt, "⏳ Proses JJ terlalu lama dan melebihi batas waktu. Coba lagi nanti ya.")
			return ctx.Err()
		case <-ticker.C:
			st, err := m.jjGetJob(ctx, base, jobID)
			if err != nil {
				continue
			}
			status, _ := st["status"].(string)
			switch status {
			case "selesai":
				dl, _ := st["download_url"].(string)
				if strings.TrimSpace(dl) == "" {
					_ = m.sendReply(ctx, evt, "⚠️ Video JJ sudah jadi, tetapi tautan unduh tidak tersedia. Coba lagi ya.")
					return nil
				}
				m.jjReset(key)
				cap := "✅ Video JJ kamu sudah jadi!"
				if t, ok := st["template"].(map[string]any); ok {
					if title, _ := t["title"].(string); strings.TrimSpace(title) != "" {
						cap = fmt.Sprintf("✅ Video JJ kamu sudah jadi!\n\n*Template:* %s\n*Foto:* %d", title, len(photos))
					}
				}
				res := ExecResult{VideoURL: dl, Caption: cap}
				if err := m.sendVideoFromURL(ctx, evt, res); err != nil {
					_ = m.sendReply(ctx, evt, cap+"\n\nMaaf, video gagal dikirim. Tautan sementara: "+dl)
					return nil
				}
				return nil
			case "gagal", "error", "timeout":
				emsg, _ := st["error"].(string)
				if emsg == "" {
					emsg = "Terjadi kesalahan saat render."
				}
				_ = m.sendReply(ctx, evt, "❌ Pembuatan video JJ gagal.\n\n*Alasan:* "+emsg)
				return nil
			}
		}
	}
}

func (m *Manager) handleJJGCCommand(ctx context.Context, evt *events.Message, cfg Config) error {
	_ = cfg
	if !evt.Info.IsGroup {
		_ = m.sendReply(ctx, evt, "Perintah *.jjgc* hanya bisa digunakan di dalam grup.")
		return nil
	}
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}
	parts, err := m.getGroupParticipants(ctx, evt.Info.Chat)
	if err != nil || len(parts) == 0 {
		_ = m.sendReply(ctx, evt, "Gagal mengambil daftar anggota grup. Coba lagi nanti.")
		return nil
	}
	// acak dan pilih hingga 3 anggota yang punya foto profil
	cands := append([]types.JID(nil), parts...)
	rand.Shuffle(len(cands), func(i, j int) { cands[i], cands[j] = cands[j], cands[i] })
	var photos []jjPhotoUpload
	for _, p := range cands {
		if len(photos) >= 3 {
			break
		}
		pp, err := c.GetProfilePictureInfo(ctx, p, &whatsmeow.GetProfilePictureParams{Preview: false})
		if err != nil || pp == nil || strings.TrimSpace(pp.URL) == "" {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, pp.URL, nil)
		if err != nil {
			continue
		}
		hc := &http.Client{Timeout: 30 * time.Second}
		resp, err := hc.Do(req)
		if err != nil {
			continue
		}
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
		resp.Body.Close()
		if resp.StatusCode >= 400 || len(data) == 0 {
			continue
		}
		mime := strings.TrimSpace(resp.Header.Get("Content-Type"))
		if mime == "" {
			mime = http.DetectContentType(data)
		}
		ext := ".jpg"
		if strings.Contains(mime, "png") {
			ext = ".png"
		}
		photos = append(photos, jjPhotoUpload{name: fmt.Sprintf("pp%d%s", len(photos)+1, ext), mime: mime, data: data})
	}
	if len(photos) < 1 {
		_ = m.sendReply(ctx, evt, "Tidak ditemukan foto profil anggota grup yang bisa digunakan. Coba lagi nanti.")
		return nil
	}
	_ = m.sendReply(ctx, evt, fmt.Sprintf("🎲 Mengambil %d foto profil anggota grup secara acak...\nSedang memproses video JJ, mohon tunggu sebentar.", len(photos)))
	base := "https://na-api-nue-api-e7bfd3f4.koyeb.app"
	jobID, _, err := m.jjCreateJob(ctx, base, photos, "")
	if err != nil {
		_ = m.sendReply(ctx, evt, "❌ Gagal memulai pembuatan video JJ grup.\n\n*Alasan:* "+err.Error())
		return nil
	}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = m.sendReply(ctx, evt, "⏳ Proses JJ grup terlalu lama dan melebihi batas waktu. Coba lagi nanti ya.")
			return ctx.Err()
		case <-ticker.C:
			st, err := m.jjGetJob(ctx, base, jobID)
			if err != nil {
				continue
			}
			status, _ := st["status"].(string)
			switch status {
			case "selesai":
				dl, _ := st["download_url"].(string)
				if strings.TrimSpace(dl) == "" {
					_ = m.sendReply(ctx, evt, "⚠️ Video JJ grup sudah jadi, tetapi tautan unduh tidak tersedia.")
					return nil
				}
				cap := fmt.Sprintf("✅ Video JJ grup sudah jadi!\n\n*Foto profil:* %d anggota (acak)", len(photos))
				if t, ok := st["template"].(map[string]any); ok {
					if title, _ := t["title"].(string); strings.TrimSpace(title) != "" {
						cap = fmt.Sprintf("✅ Video JJ grup sudah jadi!\n\n*Template:* %s\n*Foto profil:* %d anggota (acak)", title, len(photos))
					}
				}
				res := ExecResult{VideoURL: dl, Caption: cap}
				if err := m.sendVideoFromURL(ctx, evt, res); err != nil {
					_ = m.sendReply(ctx, evt, cap+"\n\nMaaf, video gagal dikirim. Tautan sementara: "+dl)
					return nil
				}
				return nil
			case "gagal", "error", "timeout":
				emsg, _ := st["error"].(string)
				if emsg == "" {
					emsg = "Terjadi kesalahan saat render."
				}
				_ = m.sendReply(ctx, evt, "❌ Pembuatan video JJ grup gagal.\n\n*Alasan:* "+emsg)
				return nil
			}
		}
	}
}

type jjPhotoUpload struct {
	name string
	mime string
	data []byte
}

func (m *Manager) jjCreateJob(ctx context.Context, base string, photos []jjPhotoUpload, templateID string) (string, map[string]any, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for _, p := range photos {
		fw, err := w.CreateFormFile("photos", p.name)
		if err != nil {
			return "", nil, err
		}
		if _, err := fw.Write(p.data); err != nil {
			return "", nil, err
		}
	}
	if strings.TrimSpace(templateID) != "" {
		_ = w.WriteField("template_id", strings.TrimSpace(templateID))
	}
	if err := w.Close(); err != nil {
		return "", nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/api/downloader/jj", &buf)
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	var out map[string]any
	if err := json.Unmarshal(rb, &out); err != nil {
		return "", nil, fmt.Errorf("respons tidak valid: %s", strings.TrimSpace(string(rb)))
	}
	if resp.StatusCode >= 400 {
		if em, _ := out["error"].(string); em != "" {
			return "", nil, errors.New(em)
		}
		return "", nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	jobID, _ := out["job_id"].(string)
	if strings.TrimSpace(jobID) == "" {
		if em, _ := out["error"].(string); em != "" {
			return "", nil, errors.New(em)
		}
		return "", nil, errors.New("job_id tidak ditemukan pada respons")
	}
	var tpl map[string]any
	if t, ok := out["template"].(map[string]any); ok {
		tpl = t
	}
	return jobID, tpl, nil
}

func (m *Manager) jjGetJob(ctx context.Context, base, id string) (map[string]any, error) {
	u := strings.TrimRight(base, "/") + "/api/downloader/jj?id=" + urlQueryEscape(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	var out map[string]any
	if err := json.Unmarshal(rb, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func urlQueryEscape(s string) string {
	r := strings.NewReplacer("%", "%25", " ", "%20", "&", "%26", "=", "%3D", "?", "%3F", "#", "%23", "+", "%2B")
	return r.Replace(s)
}

func (m *Manager) isJJCommand(cmd string) bool {
	switch normalizeCmd(cmd) {
	case "jj", "jjgc", "pilih", "hapus", "reset":
		return true
	}
	return false
}

func (m *Manager) handleJJFeatureCommand(ctx context.Context, evt *events.Message, cmd, args string, cfg Config) {
	switch normalizeCmd(cmd) {
	case "pilih":
		m.jjHandlePilih(ctx, evt, args)
	case "hapus", "reset":
		m.jjHandleReset(ctx, evt)
	case "jj":
		jctx, jcancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer jcancel()
		if err := m.handleJJCommand(jctx, evt, cfg, args); err != nil {
			m.logError("command.jj", err.Error())
		}
	case "jjgc":
		jctx, jcancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer jcancel()
		if err := m.handleJJGCCommand(jctx, evt, cfg); err != nil {
			m.logError("command.jjgc", err.Error())
		}
	}
}
