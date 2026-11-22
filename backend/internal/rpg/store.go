package rpg

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errDBUnavailable = errors.New("database is not available")
var errNotFound = errors.New("not found")

type player struct {
	LIDHash      string    `json:"-"`
	LoginCode    string    `json:"login_code,omitempty"`
	Username     string    `json:"username"`
	RP           int       `json:"rp"`
	Level        int       `json:"level"`
	XP           int       `json:"xp"`
	XPToNext     int       `json:"xp_to_next"`
	TotalXP      int       `json:"total_xp"`
	TotalFish    int       `json:"total_fish"`
	FishingSec   int       `json:"fishing_sec"`
	LastActiveAt time.Time `json:"last_active_at"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type playerBlob struct {
	Username   string `json:"username"`
	LoginCode  string `json:"login_code,omitempty"`
	RP         int    `json:"rp"`
	TotalXP    int    `json:"total_xp"`
	TotalFish  int    `json:"total_fish"`
	FishingSec int    `json:"fishing_sec"`
}

type mancingSession struct {
	ID            string
	LIDHash       string
	StartedAt     time.Time
	ExpiresAt     time.Time
	LastHeartbeat time.Time
	ClaimedAt     *time.Time
	ActiveSec     int
	XPAwarded     int
	RPAwarded     int
	Status        string
}

type store struct {
	pool    *pgxpool.Pool
	encKey  []byte
	hmacKey []byte
}

func newStore(pool *pgxpool.Pool) *store {
	key := deriveKey()
	return &store{pool: pool, encKey: key, hmacKey: deriveSubKey(key, "lid-hash")}
}

func deriveKey() []byte {
	raw := strings.TrimSpace(os.Getenv("PURUBOY_RPG_ENC_KEY"))
	if raw != "" {
		if b, err := base64.StdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
			return b
		}
		if b, err := base64.RawStdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
			return b
		}
		if b, err := hex.DecodeString(raw); err == nil && len(b) == 32 {
			return b
		}
		if len(raw) == 32 {
			return []byte(raw)
		}
		sum := sha256.Sum256([]byte(raw))
		return sum[:]
	}
	seed := os.Getenv("PURUBOY_ADMIN_KEY")
	if seed == "" {
		seed = "puruLocal-rpg-dev-key"
	}
	sum := sha256.Sum256([]byte("puruboy-rpg:" + seed))
	return sum[:]
}

func deriveSubKey(key []byte, domain string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(domain))
	return m.Sum(nil)
}

func (s *store) lidHash(lid string) string {
	m := hmac.New(sha256.New, s.hmacKey)
	m.Write([]byte(strings.TrimSpace(lid)))
	return hex.EncodeToString(m.Sum(nil))
}

func (s *store) encrypt(plain []byte, aad string) (string, error) {
	block, err := aes.NewCipher(s.encKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nil, nonce, plain, []byte(aad))
	out := make([]byte, 0, len(nonce)+len(ct))
	out = append(out, nonce...)
	out = append(out, ct...)
	return base64.StdEncoding.EncodeToString(out), nil
}

func (s *store) decrypt(enc string, aad string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(s.encKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(raw) < ns {
		return nil, errors.New("ciphertext too short")
	}
	return gcm.Open(nil, raw[:ns], raw[ns:], []byte(aad))
}

func (s *store) available() bool { return s != nil && s.pool != nil }

func (s *store) init(ctx context.Context) error {
	if !s.available() {
		return errDBUnavailable
	}
	_, err := s.pool.Exec(ctx, `
CREATE TABLE IF NOT EXISTS rpg_players (
  lid_hash TEXT PRIMARY KEY,
  enc_blob TEXT NOT NULL,
  login_code TEXT,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE rpg_players ADD COLUMN IF NOT EXISTS login_code TEXT;
CREATE INDEX IF NOT EXISTS rpg_players_last_active_idx ON rpg_players(last_active_at);
CREATE UNIQUE INDEX IF NOT EXISTS rpg_players_login_code_idx ON rpg_players(login_code) WHERE login_code IS NOT NULL AND login_code <> '';
CREATE TABLE IF NOT EXISTS rpg_mancing_sessions (
  id TEXT PRIMARY KEY,
  lid_hash TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  active_sec INTEGER NOT NULL DEFAULT 0,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  rp_awarded INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS rpg_mancing_sessions_lid_idx ON rpg_mancing_sessions(lid_hash);
`)
	return err
}

func (s *store) getPlayer(ctx context.Context, lid string) (*player, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	lh := s.lidHash(lid)
	row := s.pool.QueryRow(ctx, `SELECT enc_blob, last_active_at, created_at, updated_at FROM rpg_players WHERE lid_hash=$1`, lh)
	var encBlob string
	var lastActive, createdAt, updatedAt time.Time
	if err := row.Scan(&encBlob, &lastActive, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	plain, err := s.decrypt(encBlob, lh)
	if err != nil {
		return nil, fmt.Errorf("decrypt player: %w", err)
	}
	var blob playerBlob
	if err := json.Unmarshal(plain, &blob); err != nil {
		return nil, fmt.Errorf("decode player: %w", err)
	}
	level, xp, need := levelFromTotalXP(blob.TotalXP)
	return &player{
		LIDHash: lh, LoginCode: blob.LoginCode, Username: blob.Username, RP: blob.RP, Level: level, XP: xp, XPToNext: need,
		TotalXP: blob.TotalXP, TotalFish: blob.TotalFish, FishingSec: blob.FishingSec,
		LastActiveAt: lastActive, CreatedAt: createdAt, UpdatedAt: updatedAt,
	}, nil
}

func (s *store) upsertPlayer(ctx context.Context, lid string, mutate func(*playerBlob, bool) error) (*player, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	lh := s.lidHash(lid)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var blob playerBlob
	var createdAt time.Time
	exists := false
	row := tx.QueryRow(ctx, `SELECT enc_blob, created_at FROM rpg_players WHERE lid_hash=$1 FOR UPDATE`, lh)
	var encBlob string
	if err := row.Scan(&encBlob, &createdAt); err == nil {
		exists = true
		plain, err := s.decrypt(encBlob, lh)
		if err != nil {
			return nil, fmt.Errorf("decrypt player: %w", err)
		}
		if err := json.Unmarshal(plain, &blob); err != nil {
			return nil, fmt.Errorf("decode player: %w", err)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	} else {
		createdAt = time.Now().UTC()
		blob = playerBlob{}
	}
	if err := mutate(&blob, exists); err != nil {
		return nil, err
	}
	// ensure login code exists (new player or legacy migration)
	if strings.TrimSpace(blob.LoginCode) == "" {
		code, err := s.generateUniqueLoginCode(ctx, tx)
		if err != nil {
			return nil, err
		}
		blob.LoginCode = code
	}
	plain, err := json.Marshal(blob)
	if err != nil {
		return nil, err
	}
	enc, err := s.encrypt(plain, lh)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if exists {
		_, err = tx.Exec(ctx, `UPDATE rpg_players SET enc_blob=$2, login_code=$3, last_active_at=$4, updated_at=$4 WHERE lid_hash=$1`, lh, enc, blob.LoginCode, now)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO rpg_players(lid_hash,enc_blob,login_code,last_active_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$4)`, lh, enc, blob.LoginCode, now, createdAt)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	level, xp, need := levelFromTotalXP(blob.TotalXP)
	return &player{LIDHash: lh, LoginCode: blob.LoginCode, Username: blob.Username, RP: blob.RP, Level: level, XP: xp, XPToNext: need, TotalXP: blob.TotalXP, TotalFish: blob.TotalFish, FishingSec: blob.FishingSec, LastActiveAt: now, CreatedAt: createdAt, UpdatedAt: now}, nil
}

func (s *store) touchLastActive(ctx context.Context, lid string) {
	if !s.available() {
		return
	}
	lh := s.lidHash(lid)
	_, _ = s.pool.Exec(ctx, `UPDATE rpg_players SET last_active_at=NOW(), updated_at=NOW() WHERE lid_hash=$1`, lh)
}

func (s *store) touchByHash(ctx context.Context, lh string) {
	if !s.available() {
		return
	}
	_, _ = s.pool.Exec(ctx, `UPDATE rpg_players SET last_active_at=NOW(), updated_at=NOW() WHERE lid_hash=$1`, lh)
}

func randomLoginCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

func (s *store) generateUniqueLoginCode(ctx context.Context, tx pgx.Tx) (string, error) {
	for i := 0; i < 40; i++ {
		code, err := randomLoginCode()
		if err != nil {
			return "", err
		}
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM rpg_players WHERE login_code=$1)`, code).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return code, nil
		}
	}
	// fallback: 6-digit if 4-digit space crowded
	for i := 0; i < 40; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(1000000))
		if err != nil {
			return "", err
		}
		code := fmt.Sprintf("%06d", n.Int64())
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM rpg_players WHERE login_code=$1)`, code).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return code, nil
		}
	}
	return "", errors.New("gagal membuat kode login unik")
}

func (s *store) getPlayerByCode(ctx context.Context, code string) (*player, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, errNotFound
	}
	row := s.pool.QueryRow(ctx, `SELECT lid_hash, enc_blob, last_active_at, created_at, updated_at FROM rpg_players WHERE login_code=$1`, code)
	var lh, encBlob string
	var lastActive, createdAt, updatedAt time.Time
	if err := row.Scan(&lh, &encBlob, &lastActive, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	plain, err := s.decrypt(encBlob, lh)
	if err != nil {
		return nil, fmt.Errorf("decrypt player: %w", err)
	}
	var blob playerBlob
	if err := json.Unmarshal(plain, &blob); err != nil {
		return nil, fmt.Errorf("decode player: %w", err)
	}
	level, xp, need := levelFromTotalXP(blob.TotalXP)
	return &player{LIDHash: lh, LoginCode: blob.LoginCode, Username: blob.Username, RP: blob.RP, Level: level, XP: xp, XPToNext: need, TotalXP: blob.TotalXP, TotalFish: blob.TotalFish, FishingSec: blob.FishingSec, LastActiveAt: lastActive, CreatedAt: createdAt, UpdatedAt: updatedAt}, nil
}

func randomID(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *store) createMancingSession(ctx context.Context, lid string, ttl time.Duration) (*mancingSession, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	lh := s.lidHash(lid)
	id, err := randomID(16)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	exp := now.Add(ttl)
	_, err = s.pool.Exec(ctx, `INSERT INTO rpg_mancing_sessions(id,lid_hash,started_at,expires_at,last_heartbeat_at,status) VALUES($1,$2,$3,$4,$3,'active')`, id, lh, now, exp)
	if err != nil {
		return nil, err
	}
	return &mancingSession{ID: id, LIDHash: lh, StartedAt: now, ExpiresAt: exp, LastHeartbeat: now, Status: "active"}, nil
}

func (s *store) getMancingSession(ctx context.Context, id string) (*mancingSession, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	row := s.pool.QueryRow(ctx, `SELECT id,lid_hash,started_at,expires_at,last_heartbeat_at,claimed_at,active_sec,xp_awarded,rp_awarded,status FROM rpg_mancing_sessions WHERE id=$1`, id)
	var ms mancingSession
	var claimedAt *time.Time
	if err := row.Scan(&ms.ID, &ms.LIDHash, &ms.StartedAt, &ms.ExpiresAt, &ms.LastHeartbeat, &claimedAt, &ms.ActiveSec, &ms.XPAwarded, &ms.RPAwarded, &ms.Status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	ms.ClaimedAt = claimedAt
	return &ms, nil
}

func (s *store) heartbeatMancingSession(ctx context.Context, id string, activeSecDelta int) (*mancingSession, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	activeSecDelta = clampInt(activeSecDelta, 0, 120) // max 2 menit per heartbeat
	row := s.pool.QueryRow(ctx, `UPDATE rpg_mancing_sessions SET last_heartbeat_at=NOW(), active_sec=LEAST(active_sec+$2, 7200) WHERE id=$1 AND status='active' AND expires_at>NOW() RETURNING id,lid_hash,started_at,expires_at,last_heartbeat_at,claimed_at,active_sec,xp_awarded,rp_awarded,status`, id, activeSecDelta)
	var ms mancingSession
	var claimedAt *time.Time
	if err := row.Scan(&ms.ID, &ms.LIDHash, &ms.StartedAt, &ms.ExpiresAt, &ms.LastHeartbeat, &claimedAt, &ms.ActiveSec, &ms.XPAwarded, &ms.RPAwarded, &ms.Status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	ms.ClaimedAt = claimedAt
	return &ms, nil
}

func (s *store) claimMancingSession(ctx context.Context, id string, lidHash string, activeSec int, rpGain int, fishCount int) (*mancingSession, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	activeSec = clampInt(activeSec, 0, 7200)
	rpGain = clampInt(rpGain, 0, 50000)
	fishCount = clampInt(fishCount, 0, 5000)
	xpGain := xpFromActiveSeconds(activeSec)
	now := time.Now().UTC()
	row := s.pool.QueryRow(ctx, `UPDATE rpg_mancing_sessions SET claimed_at=$2, active_sec=$3, xp_awarded=$4, rp_awarded=$5, status='claimed', last_heartbeat_at=$2 WHERE id=$1 AND lid_hash=$6 AND status='active' RETURNING id,lid_hash,started_at,expires_at,last_heartbeat_at,claimed_at,active_sec,xp_awarded,rp_awarded,status`, id, now, activeSec, xpGain, rpGain, lidHash)
	var ms mancingSession
	var claimedAt *time.Time
	if err := row.Scan(&ms.ID, &ms.LIDHash, &ms.StartedAt, &ms.ExpiresAt, &ms.LastHeartbeat, &claimedAt, &ms.ActiveSec, &ms.XPAwarded, &ms.RPAwarded, &ms.Status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	ms.ClaimedAt = claimedAt
	return &ms, nil
}

func (s *store) cleanupInactive(ctx context.Context, olderThan time.Duration) (int64, error) {
	if !s.available() {
		return 0, errDBUnavailable
	}
	cutoff := time.Now().UTC().Add(-olderThan)
	tag, err := s.pool.Exec(ctx, `DELETE FROM rpg_players WHERE last_active_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	_, _ = s.pool.Exec(ctx, `DELETE FROM rpg_mancing_sessions WHERE started_at < $1`, cutoff)
	return tag.RowsAffected(), nil
}

func (s *store) getPlayerByHash(ctx context.Context, lh string) (*player, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	row := s.pool.QueryRow(ctx, `SELECT enc_blob, last_active_at, created_at, updated_at FROM rpg_players WHERE lid_hash=$1`, lh)
	var encBlob string
	var lastActive, createdAt, updatedAt time.Time
	if err := row.Scan(&encBlob, &lastActive, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	plain, err := s.decrypt(encBlob, lh)
	if err != nil {
		return nil, fmt.Errorf("decrypt player: %w", err)
	}
	var blob playerBlob
	if err := json.Unmarshal(plain, &blob); err != nil {
		return nil, fmt.Errorf("decode player: %w", err)
	}
	level, xp, need := levelFromTotalXP(blob.TotalXP)
	return &player{LIDHash: lh, LoginCode: blob.LoginCode, Username: blob.Username, RP: blob.RP, Level: level, XP: xp, XPToNext: need, TotalXP: blob.TotalXP, TotalFish: blob.TotalFish, FishingSec: blob.FishingSec, LastActiveAt: lastActive, CreatedAt: createdAt, UpdatedAt: updatedAt}, nil
}

func (s *store) applyClaimByHash(ctx context.Context, lh string, rpGain, xpGain, fishCount, activeSec int) (*player, error) {
	if !s.available() {
		return nil, errDBUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	row := tx.QueryRow(ctx, `SELECT enc_blob, created_at FROM rpg_players WHERE lid_hash=$1 FOR UPDATE`, lh)
	var encBlob string
	var createdAt time.Time
	if err := row.Scan(&encBlob, &createdAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	plain, err := s.decrypt(encBlob, lh)
	if err != nil {
		return nil, err
	}
	var blob playerBlob
	if err := json.Unmarshal(plain, &blob); err != nil {
		return nil, err
	}
	blob.RP += clampInt(rpGain, 0, 200000)
	blob.TotalXP += clampInt(xpGain, 0, 100000)
	blob.TotalFish += clampInt(fishCount, 0, 10000)
	blob.FishingSec += clampInt(activeSec, 0, 7200)
	newPlain, err := json.Marshal(blob)
	if err != nil {
		return nil, err
	}
	enc, err := s.encrypt(newPlain, lh)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `UPDATE rpg_players SET enc_blob=$2, last_active_at=$3, updated_at=$3 WHERE lid_hash=$1`, lh, enc, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	level, xp, need := levelFromTotalXP(blob.TotalXP)
	return &player{LIDHash: lh, LoginCode: blob.LoginCode, Username: blob.Username, RP: blob.RP, Level: level, XP: xp, XPToNext: need, TotalXP: blob.TotalXP, TotalFish: blob.TotalFish, FishingSec: blob.FishingSec, LastActiveAt: now, CreatedAt: createdAt, UpdatedAt: now}, nil
}
