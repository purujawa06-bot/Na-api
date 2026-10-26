package deepseek

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

// invalidBodyMessage is the exact message the JS routes return for bad JSON.
const invalidBodyMessage = "Body JSON tidak valid"

// invalidStreamMessage is the exact message for a non-boolean stream flag.
const invalidStreamMessage = "Parameter stream harus bernilai boolean (true/false)"

// decodeBody reads the request body as a raw-field map so field coercions can
// mirror the JavaScript routes (which inspect runtime types directly).
func decodeBody(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, bool) {
	var body map[string]json.RawMessage
	if err := httpx.DecodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, invalidBodyMessage)
		return nil, false
	}
	if body == nil {
		body = make(map[string]json.RawMessage)
	}
	return body, true
}

// stringField returns the trimmed string value of key, or "" for non-strings.
func stringField(body map[string]json.RawMessage, key string) string {
	raw, ok := body[key]
	if !ok {
		return ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

// valueField decodes key into its natural Go value, or nil when absent.
func valueField(body map[string]json.RawMessage, key string) any {
	raw, ok := body[key]
	if !ok {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}

// promptValue applies the route coercion: strings are trimmed, other JSON
// types are forwarded unchanged (matching askDeepSeek).
func promptValue(body map[string]json.RawMessage) any {
	value := valueField(body, "prompt")
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return value
}

// parseStreamFlag applies the route coercion for body.stream. It writes the
// 400 response and reports ok=false when the value is neither a boolean nor
// the strings "true"/"false".
func parseStreamFlag(w http.ResponseWriter, body map[string]json.RawMessage) (bool, bool) {
	raw, present := body["stream"]
	if !present {
		return false, true
	}
	switch {
	case bytes.Equal(raw, []byte("true")):
		return true, true
	case bytes.Equal(raw, []byte("false")):
		return false, true
	case len(raw) > 0 && raw[0] == '"':
		var value string
		if err := json.Unmarshal(raw, &value); err == nil {
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "true":
				return true, true
			case "false":
				return false, true
			}
		}
	}
	writeError(w, http.StatusBadRequest, invalidStreamMessage)
	return false, false
}

// parseThinking coerces body.thinking the way the JS truthiness helper does.
func parseThinking(body map[string]json.RawMessage) bool {
	value := valueField(body, "thinking")
	if text, ok := value.(string); ok {
		switch strings.ToLower(strings.TrimSpace(text)) {
		case "true", "1":
			return true
		default:
			return false
		}
	}
	return isTruthy(value)
}

// isTruthy reproduces JavaScript truthiness for JSON-decodable values.
func isTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case float64:
		return typed != 0
	default:
		return true
	}
}
