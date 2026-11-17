// Package cdp provides a shared Chrome DevTools Protocol (CDP) client over
// WebSocket with a global handshake/connect timeout, used by features that
// automate a remote browser (e.g. downloader TikTok fallback, JJ renderer).
package cdp

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
	// DefaultEndpoint is the default remote CDP browser endpoint.
	DefaultEndpoint = "wss://light-panda-cdp.onrender.com/"
	// HandshakeTimeout bounds the WebSocket handshake/connect phase (2 minutes),
	// to tolerate slow cold starts of the remote browser.
	HandshakeTimeout = 2 * time.Minute
)

// Client is a minimal CDP client bound to a WebSocket connection and context.
type Client struct {
	Conn *websocket.Conn
	Ctx  context.Context
	id   int
}

// msg is a CDP wire message.
type msg struct {
	ID        int             `json:"id,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Method    string          `json:"method,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// Dial connects to a CDP WebSocket endpoint using the global handshake timeout.
// The returned client uses ctx for subsequent commands/reads; the caller is
// responsible for closing the connection.
func Dial(ctx context.Context, endpoint string) (*Client, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	dialCtx, cancel := context.WithTimeout(ctx, HandshakeTimeout)
	defer cancel()
	conn, _, err := websocket.Dial(dialCtx, endpoint, nil)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || strings.Contains(strings.ToLower(err.Error()), "context deadline") || strings.Contains(strings.ToLower(err.Error()), "timeout") {
			return nil, fmt.Errorf("gagal terhubung ke CDP (timeout handshake/koneksi)")
		}
		return nil, fmt.Errorf("gagal terhubung ke CDP: %v", err)
	}
	return &Client{Conn: conn, Ctx: ctx}, nil
}

// Close closes the underlying WebSocket connection.
func (c *Client) Close() error {
	if c == nil || c.Conn == nil {
		return nil
	}
	return c.Conn.Close(websocket.StatusNormalClosure, "done")
}

// Call sends a CDP command and waits for its response, ignoring events.
func (c *Client) Call(method string, params any, sessionID string) (json.RawMessage, error) {
	c.id++
	m := map[string]any{"id": c.id, "method": method}
	if params != nil {
		m["params"] = params
	}
	if sessionID != "" {
		m["sessionId"] = sessionID
	}
	if err := wsjson.Write(c.Ctx, c.Conn, m); err != nil {
		return nil, err
	}
	for {
		var resp msg
		if err := wsjson.Read(c.Ctx, c.Conn, &resp); err != nil {
			return nil, err
		}
		if resp.ID == c.id {
			if resp.Error != nil {
				return nil, errors.New(resp.Error.Message)
			}
			return resp.Result, nil
		}
		// ignore events
	}
}

// Eval evaluates a JS expression and returns its value as a string.
func (c *Client) Eval(sessionID, expression string) (string, error) {
	raw, err := c.Call("Runtime.evaluate", map[string]any{
		"expression":    expression,
		"returnByValue": true,
		"awaitPromise":  false,
	}, sessionID)
	if err != nil {
		return "", err
	}
	var out struct {
		Result struct {
			Value any `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
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

// EvalAwait evaluates a JS expression and awaits a Promise result.
func (c *Client) EvalAwait(sessionID, expression string) (string, error) {
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
			Text string `json:"text"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	if out.ExceptionDetails != nil && out.ExceptionDetails.Text != "" {
		return "", fmt.Errorf("js: %s", out.ExceptionDetails.Text)
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

// WaitFor polls a JS boolean expression until it becomes true or timeout.
func (c *Client) WaitFor(ctx context.Context, sessionID, jsExpr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		v, err := c.Eval(sessionID, jsExpr)
		if err == nil && (v == "true" || v == "1") {
			return nil
		}
		if err := SleepCtx(ctx, 500*time.Millisecond); err != nil {
			return err
		}
	}
	return fmt.Errorf("timeout menunggu kondisi")
}

// SleepCtx sleeps for d or returns early if ctx is done.
func SleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
