package content

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	createTempTable = `CREATE TABLE IF NOT EXISTS temp_store (
	id UUID PRIMARY KEY,
	data JSONB NOT NULL,
	expires_at TIMESTAMPTZ NOT NULL
)`
	// tempDefaultTTL matches the JS default of 30 minutes.
	tempDefaultTTL = 30 * time.Minute
)

// saveTempData stores a JSON document and returns its generated ID. It is the
// Go counterpart of tempService.save, kept for callers that cache scrape
// results. A zero ttl falls back to 30 minutes.
func (h *handler) saveTempData(ctx context.Context, data json.RawMessage, ttl time.Duration) (string, error) {
	if !json.Valid(data) {
		return "", errors.New("temp data must be valid JSON")
	}
	if ttl <= 0 {
		ttl = tempDefaultTTL
	}
	pool := h.pool()
	if pool == nil {
		return "", errDatabaseUnavailable
	}
	h.ensureTempTable(ctx)

	id, err := newUUID()
	if err != nil {
		return "", err
	}
	expiresAt := time.Now().UTC().Add(ttl)
	if _, err := pool.Exec(ctx,
		`INSERT INTO temp_store (id, data, expires_at) VALUES ($1::uuid, $2::jsonb, $3)`,
		id, string(data), expiresAt); err != nil {
		return "", fmt.Errorf("insert temp data: %w", err)
	}
	return id, nil
}

// ensureTempTable creates the temp store table when possible.
func (h *handler) ensureTempTable(ctx context.Context) {
	pool := h.pool()
	if pool == nil {
		return
	}
	_, _ = pool.Exec(ctx, createTempTable)
}

// getTempData returns the stored JSON document, or nil when it is missing or
// expired.
func (h *handler) getTempData(ctx context.Context, id string) (json.RawMessage, error) {
	if !validUUID(id) {
		return nil, nil
	}
	pool := h.pool()
	if pool == nil {
		return nil, errDatabaseUnavailable
	}
	h.ensureTempTable(ctx)

	var raw []byte
	err := pool.QueryRow(ctx,
		`SELECT data FROM temp_store WHERE id = $1::uuid AND expires_at > NOW()`, id).
		Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("fetch temp data: %w", err)
	}
	if raw == nil {
		return nil, nil
	}
	return json.RawMessage(raw), nil
}

// getTemp handles GET /api/temp/{id}.
func (h *handler) getTemp(w http.ResponseWriter, r *http.Request) {
	data, err := h.getTempData(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Terjadi kesalahan internal saat mengambil data.",
		})
		return
	}
	if data == nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{
			"error": "Data tidak ditemukan atau sudah kadaluarsa (Expired).",
		})
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}
