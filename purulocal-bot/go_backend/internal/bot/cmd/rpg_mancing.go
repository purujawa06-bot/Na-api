package cmd

import (
	"strings"

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
			base := strings.TrimRight(strings.TrimSpace(rpgBackendBase()), "/")
			if base == "" {
				return Result{Reply: "Backend RPG belum dikonfigurasi."}, true
			}
			url := base + "/api/rpg/mancing"
			msg := &waE2E.Message{
				InteractiveMessage: &waE2E.InteractiveMessage{
					Body: &waE2E.InteractiveMessage_Body{
						Text: proto.String("🎣 *Mancing RPG*\n\nBuka game dan login pakai *kode 4 digit* yang kamu dapat saat .register.\nProgres akan *auto save* (tanpa tombol simpan, tanpa sesi kadaluarsa)."),
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
