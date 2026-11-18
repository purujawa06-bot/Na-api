package cmd

import (
	"strings"

	"go.mau.fi/whatsmeow/types"
)

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:debug",
			Name:       "Debug",
			Command:    "debug",
			Category:   "Owner",
			ShowInMenu: true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			evt := req.Evt
			var b strings.Builder
			b.WriteString("*DEBUG INFO*\n")

			isGroup := false
			isFromMe := false
			var sender, senderAlt, chat types.JID
			pushName := ""
			chatStr, senderStr, senderAltStr := "", "", ""
			if evt != nil {
				isGroup = evt.Info.IsGroup
				isFromMe = evt.Info.IsFromMe
				sender = evt.Info.Sender
				senderAlt = evt.Info.SenderAlt
				chat = evt.Info.Chat
				pushName = strings.TrimSpace(evt.Info.PushName)
				chatStr = chat.String()
				senderStr = sender.String()
				senderAltStr = senderAlt.String()
			}

			isOwner := api.IsOwner(req.SenderIDs...)
			senderIsPN := isPNJID(sender)
			senderIsLID := isLIDJID(sender)
			altIsPN := isPNJID(senderAlt)
			altIsLID := isLIDJID(senderAlt)
			hasAlt := senderAltStr != "" && !senderAlt.IsEmpty()

			resolvedPN, resolvedLID := "", ""
			for _, id := range req.SenderIDs {
				if strings.HasPrefix(id, "resolved_pn:") && resolvedPN == "" {
					resolvedPN = strings.TrimPrefix(id, "resolved_pn:")
				}
				if strings.HasPrefix(id, "resolved_lid:") && resolvedLID == "" {
					resolvedLID = strings.TrimPrefix(id, "resolved_lid:")
				}
			}

			ctx := req.Ctx
			isGroupAdmin := false
			groupAdminKnown := false
			if evt != nil && isGroup && ctx != nil {
				isGroupAdmin = api.IsGroupAdminEvt(ctx, evt)
				groupAdminKnown = true
			}

			// Ringkasan boolean (sesuai harapan/terdeteksi)
			b.WriteString("\n*Status*\n")
			writeBool(&b, "isOwner", isOwner)
			writeBool(&b, "isGroup", isGroup)
			writeBool(&b, "isFromMe", isFromMe)
			writeBool(&b, "isJID (PN sender)", senderIsPN)
			writeBool(&b, "isLID (sender)", senderIsLID)
			writeBool(&b, "hasSenderAlt", hasAlt)
			if hasAlt {
				writeBool(&b, "isJID (PN alt)", altIsPN)
				writeBool(&b, "isLID (alt)", altIsLID)
			}
			if groupAdminKnown {
				writeBool(&b, "isGroupAdmin", isGroupAdmin)
			} else {
				b.WriteString("• isGroupAdmin: - (bukan grup/tidak diketahui)\n")
			}
			writeBool(&b, "resolvedPN", strings.TrimSpace(resolvedPN) != "")
			writeBool(&b, "resolvedLID", strings.TrimSpace(resolvedLID) != "")

			// Identitas pengirim
			b.WriteString("\n*Identitas*\n")
			writeKV(&b, "UserKey", req.UserKey)
			writeKV(&b, "PushName", emptyDash(pushName))
			writeKV(&b, "Sender", emptyDash(senderStr))
			writeKV(&b, "Sender.Server", emptyDash(sender.Server))
			writeKV(&b, "Sender.User", emptyDash(sender.User))
			if hasAlt {
				writeKV(&b, "SenderAlt", emptyDash(senderAltStr))
				writeKV(&b, "SenderAlt.Server", emptyDash(senderAlt.Server))
				writeKV(&b, "SenderAlt.User", emptyDash(senderAlt.User))
			}
			writeKV(&b, "ResolvedPN", emptyDash(resolvedPN))
			writeKV(&b, "ResolvedLID", emptyDash(resolvedLID))

			// Chat & bot
			b.WriteString("\n*Chat & Bot*\n")
			writeKV(&b, "Chat", emptyDash(chatStr))
			writeKV(&b, "Chat.Server", emptyDash(chat.Server))
			writeKV(&b, "Chat.IsGroup", fmtBool(isGroup))
			writeKV(&b, "BotName", emptyDash(api.ConfigBotName()))
			writeKV(&b, "OwnerNumber(cfg)", maskNumber(api.ConfigOwnerNumber()))

			// Kandidat ID (ringkas)
			b.WriteString("\n*Kandidat ID*\n")
			count := 0
			for _, id := range req.SenderIDs {
				id = strings.TrimSpace(id)
				if id == "" {
					continue
				}
				// hindari duplikat noise panjang berulang di tampilan utama
				b.WriteString("• " + id + "\n")
				count++
				if count >= 20 {
					b.WriteString("• ...(dipotong)\n")
					break
				}
			}
			if count == 0 {
				b.WriteString("• -\n")
			}

			return Result{Reply: strings.TrimSpace(b.String())}, true
		},
	})
}

func isPNJID(j types.JID) bool {
	if j.IsEmpty() {
		return false
	}
	return j.Server == types.DefaultUserServer || j.Server == "s.whatsapp.net"
}

func isLIDJID(j types.JID) bool {
	if j.IsEmpty() {
		return false
	}
	return j.Server == types.HiddenUserServer || j.Server == "lid"
}

func writeBool(b *strings.Builder, label string, v bool) {
	b.WriteString("• " + label + ": " + fmtBool(v) + "\n")
}

func writeKV(b *strings.Builder, k, v string) {
	b.WriteString("• " + k + ": " + v + "\n")
}

func fmtBool(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

func emptyDash(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "-"
	}
	return s
}

func maskNumber(n string) string {
	n = strings.TrimSpace(n)
	if n == "" {
		return "-"
	}
	if len(n) <= 4 {
		return n
	}
	return strings.Repeat("*", len(n)-4) + n[len(n)-4:]
}
