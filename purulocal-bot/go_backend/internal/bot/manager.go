package bot

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	botcmd "purulocal-bot/internal/bot/cmd"

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
	Connected           bool   `json:"connected"`
	LoggedIn            bool   `json:"logged_in"`
	Paused              bool   `json:"paused"`
	HasSession          bool   `json:"has_session"`
	JID                 string `json:"jid,omitempty"`
	PushName            string `json:"push_name,omitempty"`
	LastError           string `json:"last_error,omitempty"`
	Role                string `json:"role,omitempty"`                 // local|cloud
	CloudActive         bool   `json:"cloud_active"`                   // heartbeat cloud < 60s
	CloudLastHeartbeat  int64  `json:"cloud_last_heartbeat,omitempty"` // unix ms
	PausedByCloud       bool   `json:"paused_by_cloud"`
	PlayLocked          bool   `json:"play_locked"`           // local tidak boleh play saat cloud aktif
	RTDBConfigured      bool   `json:"rtdb_configured"`       // rtdb_url terisi
	DeviceCode          string `json:"device_code,omitempty"` // kode device (immutable)
	SyncLastAt          string `json:"sync_last_at,omitempty"`
	SyncLastError       string `json:"sync_last_error,omitempty"`
}

type Manager struct {
	cfgStore *ConfigStore
	dataDir  string

	mu             sync.RWMutex
	client         *whatsmeow.Client
	qrChan         <-chan whatsmeow.QRChannelItem
	status         Status
	paused         bool // user/manual pause
	pausedByCloud  bool // forced pause (cloud-first, local side)
	plugins        *PluginStore
	aiHist         *AIHistoryStore
	customCmds     *CustomCommandStore
	vip            *VIPStore
	logger         *Logger
	group          *GroupSettingsStore
	cloudSync      *CloudSyncService

	spamMu      sync.Mutex
	lastMsgAt   map[string]time.Time
	bannedUntil map[string]time.Time

	reconnectMu           sync.Mutex
	reconnectTimer        *time.Timer
	intentionalDisconnect bool

	restartOnce sync.Once
	restartCh   chan string
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
	m := &Manager{
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
		restartCh:   make(chan string, 1),
	}
	m.cloudSync = newCloudSyncService(m)
	m.cloudSync.Start()
	return m, nil
}

func (m *Manager) Config() Config { return m.cfgStore.Get() }

func (m *Manager) SaveConfig(cfg Config) error { return m.cfgStore.Save(cfg) }

func (m *Manager) ConfigPath() string { return m.cfgStore.Path() }

func (m *Manager) DataDir() string { return m.dataDir }

func (m *Manager) EnsureDeviceCode() (Config, error) { return m.cfgStore.EnsureDeviceCode() }

func (m *Manager) Status() Status {
	m.mu.RLock()
	client := m.client
	paused := m.paused || m.pausedByCloud
	pausedByCloud := m.pausedByCloud
	base := m.status
	m.mu.RUnlock()

	cfg := m.Config()
	s := base
	s.Paused = paused
	s.PausedByCloud = pausedByCloud
	s.RTDBConfigured = strings.TrimSpace(cfg.RTDBURL) != ""
	s.DeviceCode = strings.TrimSpace(cfg.DeviceCode)
	if m.cloudSync != nil {
		enabled, role, cloudActive, cloudHB, pbc, lastSync, lastErr := m.cloudSync.CloudStatus()
		s.Role = role
		s.CloudActive = cloudActive
		s.CloudLastHeartbeat = cloudHB
		if enabled {
			s.PausedByCloud = pbc
			s.PlayLocked = (role == "local" && cloudActive)
			if pbc {
				s.Paused = true
			}
		}
		s.SyncLastAt = lastSync
		s.SyncLastError = lastErr
	}
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

// SetPaused mengatur pause manual (user). Tidak dapat meng-unpause lokal saat cloud aktif (cloud-first).
func (m *Manager) SetPaused(paused bool) {
	if !paused && m.cloudSync != nil {
		if ok, _ := m.cloudSync.CanLocalPlay(); !ok {
			// tolak unpause saat cloud aktif
			return
		}
	}
	m.mu.Lock()
	m.paused = paused
	if !paused {
		m.pausedByCloud = false
	}
	m.mu.Unlock()
}

// IsPaused mengembalikan status pause efektif (manual atau dipaksa cloud-first).
func (m *Manager) IsPaused() bool {
	m.mu.RLock()
	p := m.paused || m.pausedByCloud
	m.mu.RUnlock()
	if p {
		return true
	}
	if m.cloudSync != nil {
		if ok, _ := m.cloudSync.CanLocalPlay(); !ok {
			return true
		}
	}
	return false
}

func (m *Manager) ForcePauseByCloud(on bool) {
	m.mu.Lock()
	m.pausedByCloud = on
	m.mu.Unlock()
}

func (m *Manager) AutoTakeoverFromCloud() {
	// cloud offline terdeteksi: lokal ambil alih (auto-resume) bila tidak dipause manual
	m.mu.Lock()
	manual := m.paused
	m.pausedByCloud = false
	m.mu.Unlock()
	if !manual {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			_ = m.AutoReconnect(ctx)
		}()
	}
}

func (m *Manager) OnSyncedStoreDB() {
	// store.db diperbarui dari remote saat instance pasif: lepaskan client lama agar baca state baru saat takeover
	// aman dilakukan karena instance pasif/paused (tidak memproses pesan aktif)
	if m.cloudSync != nil && m.cloudSync.Role() == "local" && m.cloudSync.CloudActive() {
		// putuskan koneksi & reset client agar tidak memegang handle DB lama
		m.mu.RLock()
		c := m.client
		m.mu.RUnlock()
		if c != nil {
			c.Disconnect()
		}
		m.mu.Lock()
		m.client = nil
		m.mu.Unlock()
	}
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

func (m *Manager) logInfo(source, msg string) {
	if m != nil && m.logger != nil {
		m.logger.Info(source, msg)
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
	// built-ins dari registry cmd (1 fitur 1 file, metadata di /internal/bot/cmd)
	for _, f := range botcmd.All() {
		id := f.ID
		if id == "" {
			id = "builtin:" + f.Command
		}
		name := strings.TrimSpace(f.Name)
		if name == "" {
			name = f.Command
		}
		items = append(items, FeatureItem{ID: id, Name: name, Command: f.Command, Type: "builtin", VIP: isVIP(id)})
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
	case *events.StreamReplaced:
		m.mu.Lock()
		m.status.LastError = "stream replaced (sesi bentrok)"
		m.mu.Unlock()
		if m.logger != nil {
			m.logger.Warn("connection", "Sesi digantikan/stream replaced (kemungkinan bentrok), reconnect dalam 10 detik")
		}
		m.scheduleReconnect10s("stream replaced (sesi bentrok)")
	case *events.Disconnected:
		m.mu.Lock()
		m.status.LastError = "disconnected"
		m.mu.Unlock()
		// ws terputus / EOF setelah bentrok: coba reconnect otomatis (fixed 10s)
		m.scheduleReconnect10s("disconnected/ws terputus")
	case *events.Connected:
		m.cancelReconnect()
		m.mu.Lock()
		m.intentionalDisconnect = false
		m.mu.Unlock()
	}
}

func (m *Manager) scheduleReconnect10s(reason string) {
	m.reconnectMu.Lock()
	defer m.reconnectMu.Unlock()
	m.mu.RLock()
	intentional := m.intentionalDisconnect
	m.mu.RUnlock()
	if intentional {
		return
	}
	// jangan reconnect jika pause efektif (manual/cloud-lock)
	if m.IsPaused() {
		return
	}
	if m.reconnectTimer != nil {
		m.reconnectTimer.Stop()
		m.reconnectTimer = nil
	}
	m.reconnectTimer = time.AfterFunc(10*time.Second, func() {
		m.reconnectMu.Lock()
		m.reconnectTimer = nil
		m.reconnectMu.Unlock()

		m.mu.RLock()
		intentional := m.intentionalDisconnect
		m.mu.RUnlock()
		if intentional || m.IsPaused() {
			return
		}
		// butuh sesi tersimpan untuk reconnect otomatis
		if m.client == nil {
			// coba ensure client; jika tidak ada sesi, AutoReconnect akan no-op
		}
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := m.AutoReconnect(ctx); err != nil {
			if m.logger != nil {
				m.logger.Warn("connection", "Auto-reconnect ("+reason+") gagal: "+err.Error()+", coba lagi 10 detik")
			}
			// retry fixed 10s
			m.scheduleReconnect10s(reason)
			return
		}
		if m.logger != nil {
			m.logger.Info("connection", "Auto-reconnect berhasil ("+reason+")")
		}
	})
}

func (m *Manager) cancelReconnect() {
	m.reconnectMu.Lock()
	defer m.reconnectMu.Unlock()
	if m.reconnectTimer != nil {
		m.reconnectTimer.Stop()
		m.reconnectTimer = nil
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


	// kumpulkan kandidat ID pengirim (JID/LID + resolusi LID<->PN) via handler global
	m.mu.RLock()
	waClient := m.client
	m.mu.RUnlock()
	senderIDs := CollectSenderIDs(ctx, waClient, evt)


	// dispatch via registry cmd (1 fitur 1 file di /internal/bot/cmd)
	if feat, okf := botcmd.Find(cmd); okf {
		switch feat.Trigger {
		case botcmd.TriggerSticker:
			maybeReact()
			doTyping()
			defer stopReact()
			if cfg.TypingBeforeReply {
				m.sendTyping(ctx, evt.Info.Chat, false)
			}
			featID := feat.ID
			if featID == "" {
				featID = "builtin:" + feat.Command
			}
			if !m.isFeatureAllowed(featID, userKey) {
				_ = m.sendReply(ctx, evt, m.vipDeniedReply().Reply)
				return
			}
			_ = m.HandleSticker(ctx, evt)
			return
		case botcmd.TriggerUpsw:
			maybeReact()
			doTyping()
			defer stopReact()
			if cfg.TypingBeforeReply {
				m.sendTyping(ctx, evt.Info.Chat, false)
			}
			featID := feat.ID
			if featID == "" {
				featID = "builtin:" + feat.Command
			}
			if !m.isFeatureAllowed(featID, userKey) {
				_ = m.sendReply(ctx, evt, m.vipDeniedReply().Reply)
				return
			}
			ids := senderIDs
			if len(ids) == 0 {
				ids = []string{userKey}
			}
			if !isOwnerAny(cfg.OwnerNumber, ids...) {
				_ = m.sendReply(ctx, evt, "Perintah ini khusus owner.")
				return
			}
			_ = m.HandleUpsw(ctx, evt, strings.TrimSpace(args))
			return
		case botcmd.TriggerRemoveNoise:
			maybeReact()
			doTyping()
			defer stopReact()
			if cfg.TypingBeforeReply {
				m.sendTyping(ctx, evt.Info.Chat, false)
			}
			featID := feat.ID
			if featID == "" {
				featID = "builtin:" + feat.Command
			}
			if !m.isFeatureAllowed(featID, userKey) {
				_ = m.sendReply(ctx, evt, m.vipDeniedReply().Reply)
				return
			}
			_ = m.HandleRemoveNoise(ctx, evt)
			return
		}
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
	if feat, okf := botcmd.Find(cmd); okf && feat.Trigger == botcmd.TriggerGroupMgmt {
		maybeReact()
		doTyping()
		defer stopReact()
		if cfg.TypingBeforeReply {
			m.sendTyping(ctx, evt.Info.Chat, false)
		}
		if res, ok := m.HandleGroupMgmt(botcmd.Request{
			Ctx:       ctx,
			Cmd:       cmd,
			Args:      args,
			UserKey:   userKey,
			SenderIDs: senderIDs,
			Evt:       evt,
		}); ok {
			if strings.TrimSpace(res.Reply) != "" {
				_ = m.sendReply(ctx, evt, res.Reply)
			}
			return
		}
	}

	// resolve command (builtin/plugin) - react hanya jika dikenali
	// cek cepat apakah command mungkin dikenal sebelum react?
	res, ok := m.resolveCommand(ctx, evt, cmd, args, userKey, cfg, senderIDs...)
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
	// kirim sticker dari URL gambar (mis. plugin .brat)
	if strings.TrimSpace(res.StickerURL) != "" {
		if err := m.sendStickerFromURL(ctx, evt, res, cfg); err != nil {
			m.logError("send.sticker", "cmd="+cmd+" err="+err.Error())
			fb := strings.TrimSpace(res.Caption)
			if fb == "" {
				fb = strings.TrimSpace(res.Reply)
			}
			if fb == "" {
				fb = "Gagal mengirim sticker."
			} else {
				fb = fb + "\n\n(Gagal mengirim sticker)"
			}
			_ = m.sendReply(ctx, evt, fb)
		}
		return
	}
	if strings.TrimSpace(res.ContactVCard) != "" {
		_ = m.sendContact(ctx, evt, res)
		return
	}
	if len(res.DocumentData) > 0 {
		if err := m.sendDocumentBytes(ctx, evt, res); err != nil {
			m.logError("send.document", "cmd="+cmd+" err="+err.Error())
			fb := strings.TrimSpace(res.Caption)
			if fb == "" {
				fb = strings.TrimSpace(res.Reply)
			}
			if fb == "" {
				fb = "Gagal mengirim dokumen."
			} else {
				fb = fb + "\n\n(Gagal mengirim dokumen)"
			}
			_ = m.sendReply(ctx, evt, fb)
		}
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

func (m *Manager) sendDocumentBytes(ctx context.Context, evt *events.Message, res ExecResult) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}
	if evt == nil || len(res.DocumentData) == 0 {
		return errors.New("dokumen kosong")
	}
	data := res.DocumentData
	mime := strings.TrimSpace(res.DocumentMIME)
	if mime == "" {
		mime = http.DetectContentType(data)
		if mime == "" || mime == "application/octet-stream" {
			mime = "application/octet-stream"
		}
	}
	fileName := strings.TrimSpace(res.DocumentName)
	if fileName == "" {
		fileName = "file.bin"
	}
	caption := strings.TrimSpace(res.Caption)
	if caption == "" {
		caption = strings.TrimSpace(res.Reply)
	}

	upCtx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	uploaded, err := c.Upload(upCtx, data, whatsmeow.MediaDocument)
	if err != nil {
		return err
	}
	doc := &waE2E.DocumentMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String(mime),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		FileName:      proto.String(fileName),
		Caption:       proto.String(caption),
		ContextInfo:   buildReplyContext(evt),
	}
	sCtx, cancel2 := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel2()
	_, err = c.SendMessage(sCtx, evt.Info.Chat, &waE2E.Message{DocumentMessage: doc})
	return err
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

func (m *Manager) sendStickerFromURL(ctx context.Context, evt *events.Message, res ExecResult, cfg Config) error {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSpace(res.StickerURL), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "*/*")
	hc := &http.Client{Timeout: 60 * time.Second}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("download sticker image: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("gambar sticker kosong")
	}

	pack := strings.TrimSpace(cfg.StickerPack)
	author := strings.TrimSpace(cfg.StickerAuthor)
	if pack == "" {
		pack = strings.TrimSpace(cfg.BotName)
		if pack == "" {
			pack = "puruLocal"
		}
	}
	if author == "" {
		author = strings.TrimSpace(cfg.OwnerName)
		if author == "" {
			author = "puruLocal Bot"
		}
	}

	webpData, err := makeStickerWebP(data, pack, author)
	if err != nil {
		return err
	}
	uploaded, err := c.Upload(ctx, webpData, whatsmeow.MediaImage)
	if err != nil {
		return err
	}
	sticker := &waE2E.StickerMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String("image/webp"),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(webpData))),
		IsAnimated:    proto.Bool(false),
		StickerSentTS: proto.Int64(evt.Info.Timestamp.UnixMilli()),
		Height:        proto.Uint32(512),
		Width:         proto.Uint32(512),
		ContextInfo:   buildReplyContext(evt),
	}
	_, err = c.SendMessage(ctx, evt.Info.Chat, &waE2E.Message{StickerMessage: sticker})
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
	// CDN CapCut/evercloud kadang lebih stabil dengan header referer umum
	if strings.Contains(res.VideoURL, "capcut") || strings.Contains(res.VideoURL, "evercloud") || strings.Contains(res.VideoURL, "byteimg") || strings.Contains(res.VideoURL, "bytedance") {
		req.Header.Set("Referer", "https://www.capcut.com/")
		req.Header.Set("Origin", "https://www.capcut.com")
	}
	hc := &http.Client{Timeout: 180 * time.Second}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("download video: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 100<<20)) // batas ~100MB
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("video kosong (HTTP %d, ct=%s)", resp.StatusCode, strings.TrimSpace(resp.Header.Get("Content-Type")))
	}
	mime := strings.TrimSpace(res.Mimetype)
	if mime == "" {
		ct := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
		if i := strings.Index(ct, ";"); i >= 0 {
			ct = strings.TrimSpace(ct[:i])
		}
		if strings.HasPrefix(ct, "video/") {
			mime = ct
		} else {
			mime = http.DetectContentType(data)
			if !strings.HasPrefix(mime, "video/") {
				mime = "video/mp4"
			}
		}
	}
	caption := strings.TrimSpace(res.Caption)
	if caption == "" {
		caption = strings.TrimSpace(res.Reply)
	}

	newSendCtx := func() (context.Context, context.CancelFunc) {
		return context.WithTimeout(context.Background(), 90*time.Second)
	}
	replyCtx := buildReplyContext(evt)

	// coba kirim sebagai video
	upCtx, cancel := newSendCtx()
	uploaded, err := c.Upload(upCtx, data, whatsmeow.MediaVideo)
	cancel()
	if err == nil {
		video := &waE2E.VideoMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			Mimetype:      proto.String(mime),
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(data))),
			Caption:       proto.String(caption),
			ContextInfo:   replyCtx,
		}
		sCtx, cancel2 := newSendCtx()
		_, sendErr := c.SendMessage(sCtx, evt.Info.Chat, &waE2E.Message{VideoMessage: video})
		cancel2()
		if sendErr == nil {
			return nil
		}
		// jika send gagal, coba fallback dokumen di bawah
	}

	// fallback: kirim sebagai dokumen (lebih andal untuk beberapa format/ukuran)
	upCtx2, cancel3 := newSendCtx()
	upDoc, err2 := c.Upload(upCtx2, data, whatsmeow.MediaDocument)
	cancel3()
	if err2 != nil {
		if err != nil {
			return err
		}
		return err2
	}
	fileName := "video.mp4"
	if !strings.Contains(mime, "mp4") && strings.Contains(mime, "/") {
		parts := strings.Split(mime, "/")
		if len(parts) == 2 && parts[1] != "" {
			fileName = "video." + parts[1]
		}
	}
	doc := &waE2E.DocumentMessage{
		URL:           proto.String(upDoc.URL),
		DirectPath:    proto.String(upDoc.DirectPath),
		MediaKey:      upDoc.MediaKey,
		Mimetype:      proto.String(mime),
		FileEncSHA256: upDoc.FileEncSHA256,
		FileSHA256:    upDoc.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(data))),
		FileName:      proto.String(fileName),
		Caption:       proto.String(caption),
		ContextInfo:   replyCtx,
	}
	sCtx2, cancel4 := newSendCtx()
	_, err = c.SendMessage(sCtx2, evt.Info.Chat, &waE2E.Message{DocumentMessage: doc})
	cancel4()
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


func (m *Manager) resolveCommand(ctx context.Context, evt *events.Message, cmd, args, userKey string, cfg Config, senderIDs ...string) (ExecResult, bool) {
	// builtin via registry cmd (1 fitur 1 file di /internal/bot/cmd)
	if f, ok := botcmd.Find(cmd); ok && f.Trigger == botcmd.TriggerDefault {
		featID := f.ID
		if featID == "" {
			featID = "builtin:" + f.Command
		}
		if !m.isFeatureAllowed(featID, userKey) {
			return m.vipDeniedReply(), true
		}
		if f.OwnerOnly {
			ids := senderIDs
			if len(ids) == 0 {
				ids = []string{userKey}
			}
			if !isOwnerAny(cfg.OwnerNumber, ids...) {
				return ExecResult{Reply: "Perintah ini khusus owner."}, true
			}
		}
		res, handled := f.Run(botcmd.Request{
			Ctx:       ctx,
			Evt:       evt,
			Cmd:       cmd,
			Args:      args,
			UserKey:   userKey,
			SenderIDs: senderIDs,
		}, m)
		if handled {
			return cmdResultToExec(res), true
		}
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


// buildMenu mempertahankan kompatibilitas; menu kini dibuat otomatis dari metadata cmd.
func (m *Manager) buildMenu(cfg Config) string {
	_ = cfg
	return m.BuildMenuText()
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

// CanStartBot mengembalikan apakah bot boleh di-start (cloud-first).
func (m *Manager) CanStartBot() (bool, string) {
	if m.cloudSync != nil {
		return m.cloudSync.CanLocalPlay()
	}
	return true, ""
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
	m.mu.Lock()
	m.intentionalDisconnect = true
	m.mu.Unlock()
	m.cancelReconnect()
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c != nil {
		c.Disconnect()
	}
}

func (m *Manager) Logout(ctx context.Context) error {
	m.cancelReconnect()
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
	m.intentionalDisconnect = true
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
	if m.cloudSync != nil {
		m.cloudSync.Stop()
	}
	m.cancelReconnect()
	m.mu.Lock()
	m.intentionalDisconnect = true
	m.mu.Unlock()
	m.Disconnect()
	return nil
}

// RequestRestart meminta proses bot restart (dipakai cloud saat menerima perintah restart dari local).
func (m *Manager) RequestRestart(reason string) {
	if m == nil {
		return
	}
	m.restartOnce.Do(func() {
		if m.logger != nil {
			m.logger.Warn("system", "Restart diminta: "+reason)
		}
		if m.restartCh != nil {
			select {
			case m.restartCh <- reason:
			default:
			}
		}
	})
}

// RestartRequested mengembalikan channel yang menerima sinyal saat restart diminta.
func (m *Manager) RestartRequested() <-chan string { return m.restartCh }



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
	isAdmin, isSuper, known := m.groupSenderRole(ctx, chat, sender)
	_ = isSuper
	return known && isAdmin
}

func (m *Manager) groupSenderRole(ctx context.Context, chat, sender types.JID) (isAdmin bool, isSuperAdmin bool, known bool) {
	if chat.IsEmpty() || sender.IsEmpty() || ctx == nil {
		return false, false, false
	}
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return false, false, false
	}
	info, err := c.GetGroupInfo(ctx, chat)
	if err != nil || info == nil {
		return false, false, false
	}
	match := func(pjid types.JID) bool {
		if pjid.IsEmpty() {
			return false
		}
		if sender.User != "" && pjid.User == sender.User {
			return true
		}
		return pjid.String() == sender.String()
	}
	for _, p := range info.Participants {
		if match(p.JID) {
			return p.IsAdmin || p.IsSuperAdmin, p.IsSuperAdmin, true
		}
	}
	return false, false, true
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
	m.mu.RLock()
	waClient := m.client
	m.mu.RUnlock()
	senderIDs := CollectSenderIDs(ctx, waClient, evt)
	if IsOwnerAny(cfg.OwnerNumber, senderIDs...) || m.isGroupAdmin(ctx, evt.Info.Chat, evt.Info.Sender) {
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



func (m *Manager) handleUpswCommand(ctx context.Context, evt *events.Message, caption string) error {
	imgMsg, vidMsg := findMediaForUpsw(evt)
	if imgMsg == nil && vidMsg == nil {
		_ = m.sendReply(ctx, evt, "Kirim atau reply foto/video dengan caption .upsw <teks>")
		return nil
	}

	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return errors.New("client not ready")
	}

	if imgMsg != nil {
		data, err := c.Download(ctx, imgMsg)
		if err != nil {
			_ = m.sendReply(ctx, evt, "Gagal mengunduh gambar: "+err.Error())
			return nil
		}
		if len(data) == 0 {
			_ = m.sendReply(ctx, evt, "Gambar kosong atau tidak dapat diunduh.")
			return nil
		}
		uploaded, err := c.Upload(ctx, data, whatsmeow.MediaImage)
		if err != nil {
			_ = m.sendReply(ctx, evt, "Gagal upload gambar status: "+err.Error())
			return nil
		}
		mime := strings.TrimSpace(imgMsg.GetMimetype())
		if mime == "" {
			mime = "image/jpeg"
		}
		msg := &waE2E.Message{
			ImageMessage: &waE2E.ImageMessage{
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				Mimetype:      proto.String(mime),
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(data))),
				Caption:       proto.String(caption),
			},
		}
		if _, err := c.SendMessage(ctx, types.StatusBroadcastJID, msg); err != nil {
			_ = m.sendReply(ctx, evt, "Gagal mengirim status: "+err.Error())
			return nil
		}
		_ = m.sendReply(ctx, evt, "Status foto berhasil dikirim.")
		return nil
	}

	// video
	data, err := c.Download(ctx, vidMsg)
	if err != nil {
		_ = m.sendReply(ctx, evt, "Gagal mengunduh video: "+err.Error())
		return nil
	}
	if len(data) == 0 {
		_ = m.sendReply(ctx, evt, "Video kosong atau tidak dapat diunduh.")
		return nil
	}
	uploaded, err := c.Upload(ctx, data, whatsmeow.MediaVideo)
	if err != nil {
		_ = m.sendReply(ctx, evt, "Gagal upload video status: "+err.Error())
		return nil
	}
	mime := strings.TrimSpace(vidMsg.GetMimetype())
	if mime == "" {
		mime = "video/mp4"
	}
	msg := &waE2E.Message{
		VideoMessage: &waE2E.VideoMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			Mimetype:      proto.String(mime),
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(data))),
			Caption:       proto.String(caption),
			Seconds:       proto.Uint32(vidMsg.GetSeconds()),
			GifPlayback:   proto.Bool(vidMsg.GetGifPlayback()),
		},
	}
	if _, err := c.SendMessage(ctx, types.StatusBroadcastJID, msg); err != nil {
		_ = m.sendReply(ctx, evt, "Gagal mengirim status: "+err.Error())
		return nil
	}
	_ = m.sendReply(ctx, evt, "Status video berhasil dikirim.")
	return nil
}

func findMediaForUpsw(evt *events.Message) (*waE2E.ImageMessage, *waE2E.VideoMessage) {
	msg := evt.Message
	if msg == nil {
		return nil, nil
	}
	// 1) media langsung pada pesan dengan caption command
	if img := msg.GetImageMessage(); img != nil {
		return img, nil
	}
	if vid := msg.GetVideoMessage(); vid != nil {
		return nil, vid
	}
	// 2) reply/quote ke media
	if ci := extractIncomingContextInfo(msg); ci != nil {
		if q := ci.GetQuotedMessage(); q != nil {
			if img := q.GetImageMessage(); img != nil {
				return img, nil
			}
			if vid := q.GetVideoMessage(); vid != nil {
				return nil, vid
			}
		}
	}
	return nil, nil
}
