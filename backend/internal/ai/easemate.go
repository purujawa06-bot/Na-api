package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
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
	nodeBinary := os.Getenv("NODE_BIN")
	if nodeBinary == "" {
		nodeBinary = "node"
	}
	bridge := os.Getenv("EASEMATE_BRIDGE")
	if bridge == "" {
		bridge = defaultEasemateBridge
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command := exec.CommandContext(ctx, nodeBinary, bridge)
	command.Stdin = strings.NewReader(prompt)
	command.Stdout = &stdout
	command.Stderr = &stderr

	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("EaseMate: %s", message)
	}

	var result easemateResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
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
