package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"sync/atomic"

	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

// defaultGeminiShareURL is used when GEMINI_SHARE_URL is not configured.
const defaultGeminiShareURL = "https://gemini.google.com/share/f9e70e37c645?skid=d2cbaf4c-1212-4c5e-a1cb-72c05df8129a"

// shareRequestCounter mirrors the per-process request id used by the JS client.
var shareRequestCounter atomic.Int64

func init() {
	shareRequestCounter.Store(1)
}

// shareID extracts the last path segment of the configured share URL.
func shareID() (string, error) {
	raw := os.Getenv("GEMINI_SHARE_URL")
	if raw == "" {
		raw = defaultGeminiShareURL
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("GEMINI_SHARE_URL tidak valid: %w", err)
	}
	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(segments) == 0 || segments[len(segments)-1] == "" {
		return "", fmt.Errorf("GEMINI_SHARE_URL tidak berisi /share/<id>")
	}
	return segments[len(segments)-1], nil
}

// generateGeminiShare chats inside a shared Gemini conversation, retrying once.
func generateGeminiShare(ctx context.Context, message string) (string, error) {
	id, err := shareID()
	if err != nil {
		return "", err
	}
	var lastErr error
	for attempt := 1; attempt <= 2; attempt++ {
		text, fetchErr := attemptGeminiShare(ctx, id, message)
		if fetchErr == nil {
			return text, nil
		}
		lastErr = fetchErr
		if attempt < 2 {
			log.Printf("[gemini] share attempt %d failed (%v), retrying", attempt, fetchErr)
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("gemini share gagal tanpa pesan error")
	}
	return "", lastErr
}

func attemptGeminiShare(ctx context.Context, id, message string) (string, error) {
	rpcID := "ujx1Bf"
	inner := `[null,"` + id + `",[4]]`
	if message != "" {
		rpcID = "q4uTj"
		payload, err := json.Marshal([]any{
			nil,
			messageContentsJSON(message),
			1,
			id,
		})
		if err != nil {
			return "", fmt.Errorf("encode gemini share prompt: %w", err)
		}
		inner = string(payload)
	}

	freq, err := json.Marshal([]any{[]any{[]any{rpcID, inner, nil, "generic"}}})
	if err != nil {
		return "", fmt.Errorf("encode gemini share request: %w", err)
	}
	form := url.Values{}
	form.Set("f.req", string(freq))

	requestID := shareRequestCounter.Add(1)
	endpoint := fmt.Sprintf(
		"https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=%s&source-path=%%2Fshare%%2F%s&bl=boq_assistant-bard-web-server_20260824.14_p0&f.sid=1&hl=en-US&_reqid=%d&rt=c",
		rpcID, url.PathEscape(id), requestID,
	)
	headers := map[string]string{
		"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
		"User-Agent":   webclient.UserAgentChrome,
		"Origin":       "https://gemini.google.com",
		"Referer":      "https://gemini.google.com/",
		"Accept":       "*/*",
	}
	if cookie := geminiCookies.header("gemini"); cookie != "" {
		headers["Cookie"] = cookie
	}

	resp, err := webclient.PostForm(ctx, endpoint, form, headers)
	if err != nil {
		return "", fmt.Errorf("Gemini Share request: %w", err)
	}
	geminiCookies.save("gemini", resp)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, readErr := webclient.ReadBody(resp)
		if readErr != nil {
			return "", webclient.StatusError("Gemini Share", resp.StatusCode, "")
		}
		return "", webclient.StatusError("Gemini Share", resp.StatusCode, raw)
	}
	raw, err := webclient.ReadBody(resp)
	if err != nil {
		return "", fmt.Errorf("read Gemini Share body: %w", err)
	}
	answer := extractShareAnswer(raw, rpcID)
	if strings.TrimSpace(answer) == "" {
		return "", fmt.Errorf("gemini share mengembalikan konten kosong")
	}
	return answer, nil
}

// messageContentsJSON builds the nested contents JSON string expected inside
// the q4uTj payload.
func messageContentsJSON(message string) string {
	contents, err := json.Marshal(map[string]any{
		"contents": []any{
			map[string]any{"parts": []any{map[string]any{"text": message}}},
		},
	})
	if err != nil {
		return "{}"
	}
	return string(contents)
}

// extractShareAnswer parses the matching wrb.fr line and returns the longest
// answer text. Transcript replies expose rc_* nodes; chat replies use the
// candidate parts shape.
func extractShareAnswer(rawText, rpcID string) string {
	prefix := `[["wrb.fr","` + rpcID + `"`
	answer := ""
	for _, line := range strings.Split(rawText, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		var top []any
		if err := json.Unmarshal([]byte(line), &top); err != nil || len(top) == 0 {
			continue
		}
		entry, ok := top[0].([]any)
		if !ok || len(entry) < 3 {
			continue
		}
		payload, ok := entry[2].(string)
		if !ok {
			continue
		}
		if rpcID == "ujx1Bf" {
			var inner any
			if err := json.Unmarshal([]byte(payload), &inner); err != nil {
				continue
			}
			if candidate := longestShareNode(inner); len(candidate) > len(answer) {
				answer = candidate
			}
			continue
		}
		var decoded any
		if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
			continue
		}
		if array, ok := decoded.([]any); ok && len(array) > 0 {
			if nested, ok := array[0].(string); ok {
				var object any
				if err := json.Unmarshal([]byte(nested), &object); err == nil {
					decoded = object
				}
			}
		}
		candidate := candidatePartsText(decoded)
		if strings.TrimSpace(candidate) != "" {
			return candidate
		}
	}
	return answer
}

// longestShareNode walks the transcript tree looking for ["rc_...", [strings]].
func longestShareNode(root any) string {
	best := ""
	stack := []any{root}
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		array, ok := current.([]any)
		if !ok {
			continue
		}
		if len(array) >= 2 {
			if name, ok := array[0].(string); ok && strings.HasPrefix(name, "rc_") {
				if parts, ok := array[1].([]any); ok {
					var builder strings.Builder
					for _, part := range parts {
						if text, ok := part.(string); ok {
							builder.WriteString(text)
						}
					}
					if builder.Len() > len(best) {
						best = builder.String()
					}
				}
			}
		}
		stack = append(stack, array...)
	}
	return best
}

// candidatePartsText extracts candidates[0].content.parts[*].text.
func candidatePartsText(value any) string {
	object, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	candidates, ok := object["candidates"].([]any)
	if !ok || len(candidates) == 0 {
		return ""
	}
	candidate, ok := candidates[0].(map[string]any)
	if !ok {
		return ""
	}
	content, ok := candidate["content"].(map[string]any)
	if !ok {
		return ""
	}
	parts, ok := content["parts"].([]any)
	if !ok {
		return ""
	}
	var builder strings.Builder
	for _, part := range parts {
		partObject, ok := part.(map[string]any)
		if !ok {
			continue
		}
		if text, ok := partObject["text"].(string); ok {
			builder.WriteString(text)
		}
	}
	return builder.String()
}
