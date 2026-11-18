package cmd

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:logs",
			Name:       "Logs",
			Command:    "logs",
			Category:   "Owner",
			ShowInMenu: true,
			OwnerOnly:  true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			return Result{Reply: api.FormatLogsForOwner()}, true
		},
	})
}
