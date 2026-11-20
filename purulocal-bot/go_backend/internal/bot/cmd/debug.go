package cmd

import (
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
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
			ctx := req.Ctx
			var b strings.Builder
			b.WriteString("*DEBUG INFO*\n")

			// --- sumber dasar ---
			isGroup := false
			isFromMe := false
			chat := types.EmptyJID
			sender := types.EmptyJID
			senderAlt := types.EmptyJID
			pushName := ""
			if evt != nil {
				isGroup = evt.Info.IsGroup
				isFromMe = evt.Info.IsFromMe
				chat = evt.Info.Chat
				sender = evt.Info.Sender
				senderAlt = evt.Info.SenderAlt
				pushName = strings.TrimSpace(evt.Info.PushName)
			}

			// fallback dari UserKey/kandidat bila evt/sender kosong
			userKeyJID := parseJIDSafe(req.UserKey)
			if sender.IsEmpty() && !userKeyJID.IsEmpty() {
				sender = userKeyJID
			}
			if chat.IsEmpty() {
				// coba tebak chat dari kandidat (grup @g.us) jika ada
				for _, id := range req.SenderIDs {
					j := parseJIDSafe(id)
					if !j.IsEmpty() && j.Server == types.GroupServer {
						chat = j
						isGroup = true
						break
					}
				}
			}

			// resolved dari kandidat
			resolvedPN, resolvedLID := "", ""
			for _, id := range req.SenderIDs {
				if strings.HasPrefix(id, "resolved_pn:") && resolvedPN == "" {
					resolvedPN = strings.TrimPrefix(id, "resolved_pn:")
				}
				if strings.HasPrefix(id, "resolved_lid:") && resolvedLID == "" {
					resolvedLID = strings.TrimPrefix(id, "resolved_lid:")
				}
			}
			resolvedPNJID := parseJIDSafe(resolvedPN)
			resolvedLIDJID := parseJIDSafe(resolvedLID)

			// deteksi tipe JID (sender/alt) dengan fallback dari resolved
			senderIsPN := isPNJID(sender) || (!resolvedPNJID.IsEmpty() && sameUser(sender, resolvedPNJID))
			senderIsLID := isLIDJID(sender) || (!resolvedLIDJID.IsEmpty() && sameUser(sender, resolvedLIDJID))
			// jika sender kosong total, infer dari UserKey/resolved
			if sender.IsEmpty() {
				senderIsPN = isPNJID(userKeyJID) || strings.TrimSpace(resolvedPN) != ""
				senderIsLID = isLIDJID(userKeyJID) || strings.TrimSpace(resolvedLID) != ""
			}
			hasAlt := !senderAlt.IsEmpty()
			altIsPN := isPNJID(senderAlt)
			altIsLID := isLIDJID(senderAlt)

			isOwner := api.IsOwner(req.SenderIDs...)
			chatIsGroupJID := !chat.IsEmpty() && chat.Server == types.GroupServer
			if chatIsGroupJID {
				isGroup = true
			}

			// peran grup (admin/superadmin)
			isAdmin, isSuperAdmin, roleKnown := false, false, false
			if isGroup && evt != nil && ctx != nil && !chat.IsEmpty() {
				isAdmin, isSuperAdmin, roleKnown = api.GroupSenderRole(ctx, evt)
			}

			// quoted/reply context
			qParticipant, qID, qType := "", "", ""
			if evt != nil && evt.Message != nil {
				qParticipant, qID, qType = extractQuoted(evt.Message)
			}

			// --- Status (boolean, terdeteksi/sesuai harapan) ---
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
			if roleKnown {
				writeBool(&b, "isAdmin", isAdmin)
				writeBool(&b, "isSuperAdmin", isSuperAdmin)
			} else {
				b.WriteString("• isAdmin: - (bukan grup/tidak diketahui)\n")
				b.WriteString("• isSuperAdmin: - (bukan grup/tidak diketahui)\n")
			}
			writeBool(&b, "resolvedPN", strings.TrimSpace(resolvedPN) != "")
			writeBool(&b, "resolvedLID", strings.TrimSpace(resolvedLID) != "")
			writeBool(&b, "evtAvailable", evt != nil)

			// --- Identitas pengirim ---
			b.WriteString("\n*Identitas*\n")
			writeKV(&b, "UserKey", emptyDash(req.UserKey))
			writeKV(&b, "PushName", emptyDash(pushName))
			writeKV(&b, "Sender", emptyDash(jidStr(sender)))
			writeKV(&b, "Sender.Server", emptyDash(sender.Server))
			writeKV(&b, "Sender.User", emptyDash(sender.User))
			if hasAlt {
				writeKV(&b, "SenderAlt", emptyDash(senderAlt.String()))
				writeKV(&b, "SenderAlt.Server", emptyDash(senderAlt.Server))
				writeKV(&b, "SenderAlt.User", emptyDash(senderAlt.User))
			}
			writeKV(&b, "ResolvedPN", emptyDash(resolvedPN))
			writeKV(&b, "ResolvedLID", emptyDash(resolvedLID))

			// --- Chat & bot ---
			b.WriteString("\n*Chat & Bot*\n")
			writeKV(&b, "Chat", emptyDash(jidStr(chat)))
			writeKV(&b, "Chat.Server", emptyDash(chat.Server))
			writeBool(&b, "Chat.IsGroup", isGroup)
			writeKV(&b, "BotName", emptyDash(api.ConfigBotName()))
			writeKV(&b, "OwnerNumber(cfg)", maskNumber(api.ConfigOwnerNumber()))

			// --- Reply/quoted (jika command reply pesan) ---
			if strings.TrimSpace(qParticipant) != "" || strings.TrimSpace(qID) != "" {
				b.WriteString("\n*Reply/Quoted*\n")
				writeKV(&b, "Quoted.Participant", emptyDash(qParticipant))
				qpj := parseJIDSafe(qParticipant)
				if !qpj.IsEmpty() {
					writeKV(&b, "Quoted.Server", emptyDash(qpj.Server))
					writeKV(&b, "Quoted.User", emptyDash(qpj.User))
					writeBool(&b, "Quoted.isJID(PN)", isPNJID(qpj))
					writeBool(&b, "Quoted.isLID", isLIDJID(qpj))
				}
				writeKV(&b, "Quoted.StanzaID", emptyDash(qID))
				if qType != "" {
					writeKV(&b, "Quoted.Type", qType)
				}
			}

			// --- Kandidat ID (ringkas, dedupe) ---
			b.WriteString("\n*Kandidat ID*\n")
			count := 0
			seen := map[string]bool{}
			for _, id := range req.SenderIDs {
				id = strings.TrimSpace(id)
				if id == "" || seen[id] {
					continue
				}
				seen[id] = true
				b.WriteString("• " + id + "\n")
				count++
				if count >= 24 {
					b.WriteString("• ...(dipotong)\n")
					break
				}
			}
			if count == 0 {
				b.WriteString("• -\n")
			}

			// output: (private chat, isFromMe, LID resolved)
			// *DEBUG INFO*
			//
			// *Status*
			// • isOwner: true
			// • isGroup: false
			// • isFromMe: true
			// • isJID (PN sender): false
			// • isLID (sender): true
			// • hasSenderAlt: false
			// • isAdmin: - (bukan grup/tidak diketahui)
			// • isSuperAdmin: - (bukan grup/tidak diketahui)
			// • resolvedPN: true
			// • resolvedLID: true
			// • evtAvailable: true
			//
			// *Identitas*
			// • UserKey: 92776125477117:43@lid
			// • PushName: ‮uuruP uuruP
			// • Sender: 92776125477117:43@lid
			// • Sender.Server: lid
			// • Sender.User: 92776125477117
			// • ResolvedPN: 6283894391287:43@s.whatsapp.net
			// • ResolvedLID: 92776125477117:43@lid
			//
			// *Chat & Bot*
			// • Chat: 92776125477117@lid
			// • Chat.Server: lid
			// • Chat.IsGroup: false
			// • BotName: PuruBot
			// • OwnerNumber(cfg): *********1287
			//
			// *Kandidat ID*
			// • 92776125477117:43@lid
			// • 6283894391287:43@s.whatsapp.net
			// • pn:‮uuruP uuruP
			// • resolved_pn:6283894391287:43@s.whatsapp.net
			// • resolved_lid:92776125477117:43@lid
			//
			// output: (group chat, isFromMe, reply/quoted, LID resolved)
			// *DEBUG INFO*
			//
			// *Status*
			// • isOwner: true
			// • isGroup: true
			// • isFromMe: true
			// • isJID (PN sender): false
			// • isLID (sender): true
			// • hasSenderAlt: false
			// • isAdmin: true
			// • isSuperAdmin: true
			// • resolvedPN: true
			// • resolvedLID: true
			// • evtAvailable: true
			//
			// *Identitas*
			// • UserKey: 92776125477117:43@lid
			// • PushName: ‮uuruP uuruP
			// • Sender: 92776125477117:43@lid
			// • Sender.Server: lid
			// • Sender.User: 92776125477117
			// • ResolvedPN: 6283894391287:43@s.whatsapp.net
			// • ResolvedLID: 92776125477117:43@lid
			//
			// *Chat & Bot*
			// • Chat: 120363429971778292@g.us
			// • Chat.Server: g.us
			// • Chat.IsGroup: true
			// • BotName: PuruBot
			// • OwnerNumber(cfg): *********1287
			//
			// *Reply/Quoted*
			// • Quoted.Participant: 174315945341052@lid
			// • Quoted.Server: lid
			// • Quoted.User: 174315945341052
			// • Quoted.isJID(PN): false
			// • Quoted.isLID: true
			// • Quoted.StanzaID: AC2E1F398CEDE65EAC20077D13762FF4
			// • Quoted.Type: text
			//
			// *Kandidat ID*
			// • 92776125477117:43@lid
			// • 6283894391287:43@s.whatsapp.net
			// • pn:‮uuruP uuruP
			// • resolved_pn:6283894391287:43@s.whatsapp.net
			// • resolved_lid:92776125477117:43@lid
			return Result{Reply: strings.TrimSpace(b.String())}, true
		},
	})
}

func parseJIDSafe(s string) types.JID {
	s = strings.TrimSpace(s)
	if s == "" {
		return types.EmptyJID
	}
	// strip prefiks metadata kandidat
	for _, p := range []string{"resolved_pn:", "resolved_lid:", "pn:"} {
		if strings.HasPrefix(s, p) {
			s = strings.TrimSpace(strings.TrimPrefix(s, p))
		}
	}
	j, err := types.ParseJID(s)
	if err != nil {
		return types.EmptyJID
	}
	return j
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

func sameUser(a, b types.JID) bool {
	if a.IsEmpty() || b.IsEmpty() || a.User == "" || b.User == "" {
		return false
	}
	return a.User == b.User
}

func jidStr(j types.JID) string {
	if j.IsEmpty() {
		return ""
	}
	return j.String()
}



// extractQuoted pulls quoted context from an events.Message-like holder.
func extractQuoted(msg *waE2E.Message) (participant, stanzaID, msgType string) {
	ci := extractContextInfo(msg)
	if ci == nil {
		return "", "", ""
	}
	participant = strings.TrimSpace(ci.GetParticipant())
	stanzaID = strings.TrimSpace(ci.GetStanzaID())
	if qm := ci.GetQuotedMessage(); qm != nil {
		switch {
		case qm.GetConversation() != "" || qm.GetExtendedTextMessage() != nil:
			msgType = "text"
		case qm.GetImageMessage() != nil:
			msgType = "image"
		case qm.GetVideoMessage() != nil:
			msgType = "video"
		case qm.GetAudioMessage() != nil:
			msgType = "audio"
		case qm.GetDocumentMessage() != nil:
			msgType = "document"
		case qm.GetStickerMessage() != nil:
			msgType = "sticker"
		case qm.GetContactMessage() != nil:
			msgType = "contact"
		default:
			msgType = "other"
		}
	}
	return
}

func extractContextInfo(msg *waE2E.Message) *waE2E.ContextInfo {
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
	case msg.GetContactMessage() != nil:
		return msg.GetContactMessage().GetContextInfo()
	case msg.GetButtonsResponseMessage() != nil:
		return msg.GetButtonsResponseMessage().GetContextInfo()
	case msg.GetListResponseMessage() != nil:
		return msg.GetListResponseMessage().GetContextInfo()
	case msg.GetTemplateButtonReplyMessage() != nil:
		return msg.GetTemplateButtonReplyMessage().GetContextInfo()
	}
	return nil
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


