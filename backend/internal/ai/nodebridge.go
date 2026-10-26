package ai

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// runNodeBridge executes a Node.js helper, passing prompt through stdin and
// returning stdout. Bridges are used only for providers that cannot run under
// the Go runtime (WASM signing, Cloudflare JS challenge).
func runNodeBridge(ctx context.Context, prompt, bridgeEnv, defaultBridge string) ([]byte, error) {
	nodeBinary := os.Getenv("NODE_BIN")
	if nodeBinary == "" {
		nodeBinary = "node"
	}
	bridge := os.Getenv(bridgeEnv)
	if bridge == "" {
		bridge = defaultBridge
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
		return nil, fmt.Errorf("%s", message)
	}
	return stdout.Bytes(), nil
}
