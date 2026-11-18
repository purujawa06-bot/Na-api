package bot

import (
	"context"
	"strings"
	"time"

	botcmd "purulocal-bot/internal/bot/cmd"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// Ensure *Manager implements cmd.BotAPI at compile time.
var _ botcmd.BotAPI = (*Manager)(nil)

func (m *Manager) ConfigBotName() string   { return m.Config().BotName }
func (m *Manager) ConfigOwnerName() string { return m.Config().OwnerName }
func (m *Manager) ConfigOwnerNumber() string {
	return m.Config().OwnerNumber
}

func (m *Manager) IsOwner(senderIDs ...string) bool {
	return IsOwnerAny(m.Config().OwnerNumber, senderIDs...)
}

func (m *Manager) IsFeatureAllowed(featureID, userKey string) bool {
	return m.isFeatureAllowed(featureID, userKey)
}

func (m *Manager) VIPDeniedText() string {
	return m.vipDeniedReply().Reply
}

func (m *Manager) FormatLogsForOwner() string {
	if m == nil || m.logger == nil {
		return "*Logs*\nLogger tidak tersedia."
	}
	entries := m.logger.List()
	if len(entries) == 0 {
		return "*Logs*\nBelum ada log. (Bisa lihat juga di halaman Logger)"
	}
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
		line := "[" + e.Time + "][" + lvl + "][" + e.Source + "] " + strings.TrimSpace(e.Message)
		lines = append(lines, line)
	}
	out := strings.Join(lines, "\n")
	r := []rune(out)
	if len(r) > 3500 {
		out = string(r[:3500]) + "\n...(dipotong, lihat halaman Logger untuk lengkap)"
	}
	return out
}

func (m *Manager) RedeemVIP(userKey, code string) (expireUnix int64, remainingSec int64, err error) {
	if m.vip == nil {
		return 0, 0, errVIPUnavailable()
	}
	exp, err := m.vip.Redeem(userKey, normalizeVIPCode(code), time.Now())
	if err != nil {
		return 0, 0, err
	}
	remain := exp - time.Now().Unix()
	if remain < 0 {
		remain = 0
	}
	return exp, remain, nil
}

func (m *Manager) VIPStatus(userKey string) (isVIP bool, remainingSec int64, available bool) {
	if m.vip == nil {
		return false, 0, false
	}
	ok, exp := m.vip.IsUserVIP(userKey, time.Now())
	if !ok {
		return false, 0, true
	}
	remain := exp - time.Now().Unix()
	if remain < 0 {
		remain = 0
	}
	return true, remain, true
}

func (m *Manager) BuildOwnerVCard() (name, vcard string) {
	cfg := m.Config()
	v := buildOwnerVCard(cfg.OwnerName, cfg.OwnerNumber)
	return cfg.OwnerName, v
}

func toGroupView(gs GroupSetting) botcmd.GroupSettingsView {
	return botcmd.GroupSettingsView{
		Antilink:       gs.Antilink,
		WelcomeEnabled: gs.Welcome.Enabled,
		WelcomeText:    gs.Welcome.Text,
		GoodbyeEnabled: gs.Goodbye.Enabled,
		GoodbyeText:    gs.Goodbye.Text,
	}
}

func (m *Manager) GroupGet(chatID string) botcmd.GroupSettingsView {
	if m.group == nil {
		return botcmd.GroupSettingsView{}
	}
	return toGroupView(m.group.Get(chatID))
}

func (m *Manager) GroupSetAntilink(chatID string, on bool) (botcmd.GroupSettingsView, error) {
	if m.group == nil {
		return botcmd.GroupSettingsView{}, errGroupUnavailable()
	}
	gs, err := m.group.SetAntilink(chatID, on)
	return toGroupView(gs), err
}
func (m *Manager) GroupSetWelcomeEnabled(chatID string, on bool) (botcmd.GroupSettingsView, error) {
	if m.group == nil {
		return botcmd.GroupSettingsView{}, errGroupUnavailable()
	}
	gs, err := m.group.SetWelcomeEnabled(chatID, on)
	return toGroupView(gs), err
}
func (m *Manager) GroupSetWelcomeText(chatID, text string) (botcmd.GroupSettingsView, error) {
	if m.group == nil {
		return botcmd.GroupSettingsView{}, errGroupUnavailable()
	}
	gs, err := m.group.SetWelcomeText(chatID, text)
	return toGroupView(gs), err
}
func (m *Manager) GroupSetGoodbyeEnabled(chatID string, on bool) (botcmd.GroupSettingsView, error) {
	if m.group == nil {
		return botcmd.GroupSettingsView{}, errGroupUnavailable()
	}
	gs, err := m.group.SetGoodbyeEnabled(chatID, on)
	return toGroupView(gs), err
}
func (m *Manager) GroupSetGoodbyeText(chatID, text string) (botcmd.GroupSettingsView, error) {
	if m.group == nil {
		return botcmd.GroupSettingsView{}, errGroupUnavailable()
	}
	gs, err := m.group.SetGoodbyeText(chatID, text)
	return toGroupView(gs), err
}

func (m *Manager) IsGroupAdminEvt(ctx context.Context, evt *events.Message) bool {
	if evt == nil {
		return false
	}
	return m.isGroupAdmin(ctx, evt.Info.Chat, evt.Info.Sender)
}

func (m *Manager) GroupSenderRole(ctx context.Context, evt *events.Message) (isAdmin bool, isSuperAdmin bool, known bool) {
	if evt == nil {
		return false, false, false
	}
	// coba sender utama lalu sender alt (LID/PN bisa berbeda)
	if a, s, k := m.groupSenderRole(ctx, evt.Info.Chat, evt.Info.Sender); k {
		if a || s {
			return a, s, k
		}
		// jika sender utama ditemukan tapi bukan admin, coba alt juga (beberapa kasus identitas)
		if !evt.Info.SenderAlt.IsEmpty() {
			if a2, s2, k2 := m.groupSenderRole(ctx, evt.Info.Chat, evt.Info.SenderAlt); k2 && (a2 || s2) {
				return a2, s2, k2
			}
		}
		return a, s, k
	}
	if !evt.Info.SenderAlt.IsEmpty() {
		return m.groupSenderRole(ctx, evt.Info.Chat, evt.Info.SenderAlt)
	}
	return false, false, false
}

func (m *Manager) CanManageGroupEvt(ctx context.Context, evt *events.Message, senderIDs ...string) (bool, string) {
	return m.canManageGroup(ctx, evt, m.Config(), senderIDs...)
}

func (m *Manager) GetGroupParticipants(ctx context.Context, chat types.JID) ([]types.JID, error) {
	return m.getGroupParticipants(ctx, chat)
}

func (m *Manager) SendTextWithMentions(ctx context.Context, chat types.JID, text string, mentions []types.JID) error {
	return m.sendTextWithMentions(ctx, chat, text, mentions)
}

func (m *Manager) HandleSticker(ctx context.Context, evt *events.Message) error {
	return m.handleStickerCommand(ctx, evt, m.Config())
}

func (m *Manager) HandleUpsw(ctx context.Context, evt *events.Message, caption string) error {
	return m.handleUpswCommand(ctx, evt, caption)
}

func (m *Manager) SendReply(ctx context.Context, evt *events.Message, text string) error {
	return m.sendReply(ctx, evt, text)
}

// HandleGroupMgmt mengadaptasi cmd.Request ke handler grup internal.
func (m *Manager) HandleGroupMgmt(req botcmd.Request) (botcmd.Result, bool) {
	cfg := m.Config()
	ctx := req.Ctx
	if ctx == nil {
		ctx = context.Background()
	}
	res, ok := m.handleGroupMgmtCommand(ctx, req.Evt, req.Cmd, req.Args, req.UserKey, cfg, req.SenderIDs...)
	if !ok {
		return botcmd.Result{}, false
	}
	return botcmd.Result{Reply: res.Reply}, true
}

func errVIPUnavailable() error   { return &simpleErr{"Fitur VIP tidak tersedia."} }
func errGroupUnavailable() error { return &simpleErr{"Fitur group management tidak tersedia."} }

type simpleErr struct{ s string }

func (e *simpleErr) Error() string { return e.s }

// cmdResultToExec mengonversi hasil cmd ke ExecResult.
func cmdResultToExec(r botcmd.Result) ExecResult {
	return ExecResult{
		Reply:        r.Reply,
		Caption:      r.Caption,
		Notice:       r.Notice,
		AudioURL:     r.AudioURL,
		VideoURL:     r.VideoURL,
		StickerURL:   r.StickerURL,
		Title:        r.Title,
		PermalinkURL: r.PermalinkURL,
		Mimetype:     r.Mimetype,
		DurationSec:  r.DurationSec,
		ContactName:  r.ContactName,
		ContactVCard: r.ContactVCard,
	}
}
