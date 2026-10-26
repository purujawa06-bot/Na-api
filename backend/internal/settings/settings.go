// Package settings persists small configuration documents (auto fallback chain
// and featured endpoint) in the optional PostgreSQL settings table.
package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/aimodels"
	"github.com/purujawa06-bot/na-api/backend/internal/db"
)

const (
	chainKey       = "auto_fallback_chain"
	featuredKey    = "featured_endpoint"
	chainCacheTTL  = 60 * time.Second
	createSettings = `CREATE TABLE IF NOT EXISTS settings (
		key VARCHAR(50) PRIMARY KEY,
		value JSONB NOT NULL
	)`
)

// Service exposes the settings documents used by chat and the admin panel.
type Service struct {
	store *db.Store

	mu           sync.RWMutex
	cachedChain  []string
	chainExpires time.Time
}

// New builds a settings service around the shared database store.
func New(store *db.Store) *Service { return &Service{store: store} }

// AutoChain returns the ordered fallback chain for the "auto" model. It never
// fails: a missing database falls back to the compiled-in default.
func (s *Service) AutoChain(ctx context.Context) []string {
	s.mu.RLock()
	if s.cachedChain != nil && time.Now().Before(s.chainExpires) {
		chain := append([]string(nil), s.cachedChain...)
		s.mu.RUnlock()
		return chain
	}
	s.mu.RUnlock()

	chain := append([]string(nil), aimodels.ChainDefault...)
	if s.store.Available() {
		if _, err := s.store.Pool.Exec(ctx, createSettings); err == nil {
			var raw []byte
			err := s.store.Pool.QueryRow(ctx, `SELECT value FROM settings WHERE key = $1`, chainKey).Scan(&raw)
			if err == nil {
				var stored []string
				if json.Unmarshal(raw, &stored) == nil {
					chain = aimodels.NormalizeChain(stored)
				}
			}
		}
	}

	s.mu.Lock()
	s.cachedChain = chain
	s.chainExpires = time.Now().Add(chainCacheTTL)
	s.mu.Unlock()
	return append([]string(nil), chain...)
}

// SetAutoChain validates and stores a new fallback chain.
func (s *Service) SetAutoChain(ctx context.Context, chain []string) ([]string, error) {
	clean := aimodels.NormalizeChain(chain)
	if len(clean) == 0 {
		return nil, fmt.Errorf("invalid chain: provide at least one known model ID")
	}
	if !s.store.Available() {
		return nil, db.ErrNotConfigured
	}
	if _, err := s.store.Pool.Exec(ctx, createSettings); err != nil {
		return nil, fmt.Errorf("ensure settings table: %w", err)
	}
	raw, err := json.Marshal(clean)
	if err != nil {
		return nil, err
	}
	_, err = s.store.Pool.Exec(ctx, `
		INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
		ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`, chainKey, string(raw))
	if err != nil {
		return nil, fmt.Errorf("save auto chain: %w", err)
	}
	s.mu.Lock()
	s.cachedChain = clean
	s.chainExpires = time.Now().Add(chainCacheTTL)
	s.mu.Unlock()
	return clean, nil
}

// Featured returns the featured endpoint document, or nil when unset.
func (s *Service) Featured(ctx context.Context) (json.RawMessage, error) {
	if !s.store.Available() {
		return nil, db.ErrNotConfigured
	}
	if _, err := s.store.Pool.Exec(ctx, createSettings); err != nil {
		return nil, fmt.Errorf("ensure settings table: %w", err)
	}
	var raw []byte
	err := s.store.Pool.QueryRow(ctx, `SELECT value FROM settings WHERE key = $1`, featuredKey).Scan(&raw)
	if err != nil {
		return nil, nil
	}
	return json.RawMessage(raw), nil
}

// SetFeatured stores the featured endpoint document.
func (s *Service) SetFeatured(ctx context.Context, document json.RawMessage) (json.RawMessage, error) {
	if !s.store.Available() {
		return nil, db.ErrNotConfigured
	}
	if _, err := s.store.Pool.Exec(ctx, createSettings); err != nil {
		return nil, fmt.Errorf("ensure settings table: %w", err)
	}
	var stored []byte
	err := s.store.Pool.QueryRow(ctx, `
		INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
		ON CONFLICT (key) DO UPDATE SET value = $2::jsonb
		RETURNING value`, featuredKey, string(document)).Scan(&stored)
	if err != nil {
		return nil, fmt.Errorf("save featured endpoint: %w", err)
	}
	return json.RawMessage(stored), nil
}
