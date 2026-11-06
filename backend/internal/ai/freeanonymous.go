package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	freeAnonymousBase        = "https://www.freeanonymousai.com"
	freeAnonymousPageURL     = freeAnonymousBase + "/chat/general"
	freeAnonymousGenerateURL = freeAnonymousBase + "/api/generate"
)

// freeAnonymousCookies keeps the anonymous session cookie produced by the site.
var freeAnonymousCookies = &cookieJarStore{values: make(map[string]string)}

type freeAnonymousGenerateRequest struct {
	Prompt         string   `json:"prompt"`
	Tool           string   `json:"tool"`
	Attachments    []any    `json:"attachments"`
	History        []any    `json:"history"`
	SelectedModel  string   `json:"selectedModel,omitempty"`
	Thinking       bool     `json:"thinking"`
	Search         bool     `json:"search"`
	Stream         bool     `json:"stream"`
}

type freeAnonymousJSON struct {
	Output     string `json:"output"`
	Type       string `json:"type"`
	Model      string `json:"model"`
	Error      string `json:"error"`
	Upgrade    bool   `json:"upgrade"`
	NeedsImage bool   `json:"needsImage"`
}

// book_generateFreeAnonymous
//
// generateFreeAnonymous sends one prompt to the Free Anonymous AI router and
// returns the buffered text answer. The public model is an auto-router, so the
// reported model name is intentionally not returned to callers: na-api exposes
// a single stable ID for this provider.
func generateFreeAnonymous(ctx context.Context, prompt string) (string, error) {
	var lastErr error

	for attempt := 0; attempt < 2; attempt++ {
		cookie := freeAnonymousCookies.header("freeanonymous")
		if cookie == "" {
			if refreshErr := refreshFreeAnonymousSession(ctx); refreshErr != nil {
				lastErr = refreshErr
				continue
			}
			cookie = freeAnonymousCookies.header("freeanonymous")
		}

		payload := freeAnonymousGenerateRequest{
			Prompt:        prompt,
			Tool:          "auto",
			Attachments:   []any{},
			History:       []any{},
			SelectedModel: "auto",
			Thinking:      false,
			Search:        false,
			Stream:        false,
		}

		headers := map[string]string{
			"Origin":  freeAnonymousBase,
			"Referer": freeAnonymousPageURL,
			"Accept":  "application/json, text/plain, */*",
		}
		if cookie != "" {
			headers["Cookie"] = cookie
		}

		resp, err := webclient.PostJSON(ctx, freeAnonymousGenerateURL, payload, headers)
		if err != nil {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			lastErr = err
			continue
		}

		freeAnonymousCookies.save("freeanonymous", resp)

		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
			body, _ := readBodyString(resp)
			resp.Body.Close()
			lastErr = fmt.Errorf("Free Anonymous AI: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(body))
			// A new session sometimes helps, but do not hammer the endpoint.
			_ = refreshFreeAnonymousSession(ctx)
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := readBodyString(resp)
			resp.Body.Close()
			lastErr = fmt.Errorf("Free Anonymous AI: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(body))
			if resp.StatusCode == http.StatusBadRequest && attempt == 0 {
				_ = refreshFreeAnonymousSession(ctx)
				continue
			}
			return "", lastErr
		}

		contentType := resp.Header.Get("Content-Type")
		if strings.Contains(contentType, "application/json") {
			var result freeAnonymousJSON
			decodeErr := json.NewDecoder(resp.Body).Decode(&result)
			resp.Body.Close()
			if decodeErr != nil {
				lastErr = fmt.Errorf("Free Anonymous AI: respons JSON tidak valid: %w", decodeErr)
				continue
			}
			if result.Error != "" {
				lastErr = fmt.Errorf("Free Anonymous AI: %s", result.Error)
				if result.Upgrade {
					lastErr = fmt.Errorf("Free Anonymous AI: batas penggunaan gratis tercapai")
				}
				if attempt == 0 {
					_ = refreshFreeAnonymousSession(ctx)
					continue
				}
				return "", lastErr
			}
			text := strings.TrimSpace(result.Output)
			if text == "" {
				lastErr = fmt.Errorf("Free Anonymous AI: respons kosong")
				continue
			}
			return text, nil
		}

		body, readErr := readBodyString(resp)
		resp.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("Free Anonymous AI: gagal membaca respons: %w", readErr)
			continue
		}
		text := strings.TrimSpace(body)
		if text == "" {
			lastErr = fmt.Errorf("Free Anonymous AI: respons kosong")
			continue
		}
		return text, nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("Free Anonymous AI: gagal tanpa pesan error")
	}
	return "", lastErr
}

// book_refreshFreeAnonymousSession
func refreshFreeAnonymousSession(ctx context.Context) error {
	resp, err := webclient.Get(ctx, freeAnonymousPageURL, map[string]string{
		"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	})
	if err != nil {
		return fmt.Errorf("Free Anonymous AI: gagal membuka sesi: %w", err)
	}
	freeAnonymousCookies.save("freeanonymous", resp)
	_, _ = webclient.ReadBody(resp)
	return nil
}

func readBodyString(resp *http.Response) (string, error) {
	return webclient.ReadBody(resp)
}
