package cmd

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:hidetag",
			Name:       "Hidetag",
			Command:    "hidetag",
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
