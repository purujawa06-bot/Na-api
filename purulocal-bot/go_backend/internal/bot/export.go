package bot

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const defaultUpdateManifestURL = "https://github.com/purujawa06-bot/Na-api/releases/download/purulocal-experiment/update-manifest.json"

// ExportZip menulis zip ekspor bot (data + skrip runner + info binary) ke w.
// Mengembalikan nama file zip yang disarankan.
func (m *Manager) ExportZip(format string, w io.Writer) (string, error) {
	format = strings.ToLower(strings.TrimSpace(format))
	switch format {
	case "", "node", "nodejs", "js":
		format = "nodejs"
	default:
		return "", fmt.Errorf("format tidak didukung: %s (gunakan nodejs)", format)
	}
	// export hanya diizinkan jika RTDB_URL sudah diisi (sync cloud-first)
	cfg := m.Config()
	if strings.TrimSpace(cfg.RTDBURL) == "" {
		return "", fmt.Errorf("export ditolak: isi RTDB URL di Settings terlebih dahulu (diperlukan untuk sync cloud-first)")
	}
	// pastikan device_code unik & persisten tertanam
	if strings.TrimSpace(cfg.DeviceCode) == "" {
		if ensured, err := m.EnsureDeviceCode(); err == nil {
			cfg = ensured
		} else {
			return "", fmt.Errorf("gagal menyiapkan device code: %w", err)
		}
	}
	runnerName := "index.js"
	runnerContent := NodeRunnerScript()

	root := "purulocal-bot-export"
	zw := zip.NewWriter(w)

	// metadata export
	meta := map[string]any{
		"app":            "puruLocalBot",
		"exported_at":    time.Now().UTC().Format(time.RFC3339),
		"format":         format,
		"runner":         runnerName,
		"manifest_url":   defaultUpdateManifestURL,
		"config_file":    "config.json",
		"data_dir":       "data",
		"binary_hint":    "bin/purulocal-bot",
		"device_code":    cfg.DeviceCode,
		"cloud_first":    true,
		"note":           "Jalankan runner (index.js). Runner cek auto-update runtime saat startup lalu spawn binary bot (mode cloud, sync RTDB).",
	}
	if err := writeZipJSON(zw, root+"/export-info.json", meta); err != nil {
		_ = zw.Close()
		return "", err
	}

	// config
	cfgPath := m.ConfigPath()
	if b, err := os.ReadFile(cfgPath); err == nil {
		if err := writeZipBytes(zw, root+"/config.json", b, 0600); err != nil {
			_ = zw.Close()
			return "", err
		}
	} else {
		// fallback: tulis config saat ini
		cfg := m.Config()
		cfg.Normalize()
		b, _ := json.MarshalIndent(cfg, "", "  ")
		if err := writeZipBytes(zw, root+"/config.json", b, 0600); err != nil {
			_ = zw.Close()
			return "", err
		}
	}

	// data dir
	dataDir := m.DataDir()
	if err := addDirToZip(zw, root+"/data", dataDir); err != nil {
		_ = zw.Close()
		return "", err
	}

	// binary saat ini (jika ada) agar bisa langsung jalan di cloud
	if exe, err := os.Executable(); err == nil && exe != "" {
		if info, err := os.Stat(exe); err == nil && !info.IsDir() {
			// simpan dengan nama asli di bin/ dan salinan canonical
			base := filepath.Base(exe)
			_ = addFileToZip(zw, root+"/bin/"+base, exe, 0755)
			canonical := "purulocal-bot"
			if strings.HasSuffix(strings.ToLower(base), ".exe") {
				canonical = "purulocal-bot.exe"
			}
			if base != canonical {
				_ = addFileToZip(zw, root+"/bin/"+canonical, exe, 0755)
			}
			// catat sha256 binary yang dibundel
			if sum, err := fileSHA256(exe); err == nil {
				_ = writeZipJSON(zw, root+"/bin/bundled-binary.json", map[string]any{
					"name":   base,
					"sha256": sum,
					"os":     runtime.GOOS,
					"arch":   runtime.GOARCH,
				})
			}
		}
	}

	// runner script
	if err := writeZipBytes(zw, root+"/"+runnerName, []byte(runnerContent), 0755); err != nil {
		_ = zw.Close()
		return "", err
	}

	// README singkat
	readme := exportReadme(format, runnerName)
	_ = writeZipBytes(zw, root+"/README.txt", []byte(readme), 0644)

	if err := zw.Close(); err != nil {
		return "", err
	}

	ts := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("purulocal-bot-%s-%s.zip", format, ts)
	return filename, nil
}

func exportReadme(format, runner string) string {
	return "puruLocal Bot export\r\n" +
		"====================\r\n\r\n" +
		"Isi:\r\n" +
		"- config.json : konfigurasi bot\r\n" +
		"- data/       : seluruh data lokal (termasuk sesi store.db, plugin, riwayat, dsb)\r\n" +
		"- bin/        : binary bot yang dibundel (jika tersedia)\r\n" +
		"- " + runner + " : skrip runner (spawn binary + auto-update saat startup)\r\n\r\n" +
		"Menjalankan (lokal/cloud):\r\n" +
		"  node index.js\r\n\r\n" +
		"Variabel lingkungan (opsional):\r\n" +
		"- PURULOCAL_CONFIG          : path config (default ./config.json)\r\n" +
		"- PURULOCAL_DATA            : folder data (default ./data)\r\n" +
		"- PURULOCAL_ADDR            : alamat bind UI/API (override; jika kosong pakai config port atau 0.0.0.0:8787)\r\n" +
		"- PURULOCAL_UPDATE_MANIFEST : URL manifest update runtime\r\n" +
		"- PURULOCAL_BIN             : path binary bot (override)\r\n\r\n" +
		"Saat startup skrip akan mengecek manifest update runtime. Jika ada versi/arsitektur\r\n" +
		"yang cocok, binary diperbarui lalu dijalankan. Jika tidak ada update cocok, binary\r\n" +
		"yang dibundel/tersedia dan kompatibel akan dijalankan. Pastikan runtime untuk\r\n" +
		"platform cloud (mis. linux-amd64/linux-arm64) tersedia di manifest.\r\n"
}

func writeZipBytes(zw *zip.Writer, name string, data []byte, mode fs.FileMode) error {
	h := &zip.FileHeader{Name: filepath.ToSlash(name), Method: zip.Deflate}
	h.SetMode(mode)
	w, err := zw.CreateHeader(h)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func writeZipJSON(zw *zip.Writer, name string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeZipBytes(zw, name, b, 0644)
}

func addFileToZip(zw *zip.Writer, name, srcPath string, mode fs.FileMode) error {
	f, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer f.Close()
	h := &zip.FileHeader{Name: filepath.ToSlash(name), Method: zip.Deflate}
	h.SetMode(mode)
	w, err := zw.CreateHeader(h)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, f)
	return err
}

func addDirToZip(zw *zip.Writer, zipPrefix, srcDir string) error {
	info, err := os.Stat(srcDir)
	if err != nil {
		if os.IsNotExist(err) {
			// tetap buat folder kosong
			h := &zip.FileHeader{Name: filepath.ToSlash(strings.TrimRight(zipPrefix, "/") + "/")}
			h.SetMode(0755)
			_, e := zw.CreateHeader(h)
			return e
		}
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("bukan direktori: %s", srcDir)
	}
	return filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			h := &zip.FileHeader{Name: filepath.ToSlash(strings.TrimRight(zipPrefix, "/") + "/")}
			h.SetMode(0755)
			_, e := zw.CreateHeader(h)
			return e
		}
		name := filepath.ToSlash(strings.TrimRight(zipPrefix, "/") + "/" + rel)
		if d.IsDir() {
			h := &zip.FileHeader{Name: name + "/"}
			h.SetMode(0755)
			_, e := zw.CreateHeader(h)
			return e
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		mode := info.Mode().Perm()
		if mode == 0 {
			mode = 0644
		}
		return addFileToZip(zw, name, path, mode)
	})
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// NodeRunnerScript mengembalikan skrip runner Node.js (index.js) untuk export/cloud.
// book_node_runner_script
func NodeRunnerScript() string {
	return `#!/usr/bin/env node
'use strict';
/**
 * puruLocal Bot runner (Node.js)
 * - Cek auto-update runtime & runner (index.js) via manifest.
 * - Auto-update penting: update index.js lalu auto-restart.
 * - Dapat dijalankan lokal maupun di cloud.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

const BASE = __dirname;
const MANIFEST_URL = process.env.PURULOCAL_UPDATE_MANIFEST || 'https://github.com/purujawa06-bot/Na-api/releases/download/purulocal-experiment/update-manifest.json';
const STATE_FILE = path.join(BASE, '.purulocal-runtime.json');
const BIN_DIR = path.join(BASE, 'bin');
const RUNNER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

let childProc = null;
let restarting = false;
let runnerCheckTimer = null;

function log(msg) { console.log('[purulocal] ' + msg); }
function warn(msg) { console.warn('[purulocal] ' + msg); }

function hostPlatform() {
  const p = process.platform === 'win32' ? 'windows' : process.platform;
  let a = process.arch;
  if (a === 'x64') a = 'amd64';
  if (a === 'arm64') a = 'arm64';
  return { os: p, arch: a };
}

function platformKeys() {
  const h = hostPlatform();
  const archs = h.arch === 'amd64' ? ['amd64', 'x64'] : h.arch === 'arm64' ? ['arm64', 'aarch64'] : [h.arch];
  const keys = [];
  for (const ar of archs) { keys.push(h.os + '-' + ar); keys.push(h.os + '_' + ar); }
  for (const ar of archs) keys.push(ar);
  if (h.os === 'android' && h.arch === 'arm64') keys.unshift('arm64-v8a', 'android-arm64');
  if (h.os === 'linux' && h.arch === 'amd64') keys.unshift('linux-amd64', 'linux-x64');
  if (h.os === 'linux' && h.arch === 'arm64') keys.unshift('linux-arm64', 'linux-aarch64');
  return Array.from(new Set(keys));
}

function fetchText(url, redirects) {
  redirects = redirects == null ? 5 : redirects;
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'puruLocal-runner/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
  });
}

async function fetchManifest() {
  const buf = await fetchText(MANIFEST_URL);
  return JSON.parse(buf.toString('utf8'));
}

function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; } }
function saveState(st) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); } catch (e) {} }

function pickRuntime(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const rt = manifest.runtime || {};
  const keys = platformKeys();
  for (const k of keys) {
    const v = rt[k];
    if (v && typeof v === 'object' && v.url) return { key: k, url: String(v.url), sha256: String(v.sha256 || '').toLowerCase() };
    if (v && typeof v === 'string') return { key: k, url: v, sha256: '' };
  }
  return null;
}

function pickRunner(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  let r = manifest.runner;
  if (typeof r === 'string') r = { url: r };
  if (!r || typeof r !== 'object') {
    // fallback fields
    if (manifest.runnerUrl) r = { url: String(manifest.runnerUrl), sha256: manifest.runnerSha256 || '', important: !!manifest.runnerImportant, version: manifest.runnerVersion || '' };
    else return null;
  }
  const url = r.url || r.href || '';
  if (!url) return null;
  const important = !!(r.important || r.force || r.critical || manifest.runnerImportant || manifest.runnerForce || manifest.importantRunner);
  return {
    url: String(url),
    sha256: String(r.sha256 || r.hash || '').toLowerCase(),
    version: r.version != null ? String(r.version) : (r.runtimeVersion != null ? String(r.runtimeVersion) : ''),
    important: important
  };
}

async function maybeUpdateRunner(manifest) {
  const pick = pickRunner(manifest);
  if (!pick) return { updated: false, important: false };
  const state = loadState();
  const prev = state.runner || {};
  const curSha = prev.sha256 || '';
  let need = false;
  if (pick.sha256 && pick.sha256 !== curSha) need = true;
  if (!pick.sha256 && pick.version && String(pick.version) !== String(prev.version || '')) need = true;
  if (!pick.sha256 && !pick.version && pick.url && pick.url !== prev.url) need = true;
  // jika sha tidak diketahui, coba deteksi perubahan konten saat penting
  if (!need && !pick.sha256 && !pick.version) need = !!pick.important;
  if (!need) return { updated: false, important: pick.important };

  log('Update runner (index.js) terdeteksi' + (pick.important ? ' [PENTING]' : '') + ', mengunduh...');
  try {
    const buf = await fetchText(pick.url);
    const sum = sha256Buffer(buf).toLowerCase();
    if (pick.sha256 && sum !== pick.sha256) throw new Error('sha256 mismatch runner: ' + sum + ' != ' + pick.sha256);
    if (!pick.sha256 && curSha && sum === curSha) {
      // konten sama, perbarui state saja
      state.runner = { sha256: sum, url: pick.url, version: pick.version || '', updated_at: new Date().toISOString() };
      saveState(state);
      return { updated: false, important: pick.important };
    }
    const target = __filename;
    const tmp = target + '.update';
    fs.writeFileSync(tmp, buf);
    try { fs.renameSync(tmp, target); } catch (e) { fs.copyFileSync(tmp, target); try { fs.unlinkSync(tmp); } catch (e2) {} }
    state.runner = { sha256: pick.sha256 || sum, url: pick.url, version: pick.version || '', updated_at: new Date().toISOString() };
    saveState(state);
    log('Runner (index.js) diperbarui.');
    return { updated: true, important: pick.important };
  } catch (e) {
    warn('Gagal update runner (index.js): ' + e.message);
    return { updated: false, important: pick.important, err: e };
  }
}

function restartSelf(reason) {
  if (restarting) return;
  restarting = true;
  log('Restart runner' + (reason ? ' (' + reason + ')' : '') + ' ...');
  if (runnerCheckTimer) { try { clearInterval(runnerCheckTimer); } catch (e) {} }
  if (childProc) { try { childProc.kill('SIGTERM'); } catch (e) {} }
  setTimeout(() => {
    try {
      const child = spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: process.env, cwd: BASE });
      child.on('exit', (code) => process.exit(code == null ? 0 : code));
      child.on('error', () => process.exit(0));
      // lepas runner lama
      setTimeout(() => process.exit(0), 1000);
    } catch (e) {
      process.exit(0);
    }
  }, 500);
}

function loadBundledInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(BIN_DIR, 'bundled-binary.json'), 'utf8')); } catch (e) { return null; }
}

function archNorm(a) {
  a = String(a || '').toLowerCase();
  if (a === 'x64' || a === 'x86_64' || a === 'amd64') return 'amd64';
  if (a === 'arm64' || a === 'aarch64') return 'arm64';
  return a;
}

function bundledCompatible() {
  const info = loadBundledInfo();
  if (!info) return true;
  const h = hostPlatform();
  const osOk = String(info.os || '') === h.os;
  const archOk = archNorm(info.arch) === archNorm(h.arch);
  return osOk && archOk;
}

function candidateBins() {
  const names = process.platform === 'win32'
    ? ['purulocal-bot.exe', 'libpurulocal.exe']
    : ['purulocal-bot', 'purulocal', 'libpurulocal-arm64-v8a.so'];
  const dirs = [BIN_DIR, BASE, path.join(BASE, 'runtime')];
  const out = [];
  for (const d of dirs) for (const n of names) out.push(path.join(d, n));
  return out;
}

function findBinary(downloadedPath) {
  if (process.env.PURULOCAL_BIN && fs.existsSync(process.env.PURULOCAL_BIN)) return { path: process.env.PURULOCAL_BIN, source: 'env' };
  if (downloadedPath && fs.existsSync(downloadedPath)) return { path: downloadedPath, source: 'downloaded' };
  if (!bundledCompatible()) return null;
  for (const p of candidateBins()) {
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return { path: p, source: 'bundled' }; } catch (e) {}
  }
  return null;
}

function ensureExec(p) { try { if (process.platform !== 'win32') fs.chmodSync(p, 0o755); } catch (e) {} }

async function autoUpdateRuntime(manifest) {
  if (!manifest) return { downloaded: null, hasPick: false };
  const pick = pickRuntime(manifest);
  if (!pick) {
    log('Tidak ada runtime cocok di manifest untuk platform ini (' + platformKeys().join(', ') + '). Lewati update runtime.');
    return { downloaded: null, hasPick: false };
  }

  const target = path.join(BIN_DIR, process.platform === 'win32' ? 'purulocal-bot.exe' : 'purulocal-bot');
  const state = loadState();
  const rv = manifest.runtimeVersion != null ? String(manifest.runtimeVersion) : '';
  const prev = state[pick.key] || {};
  if (rv && prev.runtimeVersion === rv && prev.sha256 && pick.sha256 && prev.sha256 === pick.sha256 && fs.existsSync(target)) {
    log('Runtime sudah terbaru (' + pick.key + ' rv=' + rv + ').');
    return { downloaded: target, hasPick: true };
  }
  if (!pick.sha256 && fs.existsSync(target) && prev.url === pick.url && prev.runtimeVersion === rv) {
    log('Runtime sudah sesuai manifest.');
    return { downloaded: target, hasPick: true };
  }

  log('Mengunduh update runtime (' + pick.key + ') ...');
  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const tmp = target + '.download';
    const buf = await fetchText(pick.url);
    fs.writeFileSync(tmp, buf);
    if (pick.sha256) {
      const sum = sha256Buffer(buf).toLowerCase();
      if (sum !== pick.sha256) {
        try { fs.unlinkSync(tmp); } catch (e) {}
        throw new Error('sha256 mismatch: ' + sum + ' != ' + pick.sha256);
      }
    }
    try { fs.renameSync(tmp, target); } catch (e) { fs.copyFileSync(tmp, target); try { fs.unlinkSync(tmp); } catch (e2) {} }
    ensureExec(target);
    state[pick.key] = { runtimeVersion: rv, sha256: pick.sha256, url: pick.url, updated_at: new Date().toISOString() };
    saveState(state);
    log('Runtime diperbarui: ' + target);
    return { downloaded: target, hasPick: true };
  } catch (e) {
    warn('Update runtime gagal, gunakan binary yang ada: ' + e.message);
    return { downloaded: fs.existsSync(target) ? target : null, hasPick: true, err: e };
  }
}

function spawnBinary(bin) {
  if (restarting) return;
  log('Menjalankan: ' + bin.path + ' (' + bin.source + ')');
  log('UI/API: http://' + (process.env.PURULOCAL_ADDR || '0.0.0.0:8787'));
  const child = spawn(bin.path, process.argv.slice(2), { stdio: 'inherit', env: process.env, cwd: BASE });
  childProc = child;
  const forward = (sig) => { try { child.kill(sig); } catch (e) {} };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.on('error', (err) => {
    childProc = null;
    console.error('[purulocal] Gagal menjalankan binary: ' + err.message);
    if (err && (err.code === 'ENOEXEC' || err.code === 'EACCES' || err.code === 'EINVAL')) {
      console.error('[purulocal] Binary tidak kompatibel/dapat dijalankan di platform ini (' + process.platform + '/' + process.arch + '). Pastikan runtime yang sesuai tersedia di manifest atau set PURULOCAL_BIN ke binary yang benar.');
    }
    if (!restarting) process.exit(1);
  });
  child.on('exit', (code, signal) => {
    childProc = null;
    if (restarting) return;
    if (signal) process.exit(128);
    // kode 42: restart diminta (mis. ubah port cloud dari local) -> respawn binary
    if (code === 42) {
      log('Binary meminta restart, memulai ulang dalam 1 detik...');
      setTimeout(() => {
        if (!restarting) spawnBinary(bin);
      }, 1000);
      return;
    }
    process.exit(code == null ? 1 : code);
  });
}

function startRunnerAutoUpdateLoop() {
  if (runnerCheckTimer) return;
  runnerCheckTimer = setInterval(async () => {
    if (restarting) return;
    try {
      const manifest = await fetchManifest();
      const res = await maybeUpdateRunner(manifest);
      if (res && res.updated) {
        // update penting atau ada versi runner baru -> auto restart
        restartSelf(res.important ? 'update penting index.js' : 'update index.js');
      }
    } catch (e) {
      // diamkan, coba lagi interval berikutnya
    }
  }, RUNNER_CHECK_INTERVAL_MS);
  if (runnerCheckTimer && typeof runnerCheckTimer.unref === 'function') runnerCheckTimer.unref();
}

function addrFromConfig(cfgPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
    let p = cfg.port;
    if (p === undefined || p === null) return '';
    p = String(p).trim();
    if (!p) return '';
    return p.indexOf(':') >= 0 ? p : ('0.0.0.0:' + p);
  } catch (e) { return ''; }
}

async function main() {
  if (!process.env.PURULOCAL_CONFIG) process.env.PURULOCAL_CONFIG = path.join(BASE, 'config.json');
  if (!process.env.PURULOCAL_DATA) process.env.PURULOCAL_DATA = path.join(BASE, 'data');
  if (!process.env.PURULOCAL_ADDR) {
    const fromCfg = addrFromConfig(process.env.PURULOCAL_CONFIG);
    process.env.PURULOCAL_ADDR = fromCfg || '0.0.0.0:8787';
  }
  // instance hasil export berjalan sebagai cloud (heartbeat cloud-first)
  if (process.env.PURULOCAL_CLOUD === undefined || process.env.PURULOCAL_CLOUD === '') {
    process.env.PURULOCAL_CLOUD = '1';
  }

  let manifest = null;
  try { manifest = await fetchManifest(); } catch (e) { warn('Gagal cek manifest saat startup: ' + e.message); }

  // Auto-update runner (index.js): jika ada update (terutama penting) -> update & auto restart
  if (manifest) {
    const r = await maybeUpdateRunner(manifest);
    if (r && r.updated) {
      restartSelf(r.important ? 'update penting index.js' : 'update index.js');
      return;
    }
  }

  const upd = await autoUpdateRuntime(manifest);
  const bin = findBinary(upd && upd.downloaded);
  if (!bin) {
    const b = loadBundledInfo();
    console.error('[purulocal] Binary bot yang kompatibel tidak ditemukan untuk platform ' + process.platform + '/' + process.arch + '.');
    if (b && !bundledCompatible()) console.error('[purulocal] Binary yang dibundel berasal dari ' + b.os + '/' + b.arch + ' (tidak kompatibel).');
    console.error('[purulocal] Pastikan runtime untuk platform ini tersedia di manifest: ' + MANIFEST_URL);
    console.error('[purulocal] Atau set PURULOCAL_BIN ke path binary puruLocal yang sesuai platform.');
    process.exit(1);
  }
  ensureExec(bin.path);

  // Cek berkala: jika ada update penting index.js -> otomatis update & restart
  startRunnerAutoUpdateLoop();

  spawnBinary(bin);
}

main().catch((e) => { console.error('[purulocal] fatal:', e); process.exit(1); });
`
}

