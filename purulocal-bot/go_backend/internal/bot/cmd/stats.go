package cmd

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:stats",
			Name:       "Stats",
			Command:    "stats",
			Category:   "Utama",
			ShowInMenu: true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			ok, remain, avail := api.VIPStatus(req.UserKey)
			if !avail || !ok {
				return Result{Reply: "*Status:* Bukan VIP"}, true
			}
			return Result{Reply: "*Status:* VIP\n*Sisa:* " + formatDurationSec(remain)}, true
		},
	})
}
