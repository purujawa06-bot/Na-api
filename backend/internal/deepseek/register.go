// Package deepseek ports the chat.deepseek.com web client used by the
// /api/deepseek endpoints: DeepSeekHashV1 proof-of-work, pure-HTTP chat
// completion over SSE, multi-turn sessions, and vision file uploads.
package deepseek

import (
	"net/http"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// service bundles the dependencies shared by the DeepSeek handlers.
type service struct {
	deps   *app.Deps
	client *client
}

// Register mounts the DeepSeek endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	handler := &service{deps: deps, client: newClient()}
	mux.HandleFunc("POST /api/deepseek/instant", handler.handleInstant)
	mux.HandleFunc("POST /api/deepseek/reasoning", handler.handleReasoning)
	mux.HandleFunc("POST /api/deepseek/vision", handler.handleVision)
}

// requestTimeout bounds one request end to end.
func (s *service) requestTimeout() time.Duration {
	if s.deps != nil && s.deps.Config != nil && s.deps.Config.RequestTimeout > 0 {
		return s.deps.Config.RequestTimeout
	}
	return defaultRequestTimeout
}

// chatPreset holds the fixed options that distinguish the text endpoints.
type chatPreset struct {
	thinking      bool
	searchEnabled bool
	modelType     string
}

// handleInstant serves POST /api/deepseek/instant: fast mode, web search on.
func (s *service) handleInstant(w http.ResponseWriter, r *http.Request) {
	s.handleChat(w, r, chatPreset{thinking: false, searchEnabled: true})
}

// handleReasoning serves POST /api/deepseek/reasoning: thinking mode, the
// "expert" model type, and web search disabled.
func (s *service) handleReasoning(w http.ResponseWriter, r *http.Request) {
	s.handleChat(w, r, chatPreset{thinking: true, searchEnabled: false, modelType: "expert"})
}

// handleChat runs the shared validation flow for the text endpoints.
func (s *service) handleChat(w http.ResponseWriter, r *http.Request, preset chatPreset) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	stream, ok := parseStreamFlag(w, body)
	if !ok {
		return
	}
	s.run(w, r, chatRequest{
		Token:         stringField(body, "userID"),
		Prompt:        promptValue(body),
		ChatID:        stringField(body, "chatID"),
		ParentID:      valueField(body, "parentID"),
		Thinking:      preset.thinking,
		SearchEnabled: preset.searchEnabled,
		ModelType:     preset.modelType,
		Stream:        stream,
	})
}

// handleVision serves POST /api/deepseek/vision: upload the image, then chat
// with the resulting file id in ref_file_ids.
func (s *service) handleVision(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}

	image := valueField(body, "image")
	if !isTruthy(image) {
		writeError(w, http.StatusBadRequest, "Parameter image wajib diisi")
		return
	}
	imageText, isText := image.(string)
	if !isText {
		writeError(w, http.StatusBadRequest, "Parameter image harus URL http(s)")
		return
	}
	imageURL := imageText

	stream, ok := parseStreamFlag(w, body)
	if !ok {
		return
	}
	imageURL = strings.TrimSpace(imageURL)
	if imageURL != "" && !httpURLPattern.MatchString(imageURL) {
		writeError(w, http.StatusBadRequest, "Parameter image harus URL http(s)")
		return
	}

	s.run(w, r, chatRequest{
		Token:         stringField(body, "userID"),
		Prompt:        promptValue(body),
		ChatID:        stringField(body, "chatID"),
		ParentID:      valueField(body, "parentID"),
		Thinking:      parseThinking(body),
		SearchEnabled: true,
		ImageURL:      imageURL,
		Stream:        stream,
	})
}

// writeError writes the JS error envelope for pre-run validation failures.
func writeError(w http.ResponseWriter, status int, message string) {
	httpx.JSON(w, status, errorResponse{Success: false, Error: message})
}
