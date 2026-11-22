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
									Name:             proto.String("quick_reply"),
									ButtonParamsJSON: proto.String(`{"display_text":"OK","id":"tes_ok"}`),
								},
							},
							MessageVersion: proto.Int32(2),
						},
					},
				},
			}
			return Result{RawMessage: msg}, true
		},
	})
}
