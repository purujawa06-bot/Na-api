package agenttools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
	"github.com/purujawa06-bot/na-api/backend/internal/webclient"
)

const maiaEndpoint = "https://www.maiachess.com/api/v1/play/get_move"

// maiaQueryKeys preserves the raw key order so the first unexpected parameter
// reported matches the JS route.
func maiaQueryKeys(rawQuery string) []string {
	keys := make([]string, 0, 4)
	for _, pair := range strings.Split(rawQuery, "&") {
		if pair == "" {
			continue
		}
		key := pair
		if index := strings.IndexByte(pair, '='); index >= 0 {
			key = pair[:index]
		}
		if decoded, err := url.QueryUnescape(key); err == nil {
			key = decoded
		}
		keys = append(keys, key)
	}
	return keys
}

func (s *server) requestTimeout() time.Duration {
	if s.deps != nil && s.deps.Config != nil && s.deps.Config.RequestTimeout > 0 {
		return s.deps.Config.RequestTimeout
	}
	return 55 * time.Second
}

func (s *server) handleMaia(w http.ResponseWriter, r *http.Request) {
	for _, key := range maiaQueryKeys(r.URL.RawQuery) {
		if key != "pgn" {
			httpx.JSON(w, http.StatusBadRequest, map[string]any{
				"error": "Query parameter \"" + key + "\" is not allowed. Only \"pgn\" is accepted.",
			})
			return
		}
	}

	pgn := r.URL.Query().Get("pgn")
	if pgn == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"error": "Query parameter \"pgn\" is required",
		})
		return
	}

	moves, err := pgnToUCI(pgn)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid PGN string"})
		return
	}
	if len(moves) == 0 {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid PGN: no moves found"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.requestTimeout())
	defer cancel()

	params := url.Values{}
	params.Set("maia_name", "maia_kdd_2200")
	params.Set("initial_clock", "0")
	params.Set("current_clock", "0")
	params.Set("maia_version", "maia3")
	endpoint := maiaEndpoint + "?" + params.Encode()

	response, err := webclient.PostJSON(ctx, endpoint, moves, map[string]string{
		"Accept":  "application/json",
		"Origin":  "https://www.maiachess.com",
		"Referer": "https://www.maiachess.com/",
	})
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail, readErr := webclient.ReadBody(response)
		if readErr != nil {
			detail = readErr.Error()
		}
		httpx.JSON(w, response.StatusCode, map[string]any{
			"error":  fmt.Sprintf("Upstream error %d", response.StatusCode),
			"detail": detail,
		})
		return
	}

	var payload json.RawMessage
	if err := webclient.DecodeJSON(response, &payload); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, payload)
}
