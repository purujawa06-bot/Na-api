package ai

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

//go:embed gemini-freq-template.json
var geminiFreqTemplateRaw []byte

const (
	geminiBase       = "https://gemini.google.com"
	geminiStreamPath = "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
	geminiBatchURL   = geminiBase + "/_/BardChatUi/data/batchexecute?rpcids=L5adhe&source-path=%2Fapp&bl=boq_assistant-bard-web-server_20260821.03_p0&hl=id&rt=c"
	geminiStreamURL  = geminiBase + geminiStreamPath + "?bl=boq_assistant-bard-web-server_20260821.03_p0&f.sid=8086908132051073879&hl=id&_reqid=3129066&rt=c"
)

// geminiTemplate is the embedded StreamGenerate request skeleton.
type geminiTemplate struct {
	URL   string `json:"url"`
	Inner []any  `json:"inner"`
	At    string `json:"at"`
}

var (
	templateOnce sync.Once
	templateData geminiTemplate
	templateErr  error
	xsrfPattern  = regexp.MustCompile(`"48448350":\["xsrf","([^"]+)"`)
	// markdownLinkPattern matches [label](url) including one level of balanced
	// parentheses inside the URL, mirroring unwrapMarkdownUrls.
	markdownLinkPattern = regexp.MustCompile(`\[([^\[\]]*)\]\(((?:[^()]|\([^()]*\))*)\)`)
)

// loadTemplate decodes the embedded template exactly once.
func loadTemplate() (*geminiTemplate, error) {
	templateOnce.Do(func() {
		raw := strings.TrimPrefix(string(geminiFreqTemplateRaw), "\ufeff")
		if err := json.Unmarshal([]byte(raw), &templateData); err != nil {
			templateErr = fmt.Errorf("decode gemini frequency template: %w", err)
			return
		}
		if len(templateData.Inner) == 0 {
			templateErr = fmt.Errorf("gemini frequency template has no inner payload")
		}
	})
	if templateErr != nil {
		return nil, templateErr
	}
	return &templateData, nil
}

// cookieJar keeps upstream cookies within this process only. The Next.js
// backend persisted them in Firebase RTDB; a cookie-less request works too, so
// this is a best-effort optimisation.
type cookieJarStore struct {
	mu     sync.Mutex
	values map[string]string
}

var geminiCookies = &cookieJarStore{values: make(map[string]string)}

func (j *cookieJarStore) header(key string) string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.values[key]
}

func (j *cookieJarStore) save(key string, resp *http.Response) {
	if resp == nil {
		return
	}
	cookies := resp.Cookies()
	if len(cookies) == 0 {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	// Merge with the previous header so refreshed session cookies do not drop
	// unrelated ones.
	merged := make(map[string]string)
	for _, pair := range strings.Split(j.values[key], "; ") {
		if name, value, ok := strings.Cut(pair, "="); ok && name != "" {
			merged[name] = value
		}
	}
	for _, cookie := range cookies {
		if cookie.Name == "" {
			continue
		}
		merged[cookie.Name] = cookie.Value
	}
	names := make([]string, 0, len(merged))
	for name := range merged {
		names = append(names, name)
	}
	sort.Strings(names)
	parts := make([]string, 0, len(names))
	for _, name := range names {
		parts = append(parts, name+"="+merged[name])
	}
	j.values[key] = strings.Join(parts, "; ")
}

func geminiHeaders() map[string]string {
	return map[string]string{
		"User-Agent":                webclient.UserAgentChrome,
		"Origin":                    geminiBase,
		"Referer":                   geminiBase + "/",
		"x-goog-ext-73010989-jspb":  "[0]",
		"x-goog-ext-525001261-jspb": `[1,null,null,null,"fbb127bbb056c959",null,null,0,[4,5,6,8,4,5,6,8],null,null,1,null,null,1,1,"3DB078"]`,
		"x-goog-ext-525005358-jspb": `["4B235E08-4D33-462B-92FA-08C41A4C6AC8",1]`,
		"x-goog-ext-73010990-jspb":  "[0,0,0]",
		"Content-Type":              "application/x-www-form-urlencoded;charset=UTF-8",
	}
}

// buildGeminiFreq clones the template and injects the prompt.
func buildGeminiFreq(prompt string) ([]any, string, error) {
	template, err := loadTemplate()
	if err != nil {
		return nil, "", err
	}
	encoded, err := json.Marshal(template.Inner)
	if err != nil {
		return nil, "", fmt.Errorf("clone gemini template: %w", err)
	}
	var inner []any
	if err := json.Unmarshal(encoded, &inner); err != nil {
		return nil, "", fmt.Errorf("clone gemini template: %w", err)
	}
	first, ok := inner[0].([]any)
	if !ok || len(first) == 0 {
		return nil, "", fmt.Errorf("gemini template inner[0] is malformed")
	}
	first[0] = prompt
	inner[0] = first
	if len(inner) > 1 {
		inner[1] = []any{"id"}
	}
	return inner, template.At, nil
}

// setGeminiModel selects the L5adhe model code (0 = Flash-Lite, 1 = Flash).
// Failures are ignored: StreamGenerate may still honour the template default.
func setGeminiModel(ctx context.Context, code int, cookie string) {
	padding := make([]any, 95)
	padding[94] = 1
	if code != 0 && code != 1 {
		padding[94] = "NULL"
	}
	payload, err := json.Marshal([]any{padding, nil, []any{code}})
	if err != nil {
		return
	}
	freq, err := json.Marshal([]any{[]any{"L5adhe", string(payload), nil, "generic"}})
	if err != nil {
		return
	}
	form := url.Values{}
	form.Set("f.req", string(freq))
	headers := map[string]string{
		"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
		"User-Agent":   webclient.UserAgentChrome,
		"Origin":       geminiBase,
		"Referer":      geminiBase + "/",
	}
	if cookie != "" {
		headers["Cookie"] = cookie
	}
	resp, err := webclient.PostForm(ctx, geminiBatchURL, form, headers)
	if err != nil {
		log.Printf("[gemini] set model code %d failed: %v", code, err)
		return
	}
	geminiCookies.save("gemini-3.6-flash", resp)
	_, _ = webclient.ReadBody(resp)
}

// streamGenerate performs the StreamGenerate POST, retrying once with the
// xsrf token when Google answers 400.
func streamGenerate(ctx context.Context, inner []any, at, cookie string) (string, error) {
	innerJSON, err := json.Marshal(inner)
	if err != nil {
		return "", fmt.Errorf("encode gemini prompt: %w", err)
	}
	outer, err := json.Marshal([]any{nil, string(innerJSON)})
	if err != nil {
		return "", fmt.Errorf("encode gemini request: %w", err)
	}
	form := url.Values{}
	form.Set("f.req", string(outer))
	if at != "" {
		form.Set("at", at)
	}
	headers := geminiHeaders()
	if cookie != "" {
		headers["Cookie"] = cookie
	}

	resp, err := webclient.PostForm(ctx, geminiStreamURL, form, headers)
	if err != nil {
		return "", fmt.Errorf("StreamGenerate request: %w", err)
	}
	geminiCookies.save("gemini-3.6-flash", resp)

	if resp.StatusCode == http.StatusBadRequest {
		raw, readErr := webclient.ReadBody(resp)
		if readErr != nil {
			return "", fmt.Errorf("read StreamGenerate 400 body: %w", readErr)
		}
		match := xsrfPattern.FindStringSubmatch(raw)
		if len(match) != 2 {
			return "", webclient.StatusError("StreamGenerate", http.StatusBadRequest, raw)
		}
		form.Set("at", match[1])
		retry, retryErr := webclient.PostForm(ctx, geminiStreamURL, form, headers)
		if retryErr != nil {
			return "", fmt.Errorf("StreamGenerate retry: %w", retryErr)
		}
		geminiCookies.save("gemini-3.6-flash", retry)
		return readGeminiBody(retry)
	}
	return readGeminiBody(resp)
}

func readGeminiBody(resp *http.Response) (string, error) {
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, err := webclient.ReadBody(resp)
		if err != nil {
			return "", webclient.StatusError("StreamGenerate", resp.StatusCode, "")
		}
		return "", webclient.StatusError("StreamGenerate", resp.StatusCode, raw)
	}
	return webclient.ReadBody(resp)
}

// unwrapMarkdownUrls turns every [label](url) into label, repeatedly, until
// the string stops changing (nested links collapse to their inner label).
func unwrapMarkdownUrls(text string) string {
	result := text
	for iteration := 0; iteration < 100; iteration++ {
		replaced := markdownLinkPattern.ReplaceAllStringFunc(result, func(match string) string {
			groups := markdownLinkPattern.FindStringSubmatch(match)
			if len(groups) < 2 {
				return match
			}
			return groups[1]
		})
		if replaced == result {
			return replaced
		}
		result = replaced
	}
	return result
}

// parseGeminiResponse extracts the longest answer and the reported model name
// from a batchexecute-style response.
func parseGeminiResponse(text string) (modelName, answer string) {
	parts := regexp.MustCompile(`\n\d+\n`).Split(text, -1)
	if len(parts) > 1 {
		parts = parts[1:]
	}
	for _, part := range parts {
		first := strings.TrimSpace(strings.SplitN(part, "\n", 2)[0])
		if !strings.HasPrefix(first, "[") {
			continue
		}
		var entries []any
		if err := json.Unmarshal([]byte(first), &entries); err != nil {
			continue
		}
		for _, entry := range entries {
			fields, ok := entry.([]any)
			if !ok || len(fields) < 3 || fields[0] != "wrb.fr" {
				continue
			}
			payload, ok := fields[2].(string)
			if !ok {
				continue
			}
			var inner []any
			if err := json.Unmarshal([]byte(payload), &inner); err != nil {
				continue
			}
			if len(inner) > 42 {
				if name, ok := inner[42].(string); ok {
					modelName = name
				}
			}
			if candidate := nestedString(inner, 4, 0, 1, 0); len(candidate) > len(answer) {
				answer = candidate
			}
		}
	}
	return modelName, answer
}

// nestedString walks nested arrays by index and returns a string leaf.
func nestedString(value any, indexes ...int) string {
	current := value
	for _, index := range indexes {
		array, ok := current.([]any)
		if !ok || index < 0 || index >= len(array) {
			return ""
		}
		current = array[index]
	}
	text, _ := current.(string)
	return text
}

// generateGemini runs one full attempt (model select + StreamGenerate + parse)
// with one retry, matching generateGemini in lib/gemini-web.js.
func generateGemini(ctx context.Context, prompt string, modelCode int) (string, string, error) {
	var lastErr error
	for attempt := 1; attempt <= 2; attempt++ {
		text, modelName, err := attemptGemini(ctx, prompt, modelCode)
		if err == nil {
			return text, modelName, nil
		}
		lastErr = err
		if attempt < 2 {
			log.Printf("[gemini] attempt %d failed (%v), retrying with a fresh session", attempt, err)
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("gemini gagal tanpa pesan error")
	}
	return "", "", lastErr
}

func attemptGemini(ctx context.Context, prompt string, modelCode int) (string, string, error) {
	cookie := geminiCookies.header("gemini-3.6-flash")
	inner, at, err := buildGeminiFreq(prompt)
	if err != nil {
		return "", "", err
	}
	setGeminiModel(ctx, modelCode, cookie)
	if cookie == "" {
		// The model-selection request may have produced a session cookie.
		cookie = geminiCookies.header("gemini-3.6-flash")
	}
	raw, err := streamGenerate(ctx, inner, at, cookie)
	if err != nil {
		return "", "", err
	}
	modelName, answer := parseGeminiResponse(raw)
	clean := unwrapMarkdownUrls(answer)
	if strings.TrimSpace(clean) == "" {
		return "", "", fmt.Errorf("gemini mengembalikan konten kosong")
	}
	if modelName == "" {
		modelName = "gemini"
	}
	return clean, modelName, nil
}
