// Package cache implements a tiny in-process TTL cache used to avoid hitting
// upstream services repeatedly for identical read-only requests.
package cache

import (
	"sync"
	"time"
)

type entry struct {
	value     any
	expiresAt time.Time
}

// Cache is a concurrency-safe TTL map. The zero value is not usable; call New.
type Cache struct {
	mu      sync.RWMutex
	entries map[string]entry
	maxSize int
}

// New creates a cache that keeps at most maxSize entries.
func New(maxSize int) *Cache {
	if maxSize <= 0 {
		maxSize = 300
	}
	return &Cache{entries: make(map[string]entry), maxSize: maxSize}
}

// Get returns the cached value when it is still fresh.
func (c *Cache) Get(key string) (any, bool) {
	c.mu.RLock()
	item, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok || time.Now().After(item.expiresAt) {
		return nil, false
	}
	return item.value, true
}

// Set stores a value for the given TTL, evicting the oldest entries when full.
func (c *Cache) Set(key string, value any, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= c.maxSize {
		var oldestKey string
		var oldest time.Time
		for k, item := range c.entries {
			if oldestKey == "" || item.expiresAt.Before(oldest) {
				oldestKey, oldest = k, item.expiresAt
			}
		}
		delete(c.entries, oldestKey)
	}
	c.entries[key] = entry{value: value, expiresAt: time.Now().Add(ttl)}
}
