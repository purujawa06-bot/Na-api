package cmd

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
)

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:rpg_stats",
			Name:       "RPG Stats",
			Command:    "gamestats",
			Aliases:    []string{"gstats"},
			Category:   "RPG",
			ShowInMenu: true,
		},
		Run: func(req Request, _ BotAPI) (Result, bool) {
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
			j, _, err := rpgGet(ctx, "/api/rpg/stats?lid="+url.QueryEscape(lid))
			if err != nil {
				msg := err.Error()
				if strings.Contains(strings.ToLower(msg), "belum terdaftar") {
					return Result{Reply: "Kamu belum terdaftar. Gunakan: .register <username>"}, true
				}
				return Result{Reply: "Gagal ambil stats RPG: " + msg}, true
			}
			p := asMap(j["player"])
			uname := asStr(p["username"])
			rp := asInt(p["rp"])
			level := asInt(p["level"])
			xp := asInt(p["xp"])
			xpNext := asInt(p["xp_to_next"])
			fish := asInt(p["total_fish"])
			if xpNext <= 0 {
				xpNext = 30
			}
			reply := fmt.Sprintf("🎮 *GAME STATS*\n\n👤 Username: %s\n💰 $RP: %d\n⭐ Level: %d\n✨ XP: %d/%d\n🐟 Total Ikan: %d", uname, rp, level, xp, xpNext, fish)
			return Result{Reply: reply}, true
		},
	})
}
