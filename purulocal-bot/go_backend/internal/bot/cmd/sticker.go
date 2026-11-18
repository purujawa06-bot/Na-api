package cmd

// Fitur sticker: dipicu khusus saat pesan gambar/reply gambar dengan caption .s/.sticker
// (ditangani di message handler agar bisa akses media). Metadata untuk menu/VIP.
func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:sticker",
			Name:       "Sticker",
			Command:    "sticker",
			Aliases:    []string{"s"},
			Category:   "Media",
			ShowInMenu: true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			// fallback jika dipanggil sebagai command biasa tanpa konteks media
			return Result{Reply: "Kirim atau reply gambar dengan caption .s atau .sticker"}, true
		},
	})
}
