package ai

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/aimodels"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// chatCreated is the process start timestamp reported in OpenAI responses,
// mirroring the module-level CREATED constant in the Next.js route.
var chatCreated = time.Now().Unix()

const defaultRequestTimeout = 55 * time.Second

// chatRequest is the accepted OpenAI Chat Completions request body.
type chatRequest struct {
	Model    string            `json:"model"`
	Messages []openAIMessage   `json:"messages"`
	Stream   json.RawMessage   `json:"stream"`
	Tools    []json.RawMessage `json:"tools"`
}

// chatResponseMessage is the assistant message of a non-streaming response.
type chatResponseMessage struct {
	Role             string                 `json:"role"`
	Content          *string                `json:"content"`
	ReasoningContent string                 `json:"reasoning_content,omitempty"`
	ToolCalls        []chatResponseToolCall `json:"tool_calls,omitempty"`
}

type chatResponseToolCall struct {
	ID       string               `json:"id"`
	Type     string               `json:"type"`
	Function chatResponseFunction `json:"function"`
}

type chatResponseFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type chatResponseChoice struct {
	Index        int                 `json:"index"`
	Message      chatResponseMessage `json:"message"`
	FinishReason string              `json:"finish_reason"`
}

type chatUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type chatResponse struct {
	ID      string               `json:"id"`
	Object  string               `json:"object"`
	Created int64                `json:"created"`
	Model   string               `json:"model"`
	Choices []chatResponseChoice `json:"choices"`
	Usage   chatUsage            `json:"usage"`
}

type chatStreamChunk struct {
	ID      string             `json:"id"`
	Object  string             `json:"object"`
	Created int64              `json:"created"`
	Model   string             `json:"model"`
	Choices []chatStreamChoice `json:"choices"`
}

type chatStreamChoice struct {
	Index        int     `json:"index"`
	Delta        any     `json:"delta"`
	FinishReason *string `json:"finish_reason"`
}

type chatStreamDelta struct {
	Role             string               `json:"role,omitempty"`
	Content          *string              `json:"content,omitempty"`
	ReasoningContent string               `json:"reasoning_content,omitempty"`
	ToolCalls        []chatStreamToolCall `json:"tool_calls,omitempty"`
}

type chatStreamToolCall struct {
	Index    int                    `json:"index"`
	ID       string                 `json:"id,omitempty"`
	Type     string                 `json:"type,omitempty"`
	Function chatStreamToolFunction `json:"function"`
}

type chatStreamToolFunction struct {
	Name      string  `json:"name,omitempty"`
	Arguments *string `json:"arguments,omitempty"`
}

// parseStream reproduces the JS truthiness check: true, "true", 1 and "1".
func parseStream(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true" || typed == "1"
	case float64:
		return typed == 1
	default:
		return false
	}
}

func newCompletionID() string {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return "chatcmpl-000000000000000000000000"
	}
	return "chatcmpl-" + hex.EncodeToString(buffer)
}

func (h *handlers) requestTimeout() time.Duration {
	if h.deps != nil && h.deps.Config != nil && h.deps.Config.RequestTimeout > 0 {
		return h.deps.Config.RequestTimeout
	}
	return defaultRequestTimeout
}

// autoChain reads the admin-configured fallback chain, defaulting safely when
// settings are unavailable.
func (h *handlers) autoChain(ctx context.Context) []string {
	if h.deps == nil || h.deps.Settings == nil {
		return append([]string(nil), aimodels.ChainDefault...)
	}
	return h.deps.Settings.AutoChain(ctx)
}

// isPortedModel reports whether the Go backend implements a provider.
func isPortedModel(id string) bool {
	return id == "gemini-3.6-flash" || id == "gemini"
}

// isUnavailableModel reports provider IDs kept in /api/models but not ported
// (EaseMate needs WASM signing, QuillBot needs a Cloudflare bypass).
func isUnavailableModel(id string) bool {
	return id == "gemini-1.5-flash" || id == "gpt-4.1-mini"
}

// candidateIDs resolves the models to try. Auto chains skip unported models;
// the remaining ported providers are appended in registry order so the chain
// still has a working fallback when the admin list only mentions EaseMate or
// QuillBot.
func candidateIDs(model string, chain []string) []string {
	if model != "auto" {
		return []string{model}
	}
	candidates := make([]string, 0, len(chain))
	seen := make(map[string]bool, len(chain))
	for _, id := range aimodels.NormalizeChain(chain) {
		if isPortedModel(id) && !seen[id] {
			seen[id] = true
			candidates = append(candidates, id)
		}
	}
	for _, id := range []string{"gemini-3.6-flash", "gemini"} {
		if !seen[id] {
			candidates = append(candidates, id)
		}
	}
	return candidates
}

// generateOne invokes one ported provider.
func (h *handlers) generateOne(ctx context.Context, modelID, prompt string) (string, error) {
	switch modelID {
	case "gemini-3.6-flash":
		text, _, err := generateGemini(ctx, prompt, 0)
		return text, err
	case "gemini":
		return generateGeminiShare(ctx, prompt)
	default:
		return "", fmt.Errorf("Model %s belum tersedia di backend Go", modelID)
	}
}

// generate walks the candidate chain. A candidate is rejected on error or on
// empty text, matching runChainGenerate.
func (h *handlers) generate(ctx context.Context, candidates []string, auto bool, prompt string) (string, string, error) {
	var lastErr error
	for index, modelID := range candidates {
		text, err := h.generateOne(ctx, modelID, prompt)
		if err == nil && strings.TrimSpace(text) != "" {
			return text, modelID, nil
		}
		if err == nil {
			err = fmt.Errorf("%s mengembalikan konten kosong", modelID)
		}
		if !auto {
			return "", "", err
		}
		lastErr = err
		if index+1 < len(candidates) {
			log.Printf("[auto] %s gagal (%q), lanjut ke %s", modelID, err.Error(), candidates[index+1])
		} else {
			log.Printf("[auto] %s gagal (%q), semua provider habis", modelID, err.Error())
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("tidak ada kandidat")
	}
	return "", "", fmt.Errorf("Semua provider rantai auto gagal (%v)", lastErr)
}

// chatInfo serves GET /api/chat/completions (endpoint discovery document).
func (h *handlers) chatInfo(w http.ResponseWriter, _ *http.Request) {
	httpx.OK(w, map[string]any{
		"endpoint":   "/api/chat/completions",
		"compatible": "OpenAI Chat Completions API",
		"models":     aimodels.IDs(),
		"features":   []string{"multi-turn", "streaming-sse", "reasoning_content", "function-calling (morphxml protocol — cocok untuk tugas sederhana)"},
		"usage": map[string]any{
			"method": "POST",
			"body": map[string]any{
				"model":       strings.Join(aimodels.IDs(), " | ") + " (default auto: rantai fallback dinamis dari panel admin)",
				"messages":    "[{role: system|user|assistant|tool, content}]",
				"stream":      "boolean (opsional)",
				"tools":       `[{type:"function", function:{name, description, parameters}}] (opsional)`,
				"tool_choice": "diabaikan (kompatibilitas OpenAI saja)",
			},
			"curl": `curl -X POST http://localhost:8080/api/chat/completions -H "Content-Type: application/json" -d '{"model":"auto","messages":[{"role":"user","content":"halo"}]}'`,
		},
		"note": "Function calling diemulasi via prompt injection (MorphXML protocol — XML element per function call). Cocok untuk tugas sederhana seperti pencarian, fetch, cuaca, translate. Bukan untuk coding kompleks.",
	})
}

// chatCompletions serves POST /api/chat/completions.
func (h *handlers) chatCompletions(w http.ResponseWriter, r *http.Request) {
	httpx.SetNoStore(w)

	var request chatRequest
	if err := httpx.DecodeJSON(r, &request); err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]any{"message": "Invalid JSON body", "type": "invalid_request_error"},
		})
		return
	}
	if len(request.Messages) == 0 {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]any{"message": "'messages' wajib berupa array non-kosong", "type": "invalid_request_error"},
		})
		return
	}

	model := strings.TrimSpace(request.Model)
	if model == "" || !aimodels.IsKnown(model) {
		model = "auto"
	}
	if isUnavailableModel(model) {
		httpx.JSON(w, http.StatusBadGateway, map[string]any{
			"success": false,
			"error":   "Model " + model + " belum tersedia di backend Go",
			"status":  http.StatusBadGateway,
		})
		return
	}

	tools := parseToolDefinitions(request.Tools)
	toolsEnabled := len(tools) > 0
	instructions, convo := splitChatMessages(request.Messages, toolsEnabled)
	if toolsEnabled {
		prompt := toolsSystemPrompt(tools)
		if instructions == "" {
			instructions = prompt
		} else {
			instructions += "\n\n" + prompt
		}
	}
	prompt := flattenPrompt(instructions, convo)

	auto := model == "auto"
	var chain []string
	if auto {
		chain = h.autoChain(r.Context())
	}
	candidates := candidateIDs(model, chain)

	if parseStream(request.Stream) {
		h.streamCompletion(w, r, model, candidates, auto, prompt, tools)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.requestTimeout())
	defer cancel()

	text, used, err := h.generate(ctx, candidates, auto, prompt)
	if err != nil {
		log.Printf("[chat] generation failed (model=%s): %v", model, err)
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": map[string]any{"message": err.Error(), "type": "internal_error"},
		})
		return
	}

	content, calls := parseToolOutput(text, tools)
	message := chatResponseMessage{Role: "assistant"}
	if content != "" {
		message.Content = &content
	}
	if len(calls) > 0 {
		message.ToolCalls = make([]chatResponseToolCall, 0, len(calls))
		for _, call := range calls {
			message.ToolCalls = append(message.ToolCalls, chatResponseToolCall{
				ID:       newToolCallID(),
				Type:     "function",
				Function: chatResponseFunction{Name: call.Name, Arguments: call.Arguments},
			})
		}
	}
	finishReason := "stop"
	if len(calls) > 0 {
		finishReason = "tool_calls"
	}
	if !auto {
		used = model
	}
	promptTokens := countTokens(prompt)
	completionTokens := countTokens(text)
	httpx.OK(w, chatResponse{
		ID:      newCompletionID(),
		Object:  "chat.completion",
		Created: chatCreated,
		Model:   used,
		Choices: []chatResponseChoice{{
			Index:        0,
			Message:      message,
			FinishReason: finishReason,
		}},
		Usage: chatUsage{
			PromptTokens:     promptTokens,
			CompletionTokens: completionTokens,
			TotalTokens:      promptTokens + completionTokens,
		},
	})
}

// streamCompletion emits the OpenAI SSE chunk sequence. Generation is buffered
// (all ported providers are buffered), so keep-alive reasoning chunks are sent
// every two seconds while the fallback chain is still running.
func (h *handlers) streamCompletion(
	w http.ResponseWriter,
	r *http.Request,
	model string,
	candidates []string,
	auto bool,
	prompt string,
	tools []toolDef,
) {
	flusher, ok := httpx.StartSSE(w)
	if !ok {
		return
	}
	id := newCompletionID()
	reportedModel := model

	ctx, cancel := context.WithTimeout(r.Context(), h.requestTimeout())
	defer cancel()

	type outcome struct {
		text string
		used string
		err  error
	}
	results := make(chan outcome, 1)
	go func() {
		text, used, err := h.generate(ctx, candidates, auto, prompt)
		results <- outcome{text: text, used: used, err: err}
	}()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	var result outcome
	waited := 0
	waiting := true
	for waiting {
		select {
		case result = <-results:
			waiting = false
		case <-ticker.C:
			waited++
			dots := strings.Repeat(".", min(waited, 6))
			delta := chatStreamDelta{ReasoningContent: "[menunggu respons provider " + dots + "]"}
			if err := writeChatChunk(w, flusher, id, reportedModel, delta, nil); err != nil {
				return
			}
		case <-ctx.Done():
			result = outcome{err: ctx.Err()}
			waiting = false
		}
	}

	if result.err != nil {
		log.Printf("[chat] stream generation failed (model=%s): %v", model, result.err)
		// The Next.js route marks the stream closed after the error chunk, so no
		// finish chunk or [DONE] follows (same observable behaviour).
		_ = writeSSEPayload(w, flusher, map[string]any{
			"error": map[string]any{"message": result.err.Error(), "type": "internal_error"},
		})
		return
	}
	if result.used != "" {
		reportedModel = result.used
	}

	empty := ""
	if err := writeChatChunk(w, flusher, id, reportedModel, chatStreamDelta{Role: "assistant", Content: &empty}, nil); err != nil {
		return
	}
	content, calls := parseToolOutput(result.text, tools)
	if content != "" {
		value := content
		if err := writeChatChunk(w, flusher, id, reportedModel, chatStreamDelta{Content: &value}, nil); err != nil {
			return
		}
	}
	for index, call := range calls {
		start := ""
		startChunk := chatStreamDelta{ToolCalls: []chatStreamToolCall{{
			Index:    index,
			ID:       newToolCallID(),
			Type:     "function",
			Function: chatStreamToolFunction{Name: call.Name, Arguments: &start},
		}}}
		if err := writeChatChunk(w, flusher, id, reportedModel, startChunk, nil); err != nil {
			return
		}
		arguments := call.Arguments
		deltaChunk := chatStreamDelta{ToolCalls: []chatStreamToolCall{{
			Index:    index,
			Function: chatStreamToolFunction{Arguments: &arguments},
		}}}
		if err := writeChatChunk(w, flusher, id, reportedModel, deltaChunk, nil); err != nil {
			return
		}
	}

	finish := "stop"
	if len(calls) > 0 {
		finish = "tool_calls"
	}
	if err := writeChatChunk(w, flusher, id, reportedModel, struct{}{}, &finish); err != nil {
		return
	}
	_ = writeSSEDone(w, flusher)
}

// writeChatChunk writes one chat.completion.chunk SSE event.
func writeChatChunk(w http.ResponseWriter, flusher http.Flusher, id, model string, delta any, finish *string) error {
	payload := chatStreamChunk{
		ID:      id,
		Object:  "chat.completion.chunk",
		Created: chatCreated,
		Model:   model,
		Choices: []chatStreamChoice{{Index: 0, Delta: delta, FinishReason: finish}},
	}
	return writeSSEPayload(w, flusher, payload)
}

func writeSSEPayload(w http.ResponseWriter, flusher http.Flusher, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", encoded); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func writeSSEDone(w http.ResponseWriter, flusher http.Flusher) error {
	if _, err := fmt.Fprint(w, "data: [DONE]\n\n"); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}
