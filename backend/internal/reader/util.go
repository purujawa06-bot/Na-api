package reader

import (
	"encoding/json"
	"math"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/net/html"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
)

// truthy mirrors JavaScript truthiness for the values decoded from upstream
// JSON, so the Go port keeps the same fallback chains as the Node version.
func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case json.Number:
		number, err := typed.Float64()
		if err != nil {
			return false
		}
		return number != 0 && !math.IsNaN(number)
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case int:
		return typed != 0
	}
	return true
}

// firstTruthy returns the first truthy value, or nil when every value is falsy.
func firstTruthy(values ...any) any {
	for _, value := range values {
		if truthy(value) {
			return value
		}
	}
	return nil
}

// orNull applies the JavaScript `value || null` idiom.
func orNull(value any) any {
	if !truthy(value) {
		return nil
	}
	return value
}

// valueOr applies the JavaScript `value ?? fallback` idiom.
func valueOr(value, fallback any) any {
	if value == nil {
		return fallback
	}
	return value
}

// numberOrNil keeps the value only when it is a JSON number, matching the
// `typeof x === 'number'` guards in the original implementation.
func numberOrNil(value any) any {
	switch value.(type) {
	case float64, json.Number:
		return value
	}
	return nil
}

// jsString renders a decoded JSON value the way `String(value)` would.
func jsString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	}
	return ""
}

// attrValue returns an attribute value as any, or nil when it is absent/empty.
func attrValue(node *html.Node, key string) any {
	value := htmlx.Attr(node, key)
	if value == "" {
		return nil
	}
	return value
}

// collapseText returns the node text with runs of whitespace collapsed.
func collapseText(node *html.Node) string {
	return strings.Join(strings.Fields(htmlx.RawText(node)), " ")
}

// encodeURIComponent percent-encodes a value the way JavaScript's
// encodeURIComponent does for the characters that matter in URLs and keys.
func encodeURIComponent(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

// arrayOf returns the value as a JSON array, or nil when it is not one.
func arrayOf(value any) []any {
	if list, ok := value.([]any); ok {
		return list
	}
	return nil
}

// objectOf returns the value as a JSON object, or nil when it is not one.
func objectOf(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return nil
}

// arrayOrEmpty returns the value as an array, defaulting to an empty one.
func arrayOrEmpty(value any) []any {
	if list, ok := value.([]any); ok {
		return list
	}
	return []any{}
}
