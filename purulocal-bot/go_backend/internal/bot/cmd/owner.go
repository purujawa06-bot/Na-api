package cmd

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:owner",
			Name:       "Owner",
			Command:    "owner",
			Category:   "Utama",
			ShowInMenu: true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			name, vcard := api.BuildOwnerVCard()
			return Result{ContactName: name, ContactVCard: vcard}, true
		},
	})
}
