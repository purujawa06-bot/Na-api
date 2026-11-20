package bot

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	botcmd "purulocal-bot/internal/bot/cmd"
)

const naAPIPublicBase = "https://na-api-nue-api-e7bfd3f4.koyeb.app"

func (m *Manager) RunAICommand(ctx context.Context, args, userKey string) (botcmd.Result, error) {
	prompt := strings.TrimSpace(args)
	if prompt == "" {
		return botcmd.Result{Reply: "Gunakan: .ai <pertanyaan>"}, nil
	}
	cfg := m.Config()

	// riwayat percakapan per user + auto-compact
	var hist []ChatMessage
	if m.aiHist != nil {
		hist = m.aiHist.Get(userKey)
		hist = append(hist, ChatMessage{Role: "user", Content: prompt})
		hist = CompactIfNeeded(hist, 6000)
	} else {
		hist = []ChatMessage{{Role: "user", Content: prompt}}
	}

	reply, err := runAIChat(ctx, prompt, hist, strings.TrimSpace(cfg.AISystemPrompt))
	if err != nil {
		return botcmd.Result{}, err
	}
	if strings.TrimSpace(reply) != "" && m.aiHist != nil {
		hist = append(hist, ChatMessage{Role: "assistant", Content: reply})
		hist = CompactIfNeeded(hist, 6000)
		_ = m.aiHist.Set(userKey, hist)
	}
	return botcmd.Result{Reply: reply}, nil
}

func runAIChat(ctx context.Context, prompt string, messages []ChatMessage, systemPrompt string) (string, error) {
	msgs := make([]map[string]any, 0, len(messages)+1)
	if systemPrompt != "" {
		hasSystem := false
		if len(messages) > 0 && strings.EqualFold(messages[0].Role, "system") {
			hasSystem = true
		}
		if !hasSystem {
			msgs = append(msgs, map[string]any{"role": "system", "content": systemPrompt})
		}
	}
	if len(messages) == 0 {
		msgs = append(msgs, map[string]any{"role": "user", "content": prompt})
	} else {
		for _, m := range messages {
			msgs = append(msgs, map[string]any{"role": m.Role, "content": m.Content})
		}
	}

	endpoint := naAPIPublicBase + "/api/chat/completions"
	payload := map[string]any{
		"model":    "auto",
		"messages": msgs,
		"stream":   true,
		"tools": []map[string]any{
			{
				"type": "function",
				"function": map[string]any{
					"name":        "getWeather",
					"description": "Cuaca sebuah kota",
					"parameters": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"city": map[string]any{"type": "string"},
						},
						"required": []string{"city"},
					},
				},
			},
		},
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 60 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return formatAIReply("Gagal menghubungi AI: " + err.Error()), nil
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		rb, _ := io.ReadAll(io.LimitReader(res.Body, 2000))
		return formatAIReply("AI error: " + strings.TrimSpace(string(rb))), nil
	}
	// baca SSE stream dan gabungkan delta.content
	var out strings.Builder
	sc := bufio.NewScanner(res.Body)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			if data == "[DONE]" {
				break
			}
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) > 0 {
			c := chunk.Choices[0].Delta.Content
			if c != "" {
				out.WriteString(c)
			}
		}
	}
	txt := strings.TrimSpace(out.String())
	if txt == "" {
		return formatAIReply("(AI tidak mengembalikan jawaban)"), nil
	}
	if len([]rune(txt)) > 3500 {
		txt = string([]rune(txt)[:3500]) + "..."
	}
	return formatAIReply(txt), nil
}

var (
	reMDBold   = regexp.MustCompile(`\*\*(.+?)\*\*`)
	reMDUBold  = regexp.MustCompile(`__(.+?)__`)
	reMDStrike = regexp.MustCompile(`~~(.+?)~~`)
	reMDHead   = regexp.MustCompile(`(?m)^(#{1,6})\s+(.+)$`)
	reMDLink   = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	reMDBullet = regexp.MustCompile(`(?m)^(\s*)[-*]\s+`)
	reMDNum    = regexp.MustCompile(`(?m)^(\s*)\d+\.\s+`)
)

func formatAIReply(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimLeft(s, "\uFEFF")
	for _, p := range []string{"\U0001F916", ":robot:"} {
		if strings.HasPrefix(s, p) {
			s = strings.TrimSpace(strings.TrimPrefix(s, p))
		}
	}
	lines := strings.Split(s, "\n")
	inCode := false
	for i, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "```") {
			inCode = !inCode
			continue
		}
		if inCode {
			continue
		}
		if m := reMDHead.FindStringSubmatch(line); m != nil {
			line = "*" + strings.TrimSpace(m[2]) + "*"
		}
		line = reMDLink.ReplaceAllString(line, "$1 ($2)")
		line = reMDBold.ReplaceAllString(line, "*$1*")
		line = reMDUBold.ReplaceAllString(line, "*$1*")
		line = reMDStrike.ReplaceAllString(line, "~$1~")
		line = reMDBullet.ReplaceAllString(line, "${1}- ")
		line = reMDNum.ReplaceAllString(line, "${1}- ")
		lines[i] = line
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}
