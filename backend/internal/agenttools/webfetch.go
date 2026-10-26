package agenttools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/htmlx"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"

	"golang.org/x/net/html"
)

const (
	webFetchTimeout = 20 * time.Second
	webFetchMaxBody = 2 << 20
	maxFetchLength  = 20000
)

var (
	htmlHintPattern = regexp.MustCompile(`(?i)<\s*html|<\s*body|<\s*div|<\s*p[\s>]`)
	inlineSpace     = regexp.MustCompile(`[ \t\x0b\f]+`)
	extraNewlines   = regexp.MustCompile(`\n{3,}`)

	errBlockedAddress = errors.New("blocked private address")
)

// webFetchClient resolves and validates every connection (including redirect
// hops) so a public hostname cannot be rebound to a private address between the
// initial check and the actual dial.
var webFetchClient = func() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			allowed := make([]net.IP, 0, len(ips))
			for _, candidate := range ips {
				if isBlockedIP(candidate.IP) {
					return nil, errBlockedAddress
				}
				allowed = append(allowed, candidate.IP)
			}
			if len(allowed) == 0 {
				return nil, errBlockedAddress
			}
			var lastErr error
			for _, ip := range allowed {
				conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if dialErr == nil {
					return conn, nil
				}
				lastErr = dialErr
			}
			return nil, lastErr
		},
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		IdleConnTimeout:       15 * time.Second,
	}
	return &http.Client{Transport: transport}
}()

// fetchError carries the HTTP status the route must return.
type fetchError struct {
	Status  int
	Message string
}

func (e *fetchError) Error() string { return e.Message }

// isBlockedIP rejects loopback, private, link-local, unspecified, multicast, and
// carrier-grade NAT addresses.
func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 0 {
			return true
		}
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return true
		}
	}
	return false
}

// isBlockedHostname applies the literal host rules from lib/web-fetch.js plus
// the stricter IP checks.
func isBlockedHostname(host string) bool {
	name := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	if name == "" {
		return true
	}
	switch name {
	case "localhost", "::1", "[::1]", "0.0.0.0", "169.254.169.254", "[fd00:ec2::254]":
		return true
	}
	if strings.HasSuffix(name, ".local") || strings.HasSuffix(name, ".internal") {
		return true
	}
	if strings.HasPrefix(name, "fc00:") || strings.HasPrefix(name, "fd00:") || strings.HasPrefix(name, "fe80:") {
		return true
	}
	if ip := net.ParseIP(name); ip != nil {
		return isBlockedIP(ip)
	}
	return false
}

// validateFetchURL rejects unsupported schemes and local/private targets,
// including hosts whose DNS records resolve to private addresses.
func validateFetchURL(ctx context.Context, rawURL string) (*url.URL, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, &fetchError{Status: http.StatusBadRequest, Message: "Parameter url wajib diisi"}
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return nil, &fetchError{Status: http.StatusBadRequest, Message: "Parameter url tidak valid (harus http/https)"}
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, &fetchError{Status: http.StatusBadRequest, Message: "Parameter url harus http/https"}
	}
	host := parsed.Hostname()
	if isBlockedHostname(host) {
		return nil, &fetchError{Status: http.StatusBadRequest, Message: "Host lokal/privat ditolak (proteksi SSRF)"}
	}
	if net.ParseIP(host) == nil {
		resolveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		addresses, err := net.DefaultResolver.LookupIPAddr(resolveCtx, host)
		cancel()
		if err == nil {
			for _, address := range addresses {
				if isBlockedIP(address.IP) {
					return nil, &fetchError{Status: http.StatusBadRequest, Message: "Host lokal/privat ditolak (proteksi SSRF)"}
				}
			}
		}
	}
	return parsed, nil
}

// cleanText collapses horizontal whitespace, drops empty lines, and caps
// consecutive blank lines at one, matching cleanText() in lib/web-fetch.js.
func cleanText(input string) string {
	normalized := strings.ReplaceAll(input, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		collapsed := strings.TrimSpace(inlineSpace.ReplaceAllString(line, " "))
		if collapsed != "" {
			kept = append(kept, collapsed)
		}
	}
	return strings.TrimSpace(extraNewlines.ReplaceAllString(strings.Join(kept, "\n"), "\n\n"))
}

// htmlToText strips non-content elements and returns the readable text.
func htmlToText(markup string) string {
	root, err := htmlx.Parse(markup)
	if err != nil {
		return cleanText(markup)
	}
	start := root
	if body := htmlx.First(root, "body", "", ""); body != nil {
		start = body
	}

	var builder strings.Builder
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch strings.ToLower(node.Data) {
			case "script", "style", "noscript", "svg", "canvas", "template":
				return
			}
		}
		if node.Type == html.TextNode {
			builder.WriteString(node.Data)
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(start)
	return cleanText(builder.String())
}

// fetchWebChunk fetches a public URL, converts the body to text, and returns
// the requested character window with pagination metadata.
func fetchWebChunk(ctx context.Context, rawURL string, offset, length int) (map[string]any, error) {
	parsed, err := validateFetchURL(ctx, rawURL)
	if err != nil {
		return nil, err
	}

	callCtx, cancel := context.WithTimeout(ctx, webFetchTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(callCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, &fetchError{Status: http.StatusBadRequest, Message: "Parameter url tidak valid (harus http/https)"}
	}
	request.Header.Set("User-Agent", webclient.UserAgentChrome)
	request.Header.Set("Accept", "text/html,application/xhtml+xml,application/json,text/*;q=0.9,*/*;q=0.8")

	response, err := webFetchClient.Do(request)
	if err != nil {
		if errors.Is(err, errBlockedAddress) {
			return nil, &fetchError{Status: http.StatusBadRequest, Message: "Host lokal/privat ditolak (proteksi SSRF)"}
		}
		return nil, &fetchError{Status: http.StatusBadGateway, Message: "Gagal fetch URL: " + err.Error()}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &fetchError{Status: http.StatusBadGateway, Message: fmt.Sprintf("Upstream HTTP %d", response.StatusCode)}
	}

	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	raw, err := io.ReadAll(io.LimitReader(response.Body, webFetchMaxBody+1))
	if err != nil {
		return nil, &fetchError{Status: http.StatusBadGateway, Message: "Gagal membaca respons: " + err.Error()}
	}
	truncatedBody := len(raw) > webFetchMaxBody
	if truncatedBody {
		raw = raw[:webFetchMaxBody]
	}
	rawText := string(raw)

	sample := rawText
	if len(sample) > 2000 {
		sample = sample[:2000]
	}
	var text string
	if strings.Contains(contentType, "text/html") ||
		(!strings.Contains(contentType, "json") && htmlHintPattern.MatchString(sample)) {
		text = htmlToText(rawText)
	} else {
		text = cleanText(rawText)
	}
	if text == "" {
		text = "(konten kosong / tidak ada teks terbaca)"
	}

	runes := []rune(text)
	totalLength := len(runes)
	content := ""
	if offset < totalLength {
		end := offset + length
		if end > totalLength {
			end = totalLength
		}
		content = string(runes[offset:end])
	}

	finalURL := parsed.String()
	if response.Request != nil && response.Request.URL != nil {
		finalURL = response.Request.URL.String()
	}
	var contentTypeValue any
	if contentType != "" {
		contentTypeValue = contentType
	}

	return map[string]any{
		"url":              parsed.String(),
		"final_url":        finalURL,
		"content_type":     contentTypeValue,
		"total_length":     totalLength,
		"offset":           offset,
		"length":           len([]rune(content)),
		"requested_length": length,
		"has_more":         offset+length < totalLength,
		"truncated_body":   truncatedBody,
		"content":          content,
	}, nil
}

func integerFromFloat(value float64) (int, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) || math.Trunc(value) != value {
		return 0, false
	}
	if value < float64(math.MinInt) || value > float64(math.MaxInt) {
		return 0, false
	}
	return int(value), true
}

// integerParam converts a GET string or POST JSON value the same way the JS
// route does (String(value).trim() then Number()). Missing, empty, and
// non-integer values all report ok=false.
func integerParam(value any) (int, bool) {
	switch typed := value.(type) {
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, false
		}
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return 0, false
		}
		return integerFromFloat(parsed)
	case float64:
		return integerFromFloat(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return 0, false
		}
		return integerFromFloat(parsed)
	default:
		return 0, false
	}
}

// parseWebFetchParams validates the mandatory url/offset/length triple.
func parseWebFetchParams(rawURL, rawOffset, rawLength any) (string, int, int, error) {
	urlValue := strings.TrimSpace(coerceString(rawURL))
	if urlValue == "" {
		return "", 0, 0, &fetchError{Status: http.StatusBadRequest, Message: "Parameter url wajib diisi"}
	}

	offset, offsetOK := integerParam(rawOffset)
	if !offsetOK || offset < 0 {
		return "", 0, 0, &fetchError{Status: http.StatusBadRequest, Message: "Parameter offset wajib diisi (integer >= 0)"}
	}

	length, lengthOK := integerParam(rawLength)
	if !lengthOK || length < 1 || length > maxFetchLength {
		return "", 0, 0, &fetchError{
			Status:  http.StatusBadRequest,
			Message: fmt.Sprintf("Parameter length wajib diisi (integer 1..%d)", maxFetchLength),
		}
	}
	return urlValue, offset, length, nil
}

// runWebFetch executes a fetch and maps errors to the route envelope.
func runWebFetch(ctx context.Context, urlValue string, offset, length int) (int, any) {
	result, err := fetchWebChunk(ctx, urlValue, offset, length)
	if err != nil {
		status := http.StatusBadGateway
		var fetchErr *fetchError
		if errors.As(err, &fetchErr) && fetchErr.Status == http.StatusBadRequest {
			status = http.StatusBadRequest
		}
		return status, map[string]any{
			"success":    false,
			"status":     "error",
			"error":      err.Error(),
			"httpStatus": status,
		}
	}
	payload := map[string]any{
		"success": true,
		"status":  "success",
	}
	for key, value := range result {
		payload[key] = value
	}
	return http.StatusOK, payload
}

func (s *server) handleWebFetch(w http.ResponseWriter, r *http.Request) {
	var (
		urlValue string
		offset   int
		length   int
		err      error
	)

	if r.Method == http.MethodPost {
		var body map[string]any
		if decodeErr := httpx.DecodeJSON(r, &body); decodeErr != nil {
			httpx.JSON(w, http.StatusBadRequest, map[string]any{
				"success": false,
				"error":   `Body harus JSON: {"url": "...", "offset": 0, "length": 5000}`,
			})
			return
		}
		urlValue, offset, length, err = parseWebFetchParams(body["url"], body["offset"], body["length"])
	} else {
		values := r.URL.Query()
		rawURL, _ := firstQueryParam(values, "url")
		rawOffset, _ := firstQueryParam(values, "offset")
		rawLength, _ := firstQueryParam(values, "length")
		urlValue, offset, length, err = parseWebFetchParams(rawURL, rawOffset, rawLength)
	}
	if err != nil {
		status := http.StatusBadRequest
		var fetchErr *fetchError
		if errors.As(err, &fetchErr) {
			status = fetchErr.Status
		}
		httpx.JSON(w, status, map[string]any{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	if r.Method == http.MethodPost {
		status, payload := runWebFetch(r.Context(), urlValue, offset, length)
		httpx.JSON(w, status, payload)
		return
	}

	s.respondCached(w, r, agentToolsTTL, agentToolsStale, func() (int, any) {
		return runWebFetch(r.Context(), urlValue, offset, length)
	})
}
