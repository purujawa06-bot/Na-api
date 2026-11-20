package bot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const (
	cdpDefaultEndpoint = "wss://light-panda-cdp.onrender.com/"
	cdpHandshakeTimeout = 2 * time.Minute
)

type cdpClient struct {
	conn *websocket.Conn
	ctx  context.Context
	id   int
}

type cdpMsg struct {
	ID        int             `json:"id,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Method    string          `json:"method,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func cdpDial(ctx context.Context, endpoint string) (*cdpClient, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = cdpDefaultEndpoint
	}
	dialCtx, cancel := context.WithTimeout(ctx, cdpHandshakeTimeout)
	defer cancel()
	conn, _, err := websocket.Dial(dialCtx, endpoint, nil)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || strings.Contains(strings.ToLower(err.Error()), "context deadline") || strings.Contains(strings.ToLower(err.Error()), "timeout") {
			return nil, fmt.Errorf("gagal terhubung ke CDP (timeout handshake/koneksi)")
		}
		return nil, fmt.Errorf("gagal terhubung ke CDP: %v", err)
	}
	return &cdpClient{conn: conn, ctx: ctx}, nil
}

func (c *cdpClient) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close(websocket.StatusNormalClosure, "done")
}

func (c *cdpClient) Call(method string, params any, sessionID string) (json.RawMessage, error) {
	c.id++
	m := map[string]any{"id": c.id, "method": method}
	if params != nil {
		m["params"] = params
	}
	if sessionID != "" {
		m["sessionId"] = sessionID
	}
	if err := wsjson.Write(c.ctx, c.conn, m); err != nil {
		return nil, err
	}
	for {
		var resp cdpMsg
		if err := wsjson.Read(c.ctx, c.conn, &resp); err != nil {
			return nil, err
		}
		if resp.ID == c.id {
			if resp.Error != nil {
				return nil, errors.New(resp.Error.Message)
			}
			return resp.Result, nil
		}
	}
}

func (c *cdpClient) EvalAwait(sessionID, expression string) (string, error) {
	raw, err := c.Call("Runtime.evaluate", map[string]any{
		"expression":    expression,
		"returnByValue": true,
		"awaitPromise":  true,
	}, sessionID)
	if err != nil {
		return "", err
	}
	var out struct {
		Result struct {
			Value any `json:"value"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text      string `json:"text"`
			Exception *struct {
				Description string `json:"description"`
				Value       any    `json:"value"`
			} `json:"exception"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	if out.ExceptionDetails != nil {
		msg := strings.TrimSpace(out.ExceptionDetails.Text)
		if out.ExceptionDetails.Exception != nil {
			if desc := strings.TrimSpace(out.ExceptionDetails.Exception.Description); desc != "" {
				if msg == "" || msg == "Uncaught" {
					msg = desc
				} else {
					msg = msg + ": " + desc
				}
			} else if v := out.ExceptionDetails.Exception.Value; v != nil && (msg == "" || msg == "Uncaught") {
				msg = fmt.Sprintf("%v", v)
			}
		}
		if msg != "" {
			return "", fmt.Errorf("js: %s", msg)
		}
	}
	switch v := out.Result.Value.(type) {
	case string:
		return v, nil
	case nil:
		return "", nil
	default:
		b, _ := json.Marshal(v)
		return string(b), nil
	}
}

func (c *cdpClient) WaitFor(sessionID, jsExpr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		raw, err := c.Call("Runtime.evaluate", map[string]any{
			"expression":    jsExpr,
			"returnByValue": true,
		}, sessionID)
		if err == nil {
			var out struct {
				Result struct {
					Value any `json:"value"`
				} `json:"result"`
			}
			if json.Unmarshal(raw, &out) == nil {
				switch v := out.Result.Value.(type) {
				case bool:
					if v {
						return nil
					}
				case string:
					if v == "true" || v == "1" {
						return nil
					}
				}
			}
		}
		if err := cdpSleep(c.ctx, 500*time.Millisecond); err != nil {
			return err
		}
	}
	return fmt.Errorf("timeout menunggu kondisi")
}

func cdpSleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
