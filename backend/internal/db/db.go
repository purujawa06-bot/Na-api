// Package db opens the optional PostgreSQL pool used by the dynamic content
// endpoints (blogs, chat board, temp store, settings).
package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotConfigured is returned when PURUBOY_PG_URL is missing.
var ErrNotConfigured = errors.New("database is not configured: PURUBOY_PG_URL is unset")

// Store wraps a pgx pool that may be nil when the database is disabled.
type Store struct {
	Pool *pgxpool.Pool
	Err  error
}

// Open creates the pool. A missing DSN is not fatal: dynamic endpoints report
// ErrNotConfigured while every scraper endpoint keeps working.
func Open(ctx context.Context, dsn string) *Store {
	if dsn == "" {
		return &Store{Err: ErrNotConfigured}
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return &Store{Err: fmt.Errorf("connect database: %w", err)}
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return &Store{Err: fmt.Errorf("ping database: %w", err)}
	}
	return &Store{Pool: pool}
}

// Available reports whether queries can run.
func (s *Store) Available() bool { return s != nil && s.Pool != nil }

// Close releases the pool.
func (s *Store) Close() {
	if s != nil && s.Pool != nil {
		s.Pool.Close()
	}
}
