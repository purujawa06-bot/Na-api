package deepseek

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const (
	// defaultRequestTimeout mirrors the JS route maxDuration when config has
	// no explicit timeout.
	defaultRequestTimeout = 60 * time.Second
	// imageDownloadTimeout caps the vision image download.
	imageDownloadTimeout = 20 * time.Second
	// maxImageBytes caps the downloaded image size (same as webclient).
	maxImageBytes = webclient.MaxBodyBytes
)

var (
	httpURLPattern   = regexp.MustCompile(`(?i)^https?://`)
	imageExtPattern  = regexp.MustCompile(`(?i)\.[a-z0-9]{2,5}$`)
	imageExtensionBy = map[string]string{
		"image/png":  ".png",
		"image/jpeg": ".jpg",
		"image/jpg":  ".jpg",
		"image/webp": ".webp",
		"image/gif":  ".gif",
	}
)

// apiError marks a caller mistake that must be answered with HTTP 400.
type apiError struct {
	message string
}

// Error implements the error interface.
func (e *apiError) Error() string { return e.message }

// badRequest builds a 400-mapped error with an Indonesian message.
func badRequest(message string) error { return &apiError{message: message} }

// errorResponse matches the JS error envelope exactly.
type errorResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// chatResult is the non-streaming JSON body returned by every endpoint.
type chatResult struct {
	Success   bool   `json:"success"`
	Source    string `json:"source"`
	ChatID    string `json:"chatID"`
	ParentID  any    `json:"parentID"`
	Content   string `json:"content"`
	Reasoning string `json:"reasoning,omitempty"`
}

// sseMeta announces the session before the first delta.
type sseMeta struct {
	Type   string `json:"type"`
	ChatID string `json:"chatID"`
	Model  string `json:"model"`
}

// sseDelta carries one reasoning/content chunk.
type sseDelta struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// sseDone closes a successful stream with the ids needed for the next turn.
type sseDone struct {
	Type     string `json:"type"`
	ChatID   string `json:"chatID"`
	ParentID any    `json:"parentID"`
}

// sseError reports a mid-stream failure, matching the JS error event.
type sseError struct {
	Type  string `json:"type"`
	Error string `json:"error"`
}

// chatRequest is the normalised input shared by all three endpoints.
type chatRequest struct {
	Token         string
	Prompt        any
	ChatID        string
	ParentID      any
	Thinking      bool
	SearchEnabled bool
	ModelType     string
	ImageURL      string
	Stream        bool
}

// run executes a validated request and writes either JSON or SSE.
func (s *service) run(w http.ResponseWriter, r *http.Request, request chatRequest) {
	if err := validateChatRequest(request); err != nil {
		s.writeFailure(w, err)
		return
	}
	if request.ImageURL != "" && !httpURLPattern.MatchString(request.ImageURL) {
		s.writeFailure(w, badRequest("Parameter image harus URL http(s)"))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.requestTimeout())
	defer cancel()

	refFileIDs, err := s.prepareImage(ctx, request)
	if err != nil {
		s.writeFailure(w, err)
		return
	}

	sessionID := request.ChatID
	if sessionID == "" {
		sessionID, err = s.client.createSession(ctx, request.Token)
		if err != nil {
			s.writeFailure(w, err)
			return
		}
	}

	modelType := request.ModelType
	if modelType == "" && len(refFileIDs) > 0 {
		modelType = "vision"
	}
	if modelType == "" {
		modelType = "default"
	}

	options := completionOptions{
		Token:           request.Token,
		ChatID:          sessionID,
		ParentID:        request.ParentID,
		ModelType:       modelType,
		Prompt:          request.Prompt,
		RefFileIDs:      refFileIDs,
		ThinkingEnabled: request.Thinking,
		SearchEnabled:   request.SearchEnabled,
	}

	if !request.Stream {
		// The JS client calls streamTurn without modelType/searchEnabled on the
		// non-streaming path, so upstream falls back to model_type
		// "default"/"vision" and disables web search. Keep that behaviour.
		options.ModelType = "default"
		if len(refFileIDs) > 0 {
			options.ModelType = "vision"
		}
		options.SearchEnabled = false
		s.respondJSON(w, ctx, request, sessionID, options)
		return
	}
	s.respondStream(w, ctx, request, sessionID, options)
}

// validateChatRequest applies the same checks as askDeepSeek in the JS client.
func validateChatRequest(request chatRequest) error {
	if request.Token == "" {
		return badRequest("Parameter userID wajib diisi")
	}
	if !isTruthy(request.Prompt) {
		return badRequest("Parameter prompt wajib diisi")
	}
	if request.ChatID != "" && !isTruthy(request.ParentID) {
		return badRequest("Untuk melanjutkan chat, kirim chatID + parentID (message_id jawaban terakhir dari respons sebelumnya)")
	}
	return nil
}

// prepareImage downloads and uploads the vision attachment, if any.
func (s *service) prepareImage(ctx context.Context, request chatRequest) ([]string, error) {
	if request.ImageURL == "" {
		return nil, nil
	}
	data, contentType, err := downloadImage(ctx, request.ImageURL)
	if err != nil {
		return nil, err
	}
	uploaded, err := s.client.uploadFile(ctx, request.Token, data, imageFilename(request.ImageURL, contentType), contentType)
	if err != nil {
		return nil, err
	}
	return []string{uploaded.ID}, nil
}

// downloadImage fetches the vision image and returns its bytes and MIME type.
func downloadImage(ctx context.Context, imageURL string) ([]byte, string, error) {
	downloadCtx, cancel := context.WithTimeout(ctx, imageDownloadTimeout)
	defer cancel()

	resp, err := webclient.Get(downloadCtx, imageURL, map[string]string{"User-Agent": webclient.UserAgentChrome})
	if err != nil {
		return nil, "", fmt.Errorf("Gagal mengunduh gambar: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, "", badRequest(fmt.Sprintf("Gagal mengunduh gambar (HTTP %d)", resp.StatusCode))
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("Gagal mengunduh gambar: %w", err)
	}
	if len(data) > maxImageBytes {
		return nil, "", fmt.Errorf("Gagal mengunduh gambar: ukuran melebihi %d byte", maxImageBytes)
	}

	contentType := resp.Header.Get("Content-Type")
	if index := strings.IndexByte(contentType, ';'); index >= 0 {
		contentType = contentType[:index]
	}
	contentType = strings.TrimSpace(contentType)
	if contentType == "" {
		contentType = "image/png"
	}
	return data, contentType, nil
}

// imageFilename derives the upload filename, appending an extension when the
// URL has none because DeepSeek validates by extension.
func imageFilename(imageURL, contentType string) string {
	segments := strings.Split(imageURL, "/")
	name := segments[len(segments)-1]
	if index := strings.IndexByte(name, '?'); index >= 0 {
		name = name[:index]
	}
	if !imageExtPattern.MatchString(name) {
		extension := imageExtensionBy[contentType]
		if extension == "" {
			extension = ".png"
		}
		name = "image" + extension
	}
	return name
}

// respondJSON runs the turn to completion and returns the collected answer.
func (s *service) respondJSON(w http.ResponseWriter, ctx context.Context, request chatRequest, sessionID string, options completionOptions) {
	var content strings.Builder
	var reasoning strings.Builder
	meta := &turnMeta{}

	err := s.client.streamTurn(ctx, options, meta, func(part delta) error {
		if part.Kind == deltaReasoning {
			reasoning.WriteString(part.Text)
			return nil
		}
		content.WriteString(part.Text)
		return nil
	})
	if err != nil {
		s.writeFailure(w, err)
		return
	}

	source := "deepseek-web"
	if request.ImageURL != "" {
		source = "deepseek-web-vision"
	}
	httpx.OK(w, chatResult{
		Success:   true,
		Source:    source,
		ChatID:    sessionID,
		ParentID:  meta.MessageID,
		Content:   strings.TrimSpace(content.String()),
		Reasoning: strings.TrimSpace(reasoning.String()),
	})
}

// respondStream proxies the turn as the JS-style SSE stream:
// meta -> reasoning/content deltas -> done -> [DONE].
func (s *service) respondStream(w http.ResponseWriter, ctx context.Context, request chatRequest, sessionID string, options completionOptions) {
	flusher, ok := httpx.StartSSE(w)
	if !ok {
		return
	}
	send := func(payload any) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "data: %s\n\n", raw)
		flusher.Flush()
	}

	send(sseMeta{Type: "meta", ChatID: sessionID, Model: streamModel(request)})

	meta := &turnMeta{}
	err := s.client.streamTurn(ctx, options, meta, func(part delta) error {
		event := "content"
		if part.Kind == deltaReasoning {
			event = "reasoning"
		}
		send(sseDelta{Type: event, Text: part.Text})
		return nil
	})
	if err != nil {
		send(sseError{Type: "error", Error: err.Error()})
		return
	}

	send(sseDone{Type: "done", ChatID: sessionID, ParentID: meta.MessageID})
	fmt.Fprint(w, "data: [DONE]\n\n")
	flusher.Flush()
}

// streamModel picks the model label announced in the meta event.
func streamModel(request chatRequest) string {
	switch {
	case request.ImageURL != "":
		return "deepseek-vision"
	case request.Thinking:
		return "deepseek-reasoner"
	default:
		return "deepseek-chat"
	}
}

// writeFailure maps errors to 400 (caller mistakes) or 502 (upstream failures).
func (s *service) writeFailure(w http.ResponseWriter, err error) {
	var callerErr *apiError
	if errors.As(err, &callerErr) {
		httpx.JSON(w, http.StatusBadRequest, errorResponse{Success: false, Error: callerErr.message})
		return
	}
	log.Printf("[deepseek] upstream failure: %v", err)
	httpx.JSON(w, http.StatusBadGateway, errorResponse{Success: false, Error: err.Error()})
}
