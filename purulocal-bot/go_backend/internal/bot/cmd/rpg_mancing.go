package cmd

import (
	"context"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:rpg_mancing",
			Name:       "Mancing",
			Command:    "mancing",
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
			j, _, err := rpgPost(ctx, "/api/rpg/mancing/start", map[string]any{"lid": lid})
			if err != nil {
				msg := err.Error()
				if strings.Contains(strings.ToLower(msg), "belum terdaftar") {
					return Result{Reply: "Kamu belum terdaftar. Gunakan: .register <username>"}, true
				}
				return Result{Reply: "Gagal memulai mancing: " + msg}, true
			}
			url, _ := j["url"].(string)
			if strings.TrimSpace(url) == "" {
				return Result{Reply: "Gagal memulai mancing: URL sesi tidak tersedia."}, true
			}
			msg := &waE2E.Message{
				InteractiveMessage: &waE2E.InteractiveMessage{
					Body: &waE2E.InteractiveMessage_Body{
						Text: proto.String("🎣 *Mancing RPG*\n\nSesi mancing siap. Buka game, tangkap ikan, lalu tekan *Simpan* di game untuk konversi ikan ke $RP. 10 menit mancing = 1 XP."),
					},
					Footer: &waE2E.InteractiveMessage_Footer{
						Text: proto.String("puruLocal RPG"),
					},
					InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{
						NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
							Buttons: []*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
								{
									Name: proto.String("cta_url"),
									ButtonParamsJSON: proto.String(
										`{"display_text":"Buka Game Mancing","url":"` + strings.ReplaceAll(url, `"`, `\"`) +
											`","merchant_url":"` + strings.ReplaceAll(url, `"`, `\"`) +
											`","landing_page_url":"` + strings.ReplaceAll(url, `"`, `\"`) +
											`","webview_interaction":true,"webview_presentation":null,"payment_link_preview":false}`,
									),
								},
							},
							MessageVersion: proto.Int32(2),
							MessageParamsJSON: proto.String(
								`{"bottom_sheet":{"in_thread_buttons_limit":2,"divider_indices":[]},"tap_target_configuration":{"canonical_url":"` + strings.ReplaceAll(url, `"`, `\"`) +
									`","url_type":"STATIC","button_index":0,"tap_target_format":1},"tap_target_list":[{"canonical_url":"` + strings.ReplaceAll(url, `"`, `\"`) +
									`","url_type":"STATIC","button_index":0,"tap_target_format":1}]}`,
							),
						},
					},
				},
			}
			return Result{RawMessage: msg}, true
		},
	})
}
