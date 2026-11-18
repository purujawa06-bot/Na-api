package cmd

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:menu",
			Name:       "Menu",
			Command:    "menu",
			Category:   "Utama",
			ShowInMenu: true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			return Result{Reply: api.BuildMenuText()}, true
		},
	})
}
