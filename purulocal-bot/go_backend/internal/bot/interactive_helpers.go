package bot

import (
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

// BuildWebviewCTAMessage membuat pesan InteractiveMessage NativeFlow dengan tombol CTA URL
// + webview params. Logic ini sudah teruji tampil (dipakai .tes) dan disimpan untuk
// fitur game/webview ke depan.
//
// Cara pakai dari command: return ExecResult{RawMessage: BuildWebviewCTAMessage(...)}
func BuildWebviewCTAMessage(body, footer, displayText, targetURL string) *waE2E.Message {
	if body == "" {
		body = "Buka"
	}
	if footer == "" {
		footer = "puruLocal Bot"
	}
	if displayText == "" {
		displayText = "Buka Web"
	}
	if targetURL == "" {
		targetURL = "https://example.com"
	}
	return &waE2E.Message{
		InteractiveMessage: &waE2E.InteractiveMessage{
			Body: &waE2E.InteractiveMessage_Body{
				Text: proto.String(body),
			},
			Footer: &waE2E.InteractiveMessage_Footer{
				Text: proto.String(footer),
			},
			InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{
				NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
					Buttons: []*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
						{
							Name: proto.String("cta_url"),
							ButtonParamsJSON: proto.String(
								`{"display_text":"` + jsonEscape(displayText) +
									`","url":"` + jsonEscape(targetURL) +
									`","merchant_url":"` + jsonEscape(targetURL) +
									`","landing_page_url":"` + jsonEscape(targetURL) +
									`","webview_interaction":true,"webview_presentation":null,"payment_link_preview":false}`,
							),
						},
					},
					MessageVersion: proto.Int32(2),
					MessageParamsJSON: proto.String(
						`{"bottom_sheet":{"in_thread_buttons_limit":2,"divider_indices":[]},` +
							`"tap_target_configuration":{"canonical_url":"` + jsonEscape(targetURL) +
							`","url_type":"STATIC","button_index":0,"tap_target_format":1},` +
							`"tap_target_list":[{"canonical_url":"` + jsonEscape(targetURL) +
							`","url_type":"STATIC","button_index":0,"tap_target_format":1}]}`,
					),
				},
			},
		},
	}
}

func jsonEscape(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch r {
		case '\\':
			out = append(out, '\\', '\\')
		case '"':
			out = append(out, '\\', '"')
		case '\n':
			out = append(out, '\\', 'n')
		case '\r':
			out = append(out, '\\', 'r')
		case '\t':
			out = append(out, '\\', 't')
		default:
			out = append(out, r)
		}
	}
	return string(out)
}
