// Package config loads runtime settings from environment variables and an
// optional JSON file shared with the Next.js frontend.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config holds all backend settings. Secrets only ever come from environment
// variables, while the shared config.json carries non-secret wiring such as the
// public backend URL and the listening port.
type Config struct {
	// Port is the TCP port the API listens on.
	Port int
	// BackendURL is the public URL of this backend (handy for docs/debugging).
	BackendURL string
	// PGURL is the PostgreSQL connection string. Empty disables database features.
	PGURL string
	// AdminKey protects the admin endpoints.
	AdminKey string
	// GithubToken raises the anonymous GitHub API rate limit when present.
	GithubToken string
	// CloudflareProxy is the fallback fetcher used for Cloudflare-protected sites.
	CloudflareProxy string
	// RequestTimeout bounds upstream calls made on behalf of a client request.
	RequestTimeout time.Duration
}

// fileConfig mirrors the subset of root config.json the backend understands.
type fileConfig struct {
	Port            int    `json:"port"`
	BackendURL      string `json:"backendUrl"`
	RequestTimeoutM int    `json:"requestTimeoutMs"`
}

// Load reads config.json (when present) and then applies environment overrides.
// A broken config file is ignored so the service can still boot from env vars.
func Load() *Config {
	cfg := &Config{
		Port:            8080,
		BackendURL:      "http://localhost:8080",
		CloudflareProxy: "https://vercel-api-beta-red.vercel.app/api/fetch",
		RequestTimeout:  55 * time.Second,
	}

	path := env("CONFIG_PATH", "config.json")
	if raw, err := os.ReadFile(path); err == nil {
		applyFileConfig(cfg, raw)
	} else if raw, err := os.ReadFile(filepath.Join("..", "config.json")); err == nil {
		// Running from backend/ locally: the shared config lives in the repo root.
		applyFileConfig(cfg, raw)
	}

	if port, err := strconv.Atoi(os.Getenv("PORT")); err == nil && port > 0 {
		cfg.Port = port
	}
	cfg.PGURL = os.Getenv("PURUBOY_PG_URL")
	cfg.AdminKey = os.Getenv("PURUBOY_ADMIN_KEY")
	cfg.GithubToken = os.Getenv("GITHUB_TOKEN")
	if proxy := os.Getenv("CF_PROXY"); proxy != "" {
		cfg.CloudflareProxy = proxy
	}
	if seconds, err := strconv.Atoi(os.Getenv("REQUEST_TIMEOUT_SECONDS")); err == nil && seconds > 0 {
		cfg.RequestTimeout = time.Duration(seconds) * time.Second
	}
	return cfg
}

// env returns the environment value for key or fallback when unset.
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// applyFileConfig merges the shared config.json into cfg, ignoring malformed
// content so the service can still boot from environment variables.
func applyFileConfig(cfg *Config, raw []byte) {
	var file fileConfig
	if json.Unmarshal(raw, &file) != nil {
		return
	}
	if file.Port > 0 {
		cfg.Port = file.Port
	}
	if file.BackendURL != "" {
		cfg.BackendURL = strings.TrimRight(file.BackendURL, "/")
	}
	if file.RequestTimeoutM > 0 {
		cfg.RequestTimeout = time.Duration(file.RequestTimeoutM) * time.Millisecond
	}
}
