package content

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
)

// handler carries the shared dependencies for every content endpoint.
type handler struct {
	deps *app.Deps
}

// pool returns the pgx pool, or nil when the database is not configured.
func (h *handler) pool() *pgxpool.Pool {
	if h == nil || h.deps == nil || h.deps.DB == nil {
		return nil
	}
	return h.deps.DB.Pool
}

// dbAvailable reports whether queries can run.
func (h *handler) dbAvailable() bool {
	if h == nil || h.deps == nil || h.deps.DB == nil {
		return false
	}
	return h.deps.DB.Available()
}

// adminKey returns the configured admin secret.
func (h *handler) adminKey() string {
	if h == nil || h.deps == nil || h.deps.Config == nil {
		return ""
	}
	return h.deps.Config.AdminKey
}

// adminAuthorized reports whether the request carries the admin key in the
// Authorization header, mirroring the Next.js routes.
func (h *handler) adminAuthorized(r *http.Request) bool {
	return h.matchesAdminKey(r.Header.Get("Authorization"))
}

// matchesAdminKey compares candidate with the configured key in constant time.
// An unset key never authorizes anything.
func (h *handler) matchesAdminKey(candidate string) bool {
	key := h.adminKey()
	if key == "" || len(candidate) != len(key) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(key)) == 1
}

var uuidPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
)

// validUUID reports whether value is a canonical UUID string.
func validUUID(value string) bool { return uuidPattern.MatchString(value) }

// newUUID returns a random RFC 4122 version 4 UUID.
func newUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate uuid: %w", err)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x",
		bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}

// isoTime formats t the way JavaScript's Date#toISOString does: UTC, always
// three fractional digits, trailing Z.
func isoTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// errNotFound marks a missing database row.
var errNotFound = errors.New("Post not found")

// errDatabaseUnavailable is returned when the pool is not configured.
var errDatabaseUnavailable = errors.New("database is not available")

// quoteIdent is deliberately absent: every statement below uses constants or
// parameter placeholders, never interpolated user input.

// normalizeText lowercases and collapses runs of whitespace, matching the JS
// duplicate-title helper.
func normalizeText(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}
