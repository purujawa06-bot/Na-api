package cmd

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:goodbye",
			Name:       "Goodbye",
			Command:    "goodbye",
			Category:   "Pengaturan Grup",
			ShowInMenu: true,
			GroupOnly:  true,
			Trigger:    TriggerGroupMgmt,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			return api.HandleGroupMgmt(req)
		},
	})
}
