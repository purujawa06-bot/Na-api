package content

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	chatSecret        = "PuruBoyChatSecureKey2025"
	chatWindowLimit   = 500
	chatSpamWindow    = 2 * time.Second
	chatTimestampSkew = 60 * time.Second
)

// chatMessage is one board entry. Column names stay snake_case because the JS
// route returned raw pg rows.
type chatMessage struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	Message   string  `json:"message"`
	DeviceID  *string `json:"device_id"`
	CreatedAt string  `json:"created_at"`
}

// chatPollResult is the lightweight polling payload.
type chatPollResult struct {
	Date     *string `json:"date"`
	IsLatest bool    `json:"isLatest"`
}

const createChatsTable = `CREATE TABLE IF NOT EXISTS chats (
	id UUID PRIMARY KEY,
	username TEXT NOT NULL,
	message TEXT NOT NULL,
	device_id TEXT,
	created_at TIMESTAMPTZ DEFAULT NOW()
)`

// ensureChatsTable creates the table and adds the device_id migration column.
func (h *handler) ensureChatsTable(ctx context.Context) {
	pool := h.pool()
	if pool == nil {
		return
	}
	if _, err := pool.Exec(ctx, createChatsTable); err != nil {
		return
	}
	_, _ = pool.Exec(ctx, `ALTER TABLE chats ADD COLUMN IF NOT EXISTS device_id TEXT`)
}

// getChatMessages returns the newest 500 messages, or everything after a
// timestamp, ordered oldest-first.
func (h *handler) getChatMessages(ctx context.Context, after string) ([]chatMessage, error) {
	pool := h.pool()
	if pool == nil {
		return nil, errDatabaseUnavailable
	}
	h.ensureChatsTable(ctx)

	var (
		rows pgx.Rows
		err  error
	)
	if after != "" {
		since, parseErr := time.Parse(time.RFC3339, after)
		if parseErr != nil {
			return nil, fmt.Errorf("invalid after timestamp: %w", parseErr)
		}
		rows, err = pool.Query(ctx, `
			SELECT id::text, username, message, device_id, created_at
			FROM chats WHERE created_at > $1
			ORDER BY created_at ASC LIMIT $2`, since, chatWindowLimit)
	} else {
		rows, err = pool.Query(ctx, `
			SELECT id::text, username, message, device_id, created_at FROM (
				SELECT id, username, message, device_id, created_at
				FROM chats ORDER BY created_at DESC LIMIT $1
			) sub ORDER BY created_at ASC`, chatWindowLimit)
	}
	if err != nil {
		return nil, fmt.Errorf("fetch chat messages: %w", err)
	}
	defer rows.Close()

	messages := make([]chatMessage, 0, 64)
	for rows.Next() {
		var (
			message   chatMessage
			createdAt time.Time
		)
		if err := rows.Scan(&message.ID, &message.Username, &message.Message, &message.DeviceID, &createdAt); err != nil {
			return nil, fmt.Errorf("scan chat message: %w", err)
		}
		message.CreatedAt = isoTime(createdAt)
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chat messages: %w", err)
	}
	return messages, nil
}

// latestChatTimestamp returns the newest message time as an ISO string, or nil
// for an empty board.
func (h *handler) latestChatTimestamp(ctx context.Context) (*string, error) {
	pool := h.pool()
	if pool == nil {
		return nil, errDatabaseUnavailable
	}
	h.ensureChatsTable(ctx)

	var createdAt time.Time
	err := pool.QueryRow(ctx, `SELECT created_at FROM chats ORDER BY created_at DESC LIMIT 1`).
		Scan(&createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("fetch latest chat timestamp: %w", err)
	}
	value := isoTime(createdAt)
	return &value, nil
}

// chatSpamBlocked reports whether the device posted within the last 2 seconds.
func (h *handler) chatSpamBlocked(ctx context.Context, deviceID string) (bool, error) {
	if deviceID == "" {
		return false, nil
	}
	pool := h.pool()
	if pool == nil {
		return false, errDatabaseUnavailable
	}
	h.ensureChatsTable(ctx)

	var last time.Time
	err := pool.QueryRow(ctx, `
		SELECT created_at FROM chats
		WHERE device_id = $1 ORDER BY created_at DESC LIMIT 1`, deviceID).
		Scan(&last)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check chat spam: %w", err)
	}
	return time.Since(last.UTC()) < chatSpamWindow, nil
}

// addChatMessage inserts a message and prunes the board to the newest 500.
func (h *handler) addChatMessage(ctx context.Context, username, message, deviceID string) (*chatMessage, error) {
	pool := h.pool()
	if pool == nil {
		return nil, errDatabaseUnavailable
	}
	h.ensureChatsTable(ctx)

	id, err := newUUID()
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO chats (id, username, message, device_id) VALUES ($1::uuid, $2, $3, $4)`,
		id, username, message, deviceID); err != nil {
		return nil, fmt.Errorf("insert chat message: %w", err)
	}

	if _, err := pool.Exec(ctx, `
		DELETE FROM chats WHERE id NOT IN (
			SELECT id FROM chats ORDER BY created_at DESC LIMIT $1
		)`, chatWindowLimit); err != nil {
		return nil, fmt.Errorf("prune chat messages: %w", err)
	}

	device := deviceID
	return &chatMessage{
		ID:        id,
		Username:  username,
		Message:   message,
		DeviceID:  &device,
		CreatedAt: isoTime(time.Now().UTC()),
	}, nil
}

// chatSignature returns the lowercase hex digest the client computes:
// SHA256(deviceId + SECRET_KEY + timestamp).
func chatSignature(deviceID, timestamp string) string {
	sum := sha256.Sum256([]byte(deviceID + chatSecret + timestamp))
	return hex.EncodeToString(sum[:])
}

// getChats handles GET /api/chat (polling and full listing).
func (h *handler) getChats(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("mode") == "poll" {
		latest, err := h.latestChatTimestamp(r.Context())
		if err != nil {
			httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		clientLast := r.URL.Query().Get("lastDate")
		isLatest := latest == nil || clientLast == *latest
		httpx.OK(w, chatPollResult{Date: latest, IsLatest: isLatest})
		return
	}

	messages, err := h.getChatMessages(r.Context(), r.URL.Query().Get("after"))
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	httpx.OK(w, messages)
}

// postChat handles POST /api/chat with the shared HMAC handshake.
func (h *handler) postChat(w http.ResponseWriter, r *http.Request) {
	signature := r.Header.Get("x-signature")
	timestamp := r.Header.Get("x-timestamp")
	deviceID := r.Header.Get("x-device-id")

	if signature == "" || timestamp == "" || deviceID == "" {
		httpx.JSON(w, http.StatusForbidden, map[string]any{"error": "Missing security headers"})
		return
	}

	clientMillis, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		httpx.JSON(w, http.StatusForbidden, map[string]any{"error": "Request expired"})
		return
	}
	difference := time.Now().UnixMilli() - clientMillis
	if difference < 0 {
		difference = -difference
	}
	if difference > chatTimestampSkew.Milliseconds() {
		httpx.JSON(w, http.StatusForbidden, map[string]any{"error": "Request expired"})
		return
	}

	expected := chatSignature(deviceID, timestamp)
	if subtle.ConstantTimeCompare([]byte(signature), []byte(expected)) != 1 {
		httpx.JSON(w, http.StatusForbidden, map[string]any{"error": "Invalid signature"})
		return
	}

	blocked, err := h.chatSpamBlocked(r.Context(), deviceID)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if blocked {
		httpx.JSON(w, http.StatusTooManyRequests, map[string]any{
			"error": "Spam detected. Please wait 2 seconds.",
		})
		return
	}

	var body struct {
		Username *string `json:"username"`
		Message  *string `json:"message"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if body.Username == nil || body.Message == nil || *body.Username == "" || *body.Message == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{
			"error": "Username and message are required",
		})
		return
	}

	newChat, err := h.addChatMessage(r.Context(), *body.Username, *body.Message, deviceID)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusCreated, newChat)
}
