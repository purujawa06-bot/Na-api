package cmd

// Fitur upload status/story (owner-only). Dipicu khusus di message handler karena butuh media.
func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:upsw",
			Name:       "Upload Status",
			Command:    "upsw",
			Aliases:    []string{"upstatus", "sw"},
			Category:   "Owner",
			ShowInMenu: true,
			OwnerOnly:  true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			return Result{Reply: "Kirim atau reply foto/video dengan caption .upsw <teks>"}, true
		},
	})
}
