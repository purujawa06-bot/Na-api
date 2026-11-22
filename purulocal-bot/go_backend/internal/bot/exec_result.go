package bot

import "strings"

// ExecResult adalah hasil eksekusi command/fitur internal bot.
type ExecResult struct {
	Reply        string `json:"reply"`
	Caption      string `json:"caption,omitempty"`
	Notice       string `json:"notice,omitempty"`
	AudioURL     string `json:"audio_url,omitempty"`
	VideoURL     string `json:"video_url,omitempty"`
	StickerURL   string `json:"sticker_url,omitempty"`
	Title        string `json:"title,omitempty"`
	PermalinkURL string `json:"permalink_url,omitempty"`
	Mimetype     string `json:"mimetype,omitempty"`
	DurationSec  uint32 `json:"duration_sec,omitempty"`
	PTT          bool   `json:"ptt,omitempty"`
	ContactName  string `json:"contact_name,omitempty"`
	ContactVCard string `json:"contact_vcard,omitempty"`
	// Document (internal, tidak dari plugin JSON)
	DocumentName string `json:"-"`
	DocumentMIME string `json:"-"`
	DocumentData []byte `json:"-"`
}

func normalizeCmd(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, ".")
	s = strings.TrimPrefix(s, "/")
	return s
}
