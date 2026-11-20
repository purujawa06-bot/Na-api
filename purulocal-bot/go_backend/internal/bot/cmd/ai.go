package cmd

import "context"

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:          "builtin:ai",
			Name:        "AI Chat",
			Command:     "ai",
			Category:    "AI",
			ShowInMenu:  true,
			Description: "Tanya AI (.ai <pertanyaan>)",
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			ctx := req.Ctx
			if ctx == nil {
				ctx = context.Background()
			}
			res, err := api.RunAICommand(ctx, req.Args, req.UserKey)
			if err != nil {
				return Result{Reply: "AI error: " + err.Error()}, true
			}
			return res, true
		},
	})
}
