package cmd

import (
	"strings"
)

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:          "builtin:export",
			Name:        "Export Bot",
			Command:     "export",
			Category:    "Owner",
			ShowInMenu:  true,
			Description: "Export data bot + runner Node.js",
			OwnerOnly:   true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			arg := strings.ToLower(strings.TrimSpace(req.Args))
			if arg != "" && arg != "node" && arg != "nodejs" && arg != "js" {
				return Result{Reply: "*Export Bot*\n\nGunakan:\n• .export\n• .export nodejs"}, true
			}

			data, name, err := api.ExportBotZip("nodejs")
			if err != nil {
				return Result{Reply: "Gagal membuat export: " + err.Error()}, true
			}
			caption := "*Export Bot (Node.js)*\n\nFile: " + name + "\nIsi: config + seluruh data + binary (jika ada) + runner Node.js (index.js).\nSaat dijalankan: cek auto-update runtime saat startup lalu spawn binary bot (lokal/cloud)."
			return Result{
				Caption:      caption,
				DocumentName: name,
				DocumentMIME: "application/zip",
				DocumentData: data,
			}, true
		},
	})
}
