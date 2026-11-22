package rpg

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/purujawa06-bot/na-api/backend/internal/app"
	"github.com/purujawa06-bot/na-api/backend/internal/httpx"
)

//go:embed mancing.html
var mancingFS embed.FS

type handler struct {
	deps        *app.Deps
	store       *store
	secret      []byte
	initOnce    sync.Once
	initErr     error
	cleanupOnce sync.Once
}

func newHandler(deps *app.Deps) *handler {
	var pool = deps.DB.Pool
	sec := strings.TrimSpace(os.Getenv("PURUBOY_RPG_SECRET"))
	if sec == "" {
		sec = strings.TrimSpace(os.Getenv("PURUBOY_ADMIN_KEY"))
	}
	if sec == "" {
		sec = "dev-rpg-secret"
	}
	sum := sha256.Sum256([]byte("rpg-secret:" + sec))
	return &handler{deps: deps, store: newStore(pool), secret: sum[:]}
}

func (h *handler) ensureInit(ctx context.Context) error {
	h.initOnce.Do(func() {
		if !h.store.available() {
			h.initErr = errDBUnavailable
			return
		}
		c, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		h.initErr = h.store.init(c)
	})
	return h.initErr
}

func (h *handler) startCleanupWorker() {
	h.cleanupOnce.Do(func() {
		go func() {
			// initial delay to let DB settle
			time.Sleep(5 * time.Second)
			for {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				if err := h.ensureInit(ctx); err == nil {
					_, _ = h.store.cleanupInactive(ctx, 60*24*time.Hour)
				}
				cancel()
				time.Sleep(12 * time.Hour)
			}
		}()
	})
}

func (h *handler) signSession(sessionID string) string {
	m := hmac.New(sha256.New, h.secret)
	m.Write([]byte(sessionID))
	return hex.EncodeToString(m.Sum(nil))
}

func (h *handler) verifySessionToken(token string) (string, bool) {
	parts := strings.SplitN(strings.TrimSpace(token), ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", false
	}
	want := h.signSession(parts[0])
	if !hmac.Equal([]byte(want), []byte(parts[1])) {
		return "", false
	}
	return parts[0], true
}

func (h *handler) makeSessionToken(sessionID string) string {
	return sessionID + "." + h.signSession(sessionID)
}

func (h *handler) authorizedBotRequest(r *http.Request) bool {
	sec := strings.TrimSpace(os.Getenv("PURUBOY_RPG_SECRET"))
	if sec == "" {
		sec = strings.TrimSpace(os.Getenv("PURUBOY_ADMIN_KEY"))
	}
	if sec != "" {
		got := strings.TrimSpace(r.Header.Get("X-RPG-Secret"))
		if got == "" {
			got = strings.TrimSpace(r.Header.Get("Authorization"))
		}
		if got != "" && hmac.Equal([]byte(got), []byte(sec)) {
			return true
		}
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	if httpx.IsLocalHost(host) {
		return true
	}
	return false
}

type registerReq struct {
	LID      string `json:"lid"`
	Username string `json:"username"`
}

func cleanUsername(u string) string {
	u = strings.TrimSpace(u)
	u = strings.Join(strings.Fields(u), " ")
	if len([]rune(u)) > 24 {
		u = string([]rune(u)[:24])
	}
	return u
}

func validUsername(u string) bool {
	if len(u) < 3 || len([]rune(u)) > 24 {
		return false
	}
	for _, r := range u {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == ' ' || r == '.' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func (h *handler) register(w http.ResponseWriter, r *http.Request) {
	if err := h.ensureInit(r.Context()); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !h.authorizedBotRequest(r) {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req registerReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	lid := strings.TrimSpace(req.LID)
	username := cleanUsername(req.Username)
	if lid == "" {
		httpx.Error(w, http.StatusBadRequest, "lid wajib")
		return
	}
	if !validUsername(username) {
		httpx.Error(w, http.StatusBadRequest, "username tidak valid (3-24, huruf/angka/spasi/._-)")
		return
	}
	p, err := h.store.upsertPlayer(r.Context(), lid, func(b *playerBlob, exists bool) error {
		b.Username = username
		if !exists {
			b.RP = 0
			b.TotalXP = 0
			b.TotalFish = 0
			b.FishingSec = 0
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.OK(w, map[string]any{"ok": true, "player": playerResp(p)})
}

func (h *handler) stats(w http.ResponseWriter, r *http.Request) {
	if err := h.ensureInit(r.Context()); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !h.authorizedBotRequest(r) {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	lid := strings.TrimSpace(r.URL.Query().Get("lid"))
	if lid == "" {
		httpx.Error(w, http.StatusBadRequest, "lid wajib")
		return
	}
	p, err := h.store.getPlayer(r.Context(), lid)
	if err != nil {
		if err == errNotFound {
			httpx.Error(w, http.StatusNotFound, "player belum terdaftar, gunakan .register <username>")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.store.touchLastActive(r.Context(), lid)
	httpx.OK(w, map[string]any{"ok": true, "player": playerResp(p)})
}

type startReq struct {
	LID string `json:"lid"`
}

func (h *handler) mancingStart(w http.ResponseWriter, r *http.Request) {
	if err := h.ensureInit(r.Context()); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !h.authorizedBotRequest(r) {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req startReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	lid := strings.TrimSpace(req.LID)
	if lid == "" {
		httpx.Error(w, http.StatusBadRequest, "lid wajib")
		return
	}
	p, err := h.store.getPlayer(r.Context(), lid)
	if err != nil {
		if err == errNotFound {
			httpx.Error(w, http.StatusNotFound, "player belum terdaftar, gunakan .register <username>")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	ms, err := h.store.createMancingSession(r.Context(), lid, 2*time.Hour)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	token := h.makeSessionToken(ms.ID)
	base := strings.TrimRight(h.deps.Config.BackendURL, "/")
	url := fmt.Sprintf("%s/api/rpg/mancing?token=%s", base, token)
	httpx.OK(w, map[string]any{"ok": true, "token": token, "url": url, "expires_at": ms.ExpiresAt, "player": playerResp(p)})
}

type hbReq struct {
	Token     string `json:"token"`
	ActiveSec int    `json:"active_sec"`
}

func (h *handler) mancingHeartbeat(w http.ResponseWriter, r *http.Request) {
	if err := h.ensureInit(r.Context()); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	var req hbReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	sid, ok := h.verifySessionToken(req.Token)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "token tidak valid")
		return
	}
	ms, err := h.store.heartbeatMancingSession(r.Context(), sid, req.ActiveSec)
	if err != nil {
		if err == errNotFound {
			httpx.Error(w, http.StatusNotFound, "sesi tidak ditemukan/berakhir")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.store.touchByHash(r.Context(), ms.LIDHash)
	httpx.OK(w, map[string]any{"ok": true, "active_sec": ms.ActiveSec, "xp_preview": xpFromActiveSeconds(ms.ActiveSec)})
}

type catchItem struct {
	ID    string  `json:"id"`
	Count int     `json:"count"`
	Kg    float64 `json:"kg"`
}
type claimReq struct {
	Token     string      `json:"token"`
	ActiveSec int         `json:"active_sec"`
	Catches   []catchItem `json:"catches"`
}

func (h *handler) mancingClaim(w http.ResponseWriter, r *http.Request) {
	if err := h.ensureInit(r.Context()); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	var req claimReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	sid, ok := h.verifySessionToken(req.Token)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "token tidak valid")
		return
	}
	ms, err := h.store.getMancingSession(r.Context(), sid)
	if err != nil {
		if err == errNotFound {
			httpx.Error(w, http.StatusNotFound, "sesi tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ms.Status != "active" {
		httpx.Error(w, http.StatusBadRequest, "sesi sudah diklaim/berakhir")
		return
	}
	// Compute RP from catches (server-authoritative, capped)
	rpGain, fishCount := computeClaimReward(req.Catches, req.ActiveSec)
	activeSec := clampInt(req.ActiveSec, 0, 7200)
	// do not trust client to be higher than heartbeat+reasonable delta
	if activeSec < ms.ActiveSec {
		activeSec = ms.ActiveSec
	}
	if activeSec > ms.ActiveSec+130 {
		activeSec = ms.ActiveSec + 130
	}
	claimed, err := h.store.claimMancingSession(r.Context(), sid, ms.LIDHash, activeSec, rpGain, fishCount)
	if err != nil {
		if err == errNotFound {
			httpx.Error(w, http.StatusBadRequest, "sesi sudah diklaim/berakhir")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Update player by lid hash - need to find lid? We don't store lid. We store lid_hash.
	// Add method to update by lid_hash.
	p, err := h.store.applyClaimByHash(r.Context(), ms.LIDHash, claimed.RPAwarded, claimed.XPAwarded, fishCount, claimed.ActiveSec)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.OK(w, map[string]any{"ok": true, "rp_gained": claimed.RPAwarded, "xp_gained": claimed.XPAwarded, "fish_count": fishCount, "active_sec": claimed.ActiveSec, "player": playerResp(p)})
}

func computeClaimReward(catches []catchItem, activeSec int) (rp int, fish int) {
	// cap by active time: at most ~1 fish per 8s on average, hard cap 450 fish/hour
	maxFish := clampInt(activeSec/6, 0, 900)
	totalFish := 0
	for _, c := range catches {
		if c.Count <= 0 {
			continue
		}
		def, ok := fishTable[c.ID]
		if !ok {
			continue
		}
		n := clampInt(c.Count, 0, 500)
		if totalFish+n > maxFish {
			n = maxFish - totalFish
		}
		if n <= 0 {
			break
		}
		// weight sanity (ignored for RP calc except sanity) - RP uses server table
		_ = clampFloat(c.Kg, 0, 100)
		rp += def.RP * n
		totalFish += n
	}
	if rp < 0 {
		rp = 0
	}
	if rp > 200000 {
		rp = 200000
	}
	return rp, totalFish
}

func (h *handler) mancingState(w http.ResponseWriter, r *http.Request) {
	if err := h.ensureInit(r.Context()); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	sid, ok := h.verifySessionToken(token)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "token tidak valid")
		return
	}
	ms, err := h.store.getMancingSession(r.Context(), sid)
	if err != nil {
		if err == errNotFound {
			httpx.Error(w, http.StatusNotFound, "sesi tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	p, err := h.store.getPlayerByHash(r.Context(), ms.LIDHash)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.OK(w, map[string]any{"ok": true, "session": map[string]any{"id": ms.ID, "status": ms.Status, "active_sec": ms.ActiveSec, "expires_at": ms.ExpiresAt, "xp_awarded": ms.XPAwarded, "rp_awarded": ms.RPAwarded}, "player": playerResp(p)})
}

func (h *handler) mancingPage(w http.ResponseWriter, r *http.Request) {
	b, err := mancingFS.ReadFile("mancing.html")
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "template tidak ditemukan")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(b)
}

func playerResp(p *player) map[string]any {
	if p == nil {
		return nil
	}
	return map[string]any{
		"username":       p.Username,
		"rp":             p.RP,
		"level":          p.Level,
		"xp":             p.XP,
		"xp_to_next":     p.XPToNext,
		"total_xp":       p.TotalXP,
		"total_fish":     p.TotalFish,
		"fishing_sec":    p.FishingSec,
		"last_active_at": p.LastActiveAt,
	}
}

func (h *handler) mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
var _ = fmt.Sprint
