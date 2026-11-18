package cmd

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:ping",
			Name:       "Ping",
			Command:    "ping",
			Category:   "Utama",
			ShowInMenu: true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			return Result{Reply: "pong"}, true
		},
	})
}
