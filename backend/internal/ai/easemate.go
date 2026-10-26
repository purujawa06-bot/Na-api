package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const defaultEasemateBridge = "bridge/easemate-cli.mjs"

// easemateResult is the JSON contract printed by the Node signing bridge.
type easemateResult struct {
	Text      string `json:"text"`
	Reasoning string `json:"reasoning"`
}

// generateEasemate runs the EaseMate Node bridge because the upstream API
// requires a signature produced by its wasm-bindgen module, which cannot be
// executed by the Go runtime directly.
func generateEasemate(ctx context.Context, prompt string) (string, error) {
	stdout, err := runNodeBridge(ctx, prompt, "EASEMATE_BRIDGE", defaultEasemateBridge)
	if err != nil {
		return "", fmt.Errorf("EaseMate: %s", err)
	}

	var result easemateResult
	if err := json.Unmarshal(stdout, &result); err != nil {
		return "", fmt.Errorf("EaseMate: respons bridge tidak valid: %w", err)
	}

	text := strings.TrimSpace(result.Text)
	if text == "" {
		text = strings.TrimSpace(result.Reasoning)
	}
	if text == "" {
		return "", fmt.Errorf("EaseMate: mengembalikan konten kosong")
	}
	return text, nil
}
