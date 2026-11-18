package bot

import (
	"context"
	"strings"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// handler.go: handler global untuk identitas owner, termasuk dukungan LID dan JID.

// CollectSenderIDs mengumpulkan semua kandidat identitas pengirim dari event
// (Sender, SenderAlt, JID/LID, serta resolusi LID<->PN via store) untuk
// pengecekan owner/izin secara konsisten.
func CollectSenderIDs(ctx context.Context, client *whatsmeow.Client, evt *events.Message) []string {
	if evt == nil {
		return nil
	}
	userKey := evt.Info.Sender.String()
	if userKey == "" {
		userKey = evt.Info.Chat.String()
	}
	senderIDs := []string{userKey, evt.Info.Sender.String(), evt.Info.SenderAlt.String()}
	resolvedPN := ""
	resolvedLID := ""

	tryResolve := func(j types.JID) {
		if j.IsEmpty() || client == nil || client.Store == nil {
			return
		}
		alt, err := client.Store.GetAltJID(ctx, j)
		if err != nil || alt.IsEmpty() {
			return
		}
		s := alt.String()
		senderIDs = append(senderIDs, s)
		if IsPNJID(alt) {
			resolvedPN = s
		} else if IsLIDJID(alt) {
			resolvedLID = s
		}
	}

	if ctx == nil {
		ctx = context.Background()
	}
	tryResolve(evt.Info.Sender)
	tryResolve(evt.Info.SenderAlt)

	if IsPNJID(evt.Info.Sender) {
		resolvedPN = evt.Info.Sender.String()
	}
	if IsPNJID(evt.Info.SenderAlt) && resolvedPN == "" {
		resolvedPN = evt.Info.SenderAlt.String()
	}
	if IsLIDJID(evt.Info.Sender) && resolvedLID == "" {
		resolvedLID = evt.Info.Sender.String()
	}
	if IsLIDJID(evt.Info.SenderAlt) && resolvedLID == "" {
		resolvedLID = evt.Info.SenderAlt.String()
	}

	senderIDs = append(senderIDs,
		"pn:"+evt.Info.PushName,
		"resolved_pn:"+resolvedPN,
		"resolved_lid:"+resolvedLID,
	)
	return senderIDs
}

// IsLIDJID mengembalikan true jika JID adalah LID.
func IsLIDJID(j types.JID) bool {
	if j.IsEmpty() {
		return false
	}
	return j.Server == types.HiddenUserServer || j.Server == "lid"
}

// IsPNJID mengembalikan true jika JID adalah nomor telepon (PN).
func IsPNJID(j types.JID) bool {
	if j.IsEmpty() {
		return false
	}
	return j.Server == types.DefaultUserServer || j.Server == "s.whatsapp.net"
}

// IsOwner mengecek apakah userKey adalah owner berdasarkan ownerNumber.
// Mendukung kandidat JID/LID/PN dan bentuk ter-resolve.
func IsOwner(userKey, ownerNumber string) bool {
	return IsOwnerAny(ownerNumber, userKey)
}

// IsOwnerAny mengecek apakah salah satu kandidat identitas adalah owner.
// Mendukung format JID (s.whatsapp.net), LID (@lid), hasil resolusi LID<->PN,
// serta variasi penulisan nomor (dengan/atau tanpa 62/0, device suffix, dll).
func IsOwnerAny(ownerNumber string, userKeys ...string) bool {
	ownerDigits := normalizeDigits(ownerNumber)
	if ownerDigits == "" {
		return false
	}
	oCore := trimCoreDigits(ownerDigits)

	for _, userKey := range userKeys {
		if strings.TrimSpace(userKey) == "" {
			continue
		}
		userDigits := extractOwnerDigits(userKey)
		if userDigits == "" {
			continue
		}
		uCore := trimCoreDigits(userDigits)
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

// isOwnerAny/isOwner alias internal (kompatibilitas pemanggil lama di package).
func isOwnerAny(ownerNumber string, userKeys ...string) bool { return IsOwnerAny(ownerNumber, userKeys...) }
func isOwner(userKey, ownerNumber string) bool                { return IsOwner(userKey, ownerNumber) }

func normalizeDigits(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= '0' && r <= '9' {
			out = append(out, r)
		}
	}
	return string(out)
}

func trimCoreDigits(d string) string {
	d = strings.TrimLeft(d, "0")
	d = strings.TrimPrefix(d, "62")
	d = strings.TrimLeft(d, "0")
	return d
}

func extractOwnerDigits(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	// strip prefiks kandidat yang ditambahkan saat resolusi
	for _, p := range []string{"resolved_pn:", "resolved_lid:", "pn:"} {
		if strings.HasPrefix(s, p) {
			s = strings.TrimPrefix(s, p)
		}
	}
	// untuk JID: ambil user part sebelum @ dan buang suffix device :n
	if i := strings.Index(s, "@"); i >= 0 {
		s = s[:i]
	}
	if i := strings.Index(s, ":"); i >= 0 {
		s = s[:i]
	}
	d := normalizeDigits(s)
	if d != "" {
		return d
	}
	// last resort: parse sebagai JID
	if j, err := types.ParseJID(raw); err == nil && !j.IsEmpty() {
		u := j.User
		if i := strings.Index(u, ":"); i >= 0 {
			u = u[:i]
		}
		return normalizeDigits(u)
	}
	return ""
}
