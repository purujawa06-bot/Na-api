package cmd

import (
	"context"
	"sort"
	"strings"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// TriggerType menentukan mode penanganan khusus fitur.
type TriggerType string

const (
	TriggerDefault     TriggerType = ""            // command teks biasa via resolve
	TriggerSticker     TriggerType = "sticker"     // butuh media gambar + caption command
	TriggerUpsw        TriggerType = "upsw"        // upload status (owner, butuh media)
	TriggerGroupMgmt   TriggerType = "group_mgmt"  // command manajemen grup (butuh konteks grup/admin)
	TriggerRemoveNoise TriggerType = "remove_noise" // hapus noise audio/vn (reply audio dengan command)
)

// Meta berisi metadata fitur/command. Setiap fitur didefinisikan dalam 1 file.
type Meta struct {
	ID          string      // ID unik untuk VIP gating, mis. "builtin:ping"
	Name        string      // nama tampilan
	Command     string      // command utama (tanpa prefix . atau /)
	Aliases     []string    // alias (bisa dipanggil, tidak ditampilkan terpisah di menu)
	Category    string      // kategori menu
	ShowInMenu  bool        // tampilkan command utama di menu
	Description string
	OwnerOnly   bool
	GroupOnly   bool
	Trigger     TriggerType // mode penanganan khusus
}

// Result hasil eksekusi command.
type Result struct {
	Reply        string
	Caption      string
	Notice       string
	AudioURL     string
	VideoURL     string
	StickerURL   string
	Title        string
	PermalinkURL string
	Mimetype     string
	DurationSec  uint32
	ContactName  string
	ContactVCard string
	// Document (untuk mengirim file/dokumen, mis. zip export)
	DocumentName string
	DocumentMIME string
	DocumentData []byte
}

// Request konteks pemanggilan command.
type Request struct {
	Cmd       string
	Args      string
	UserKey   string
	SenderIDs []string
	Evt       *events.Message
	Ctx       context.Context
}

// BotAPI adalah antarmuka ke bot yang dibutuhkan handler fitur.
// Diimplementasikan oleh *bot.Manager.
type BotAPI interface {
	ConfigBotName() string
	ConfigOwnerName() string
	ConfigOwnerNumber() string
	BuildMenuText() string
	IsOwner(senderIDs ...string) bool
	IsFeatureAllowed(featureID, userKey string) bool
	VIPDeniedText() string
	FormatLogsForOwner() string
	RedeemVIP(userKey, code string) (expireUnix int64, remainingSec int64, err error)
	VIPStatus(userKey string) (isVIP bool, remainingSec int64, available bool)
	BuildOwnerVCard() (name, vcard string)
	// group
	IsGroupAdminEvt(ctx context.Context, evt *events.Message) bool
	GroupSenderRole(ctx context.Context, evt *events.Message) (isAdmin bool, isSuperAdmin bool, known bool)
	CanManageGroupEvt(ctx context.Context, evt *events.Message, senderIDs ...string) (bool, string)
	GroupGet(chatID string) GroupSettingsView
	GroupSetAntilink(chatID string, on bool) (GroupSettingsView, error)
	GroupSetWelcomeEnabled(chatID string, on bool) (GroupSettingsView, error)
	GroupSetWelcomeText(chatID, text string) (GroupSettingsView, error)
	GroupSetGoodbyeEnabled(chatID string, on bool) (GroupSettingsView, error)
	GroupSetGoodbyeText(chatID, text string) (GroupSettingsView, error)
	GetGroupParticipants(ctx context.Context, chat types.JID) ([]types.JID, error)
	SendTextWithMentions(ctx context.Context, chat types.JID, text string, mentions []types.JID) error
	// sticker/upsw/removens (special handlers implemented in bot package)
	HandleSticker(ctx context.Context, evt *events.Message) error
	HandleUpsw(ctx context.Context, evt *events.Message, caption string) error
	HandleRemoveNoise(ctx context.Context, evt *events.Message) error
	// group management dispatch
	HandleGroupMgmt(req Request) (Result, bool)
	SendReply(ctx context.Context, evt *events.Message, text string) error
	// AI chat (builtin .ai) dengan riwayat & auto-compact
	RunAICommand(ctx context.Context, args, userKey string) (Result, error)
	// export bot (zip data+runner)
	ExportBotZip(format string) ([]byte, string, error)
}

// GroupSettingsView tampilan ringkas pengaturan grup untuk handler.
type GroupSettingsView struct {
	Antilink       bool
	WelcomeEnabled bool
	WelcomeText    string
	GoodbyeEnabled bool
	GoodbyeText    string
}

// Feature definisi satu fitur/command.
type Feature struct {
	Meta
	// Run dieksekusi untuk command biasa (via resolve/dispatch teks).
	// Mengembalikan (result, handled).
	Run func(req Request, api BotAPI) (Result, bool)
}

var registry = []*Feature{}
var byCmd = map[string]*Feature{}

// Register mendaftarkan fitur ke registry.
func Register(f *Feature) {
	if f == nil {
		return
	}
	registry = append(registry, f)
	if f.Command != "" {
		byCmd[normalize(f.Command)] = f
	}
	for _, a := range f.Aliases {
		if a != "" {
			byCmd[normalize(a)] = f
		}
	}
}

func normalize(s string) string {
	// simple normalize: lower + trim + strip prefix handled by caller, but keep safe
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			out = append(out, r-'A'+'a')
		} else {
			out = append(out, r)
		}
	}
	// trim spaces
	b := 0
	e := len(out)
	for b < e && (out[b] == ' ' || out[b] == '\t' || out[b] == '\n' || out[b] == '\r') {
		b++
	}
	for e > b && (out[e-1] == ' ' || out[e-1] == '\t' || out[e-1] == '\n' || out[e-1] == '\r') {
		e--
	}
	// strip leading . or /
	if b < e && (out[b] == '.' || out[b] == '/') {
		b++
	}
	return string(out[b:e])
}

// NormalizeCmd menormalisasi command (untuk dipakai package bot).
func NormalizeCmd(s string) string { return normalize(s) }

// All mengembalikan semua fitur terdaftar (urutan registrasi).
func All() []*Feature {
	out := make([]*Feature, len(registry))
	copy(out, registry)
	return out
}

// Find mencari fitur berdasarkan command/alias.
func Find(cmd string) (*Feature, bool) {
	f, ok := byCmd[normalize(cmd)]
	return f, ok
}

// MenuItems mengembalikan fitur yang ditampilkan di menu, dikelompokkan per kategori.
// Urutan kategori: abjad (A-Z, case-insensitive) prioritas utama, jumlah item paling sedikit prioritas kedua.
// Item di dalam kategori diurutkan abjad berdasarkan command.
func MenuItems() (order []string, groups map[string][]*Feature) {
	groups = map[string][]*Feature{}
	for _, f := range registry {
		if !f.ShowInMenu {
			continue
		}
		cat := f.Category
		if cat == "" {
			cat = "Lainnya"
		}
		if _, ok := groups[cat]; !ok {
			order = append(order, cat)
		}
		groups[cat] = append(groups[cat], f)
	}
	sort.Slice(order, func(i, j int) bool {
		ci, cj := strings.ToLower(order[i]), strings.ToLower(order[j])
		if ci != cj {
			return ci < cj
		}
		return len(groups[order[i]]) < len(groups[order[j]])
	})
	for _, cat := range order {
		sort.Slice(groups[cat], func(i, j int) bool {
			ai := strings.ToLower(strings.TrimSpace(groups[cat][i].Command))
			aj := strings.ToLower(strings.TrimSpace(groups[cat][j].Command))
			if ai != aj {
				return ai < aj
			}
			return strings.ToLower(groups[cat][i].Name) < strings.ToLower(groups[cat][j].Name)
		})
	}
	return
}
