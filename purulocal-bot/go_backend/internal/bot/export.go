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
// format: "nodejs" atau "python". Mengembalikan nama file zip yang disarankan.
func (m *Manager) ExportZip(format string, w io.Writer) (string, error) {
	format = strings.ToLower(strings.TrimSpace(format))
	var runnerName, runnerContent string
	switch format {
	case "node", "nodejs", "js":
		format = "nodejs"
		runnerName = "index.js"
		runnerContent = nodeRunnerScript()
	case "python", "py":
		format = "python"
		runnerName = "main.py"
		runnerContent = pythonRunnerScript()
	default:
		return "", fmt.Errorf("format tidak didukung: %s (gunakan nodejs atau python)", format)
	}

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
		"note":           "Jalankan runner (index.js/main.py). Runner akan cek auto-update runtime saat startup lalu spawn binary bot.",
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
	cmd := "node index.js"
	if format == "python" {
		cmd = "python3 main.py"
	}
	return "puruLocal Bot export\r\n" +
		"====================\r\n\r\n" +
		"Isi:\r\n" +
		"- config.json : konfigurasi bot\r\n" +
		"- data/       : seluruh data lokal (termasuk sesi store.db, plugin, riwayat, dsb)\r\n" +
		"- bin/        : binary bot yang dibundel (jika tersedia)\r\n" +
		"- " + runner + " : skrip runner (spawn binary + auto-update saat startup)\r\n\r\n" +
		"Menjalankan (lokal/cloud):\r\n" +
		"  " + cmd + "\r\n\r\n" +
		"Variabel lingkungan (opsional):\r\n" +
		"- PURULOCAL_CONFIG          : path config (default ./config.json)\r\n" +
		"- PURULOCAL_DATA            : folder data (default ./data)\r\n" +
		"- PURULOCAL_ADDR            : alamat bind UI/API (default 0.0.0.0:8787)\r\n" +
		"- PURULOCAL_UPDATE_MANIFEST : URL manifest update runtime\r\n" +
		"- PURULOCAL_BIN             : path binary bot (override)\r\n\r\n" +
		"Saat startup skrip akan mengecek manifest update runtime. Jika ada versi/arsitektur\r\n" +
		"yang cocok, binary diperbarui lalu dijalankan. Jika tidak ada update cocok, binary\r\n" +
		"yang dibundel/tersedia tetap dijalankan.\r\n"
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

func nodeRunnerScript() string {
	return `#!/usr/bin/env node
'use strict';
/**
 * puruLocal Bot runner (Node.js)
 * - Cek auto-update runtime saat startup (manifest) lalu jalankan binary bot.
 * - Dapat dijalankan lokal maupun di cloud.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

const BASE = __dirname;
const MANIFEST_URL = process.env.PURULOCAL_UPDATE_MANIFEST || 'https://github.com/purujawa06-bot/Na-api/releases/download/purulocal-experiment/update-manifest.json';
const STATE_FILE = path.join(BASE, '.purulocal-runtime.json');
const BIN_DIR = path.join(BASE, 'bin');

function log(msg) { console.log('[purulocal] ' + msg); }
function warn(msg) { console.warn('[purulocal] ' + msg); }

function platformKeys() {
  const p = process.platform; // linux, darwin, win32, android
  const a = process.arch;     // x64, arm64, arm
  const keys = [];
  const plat = p === 'win32' ? 'windows' : p;
  const archs = a === 'x64' ? ['amd64', 'x64'] : a === 'arm64' ? ['arm64', 'aarch64'] : [a];
  for (const ar of archs) {
    keys.push(plat + '-' + ar);
    keys.push(plat + '_' + ar);
    keys.push(ar);
  }
  if (p === 'android' && a === 'arm64') keys.unshift('arm64-v8a', 'android-arm64');
  return keys;
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
  // fallback generic linux x64 keys sometimes named differently
  return null;
}

function candidateBins() {
  const names = process.platform === 'win32'
    ? ['purulocal-bot.exe', 'libpurulocal.exe']
    : ['purulocal-bot', 'libpurulocal-arm64-v8a.so', 'purulocal'];
  const dirs = [BIN_DIR, BASE, path.join(BASE, 'runtime')];
  const out = [];
  for (const d of dirs) for (const n of names) out.push(path.join(d, n));
  return out;
}

function findBinary() {
  if (process.env.PURULOCAL_BIN && fs.existsSync(process.env.PURULOCAL_BIN)) return process.env.PURULOCAL_BIN;
  for (const p of candidateBins()) { try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (e) {} }
  return null;
}

function ensureExec(p) { try { if (process.platform !== 'win32') fs.chmodSync(p, 0o755); } catch (e) {} }

async function autoUpdate() {
  let manifest;
  try {
    const buf = await fetchText(MANIFEST_URL);
    manifest = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    warn('Gagal cek update manifest: ' + e.message);
    return;
  }
  const pick = pickRuntime(manifest);
  if (!pick) { log('Tidak ada runtime cocok di manifest untuk platform ini, lewati update.'); return; }

  const target = path.join(BIN_DIR, process.platform === 'win32' ? 'purulocal-bot.exe' : 'purulocal-bot');
  const state = loadState();
  const rv = manifest.runtimeVersion != null ? String(manifest.runtimeVersion) : '';
  const prev = state[pick.key] || {};
  if (rv && prev.runtimeVersion === rv && prev.sha256 && pick.sha256 && prev.sha256 === pick.sha256 && fs.existsSync(target)) {
    log('Runtime sudah terbaru (' + pick.key + ' rv=' + rv + ').');
    return;
  }
  if (!pick.sha256 && fs.existsSync(target) && prev.url === pick.url && prev.runtimeVersion === rv) {
    log('Runtime sudah sesuai manifest.'); return;
  }

  log('Mengunduh update runtime (' + pick.key + ') ...');
  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const tmp = target + '.download';
    const buf = await fetchText(pick.url);
    fs.writeFileSync(tmp, buf);
    if (pick.sha256) {
      const sum = (await sha256File(tmp)).toLowerCase();
      if (sum !== pick.sha256) {
        fs.unlinkSync(tmp);
        throw new Error('sha256 mismatch: ' + sum + ' != ' + pick.sha256);
      }
    }
    try { fs.renameSync(tmp, target); } catch (e) { fs.copyFileSync(tmp, target); fs.unlinkSync(tmp); }
    ensureExec(target);
    state[pick.key] = { runtimeVersion: rv, sha256: pick.sha256, url: pick.url, updated_at: new Date().toISOString() };
    saveState(state);
    log('Runtime diperbarui: ' + target);
  } catch (e) {
    warn('Update runtime gagal, gunakan binary yang ada: ' + e.message);
  }
}

async function main() {
  if (!process.env.PURULOCAL_CONFIG) process.env.PURULOCAL_CONFIG = path.join(BASE, 'config.json');
  if (!process.env.PURULOCAL_DATA) process.env.PURULOCAL_DATA = path.join(BASE, 'data');
  if (!process.env.PURULOCAL_ADDR) process.env.PURULOCAL_ADDR = '0.0.0.0:8787';

  await autoUpdate();
  const bin = findBinary();
  if (!bin) {
    console.error('[purulocal] Binary bot tidak ditemukan. Pastikan folder bin/ berisi binary yang sesuai platform atau set PURULOCAL_BIN.');
    process.exit(1);
  }
  ensureExec(bin);
  log('Menjalankan: ' + bin);
  log('UI/API: http://' + (process.env.PURULOCAL_ADDR || '0.0.0.0:8787'));

  const child = spawn(bin, process.argv.slice(2), { stdio: 'inherit', env: process.env, cwd: BASE });
  const forward = (sig) => { try { child.kill(sig); } catch (e) {} };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.on('exit', (code, signal) => {
    if (signal) process.exit(128);
    process.exit(code == null ? 1 : code);
  });
}

main().catch((e) => { console.error('[purulocal] fatal:', e); process.exit(1); });
`
}

func pythonRunnerScript() string {
	return `#!/usr/bin/env python3
"""
puruLocal Bot runner (Python)
- Cek auto-update runtime saat startup (manifest) lalu jalankan binary bot.
- Dapat dijalankan lokal maupun di cloud.
"""
import hashlib
import json
import os
import platform
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import urllib.request
from urllib.parse import urljoin

BASE = os.path.dirname(os.path.abspath(__file__))
MANIFEST_URL = os.environ.get('PURULOCAL_UPDATE_MANIFEST', 'https://github.com/purujawa06-bot/Na-api/releases/download/purulocal-experiment/update-manifest.json')
STATE_FILE = os.path.join(BASE, '.purulocal-runtime.json')
BIN_DIR = os.path.join(BASE, 'bin')


def log(msg):
    print('[purulocal] ' + msg, flush=True)


def warn(msg):
    print('[purulocal] ' + msg, file=sys.stderr, flush=True)


def platform_keys():
    p = sys.platform  # linux, darwin, win32
    m = platform.machine().lower()
    keys = []
    plat = 'windows' if p.startswith('win') else ('darwin' if p == 'darwin' else ('linux' if p.startswith('linux') else p))
    if m in ('x86_64', 'amd64'):
        archs = ['amd64', 'x64']
    elif m in ('aarch64', 'arm64'):
        archs = ['arm64', 'aarch64']
    else:
        archs = [m]
    for ar in archs:
        keys.extend([plat + '-' + ar, plat + '_' + ar, ar])
    if plat == 'linux' and 'arm64' in archs:
        keys = ['arm64-v8a', 'android-arm64'] + keys
    return keys


def fetch_bytes(url, redirects=5):
    req = urllib.request.Request(url, headers={'User-Agent': 'puruLocal-runner/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_state():
    try:
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(st):
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(st, f, indent=2)
    except Exception:
        pass


def pick_runtime(manifest):
    if not isinstance(manifest, dict):
        return None
    rt = manifest.get('runtime') or {}
    for k in platform_keys():
        v = rt.get(k)
        if isinstance(v, dict) and v.get('url'):
            return {'key': k, 'url': str(v.get('url')), 'sha256': str(v.get('sha256') or '').lower()}
        if isinstance(v, str) and v:
            return {'key': k, 'url': v, 'sha256': ''}
    return None


def candidate_bins():
    if os.name == 'nt':
        names = ['purulocal-bot.exe', 'libpurulocal.exe']
    else:
        names = ['purulocal-bot', 'libpurulocal-arm64-v8a.so', 'purulocal']
    dirs = [BIN_DIR, BASE, os.path.join(BASE, 'runtime')]
    out = []
    for d in dirs:
        for n in names:
            out.append(os.path.join(d, n))
    return out


def find_binary():
    env_bin = os.environ.get('PURULOCAL_BIN')
    if env_bin and os.path.isfile(env_bin):
        return env_bin
    for p in candidate_bins():
        if os.path.isfile(p):
            return p
    return None


def ensure_exec(p):
    if os.name == 'nt':
        return
    try:
        st = os.stat(p).st_mode
        os.chmod(p, st | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except Exception:
        pass


def auto_update():
    try:
        manifest = json.loads(fetch_bytes(MANIFEST_URL).decode('utf-8'))
    except Exception as e:
        warn('Gagal cek update manifest: ' + str(e))
        return
    pick = pick_runtime(manifest)
    if not pick:
        log('Tidak ada runtime cocok di manifest untuk platform ini, lewati update.')
        return

    target = os.path.join(BIN_DIR, 'purulocal-bot.exe' if os.name == 'nt' else 'purulocal-bot')
    state = load_state()
    rv = str(manifest.get('runtimeVersion') or '')
    prev = state.get(pick['key']) or {}
    if rv and prev.get('runtimeVersion') == rv and prev.get('sha256') and pick['sha256'] and prev.get('sha256') == pick['sha256'] and os.path.isfile(target):
        log('Runtime sudah terbaru (' + pick['key'] + ' rv=' + rv + ').')
        return
    if not pick['sha256'] and os.path.isfile(target) and prev.get('url') == pick['url'] and prev.get('runtimeVersion') == rv:
        log('Runtime sudah sesuai manifest.')
        return

    log('Mengunduh update runtime (' + pick['key'] + ') ...')
    try:
        os.makedirs(BIN_DIR, exist_ok=True)
        tmp = target + '.download'
        data = fetch_bytes(pick['url'])
        with open(tmp, 'wb') as f:
            f.write(data)
        if pick['sha256']:
            s = sha256_file(tmp).lower()
            if s != pick['sha256']:
                try:
                    os.remove(tmp)
                except Exception:
                    pass
                raise Exception('sha256 mismatch: ' + s + ' != ' + pick['sha256'])
        try:
            os.replace(tmp, target)
        except Exception:
            shutil.copyfile(tmp, target)
            try:
                os.remove(tmp)
            except Exception:
                pass
        ensure_exec(target)
        state[pick['key']] = {'runtimeVersion': rv, 'sha256': pick['sha256'], 'url': pick['url']}
        save_state(state)
        log('Runtime diperbarui: ' + target)
    except Exception as e:
        warn('Update runtime gagal, gunakan binary yang ada: ' + str(e))


def main():
    os.environ.setdefault('PURULOCAL_CONFIG', os.path.join(BASE, 'config.json'))
    os.environ.setdefault('PURULOCAL_DATA', os.path.join(BASE, 'data'))
    os.environ.setdefault('PURULOCAL_ADDR', '0.0.0.0:8787')

    auto_update()
    bin_path = find_binary()
    if not bin_path:
        print('[purulocal] Binary bot tidak ditemukan. Pastikan folder bin/ berisi binary yang sesuai platform atau set PURULOCAL_BIN.', file=sys.stderr)
        sys.exit(1)
    ensure_exec(bin_path)
    log('Menjalankan: ' + bin_path)
    log('UI/API: http://' + (os.environ.get('PURULOCAL_ADDR') or '0.0.0.0:8787'))

    child = subprocess.Popen([bin_path] + sys.argv[1:], cwd=BASE, env=os.environ.copy())

    def forward(sig, frame):
        try:
            child.send_signal(sig)
        except Exception:
            pass

    signal.signal(signal.SIGINT, forward)
    try:
        signal.signal(signal.SIGTERM, forward)
    except Exception:
        pass
    code = child.wait()
    sys.exit(code)


if __name__ == '__main__':
    main()
`
}
