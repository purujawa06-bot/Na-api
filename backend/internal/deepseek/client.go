package deepseek

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	deepSeekBaseURL = "https://chat.deepseek.com"

	powChallengePath   = "/api/v0/chat/create_pow_challenge"
	powCompletionPath  = "/api/v0/chat/completion"
	powUploadPath      = "/api/v0/file/upload_file"
	createSessionPath  = "/api/v0/chat_session/create"
	invalidPowBizCode  = 40301
	maxUpstreamSnippet = 300
)

// bizResponse is the envelope chat.deepseek.com wraps every API result in:
// the meaningful status lives in data.biz_code, not the outer code.
type bizResponse struct {
	bizCode int
	bizData json.RawMessage
	hasData bool
	raw     []byte
}

// parseBizResponse decodes an upstream body without failing on unexpected
// shapes, so the caller can surface the raw snippet like the JS client does.
func parseBizResponse(raw []byte) bizResponse {
	var envelope struct {
		Data *struct {
			BizCode int             `json:"biz_code"`
			BizData json.RawMessage `json:"biz_data"`
		} `json:"data"`
	}
	response := bizResponse{raw: raw}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return response
	}
	if envelope.Data != nil {
		response.hasData = true
		response.bizCode = envelope.Data.BizCode
		response.bizData = envelope.Data.BizData
	}
	return response
}

// succeeded reports whether the business status marks a successful call.
func (b bizResponse) succeeded() bool { return b.hasData && b.bizCode == 0 }

// fail builds the prefixed error message used by the JS client, including a
// truncated copy of the upstream body for debugging.
func (b bizResponse) fail(prefix string) error {
	return fmt.Errorf("%s: %s", prefix, snippet(b.raw))
}

// snippet trims a payload and caps it at 300 bytes.
func snippet(raw []byte) string {
	trimmed := strings.TrimSpace(string(raw))
	if len(trimmed) > maxUpstreamSnippet {
		return trimmed[:maxUpstreamSnippet]
	}
	return trimmed
}

// powCacheEntry holds a ready-to-use x-ds-pow-response header.
type powCacheEntry struct {
	header    string
	expiresAt time.Time
}

// client is a pure-HTTP chat.deepseek.com client. It owns its http.Client
// because the shared webclient timeout (45s) would cut streaming completions.
type client struct {
	http     *http.Client
	baseURL  string
	mu       sync.Mutex
	powCache map[string]powCacheEntry
}

// newClient creates a client with an empty PoW challenge cache.
func newClient() *client {
	return &client{http: &http.Client{}, baseURL: deepSeekBaseURL, powCache: make(map[string]powCacheEntry)}
}

// headers builds the browser-like headers chat.deepseek.com expects.
func deepSeekHeaders(token string, jsonBody bool) map[string]string {
	headers := map[string]string{
		"Authorization":      "Bearer " + token,
		"User-Agent":         webclient.UserAgentChrome,
		"x-client-locale":    "en_US",
		"x-client-version":   "2.4.0",
		"x-client-platform":  "web",
		"x-client-bundle-id": "com.deepseek.chat",
		"Origin":             deepSeekBaseURL,
		"Referer":            deepSeekBaseURL + "/",
	}
	if jsonBody {
		headers["Content-Type"] = "application/json"
	}
	return headers
}

// cachedPowHeader returns a cached header when it has not expired yet.
func (c *client) cachedPowHeader(key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.powCache[key]
	if !ok || !time.Now().Before(entry.expiresAt) {
		return "", false
	}
	return entry.header, true
}

// storePowHeader caches a header until 60s before the challenge expires.
func (c *client) storePowHeader(key, header string, expireAtMS int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.powCache[key] = powCacheEntry{
		header:    header,
		expiresAt: time.UnixMilli(expireAtMS - powSafetyMS),
	}
}

// dropPowHeader invalidates a cached header after upstream rejected it.
func (c *client) dropPowHeader(key string) {
	c.mu.Lock()
	delete(c.powCache, key)
	c.mu.Unlock()
}

// powHeader returns a solved x-ds-pow-response header for targetPath,
// reusing the cache when the challenge is still valid.
func (c *client) powHeader(ctx context.Context, token, targetPath string) (string, error) {
	key := token + ":" + targetPath
	if header, ok := c.cachedPowHeader(key); ok {
		return header, nil
	}

	challengePayload := struct {
		TargetPath string `json:"target_path"`
	}{TargetPath: targetPath}
	raw, err := c.postJSON(ctx, c.baseURL+powChallengePath, token, challengePayload)
	if err != nil {
		return "", fmt.Errorf("pow challenge gagal: %w", err)
	}
	response := parseBizResponse(raw)
	if !response.succeeded() {
		return "", response.fail("pow challenge gagal")
	}

	var solved struct {
		Challenge powChallenge `json:"challenge"`
	}
	if err := json.Unmarshal(response.bizData, &solved); err != nil {
		return "", fmt.Errorf("pow challenge gagal: invalid challenge payload: %w", err)
	}
	challenge := solved.Challenge
	answer, err := solvePow(ctx, challenge)
	if err != nil {
		return "", fmt.Errorf("pow challenge gagal: %w", err)
	}
	header, err := buildPowHeader(challenge, answer)
	if err != nil {
		return "", err
	}
	c.storePowHeader(key, header, challenge.ExpireAt)
	return header, nil
}

// buildPowHeader base64-encodes the solved challenge the way the web client
// sends it. Field order matches the JS JSON.stringify output.
func buildPowHeader(challenge powChallenge, answer int64) (string, error) {
	payload := struct {
		Algorithm  string `json:"algorithm"`
		Challenge  string `json:"challenge"`
		Salt       string `json:"salt"`
		Answer     int64  `json:"answer"`
		Signature  string `json:"signature"`
		TargetPath string `json:"target_path"`
	}{
		Algorithm:  challenge.Algorithm,
		Challenge:  challenge.Challenge,
		Salt:       challenge.Salt,
		Answer:     answer,
		Signature:  challenge.Signature,
		TargetPath: challenge.TargetPath,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("pow header encoding failed: %w", err)
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// postJSON sends a JSON POST and returns the raw response body.
func (c *client) postJSON(ctx context.Context, url, token string, payload any) ([]byte, error) {
	resp, err := webclient.PostJSON(ctx, url, payload, deepSeekHeaders(token, true))
	if err != nil {
		return nil, err
	}
	body, err := webclient.ReadBody(resp)
	if err != nil {
		return nil, err
	}
	return []byte(body), nil
}

// createSession opens a new chat session and returns its id.
func (c *client) createSession(ctx context.Context, token string) (string, error) {
	raw, err := c.postJSON(ctx, c.baseURL+createSessionPath, token, struct{}{})
	if err != nil {
		return "", fmt.Errorf("create session gagal: %w", err)
	}
	response := parseBizResponse(raw)
	if !response.succeeded() {
		return "", response.fail("create session gagal")
	}
	var payload struct {
		ChatSession struct {
			ID string `json:"id"`
		} `json:"chat_session"`
	}
	if err := json.Unmarshal(response.bizData, &payload); err != nil {
		return "", fmt.Errorf("create session gagal: invalid payload: %w", err)
	}
	if payload.ChatSession.ID == "" {
		return "", errors.New("create session gagal: chat session id missing")
	}
	return payload.ChatSession.ID, nil
}

// uploadedFile is the subset of the upload response the chat flow needs.
type uploadedFile struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// uploadFile uploads an image for the vision flow (multipart field "file").
// A rejected PoW (biz code 40301) drops the cached challenge and retries once.
func (c *client) uploadFile(ctx context.Context, token string, data []byte, filename, contentType string) (uploadedFile, error) {
	key := token + ":" + powUploadPath
	for attempt := 1; attempt <= 2; attempt++ {
		pow, err := c.powHeader(ctx, token, powUploadPath)
		if err != nil {
			return uploadedFile{}, err
		}
		raw, err := c.postMultipartFile(ctx, token, data, filename, contentType, pow)
		if err != nil {
			return uploadedFile{}, fmt.Errorf("upload file gagal: %w", err)
		}
		response := parseBizResponse(raw)
		if response.bizCode == invalidPowBizCode && attempt < 2 {
			c.dropPowHeader(key)
			continue
		}
		if !response.succeeded() {
			return uploadedFile{}, response.fail("upload file gagal")
		}
		var uploaded uploadedFile
		if err := json.Unmarshal(response.bizData, &uploaded); err != nil {
			return uploadedFile{}, fmt.Errorf("upload file gagal: invalid payload: %w", err)
		}
		return uploaded, nil
	}
	return uploadedFile{}, errors.New("upload file gagal: PoW retry habis")
}

// postMultipartFile streams the image as multipart/form-data with the extra
// headers that make DeepSeek treat the file as a vision attachment.
func (c *client) postMultipartFile(ctx context.Context, token string, data []byte, filename, contentType, pow string) ([]byte, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escapeQuotes(filename)))
	partHeader.Set("Content-Type", contentType)
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(data); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+powUploadPath, &body)
	if err != nil {
		return nil, err
	}
	headers := deepSeekHeaders(token, false)
	headers["Content-Type"] = writer.FormDataContentType()
	headers["x-ds-pow-response"] = pow
	headers["x-file-size"] = strconv.Itoa(len(data))
	headers["x-model-type"] = "vision"
	headers["x-thinking-enabled"] = "1"
	headers["x-client-timezone-offset"] = timezoneOffsetSeconds()
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	raw, err := webclient.ReadBody(resp)
	if err != nil {
		return nil, err
	}
	return []byte(raw), nil
}

// escapeQuotes escapes a filename for a multipart Content-Disposition header.
func escapeQuotes(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	return strings.ReplaceAll(value, `"`, `\"`)
}

// timezoneOffsetSeconds returns seconds east of UTC, matching
// -new Date().getTimezoneOffset() * 60 in the JS client.
func timezoneOffsetSeconds() string {
	_, offset := time.Now().Zone()
	return strconv.Itoa(offset)
}

// completionOptions describes one chat turn.
type completionOptions struct {
	Token           string
	ChatID          string
	ParentID        any
	ModelType       string
	Prompt          any
	RefFileIDs      []string
	ThinkingEnabled bool
	SearchEnabled   bool
}

// completionPayload mirrors the JSON body the JS client posts.
type completionPayload struct {
	ChatSessionID   string   `json:"chat_session_id"`
	ParentMessageID any      `json:"parent_message_id"`
	ModelType       string   `json:"model_type"`
	Prompt          any      `json:"prompt"`
	RefFileIDs      []string `json:"ref_file_ids"`
	ThinkingEnabled bool     `json:"thinking_enabled"`
	SearchEnabled   bool     `json:"search_enabled"`
	Action          any      `json:"action"`
	Preempt         bool     `json:"preempt"`
}

// turnMeta collects the assistant message id needed to continue the chat.
type turnMeta struct {
	MessageID any
}

// deltaKind tells reasoning text apart from the final answer.
type deltaKind int

const (
	deltaReasoning deltaKind = iota
	deltaContent
)

// delta is one incremental piece of a chat turn.
type delta struct {
	Kind deltaKind
	Text string
}

// streamTurn posts one completion turn and feeds the parsed SSE fragments to
// emit. A rejected PoW (biz code 40301) re-solves once. Errors returned here
// are upstream/protocol failures; validation lives in the handler layer.
func (c *client) streamTurn(ctx context.Context, opts completionOptions, meta *turnMeta, emit func(delta) error) error {
	key := opts.Token + ":" + powCompletionPath
	payload := completionPayload{
		ChatSessionID:   opts.ChatID,
		ParentMessageID: opts.ParentID,
		ModelType:       opts.ModelType,
		Prompt:          opts.Prompt,
		RefFileIDs:      opts.RefFileIDs,
		ThinkingEnabled: opts.ThinkingEnabled,
		SearchEnabled:   opts.SearchEnabled,
		Action:          nil,
		Preempt:         false,
	}
	if payload.RefFileIDs == nil {
		payload.RefFileIDs = []string{}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("completion payload encoding failed: %w", err)
	}

	for attempt := 1; attempt <= 2; attempt++ {
		pow, err := c.powHeader(ctx, opts.Token, powCompletionPath)
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+powCompletionPath, bytes.NewReader(body))
		if err != nil {
			return err
		}
		headers := deepSeekHeaders(opts.Token, true)
		headers["x-ds-pow-response"] = pow
		headers["Referer"] = fmt.Sprintf("%s/a/chat/s/%s", c.baseURL, opts.ChatID)
		for header, value := range headers {
			req.Header.Set(header, value)
		}

		resp, err := c.http.Do(req)
		if err != nil {
			return fmt.Errorf("completion request failed: %w", err)
		}
		if resp.StatusCode == http.StatusUnauthorized {
			resp.Body.Close()
			return errors.New("userID (token DeepSeek) tidak valid/kadaluarsa")
		}
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			upstreamBody, _ := webclient.ReadBody(resp)
			return fmt.Errorf("completion HTTP %d: %s", resp.StatusCode, snippet([]byte(upstreamBody)))
		}

		// Business errors arrive as HTTP 200 with a JSON body instead of SSE.
		if strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
			upstreamBody, _ := webclient.ReadBody(resp)
			var head struct {
				Code *int    `json:"code"`
				Msg  *string `json:"msg"`
			}
			_ = json.Unmarshal([]byte(upstreamBody), &head)
			if head.Code != nil && *head.Code == invalidPowBizCode && attempt < 2 {
				c.dropPowHeader(key)
				continue
			}
			codeLabel := "?"
			if head.Code != nil {
				codeLabel = strconv.Itoa(*head.Code)
			}
			message := "unknown"
			if head.Msg != nil {
				message = *head.Msg
			}
			return fmt.Errorf("completion gagal (biz %s): %s", codeLabel, message)
		}

		parseErr := parseCompletionStream(resp.Body, meta, emit)
		resp.Body.Close()
		return parseErr
	}
	return errors.New("completion gagal: PoW retry habis")
}

// streamFragment is one fragment object inside a completion event.
type streamFragment struct {
	Type    *string `json:"type"`
	Content *string `json:"content"`
}

// fragmentType returns the fragment type or the JS default.
func fragmentType(fragment streamFragment) string {
	if fragment.Type == nil {
		return "RESPONSE"
	}
	return *fragment.Type
}

// kindFor maps a fragment type to a delta kind.
func kindFor(fragmentType string) deltaKind {
	if fragmentType == "THINK" {
		return deltaReasoning
	}
	return deltaContent
}

// emitFragment forwards a fragment's content when it is non-empty.
func emitFragment(fragment streamFragment, emit func(delta) error) error {
	if fragment.Content == nil || *fragment.Content == "" {
		return nil
	}
	return emit(delta{Kind: kindFor(fragmentType(fragment)), Text: *fragment.Content})
}

// parseCompletionStream consumes the SSE body line by line and understands the
// same four event shapes as the JS client: full snapshots, "APPEND" batches,
// explicit deltas for the last fragment, and bare string deltas.
func parseCompletionStream(body io.Reader, meta *turnMeta, emit func(delta) error) error {
	reader := bufio.NewReader(body)
	lastFragmentType := "RESPONSE"
	for {
		line, readErr := reader.ReadString('\n')
		if strings.HasSuffix(line, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "data:") {
				if err := handleStreamLine(trimmed[len("data:"):], meta, &lastFragmentType, emit); err != nil {
					return err
				}
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return nil
			}
			return readErr
		}
	}
}

// handleStreamLine applies one "data:" payload to the turn state.
func handleStreamLine(payload string, meta *turnMeta, lastFragmentType *string, emit func(delta) error) error {
	var event struct {
		Value     json.RawMessage `json:"v"`
		Path      json.RawMessage `json:"p"`
		Operation string          `json:"o"`
	}
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return nil
	}
	if len(event.Value) == 0 {
		return nil
	}

	// Full snapshot (initial event and "ready"): carries the message id.
	if event.Value[0] == '{' {
		var snapshot struct {
			Response *struct {
				MessageID json.RawMessage  `json:"message_id"`
				Fragments []streamFragment `json:"fragments"`
			} `json:"response"`
		}
		if err := json.Unmarshal(event.Value, &snapshot); err == nil && snapshot.Response != nil {
			if messageID := jsonValueOrNil(snapshot.Response.MessageID); messageID != nil {
				meta.MessageID = messageID
			}
			if snapshot.Response.Fragments != nil {
				fragments := snapshot.Response.Fragments
				*lastFragmentType = "RESPONSE"
				if len(fragments) > 0 {
					*lastFragmentType = fragmentType(fragments[len(fragments)-1])
				}
				for _, fragment := range fragments {
					if err := emitFragment(fragment, emit); err != nil {
						return err
					}
				}
			}
			return nil
		}
	}

	// Newly appended fragments.
	if string(event.Path) == `"response/fragments"` && event.Operation == "APPEND" && event.Value[0] == '[' {
		var fragments []streamFragment
		if err := json.Unmarshal(event.Value, &fragments); err != nil {
			return nil
		}
		if len(fragments) > 0 {
			*lastFragmentType = fragmentType(fragments[len(fragments)-1])
		}
		for _, fragment := range fragments {
			if err := emitFragment(fragment, emit); err != nil {
				return err
			}
		}
		return nil
	}

	// Explicit delta for the last fragment ("response/fragments/-1/content...").
	if len(event.Path) > 0 && event.Path[0] == '"' {
		var path string
		if err := json.Unmarshal(event.Path, &path); err == nil &&
			strings.HasPrefix(path, "response/fragments/-1/content") {
			if text, ok := jsonStringValue(event.Value); ok {
				return emit(delta{Kind: kindFor(*lastFragmentType), Text: text})
			}
		}
		return nil
	}

	// Bare string delta without a path.
	if len(event.Path) == 0 && event.Value[0] == '"' {
		if text, ok := jsonStringValue(event.Value); ok {
			return emit(delta{Kind: kindFor(*lastFragmentType), Text: text})
		}
	}
	return nil
}

// jsonStringValue decodes a JSON string, reporting false for anything else.
func jsonStringValue(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

// jsonValueOrNil decodes a JSON value, treating null and absent as nil.
func jsonValueOrNil(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}
