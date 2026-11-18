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
			Description: "Export data bot + runner (nodejs/python)",
			OwnerOnly:   true,
		},
		Run: func(req Request, api BotAPI) (Result, bool) {
			arg := strings.ToLower(strings.TrimSpace(req.Args))
			format := ""
			label := ""
			switch arg {
			case "", "node", "nodejs", "js":
				format = "nodejs"
				label = "Node.js"
			case "python", "py":
				format = "python"
				label = "Python"
			default:
				return Result{Reply: "*Export Bot*\n\nGunakan:\n? .export nodejs\n? .export python"}, true
			}

			data, name, err := api.ExportBotZip(format)
			if err != nil {
				return Result{Reply: "Gagal membuat export: " + err.Error()}, true
			}
			caption := "*Export Bot (" + label + ")*\n\nFile: " + name + "\nIsi: config + seluruh data + binary (jika ada) + runner " + label + ".\nSaat dijalankan: cek auto-update runtime saat startup lalu spawn binary bot (lokal/cloud)."
			return Result{
				Caption:      caption,
				DocumentName: name,
				DocumentMIME: "application/zip",
				DocumentData: data,
			}, true
		},
	})
}
