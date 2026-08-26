// YouTube downloader backend via E2B sandbox (yt-dlp).
// Alur reverse-eng: situs downloader publik semuanya memblokir IP datacenter Vercel,
// jadi ekstraksi dijalankan di sandbox E2B (IP cloud berbeda) lewat yt-dlp.
// Manajemen sandbox: ID terakhir disimpan di PG (tabel e2b_sandboxes); tiap request
// coba reconnect ke ID tsb (sekaligus memperpanjang timeout); kalau sudah mati ->
// buat sandbox baru + install yt-dlp + simpan ID baru.
const { Sandbox } = require('@e2b/code-interpreter');
const db = require('./db');

const API_KEY = process.env.E2B_API_KEY;
const TTL_MS = 10 * 60 * 1000; // umur sandbox dipanjangkan setiap request
let cached = null; // ponytail: cache per-instance lambda; cukup karena connect murah

async function ensureTable() {
  await db.query('CREATE TABLE IF NOT EXISTS e2b_sandboxes(id text PRIMARY KEY, created_at timestamptz DEFAULT now())');
}

async function getSandbox() {
  if (cached) return cached;
  if (!API_KEY) throw new Error('E2B_API_KEY tidak diset');

  let tableOk = true;
  try {
    await ensureTable();
  } catch {
    tableOk = false; // DB opsional — tetap jalan tanpa persistensi ID
  }

  let lastId;
  if (tableOk) {
    try {
      const r = await db.query('SELECT id FROM e2b_sandboxes ORDER BY created_at DESC LIMIT 1');
      lastId = r.rows[0]?.id;
    } catch {}
  }

  if (lastId) {
    try {
      cached = await Sandbox.connect(lastId, { apiKey: API_KEY, timeoutMs: TTL_MS });
      return cached;
    } catch {} // mati/kadaluarsa -> buat baru
  }

  const sbx = await Sandbox.create({ apiKey: API_KEY, timeoutMs: TTL_MS });
  const inst = await sbx.commands.run('pip install -q yt-dlp', { timeoutMs: 180000 });
  if (inst.exitCode !== 0) throw new Error('Gagal install yt-dlp di sandbox: ' + inst.stderr.slice(-300));
  cached = sbx;
  if (tableOk) {
    db.query('INSERT INTO e2b_sandboxes(id) VALUES ($1) ON CONFLICT DO NOTHING', [sbx.sandboxId]).catch(() => {});
  }
  return sbx;
}

function pickLinks(info, type, quality) {
  // buang manifest streaming (HLS/DASH) — downloader API harus kasih URL file langsung
  const fmts = (info.formats || []).filter(f => f.url && (f.protocol || '').startsWith('http'));
  let list;
  if (type === 'audio') {
    list = fmts.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
    list.sort((a, b) => (b.abr || 0) - (a.abr || 0));
  } else {
    list = fmts.filter(f => f.vcodec !== 'none' && f.height);
    list.sort((a, b) => b.height - a.height);
    if (quality) {
      const q = parseInt(quality, 10);
      if (!isNaN(q)) {
        const exact = list.filter(f => f.height === q);
        if (exact.length) list = exact;
      }
    }
  }
  return list.map(f => ({
    quality: type === 'audio' ? `${Math.round(f.abr || 0)}kbps` : `${f.height}p`,
    ext: f.ext,
    sizeBytes: f.filesize || f.filesize_approx || null,
    hasAudio: type === 'audio' ? true : f.acodec !== 'none',
    url: f.url,
  }));
}

async function downloadYoutube(url, opts = {}) {
  const type = opts.type === 'audio' ? 'audio' : 'video';
  const sbx = await getSandbox();

  await sbx.files.write('/tmp/e2b-yt-url.txt', url);
  const r = await sbx.commands.run(
    'yt-dlp -j --no-warnings --no-playlist -a /tmp/e2b-yt-url.txt',
    { timeoutMs: 90 * 1000 }
  );
  if (r.exitCode !== 0 || !r.stdout.trim()) {
    throw new Error('yt-dlp gagal: ' + (r.stderr || '').trim().slice(-300));
  }

  const info = JSON.parse(r.stdout.split('\n')[0]);
  const links = pickLinks(info, type, opts.quality);
  if (!links.length) throw new Error(`Tidak ada format ${type} yang tersedia untuk video ini`);

  return {
    sandboxId: sbx.sandboxId,
    id: info.id,
    title: info.title,
    thumbnail: info.thumbnail,
    duration: info.duration,
    uploader: info.uploader,
    links,
  };
}

module.exports = { downloadYoutube, getSandbox };
