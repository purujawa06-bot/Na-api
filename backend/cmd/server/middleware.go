package main

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

const (
	rateWindow = time.Minute
	rateLimit  = 100
	cacheMonth = 7 * 24 * 60 * 60
)

// noStorePrefixes lists dynamic/polling endpoints that must never be cached.
var noStorePrefixes = []string{
	"/api/text2video",
	"/api/text2image",
	"/api/chat",
	"/api/temp",
	"/api/tools-image",
	"/api/uploader",
	"/api/admin",
	"/api/agent-tools",
	"/api/_diag",
	"/api/user-scripts",
	"/api/models",
}

type rateEntry struct {
	count int
	reset time.Time
}

// rateLimiter implements the same fixed-window limit as the Next.js middleware.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]rateEntry
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{buckets: make(map[string]rateEntry)}
}

// retryAfter returns the seconds to wait, or 0 when the caller is allowed.
func (l *rateLimiter) retryAfter(ip string) int {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	entry, exists := l.buckets[ip]
	if !exists || !now.Before(entry.reset) {
		if len(l.buckets) > 5000 {
			for key, bucket := range l.buckets {
				if !now.Before(bucket.reset) {
					delete(l.buckets, key)
				}
			}
		}
		l.buckets[ip] = rateEntry{count: 1, reset: now.Add(rateWindow)}
		return 0
	}
	entry.count++
	l.buckets[ip] = entry
	if entry.count > rateLimit {
		return int(entry.reset.Sub(now).Seconds()) + 1
	}
	return 0
}

func isNoStore(path string) bool {
	for _, prefix := range noStorePrefixes {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// statusRecorder captures the response status for access logging.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (rec *statusRecorder) WriteHeader(status int) {
	rec.status = status
	rec.ResponseWriter.WriteHeader(status)
}

func (rec *statusRecorder) Flush() {
	if flusher, ok := rec.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// withMiddleware wires CORS, rate limiting, cache headers, panic recovery, and
// access logging around the whole API mux.
func withMiddleware(next http.Handler) http.Handler {
	limiter := newRateLimiter()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		recorder.Header().Set("Access-Control-Allow-Origin", "*")
		recorder.Header().Set("Access-Control-Allow-Credentials", "true")
		recorder.Header().Set("Access-Control-Allow-Methods", "GET,DELETE,PATCH,POST,PUT,OPTIONS")
		recorder.Header().Set("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Signature, X-Timestamp, X-Device-Id, Authorization")
		recorder.Header().Set("Contact", "https://t.me/puruboy_hub")

		if r.Method == http.MethodOptions {
			recorder.WriteHeader(http.StatusNoContent)
			return
		}

		if retryAfter := limiter.retryAfter(httpx.ClientIP(r)); retryAfter > 0 {
			recorder.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			httpx.Error(recorder, http.StatusTooManyRequests, "Too Many Requests")
			return
		}

		if isNoStore(r.URL.Path) {
			httpx.SetNoStore(recorder)
		} else {
			httpx.SetCacheable(recorder, cacheMonth)
		}

		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("[panic] %s %s: %v", r.Method, r.URL.Path, recovered)
				httpx.Error(recorder, http.StatusInternalServerError, "Internal Server Error")
			}
			log.Printf("[http] %s %s -> %d (%s)", r.Method, r.URL.Path, recorder.status, time.Since(started).Round(time.Millisecond))
		}()

		next.ServeHTTP(recorder, r)
	})
}
