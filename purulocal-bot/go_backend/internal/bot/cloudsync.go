package bot

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const (
	cloudHeartbeatInterval = 3 * time.Second  // heartbeat cloud (cepat/instan)
	localPresencePoll      = 2 * time.Second  // poll status cloud di lokal
	cloudActiveWindow      = 8 * time.Second  // cloud dianggap aktif jika heartbeat < 8s
	syncInterval           = 30 * time.Second
)

// CloudSyncService menangani cloud-first (presence/heartbeat) dan sync data via Firebase RTDB REST.
// book_cloudsync_service
type CloudSyncService struct {
	mgr *Manager

	ctx    context.Context
	cancel context.CancelFunc

	mu              sync.RWMutex
	role            string // "cloud" | "local"
	instanceID      string
	cloudActive     bool
	cloudLastHB     int64 // unix ms
	pausedByCloud   bool
	lastSyncAt      time.Time
	lastSyncErr     string
	syncing         bool
	lastRestartCmdID string
	restartApplying  bool

	startOnce sync.Once
	stopOnce  sync.Once
}

type cloudRestartCommand struct {
	ID   string `json:"id"`
	TS   int64  `json:"ts"`
	Port string `json:"port,omitempty"`
	By   string `json:"by,omitempty"`
}

type rtdbPresence struct {
	TS       int64  `json:"ts"`
	Instance string `json:"instance,omitempty"`
}

type rtdbFile struct {
	Name    string `json:"name"`
	SHA256  string `json:"sha256"`
	MTime   int64  `json:"mtime"`
	Size    int64  `json:"size"`
	DataB64 string `json:"data,omitempty"`
	Deleted bool   `json:"deleted,omitempty"`
}

type syncLocalState struct {
	Files map[string]rtdbFileMeta `json:"files"` // key: rel name
}

type rtdbFileMeta struct {
	SHA256 string `json:"sha256"`
	MTime  int64  `json:"mtime"`
	Size   int64  `json:"size"`
}

func newCloudSyncService(m *Manager) *CloudSyncService {
	role := "local"
	if strings.TrimSpace(os.Getenv("PURULOCAL_CLOUD")) == "1" {
		role = "cloud"
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &CloudSyncService{
		mgr:        m,
		ctx:        ctx,
		cancel:     cancel,
		role:       role,
		instanceID: randomHexID(8),
	}
	s.lastRestartCmdID = s.loadLastRestartCmdID()
	return s
}

func randomHexID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func (s *CloudSyncService) Start() {
	if s == nil {
		return
	}
	s.startOnce.Do(func() {
		go s.loop()
	})
}

func (s *CloudSyncService) Stop() {
	if s == nil {
		return
	}
	s.stopOnce.Do(func() { s.cancel() })
}

func (s *CloudSyncService) Role() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.role
}

func (s *CloudSyncService) CloudActive() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cloudActive
}

func (s *CloudSyncService) PausedByCloud() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pausedByCloud
}

func (s *CloudSyncService) CloudStatus() (enabled bool, role string, cloudActive bool, cloudLastHB int64, pausedByCloud bool, lastSync string, lastErr string) {
	cfg := s.mgr.Config()
	s.mu.RLock()
	defer s.mu.RUnlock()
	ls := ""
	if !s.lastSyncAt.IsZero() {
		ls = s.lastSyncAt.Format(time.RFC3339)
	}
	return strings.TrimSpace(cfg.RTDBURL) != "" && strings.TrimSpace(cfg.DeviceCode) != "", s.role, s.cloudActive, s.cloudLastHB, s.pausedByCloud, ls, s.lastSyncErr
}

// CanLocalPlay mengembalikan apakah instance lokal boleh start/play.
func (s *CloudSyncService) CanLocalPlay() (bool, string) {
	if s == nil {
		return true, ""
	}
	if s.Role() == "cloud" {
		return true, ""
	}
	cfg := s.mgr.Config()
	if !cfg.CloudSyncReady() {
		return true, ""
	}
	if s.CloudActive() {
		return false, "Cloud sedang aktif, bot lokal dipause. Ambil alih setelah cloud offline."
	}
	return true, ""
}

func (s *CloudSyncService) loop() {
	tPresence := time.NewTicker(localPresencePoll)
	tSync := time.NewTicker(syncInterval)
	defer tPresence.Stop()
	defer tSync.Stop()

	// initial tick
	s.tickPresence()
	s.tickSync()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-tPresence.C:
			s.tickPresence()
		case <-tSync.C:
			s.tickSync()
		}
	}
}

func (s *CloudSyncService) tickPresence() {
	cfg := s.mgr.Config()
	if !cfg.CloudSyncReady() {
		s.mu.Lock()
		s.cloudActive = false
		s.pausedByCloud = false
		s.cloudLastHB = 0
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 12*time.Second)
	defer cancel()

	if s.Role() == "cloud" {
		p := rtdbPresence{TS: time.Now().UnixMilli(), Instance: s.instanceID}
		_ = s.rtdbPut(ctx, cfg, "presence/cloud", p)
		// cloud self dianggap aktif
		s.mu.Lock()
		s.cloudActive = true
		s.cloudLastHB = p.TS
		s.pausedByCloud = false
		s.mu.Unlock()
		// cek perintah kontrol (restart cloud)
		s.checkCloudRestartCommand(ctx, cfg)
		return
	}

	// local: baca presence cloud
	var cp rtdbPresence
	err := s.rtdbGet(ctx, cfg, "presence/cloud", &cp)
	active := false
	if err == nil && cp.TS > 0 {
		active = time.Since(time.UnixMilli(cp.TS)) < cloudActiveWindow
	}
	s.mu.Lock()
	prev := s.cloudActive
	s.cloudActive = active
	if cp.TS > 0 {
		s.cloudLastHB = cp.TS
	}
	pausedByCloud := active
	s.pausedByCloud = pausedByCloud
	s.mu.Unlock()

	if active {
		// paksa lokal pause
		s.mgr.ForcePauseByCloud(true)
	} else {
		s.mgr.ForcePauseByCloud(false)
		if prev {
			// transisi cloud aktif -> offline: auto takeover
			s.mgr.AutoTakeoverFromCloud()
		}
	}
}

func (s *CloudSyncService) tickSync() {
	cfg := s.mgr.Config()
	if !cfg.CloudSyncReady() {
		return
	}
	s.mu.Lock()
	if s.syncing {
		s.mu.Unlock()
		return
	}
	s.syncing = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.syncing = false
		s.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(s.ctx, 90*time.Second)
	defer cancel()
	if err := s.doSync(ctx, cfg); err != nil {
		s.mu.Lock()
		s.lastSyncErr = err.Error()
		s.mu.Unlock()
		if s.mgr.logger != nil {
			s.mgr.logger.Warn("cloudsync", err.Error())
		}
		return
	}
	s.mu.Lock()
	s.lastSyncAt = time.Now()
	s.lastSyncErr = ""
	s.mu.Unlock()
}

// isHotDataWriter menentukan apakah instance ini sumber tulis untuk data runtime/hot
// (store.db, ai_history, dll). Cloud aktif => cloud writer, lokal passive; cloud offline => lokal writer.
// book_cloudsync_iswriter
func (s *CloudSyncService) isHotDataWriter() bool {
	if s.Role() == "cloud" {
		return true
	}
	// local writer untuk hot data hanya saat cloud tidak aktif
	return !s.CloudActive()
}

func isConfigFile(name string) bool {
	return name == "config.json"
}

// isHotDataFile: data yang sering berubah (session, history AI, runtime store, dll).
// config.json diperlakukan terpisah (setting: one-way local -> cloud).
func isHotDataFile(name string) bool {
	return !isConfigFile(name)
}

func (s *CloudSyncService) doSync(ctx context.Context, cfg Config) error {
	hotWriter := s.isHotDataWriter()
	isLocal := s.Role() == "local"

	// PUSH:
	// - hot data: hanya sisi aktif/writer (siapa yang "on") -> bolak-balik mengikuti siapa yang on
	// - config (setting owner/system prompt AI, dll): satu arah hanya local -> cloud
	if hotWriter || isLocal {
		if err := s.pushSelected(ctx, cfg, hotWriter /*pushHot*/, isLocal /*pushConfig*/); err != nil {
			return err
		}
	}

	// PULL:
	// - hot data: sisi pasif menarik dari sisi aktif
	// - config: cloud menarik setting dari local; local tidak menarik/menimpa setting dari cloud
	wantPullHot := !hotWriter
	wantPullConfig := !isLocal // cloud pulls config
	if wantPullHot || wantPullConfig {
		if err := s.pullSelected(ctx, cfg, wantPullHot, wantPullConfig); err != nil {
			return err
		}
	}
	return nil
}

func (s *CloudSyncService) pushSelected(ctx context.Context, cfg Config, pushHot, pushConfig bool) error {
	files, err := s.collectLocalFiles()
	if err != nil {
		return err
	}
	remoteMeta, _ := s.fetchRemoteMeta(ctx, cfg)
	for name, lf := range files {
		if isConfigFile(name) {
			if !pushConfig {
				continue
			}
		} else {
			if !pushHot {
				continue
			}
		}
		rm, ok := remoteMeta[name]
		if ok && rm.SHA256 == lf.SHA256 && rm.MTime >= lf.MTime && rm.Size == lf.Size {
			continue
		}
		rf := rtdbFile{Name: name, SHA256: lf.SHA256, MTime: lf.MTime, Size: lf.Size}
		if lf.data != nil {
			rf.DataB64 = base64.StdEncoding.EncodeToString(lf.data)
		} else {
			b, err := s.readLocalFileForSync(name)
			if err != nil {
				continue
			}
			rf.DataB64 = base64.StdEncoding.EncodeToString(b)
			rf.Size = int64(len(b))
			rf.SHA256 = sha256Hex(b)
		}
		if err := s.rtdbPut(ctx, cfg, "files/"+encodeKey(name), rf); err != nil {
			return err
		}
	}
	// simpan state lokal untuk file yang kita kelola (push)
	st := s.loadLocalSyncState()
	for name, lf := range files {
		if (isConfigFile(name) && pushConfig) || (isHotDataFile(name) && pushHot) {
			st[name] = rtdbFileMeta{SHA256: lf.SHA256, MTime: lf.MTime, Size: lf.Size}
		}
	}
	_ = s.saveLocalSyncState(st)
	return nil
}

func (s *CloudSyncService) pullSelected(ctx context.Context, cfg Config, pullHot, pullConfig bool) error {
	remote, err := s.fetchRemoteFiles(ctx, cfg)
	if err != nil {
		return err
	}
	localMeta := s.loadLocalSyncState()
	changedStore := false
	for name, rf := range remote {
		if rf.Deleted {
			continue
		}
		if isConfigFile(name) {
			if !pullConfig {
				continue
			}
		} else {
			if !pullHot {
				continue
			}
		}
		lm, ok := localMeta[name]
		if ok && lm.SHA256 == rf.SHA256 && lm.MTime == rf.MTime {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(rf.DataB64)
		if err != nil || len(data) == 0 {
			continue
		}
		isCfg := isConfigFile(name)
		if isCfg {
			// cloud menerima setting dari local; jaga identity/sync lokal
			data = s.mergeConfigKeepIdentity(data)
		}
		if err := s.applyLocalFile(name, data); err != nil {
			continue
		}
		if isCfg {
			// reload config in-memory
			_ = s.mgr.cfgStore.Load()
		}
		if strings.HasSuffix(strings.ToLower(name), "store.db") {
			changedStore = true
		}
		localMeta[name] = rtdbFileMeta{SHA256: rf.SHA256, MTime: rf.MTime, Size: rf.Size}
	}
	_ = s.saveLocalSyncState(localMeta)
	if changedStore {
		// store diperbarui dari remote: pastikan client tidak memegang DB lama
		s.mgr.OnSyncedStoreDB()
	}
	return nil
}

type localFile struct {
	SHA256 string
	MTime  int64
	Size   int64
	data   []byte // optional preloaded/snapshot
}

func (s *CloudSyncService) collectLocalFiles() (map[string]localFile, error) {
	out := map[string]localFile{}
	dataDir := s.mgr.DataDir()
	cfgPath := s.mgr.ConfigPath()

	// config
	if b, err := os.ReadFile(cfgPath); err == nil {
		out[s.relConfigName()] = localFile{SHA256: sha256Hex(b), MTime: fileMTime(cfgPath), Size: int64(len(b)), data: b}
	}

	// dataDir files
	_ = filepath.WalkDir(dataDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		base := strings.ToLower(filepath.Base(path))
		// skip transient sqlite wal/shm dan sync state internal
		if base == "store.db-wal" || base == "store.db-shm" || base == ".sync_state.json" {
			return nil
		}
		rel, err := filepath.Rel(filepath.Dir(dataDir), path) // prefix with data dir name context? easier: use "data/<rel>"
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		// normalisasi agar selalu "data/..."
		ddBase := filepath.Base(dataDir)
		if !strings.HasPrefix(rel, ddBase+"/") && rel != ddBase {
			rel = filepath.ToSlash(filepath.Join(ddBase, rel))
		}
		if strings.EqualFold(filepath.Base(path), "store.db") {
			// snapshot konsisten
			snap, err := s.snapshotSQLite(path)
			if err != nil {
				// fallback: baca langsung
				b, err2 := os.ReadFile(path)
				if err2 != nil {
					return nil
				}
				out[rel] = localFile{SHA256: sha256Hex(b), MTime: fileMTime(path), Size: int64(len(b)), data: b}
				return nil
			}
			out[rel] = localFile{SHA256: sha256Hex(snap), MTime: fileMTime(path), Size: int64(len(snap)), data: snap}
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		out[rel] = localFile{SHA256: sha256Hex(b), MTime: fileMTime(path), Size: int64(len(b)), data: b}
		return nil
	})
	return out, nil
}

func (s *CloudSyncService) relConfigName() string { return "config.json" }

func (s *CloudSyncService) readLocalFileForSync(name string) ([]byte, error) {
	p := s.absPathForName(name)
	if strings.EqualFold(filepath.Base(p), "store.db") {
		if b, err := s.snapshotSQLite(p); err == nil {
			return b, nil
		}
	}
	return os.ReadFile(p)
}

func (s *CloudSyncService) absPathForName(name string) string {
	name = filepath.FromSlash(name)
	if name == "config.json" || strings.EqualFold(name, filepath.Base(s.mgr.ConfigPath())) {
		return s.mgr.ConfigPath()
	}
	// names like data/...
	dataDir := s.mgr.DataDir()
	ddBase := filepath.Base(dataDir)
	clean := strings.TrimPrefix(name, ddBase+string(filepath.Separator))
	if clean == name {
		clean = strings.TrimPrefix(name, ddBase+"/")
	}
	return filepath.Join(dataDir, clean)
}

func (s *CloudSyncService) controlStatePath() string {
	return filepath.Join(s.mgr.DataDir(), ".cloud_control.json")
}

func (s *CloudSyncService) loadLastRestartCmdID() string {
	b, err := os.ReadFile(s.controlStatePath())
	if err != nil {
		return ""
	}
	var st struct {
		LastRestartID string `json:"last_restart_id"`
	}
	if err := json.Unmarshal(b, &st); err != nil {
		return ""
	}
	return strings.TrimSpace(st.LastRestartID)
}

func (s *CloudSyncService) saveLastRestartCmdID(id string) {
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	st := struct {
		LastRestartID string `json:"last_restart_id"`
	}{LastRestartID: id}
	b, _ := json.MarshalIndent(st, "", "  ")
	_ = os.WriteFile(s.controlStatePath(), b, 0o600)
	s.mu.Lock()
	s.lastRestartCmdID = id
	s.mu.Unlock()
}

// PushConfigNow mendorong config.json saat ini ke RTDB (dipakai agar cloud menerima port baru sebelum restart).
func (s *CloudSyncService) PushConfigNow(ctx context.Context) error {
	cfg := s.mgr.Config()
	if !cfg.CloudSyncReady() {
		return fmt.Errorf("cloud sync belum siap (RTDB/device code)")
	}
	b, err := os.ReadFile(s.mgr.ConfigPath())
	if err != nil {
		return err
	}
	rf := rtdbFile{Name: "config.json", SHA256: sha256Hex(b), MTime: fileMTime(s.mgr.ConfigPath()), Size: int64(len(b)), DataB64: base64.StdEncoding.EncodeToString(b)}
	if err := s.rtdbPut(ctx, cfg, "files/"+encodeKey("config.json"), rf); err != nil {
		return err
	}
	st := s.loadLocalSyncState()
	st["config.json"] = rtdbFileMeta{SHA256: rf.SHA256, MTime: rf.MTime, Size: rf.Size}
	_ = s.saveLocalSyncState(st)
	return nil
}

// RequestCloudRestart menyimpan port (jika ada), push config, lalu mengirim perintah restart ke cloud via RTDB.
// Dipanggil dari sisi lokal (UI) setelah konfirmasi.
func (s *CloudSyncService) RequestCloudRestart(ctx context.Context, port string) error {
	cfg := s.mgr.Config()
	if !cfg.CloudSyncReady() {
		return fmt.Errorf("cloud sync belum siap: set RTDB URL/device code terlebih dahulu")
	}
	if s.Role() == "cloud" {
		return fmt.Errorf("perintah ini hanya dari sisi lokal")
	}
	port = strings.TrimSpace(port)
	if port != "" {
		// simpan port agar tersinkron ke cloud (setting/config local -> cloud)
		newCfg := cfg
		newCfg.Port = FlexString(port)
		if err := s.mgr.SaveConfig(newCfg); err != nil {
			return err
		}
		cfg = s.mgr.Config()
	}
	// pastikan config (port) terkirim segera
	if err := s.PushConfigNow(ctx); err != nil {
		// lanjut coba kirim perintah meski push config gagal? lebih baik laporkan
		return fmt.Errorf("gagal mengirim config ke cloud: %w", err)
	}
	cmd := cloudRestartCommand{ID: randomHexID(12), TS: time.Now().UnixMilli(), Port: port, By: "local"}
	if err := s.rtdbPut(ctx, cfg, "control/cloud_restart", cmd); err != nil {
		return err
	}
	if s.mgr.logger != nil {
		s.mgr.logger.Info("cloudsync", "Perintah restart cloud dikirim (port="+port+")")
	}
	return nil
}

func (s *CloudSyncService) checkCloudRestartCommand(ctx context.Context, cfg Config) {
	if s.Role() != "cloud" {
		return
	}
	s.mu.RLock()
	applying := s.restartApplying
	seen := s.lastRestartCmdID
	s.mu.RUnlock()
	if applying {
		return
	}
	var cmd cloudRestartCommand
	if err := s.rtdbGet(ctx, cfg, "control/cloud_restart", &cmd); err != nil {
		return
	}
	if strings.TrimSpace(cmd.ID) == "" || cmd.ID == seen {
		return
	}
	// tandai diterima agar tidak berulang
	s.saveLastRestartCmdID(cmd.ID)
	s.mu.Lock()
	if s.restartApplying {
		s.mu.Unlock()
		return
	}
	s.restartApplying = true
	s.mu.Unlock()

	if s.mgr.logger != nil {
		s.mgr.logger.Warn("cloudsync", "Menerima perintah restart cloud (port="+strings.TrimSpace(cmd.Port)+"), restart...")
	}
	// terapkan port dari perintah jika ada (agar pasti ikut saat restart), lalu simpan lokal & reload
	if p := strings.TrimSpace(cmd.Port); p != "" {
		cur := s.mgr.Config()
		cur.Port = FlexString(p)
		_ = s.mgr.cfgStore.Save(cur)
		_ = s.mgr.cfgStore.Load()
	}
	// beri jeda singkat agar log/IO sempat flush, lalu minta restart proses
	go func() {
		time.Sleep(1500 * time.Millisecond)
		if s.mgr != nil {
			s.mgr.RequestRestart("cloud restart command")
		}
	}()
}

func (s *CloudSyncService) applyLocalFile(name string, data []byte) error {
	p := s.absPathForName(name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".sync.tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (s *CloudSyncService) mergeConfigKeepIdentity(remoteData []byte) []byte {
	var remote map[string]interface{}
	if err := json.Unmarshal(remoteData, &remote); err != nil {
		return remoteData
	}
	cur := s.mgr.Config()
	if strings.TrimSpace(cur.DeviceCode) != "" {
		remote["device_code"] = cur.DeviceCode
	}
	if strings.TrimSpace(cur.RTDBURL) != "" && strings.TrimSpace(asString(remote["rtdb_url"])) == "" {
		remote["rtdb_url"] = cur.RTDBURL
	}
	b, err := json.MarshalIndent(remote, "", "  ")
	if err != nil {
		return remoteData
	}
	return b
}

func asString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func (s *CloudSyncService) snapshotSQLite(dbPath string) ([]byte, error) {
	if _, err := os.Stat(dbPath); err != nil {
		return nil, err
	}
	tmpDir := filepath.Dir(dbPath)
	tmp := filepath.Join(tmpDir, fmt.Sprintf(".store.snapshot.%s.db", s.instanceID))
	_ = os.Remove(tmp)
	// VACUUM INTO membutuhkan path literal; escape single quote
	escaped := strings.ReplaceAll(tmp, "'", "''")
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)", filepath.ToSlash(dbPath))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if _, err := db.Exec("VACUUM INTO '" + escaped + "'"); err != nil {
		_ = os.Remove(tmp)
		return nil, err
	}
	b, err := os.ReadFile(tmp)
	_ = os.Remove(tmp)
	return b, err
}

func (s *CloudSyncService) fetchRemoteMeta(ctx context.Context, cfg Config) (map[string]rtdbFileMeta, error) {
	files, err := s.fetchRemoteFiles(ctx, cfg)
	if err != nil {
		return nil, err
	}
	out := map[string]rtdbFileMeta{}
	for k, f := range files {
		out[k] = rtdbFileMeta{SHA256: f.SHA256, MTime: f.MTime, Size: f.Size}
	}
	return out, nil
}

func (s *CloudSyncService) fetchRemoteFiles(ctx context.Context, cfg Config) (map[string]rtdbFile, error) {
	var raw map[string]rtdbFile
	if err := s.rtdbGet(ctx, cfg, "files", &raw); err != nil {
		// null/not found -> empty
		return map[string]rtdbFile{}, nil
	}
	out := map[string]rtdbFile{}
	for _, v := range raw {
		if strings.TrimSpace(v.Name) == "" {
			continue
		}
		out[v.Name] = v
	}
	return out, nil
}

func (s *CloudSyncService) localSyncStatePath() string {
	return filepath.Join(s.mgr.DataDir(), ".sync_state.json")
}

func (s *CloudSyncService) loadLocalSyncState() map[string]rtdbFileMeta {
	b, err := os.ReadFile(s.localSyncStatePath())
	if err != nil {
		return map[string]rtdbFileMeta{}
	}
	var st syncLocalState
	if err := json.Unmarshal(b, &st); err != nil || st.Files == nil {
		return map[string]rtdbFileMeta{}
	}
	return st.Files
}

func (s *CloudSyncService) saveLocalSyncState(files map[string]rtdbFileMeta) error {
	st := syncLocalState{Files: files}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.localSyncStatePath(), b, 0o600)
}

func filesToMeta(in map[string]localFile) map[string]rtdbFileMeta {
	out := map[string]rtdbFileMeta{}
	for k, v := range in {
		out[k] = rtdbFileMeta{SHA256: v.SHA256, MTime: v.MTime, Size: v.Size}
	}
	return out
}

func encodeKey(name string) string {
	// RTDB key tidak boleh . $ # [ ] /
	return base64.RawURLEncoding.EncodeToString([]byte(name))
}

func fileMTime(path string) int64 {
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.ModTime().UnixMilli()
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// --- RTDB REST helpers ---

func (s *CloudSyncService) rtdbURL(cfg Config, p string) (string, error) {
	base := strings.TrimSpace(cfg.RTDBURL)
	if base == "" {
		return "", fmt.Errorf("RTDB URL kosong")
	}
	device := strings.TrimSpace(cfg.DeviceCode)
	if device == "" {
		return "", fmt.Errorf("device code kosong")
	}
	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	// scope: purulocal/<device_code>/<p>.json (di bawah base path bila ada)
	trim := strings.Trim(u.Path, "/")
	pp := strings.Trim(p, "/")
	scoped := "purulocal/" + device + "/" + pp
	if trim == "" {
		u.Path = "/" + scoped + ".json"
	} else {
		u.Path = "/" + trim + "/" + scoped + ".json"
	}
	return u.String(), nil
}

func (s *CloudSyncService) rtdbGet(ctx context.Context, cfg Config, p string, out interface{}) error {
	u, err := s.rtdbURL(cfg, p)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("rtdb get %d: %s", resp.StatusCode, string(b))
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(b)) == 0 || bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		return fmt.Errorf("not found")
	}
	return json.Unmarshal(b, out)
}

func (s *CloudSyncService) rtdbPut(ctx context.Context, cfg Config, p string, val interface{}) error {
	u, err := s.rtdbURL(cfg, p)
	if err != nil {
		return err
	}
	body, err := json.Marshal(val)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("rtdb put %d: %s", resp.StatusCode, string(b))
	}
	io.Copy(io.Discard, resp.Body)
	return nil
}

// ensure deterministic iteration helper (not strictly needed)
func sortedKeys(m map[string]localFile) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
