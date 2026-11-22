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
			return Result{Reply: "✅ *RPG REGISTER*\n\nUsername: " + uname + "\nData aman. Kalau kamu .register lagi, hanya nama yang berubah."}, true
		},
	})
}
