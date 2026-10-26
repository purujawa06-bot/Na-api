// Package tools ports the media-generation and hosting endpoints: iLoveIMG
// image tools, Vheer text-to-image, Raphael text-to-video, and imgbb uploads.
package tools

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// defaultTimeout bounds a request when the configuration leaves it unset.
const defaultTimeout = 55 * time.Second

// handlers carries the shared dependencies for every tools endpoint.
type handlers struct {
	deps *app.Deps
}

// Register mounts the tools endpoints on the shared mux.
func Register(mux *http.ServeMux, deps *app.Deps) {
	h := &handlers{deps: deps}
	mux.HandleFunc("POST /api/tools-image/upscaler", h.upscaler)
	mux.HandleFunc("POST /api/tools-image/remove-background", h.removeBackground)
	mux.HandleFunc("POST /api/tools-image/html-to-image", h.htmlToImage)
	mux.HandleFunc("POST /api/text2image", h.textToImage)
	mux.HandleFunc("POST /api/text2video", h.requestVideoTicket)
	mux.HandleFunc("GET /api/text2video/status", h.videoStatus)
	mux.HandleFunc("GET /api/text2video/redeem", h.redeemVideoTicket)
	mux.HandleFunc("POST /api/uploader/imggbb", h.imgbbUpload)
}

// requestContext derives a bounded context from the incoming request.
func (h *handlers) requestContext(r *http.Request) (context.Context, context.CancelFunc) {
	timeout := defaultTimeout
	if h.deps != nil && h.deps.Config != nil && h.deps.Config.RequestTimeout > 0 {
		timeout = h.deps.Config.RequestTimeout
	}
	return context.WithTimeout(r.Context(), timeout)
}

// failJSON writes the compact error envelope used by the JavaScript routes.
func failJSON(w http.ResponseWriter, status int, message string) {
	httpx.JSON(w, status, struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}{Success: false, Error: message})
}

// decodeBody decodes the JSON request body into an object. It writes a 400
// response and reports false when the body is missing or malformed.
func decodeBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var body map[string]any
	if err := httpx.DecodeJSON(r, &body); err != nil {
		failJSON(w, http.StatusBadRequest, "Body JSON tidak valid")
		return nil, false
	}
	return body, true
}

// stringValue returns a trimmed string field only when it is a JSON string.
func stringValue(body map[string]any, key string) (string, bool) {
	raw, exists := body[key]
	if !exists {
		return "", false
	}
	value, ok := raw.(string)
	if !ok {
		return "", false
	}
	return strings.TrimSpace(value), true
}

// isTruthy mirrors JavaScript truthiness for the scalar JSON values we accept.
func isTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case string:
		return typed != ""
	}
	return false
}

// numberOf converts a JSON scalar to a number the same way JavaScript's
// Number() does for strings, numbers, and booleans.
func numberOf(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return 0, false
		}
		return typed, true
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, false
		}
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	}
	return 0, false
}

// parseIntLike mirrors parseInt() for strings: it consumes the leading
// optional sign and digits, ignoring any trailing characters.
func parseIntLike(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return 0, false
		}
		return int(typed), true
	case string:
		trimmed := strings.TrimSpace(typed)
		end := 0
		if end < len(trimmed) && (trimmed[end] == '-' || trimmed[end] == '+') {
			end++
		}
		digits := end
		for end < len(trimmed) && trimmed[end] >= '0' && trimmed[end] <= '9' {
			end++
		}
		if end == digits {
			return 0, false
		}
		parsed, err := strconv.Atoi(trimmed[:end])
		if err != nil {
			return 0, false
		}
		return parsed, true
	}
	return 0, false
}

// requireURLField validates the "file" style URL parameter, writing a 400
// response when it is missing, malformed, or uses another protocol.
func requireURLField(w http.ResponseWriter, body map[string]any, field, missing, invalid string) (string, bool) {
	value, ok := stringValue(body, field)
	if !ok || value == "" {
		failJSON(w, http.StatusBadRequest, missing)
		return "", false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		failJSON(w, http.StatusBadRequest, invalid)
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		failJSON(w, http.StatusBadRequest, "URL harus http/https")
		return "", false
	}
	return value, true
}

// toolsError is an error carrying the HTTP status the route should return.
type toolsError struct {
	status  int
	message string
	waitMS  int
}

// Error implements the error interface.
func (e *toolsError) Error() string { return e.message }

// newToolsError builds an error with an explicit HTTP status.
func newToolsError(status int, message string) error {
	return &toolsError{status: status, message: message}
}

// errorStatus extracts the HTTP status from an error, defaulting to 500.
func errorStatus(err error) int {
	var typed *toolsError
	if errors.As(err, &typed) && typed.status > 0 {
		return typed.status
	}
	return http.StatusInternalServerError
}

// errorMessage returns a safe, non-empty error message.
func errorMessage(err error, fallback string) string {
	if err != nil && err.Error() != "" {
		return err.Error()
	}
	return fallback
}

// ceilSeconds converts milliseconds to whole seconds rounded up.
func ceilSeconds(milliseconds int) int {
	if milliseconds <= 0 {
		return 0
	}
	return int(math.Ceil(float64(milliseconds) / 1000))
}

// formatNumber renders a float the way String(number) would for form fields.
func formatNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

// hostFromURL extracts the hostname used to name generated image files.
func hostFromURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("URL tidak valid")
	}
	host := parsed.Hostname()
	var builder strings.Builder
	for _, char := range host {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '_' || char == '.' || char == '-' {
			builder.WriteRune(char)
			continue
		}
		builder.WriteByte('_')
	}
	if builder.Len() == 0 {
		return "webpage", nil
	}
	return builder.String(), nil
}
