package cmd

import (
	"net/url"
	"strings"
)

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:          "builtin:brat",
			Name:        "Brat Sticker",
			Command:     "brat",
			Category:    "Sticker",
			ShowInMenu:  true,
			Description: "Buat sticker brat dari teks (.brat <teks>)",
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			text := strings.TrimSpace(req.Args)
			if text == "" {
				return Result{Reply: "Gunakan: .brat <teks>"}, true
			}
			stickerURL := naAPIBase + "/api/tools/brat?text=" + url.QueryEscape(text)
			return Result{StickerURL: stickerURL}, true
		},
	})
}
