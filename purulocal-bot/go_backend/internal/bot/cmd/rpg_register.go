package cmd

import (
	"context"
	"strings"
	"time"
)

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:rpg_register",
			Name:       "RPG Register",
			Command:    "register",
			Category:   "RPG",
			ShowInMenu: true,
		},
		Run: func(req Request, _ BotAPI) (Result, bool) {
			if req.Evt != nil && req.Evt.Info.Chat.Server == "g.us" {
				return Result{Reply: "❌ Register RPG hanya bisa di *chat pribadi*, bukan di grup.\nSilakan chat pribadi bot lalu ketik: .register <username>"}, true
			}
			username := strings.TrimSpace(req.Args)
			if username == "" {
				return Result{Reply: "Gunakan: .register <username>"}, true
			}
			lid := pickRPGID(req)
			if lid == "" {
				return Result{Reply: "Gagal mendeteksi identitas pemain."}, true
			}
			ctx := req.Ctx
			if ctx == nil {
				ctx = context.Background()
			}
			ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			j, _, err := rpgPost(ctx, "/api/rpg/register", map[string]any{"lid": lid, "username": username})
			if err != nil {
				return Result{Reply: "Gagal register RPG: " + err.Error()}, true
			}
			p := asMap(j["player"])
			uname := asStr(p["username"])
			if uname == "" {
				uname = username
			}
			code := asStr(p["login_code"])
			msg := "✅ *RPG REGISTER*\n\nUsername: " + uname
			if code != "" {
				msg += "\nKode Login: *" + code + "*\n\nSimpan kode 4 digit ini untuk login game mancing. Jangan bagikan ke orang lain."
			} else {
				msg += "\n\nData aman. Kalau kamu .register lagi, hanya nama yang berubah."
			}
			return Result{Reply: msg}, true
		},
	})
}
