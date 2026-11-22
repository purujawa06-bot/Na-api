package cmd

import (
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func init() {
	Register(&Feature{
		Meta: Meta{
			ID:         "builtin:tes",
			Name:       "Tes",
			Command:    "tes",
			Category:   "Utama",
			ShowInMenu: false,
		},
		Run: func(_ Request, _ BotAPI) (Result, bool) {
			msg := &waE2E.Message{
				InteractiveMessage: &waE2E.InteractiveMessage{
					Body: &waE2E.InteractiveMessage_Body{
						Text: proto.String("hallo world"),
					},
					Footer: &waE2E.InteractiveMessage_Footer{
						Text: proto.String("puruLocal Bot"),
					},
					InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{
						NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
							Buttons: []*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
								{
									Name: proto.String("cta_url"),
									ButtonParamsJSON: proto.String(`{"display_text":"Buka Web","url":"https://example.com","merchant_url":"https://example.com","landing_page_url":"https://example.com","webview_interaction":true,"webview_presentation":null,"payment_link_preview":false}`),
								},
							},
							MessageVersion:    proto.Int32(2),
							MessageParamsJSON: proto.String(`{"bottom_sheet":{"in_thread_buttons_limit":2,"divider_indices":[]},"tap_target_configuration":{"canonical_url":"https://example.com","url_type":"STATIC","button_index":0,"tap_target_format":1},"tap_target_list":[{"canonical_url":"https://example.com","url_type":"STATIC","button_index":0,"tap_target_format":1}]}`),
						},
					},
				},
			}
			return Result{RawMessage: msg}, true
		},
	})
}
