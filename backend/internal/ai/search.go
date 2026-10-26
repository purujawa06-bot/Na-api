package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	// searchCacheTTL matches the 10 minute in-memory cache in lib/ai-search.js.
	searchCacheTTL = 10 * time.Minute
	// aiSearchModel is the public model ID backing web search.
	aiSearchModel = "gemini-3.6-flash"
)

var codeFencePattern = regexp.MustCompile("(?i)```(?:json)?")

var looseResultPattern = regexp.MustCompile(`"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"snippet"\s*:\s*"((?:[^"\\]|\\.)*)")?`)

// searchResult is one validated web search hit.
type searchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
	Source  string `json:"source"`
	Engine  string `json:"engine"`
	Rank    int    `json:"rank"`
}

// searchData is the cached portion of a search answer.
type searchData struct {
	Query     string         `json:"query"`
	Count     int            `json:"count"`
	Results   []searchResult `json:"results"`
	Source    string         `json:"source"`
	Providers []string       `json:"providers"`
}

type searchResponse struct {
	Success   bool           `json:"success"`
	Status    string         `json:"status"`
	Query     string         `json:"query"`
	Count     int            `json:"count"`
	Results   []searchResult `json:"results"`
	Source    string         `json:"source"`
	Providers []string       `json:"providers"`
	Limit     int            `json:"limit"`
}

// rawSearchResult is the loose shape produced by the model.
type rawSearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

type searchQueryError struct {
	status  int
	message string
}

// searchBody accepts both query aliases and any numeric/string limit field.
type searchBody struct {
	Query  *string `json:"query"`
	Q      *string `json:"q"`
	Limit  any     `json:"limit"`
	Result any     `json:"result"`
	Count  any     `json:"count"`
}

// firstQueryParam returns the first present parameter value, matching the
// nullish-coalescing aliases used by the Next.js route.
func firstQueryParam(values url.Values, keys ...string) (string, bool) {
	for _, key := range keys {
		if entries, ok := values[key]; ok && len(entries) > 0 {
			return entries[0], true
		}
	}
	return "", false
}

// parseSearchQuery validates the query and clamps the limit to [1, 20].
func parseSearchQuery(rawQuery, rawLimit string) (string, int, *searchQueryError) {
	query := strings.TrimSpace(rawQuery)
	if query == "" {
		return "", 0, &searchQueryError{status: http.StatusBadRequest, message: "Parameter 'query' is required."}
	}
	if utf8.RuneCountInString(query) > 200 {
		return "", 0, &searchQueryError{status: http.StatusBadRequest, message: "Query too long (max 200 characters)."}
	}
	limit := leadingInt(rawLimit, 10)
	if limit < 1 {
		limit = 1
	}
	if limit > 20 {
		limit = 20
	}
	return query, limit, nil
}

// leadingInt parses the leading integer of a string (parseInt semantics).
func leadingInt(value string, fallback int) int {
	value = strings.TrimSpace(value)
	end := 0
	if end < len(value) && (value[end] == '+' || value[end] == '-') {
		end++
	}
	digits := end
	for digits < len(value) && value[digits] >= '0' && value[digits] <= '9' {
		digits++
	}
	if digits == end {
		return fallback
	}
	parsed, err := strconv.Atoi(value[:digits])
	if err != nil {
		return fallback
	}
	return parsed
}

// scalarString renders a decoded JSON scalar for the limit aliases.
func scalarString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(typed)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}

func (h *handlers) searchWebGET(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	query, _ := firstQueryParam(values, "query", "q")
	limit, ok := firstQueryParam(values, "limit", "result", "count")
	if !ok {
		limit = "10"
	}
	h.runSearch(w, r, query, limit)
}

func (h *handlers) searchWebPOST(w http.ResponseWriter, r *http.Request) {
	var body searchBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   `Body must be JSON: {"query": "...", "limit": 10}`,
		})
		return
	}
	query := ""
	if body.Query != nil {
		query = *body.Query
	} else if body.Q != nil {
		query = *body.Q
	}
	limit := "10"
	switch {
	case body.Limit != nil:
		limit = scalarString(body.Limit)
	case body.Result != nil:
		limit = scalarString(body.Result)
	case body.Count != nil:
		limit = scalarString(body.Count)
	}
	h.runSearch(w, r, query, limit)
}

func (h *handlers) runSearch(w http.ResponseWriter, r *http.Request, rawQuery, rawLimit string) {
	query, limit, queryErr := parseSearchQuery(rawQuery, rawLimit)
	if queryErr != nil {
		httpx.JSON(w, queryErr.status, map[string]any{
			"success": false,
			"error":   queryErr.message,
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.requestTimeout())
	defer cancel()

	data, err := h.searchWeb(ctx, query, limit)
	if err != nil {
		log.Printf("[search] %q failed: %v", query, err)
		httpx.JSON(w, http.StatusBadGateway, map[string]any{
			"success":    false,
			"status":     "error",
			"error":      err.Error(),
			"httpStatus": http.StatusBadGateway,
		})
		return
	}
	httpx.OK(w, searchResponse{
		Success:   true,
		Status:    "success",
		Query:     data.Query,
		Count:     data.Count,
		Results:   data.Results,
		Source:    data.Source,
		Providers: data.Providers,
		Limit:     limit,
	})
}

// searchWeb asks the Gemini web provider for strict-JSON results, tolerating
// malformed output with a repair/regex fallback and up to three attempts.
func (h *handlers) searchWeb(ctx context.Context, query string, limit int) (*searchData, error) {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return nil, fmt.Errorf("Parameter 'query' is required.")
	}
	key := "ai:" + strings.ToLower(trimmed) + ":" + strconv.Itoa(limit)
	if h.deps != nil && h.deps.Cache != nil {
		if cached, ok := h.deps.Cache.Get(key); ok {
			if data, ok := cached.(*searchData); ok {
				return data, nil
			}
		}
	}

	var raw []rawSearchResult
	var lastErr error
	for attempt := 1; attempt <= 3 && len(raw) == 0; attempt++ {
		text, _, err := generateGemini(ctx, buildSearchPrompt(trimmed, limit), 0)
		if err != nil {
			lastErr = err
			if attempt < 3 {
				log.Printf("[ai-search] attempt %d failed (%v), retrying", attempt, err)
			}
			continue
		}
		raw, err = extractResults(text)
		if err != nil {
			lastErr = err
			if attempt < 3 {
				log.Printf("[ai-search] attempt %d returned malformed JSON (%v), retrying", attempt, err)
			}
		}
	}
	if len(raw) == 0 {
		if lastErr == nil {
			lastErr = fmt.Errorf("AI search returned no usable results for that query")
		}
		return nil, lastErr
	}

	seen := make(map[string]bool, len(raw))
	results := make([]searchResult, 0, limit)
	for _, item := range raw {
		if len(results) >= limit {
			break
		}
		link := strings.TrimSpace(item.URL)
		if !isHTTPURL(link) {
			continue
		}
		dedupe := strings.TrimRight(strings.ToLower(link), "/")
		if seen[dedupe] {
			continue
		}
		seen[dedupe] = true
		title := truncateRunes(strings.TrimSpace(item.Title), 200)
		if title == "" {
			title = link
		}
		results = append(results, searchResult{
			Title:   title,
			URL:     link,
			Snippet: truncateRunes(strings.TrimSpace(item.Snippet), 500),
			Source:  "ai",
			Engine:  aiSearchModel,
			Rank:    len(results) + 1,
		})
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("AI search returned no usable results for that query")
	}

	data := &searchData{
		Query:     trimmed,
		Count:     len(results),
		Results:   results,
		Source:    "ai",
		Providers: []string{aiSearchModel},
	}
	if h.deps != nil && h.deps.Cache != nil {
		h.deps.Cache.Set(key, data, searchCacheTTL)
	}
	return data, nil
}

// buildSearchPrompt is copied from lib/ai-search.js: it demands strict JSON.
func buildSearchPrompt(query string, limit int) string {
	return strings.Join([]string{
		"You are a realtime web search engine with live internet knowledge.",
		fmt.Sprintf(`Return the top %d most relevant web results for the query: "%s"`, limit, query),
		"",
		"Rules:",
		"- Reply with STRICT JSON only, no markdown fences, no commentary:",
		`  {"results":[{"title":"...","url":"https://...","snippet":"..."}]}`,
		`- "url" must be the real canonical page URL (http/https), never a redirect, tracker, or markdown link.`,
		"- Never invent domains or URLs; only pages you genuinely know exist.",
		`- "title" is the real page title, "snippet" is 1-2 sentences describing why it matches.`,
		`- Emit VALID JSON: escape newlines as \n, no trailing commas, no line breaks inside strings.`,
		"- Match the query language when possible (e.g. Indonesian query -> Indonesian pages).",
	}, "\n")
}

// repairJSON escapes raw control characters inside strings and drops trailing
// commas outside strings (single pass, string-aware).
func repairJSON(source string) string {
	var out strings.Builder
	out.Grow(len(source))
	inString := false
	escaped := false
	for i := 0; i < len(source); i++ {
		ch := source[i]
		if inString {
			if escaped {
				out.WriteByte(ch)
				escaped = false
				continue
			}
			switch ch {
			case '\\':
				out.WriteByte(ch)
				escaped = true
			case '"':
				out.WriteByte(ch)
				inString = false
			case '\n':
				out.WriteString(`\n`)
			case '\r':
				out.WriteString(`\r`)
			case '\t':
				out.WriteString(`\t`)
			default:
				out.WriteByte(ch)
			}
			continue
		}
		if ch == '"' {
			out.WriteByte(ch)
			inString = true
			continue
		}
		if ch == ',' {
			next := i + 1
			for next < len(source) {
				c := source[next]
				if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
					break
				}
				next++
			}
			if next < len(source) && (source[next] == '}' || source[next] == ']') {
				continue
			}
		}
		out.WriteByte(ch)
	}
	return out.String()
}

// extractResults parses the model text into search results.
func extractResults(text string) ([]rawSearchResult, error) {
	clean := strings.TrimSpace(codeFencePattern.ReplaceAllString(text, ""))
	start := strings.Index(clean, "{")
	if start < 0 {
		return nil, fmt.Errorf("AI search returned no JSON object")
	}
	slice := clean[start:]
	if balanced, ok := sliceBalancedJSON(clean, start); ok {
		slice = balanced
	}

	for _, candidate := range []string{slice, repairJSON(slice)} {
		var decoded any
		if err := json.Unmarshal([]byte(candidate), &decoded); err != nil {
			continue
		}
		if list := resultsFromJSON(decoded); len(list) > 0 {
			return list, nil
		}
	}
	if loose := extractResultsLoose(clean); len(loose) > 0 {
		return loose, nil
	}
	return nil, fmt.Errorf("AI search returned malformed JSON")
}

// resultsFromJSON normalises both {"results":[...]} and [...] shapes.
func resultsFromJSON(value any) []rawSearchResult {
	switch typed := value.(type) {
	case []any:
		return decodeRawResults(typed)
	case map[string]any:
		if list, ok := typed["results"].([]any); ok {
			return decodeRawResults(list)
		}
	}
	return nil
}

func decodeRawResults(items []any) []rawSearchResult {
	results := make([]rawSearchResult, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		results = append(results, rawSearchResult{
			Title:   stringValue(object["title"]),
			URL:     stringValue(object["url"]),
			Snippet: stringValue(object["snippet"]),
		})
	}
	return results
}

// extractResultsLoose pulls complete title/url/snippet triples out of a
// truncated or malformed answer.
func extractResultsLoose(text string) []rawSearchResult {
	matches := looseResultPattern.FindAllStringSubmatch(text, 20)
	results := make([]rawSearchResult, 0, len(matches))
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		snippet := ""
		if len(match) > 3 {
			snippet = match[3]
		}
		results = append(results, rawSearchResult{
			Title:   unescapeJSONString(match[1]),
			URL:     unescapeJSONString(match[2]),
			Snippet: unescapeJSONString(snippet),
		})
	}
	return results
}

func unescapeJSONString(value string) string {
	if value == "" {
		return ""
	}
	var decoded string
	if err := json.Unmarshal([]byte(`"`+value+`"`), &decoded); err != nil {
		return value
	}
	return decoded
}

// isHTTPURL reports whether value is an absolute http(s) URL.
func isHTTPURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	return parsed.Host != ""
}

// truncateRunes caps a string at max runes (JS slice uses UTF-16 units).
func truncateRunes(value string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}
