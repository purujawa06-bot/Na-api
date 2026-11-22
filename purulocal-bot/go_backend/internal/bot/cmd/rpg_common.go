package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func rpgBackendBase() string {
	if v := strings.TrimSpace(os.Getenv("PURUBOY_BACKEND_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	if v := strings.TrimSpace(os.Getenv("NA_API_BACKEND_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return naAPIBase
}

func rpgSecret() string {
	if v := strings.TrimSpace(os.Getenv("PURUBOY_RPG_SECRET")); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("PURUBOY_ADMIN_KEY"))
}

func pickRPGID(req Request) string {
	clean := func(s string) string {
		s = strings.TrimSpace(s)
		for _, p := range []string{"resolved_lid:", "resolved_pn:", "pn:"} {
			if strings.HasPrefix(strings.ToLower(s), p) {
				s = strings.TrimSpace(s[len(p):])
			}
		}
		return s
	}
	for _, id := range req.SenderIDs {
		id = clean(id)
		if id != "" && strings.Contains(id, "@lid") {
			return id
		}
	}
	if req.Evt != nil {
		s := strings.TrimSpace(req.Evt.Info.Sender.String())
		if s != "" {
			return s
		}
	}
	for _, id := range req.SenderIDs {
		id = clean(id)
		if id != "" && !strings.Contains(id, ":") {
			return id
		}
	}
	for _, id := range req.SenderIDs {
		id = clean(id)
		if id != "" {
			return id
		}
	}
	return strings.TrimSpace(req.UserKey)
}

func rpgPost(ctx context.Context, path string, body any) (map[string]any, int, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, 0, err
	}
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, rpgBackendBase()+path, bytes.NewReader(b))
	if err != nil {
		return nil, 0, err
	}
	hreq.Header.Set("Content-Type", "application/json")
	if sec := rpgSecret(); sec != "" {
		hreq.Header.Set("X-RPG-Secret", sec)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(hreq)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var j map[string]any
	_ = json.Unmarshal(rb, &j)
	if j == nil {
		j = map[string]any{}
	}
	if res.StatusCode >= 400 {
		msg, _ := j["error"].(string)
		if msg == "" {
			msg = strings.TrimSpace(string(rb))
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", res.StatusCode)
		}
		return j, res.StatusCode, fmt.Errorf("%s", msg)
	}
	return j, res.StatusCode, nil
}

func rpgGet(ctx context.Context, path string) (map[string]any, int, error) {
	hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, rpgBackendBase()+path, nil)
	if err != nil {
		return nil, 0, err
	}
	if sec := rpgSecret(); sec != "" {
		hreq.Header.Set("X-RPG-Secret", sec)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(hreq)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var j map[string]any
	_ = json.Unmarshal(rb, &j)
	if j == nil {
		j = map[string]any{}
	}
	if res.StatusCode >= 400 {
		msg, _ := j["error"].(string)
		if msg == "" {
			msg = strings.TrimSpace(string(rb))
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", res.StatusCode)
		}
		return j, res.StatusCode, fmt.Errorf("%s", msg)
	}
	return j, res.StatusCode, nil
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}
func asInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	}
	return 0
}
func asStr(v any) string { s, _ := v.(string); return s }
