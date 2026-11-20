package cmd

// Fitur anti noise: hapus noise dari audio/voice note yang di-reply.
// Dipicu khusus (reply audio/vn dengan .removens) agar handler bisa mengunduh media.
func init() {
	Register(&Feature{
		Meta: Meta{
			ID:          "builtin:removens",
			Name:        "Anti Noise",
			Command:     "removens",
			Category:    "Audio",
			ShowInMenu:  true,
			Description: "Hapus noise audio/vn (reply audio/voice note dengan .removens)",
			Trigger:     TriggerRemoveNoise,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			return Result{Reply: "Reply audio/voice note dengan .removens untuk menghapus noise."}, true
		},
	})
}
