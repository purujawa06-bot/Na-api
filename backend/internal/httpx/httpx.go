// Package httpx contains small helpers shared by every HTTP handler: JSON
// responses, query parsing, streaming headers, and client IP extraction.
package httpx

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
)

// MaxJSONBody caps request bodies decoded with DecodeJSON (8 MiB).
const MaxJSONBody = 8 << 20

// JSON writes payload as JSON with the given status code.
func JSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(payload)
}

// OK writes payload with HTTP 200.
func OK(w http.ResponseWriter, payload any) { JSON(w, http.StatusOK, payload) }

// Error writes a uniform error envelope: {"success":false,"error":msg,"status":code}.
func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, map[string]any{
		"success": false,
		"error":   message,
		"status":  status,
	})
}

// DecodeJSON decodes the request body into target, rejecting oversized or
// malformed payloads with a descriptive error.
func DecodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxJSONBody))
	if err != nil {
		return fmt.Errorf("failed to read request body: %w", err)
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return fmt.Errorf("request body is empty")
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	return nil
}

// QueryStr returns the first value of a query parameter or fallback.
func QueryStr(r *http.Request, key, fallback string) string {
	if value := r.URL.Query().Get(key); value != "" {
		return value
	}
	return fallback
}

// QueryInt returns an integer query parameter clamped to [min, max].
func QueryInt(r *http.Request, key string, fallback, min, max int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// SetNoStore marks a response as uncacheable. Call it before writing headers.
func SetNoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Cache", "BYPASS")
}

// SetCacheable marks a response as cacheable for the provided duration.
func SetCacheable(w http.ResponseWriter, seconds int) {
	w.Header().Set("Cache-Control", fmt.Sprintf("public, s-maxage=%d, stale-while-revalidate=%d", seconds, seconds))
}

// StartSSE prepares Server-Sent Events headers and flushes them immediately.
func StartSSE(w http.ResponseWriter) (http.Flusher, bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		Error(w, http.StatusInternalServerError, "streaming is not supported by this server")
		return nil, false
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	return flusher, true
}

// StartNDJSON prepares newline-delimited JSON streaming headers.
func StartNDJSON(w http.ResponseWriter) (http.Flusher, bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		Error(w, http.StatusInternalServerError, "streaming is not supported by this server")
		return nil, false
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	return flusher, true
}

// WriteSSE writes one Server-Sent Event and flushes it.
func WriteSSE(w io.Writer, flusher http.Flusher, event string, data any) {
	payload, err := json.Marshal(data)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload)
	flusher.Flush()
}

// WriteNDJSON writes one JSON line and flushes it.
func WriteNDJSON(w io.Writer, flusher http.Flusher, data any) {
	payload, err := json.Marshal(data)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "%s\n", payload)
	flusher.Flush()
}

// ClientIP extracts the caller IP, honouring common proxy headers.
func ClientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		if first := strings.TrimSpace(strings.Split(forwarded, ",")[0]); first != "" {
			return first
		}
	}
	if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
		return strings.TrimSpace(realIP)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// IsLocalHost reports whether host points at loopback or a private address.
func IsLocalHost(host string) bool {
	host = strings.TrimSpace(host)
	if host == "" || host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
	}
	return false
}
