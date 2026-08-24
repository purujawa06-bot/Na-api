/**
 * Klien SoundCloud via api-v2.soundcloud.com — download track (MP3) tanpa browser.
 * Alur (hasil reverse-engineering, Agustus 2026):
 *   1. client_id diambil dari bundle JS situs (a-v2.sndcdn.com/assets/*.js).
 *      Nilai bisa berubah kapan saja -> getClientId() auto-refresh + cache.
 *   2. GET /resolve?url=<permalink>&client_id=.. -> metadata track, termasuk
 *      track_authorization (JWT wajib utk authorize streaming) & media.transcodings.
 *   3. GET <transcoding.url>&client_id=..&track_authorization=.. -> URL file ter-signed.
 *      - protocol "progressive" (preset mp3_1_0): file MP3 tunggal (128 kbps).
 *      - protocol "hls": playlist m3u8 berisi segment MP3 murni (bukan AAC/TS),
 *        jadi segment bisa digabung langsung tanpa ffmpeg.
 *   4. Track policy "SNIP" (Go+ / preview): hanya URL preview 30 detik
 *      (cf-preview-media.sndcdn.com). Field is_preview menandakan hal ini.
 * Catatan: URL ter-signed kedaluwarsa ±1 jam (AWS EpochTime di query Policy/oe).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API = 'https://api-v2.soundcloud.com';
const HOME = 'https://soundcloud.com/';

let cachedClientId = null;

async function fetchClientIdFromAssets() {
  const res = await fetch(HOME, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`soundcloud.com HTTP ${res.status}`);
  const html = decodeEscaped(await res.text());
  const assets = [
    ...new Set(
      [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[A-Za-z0-9_-]+\.js/g)].map((m) => m[0])
    ),
  ];
  // client_id biasanya ada di bundle besar; coba dari yang paling kecil dulu tidak masalah,
  // tapi hemat waktu: pindai semua (maks ~10 file).
  for (const url of assets.reverse()) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(20000),
      });
      const js = await r.text();
      const id = js.match(/client_id["':=\s]+([A-Za-z0-9]{32})/)?.[1];
      if (id) return id;
    } catch {
      /* lanjut asset berikutnya */
    }
  }
  throw new Error('client_id SoundCloud tidak ditemukan di asset JS');
}

export async function getClientId(forceRefresh = false) {
  if (!forceRefresh && cachedClientId) return cachedClientId;
  cachedClientId = await fetchClientIdFromAssets();
  return cachedClientId;
}

function decodeEscaped(s) {
  return s.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
}

async function api(path, params, clientId) {
  const url = `${API}${path}?` + new URLSearchParams({ ...params, client_id: clientId });
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  // client_id kadaluarsa/belum valid -> refresh sekali lalu ulang
  if (res.status === 401 && !params.__retried) {
    const fresh = await getClientId(true);
    return api(path, { ...params, __retried: true }, fresh);
  }
  if (!res.ok) {
    const err = new Error(`SoundCloud API ${path} HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Authorize satu transcoding -> URL file ter-signed. */
async function authorizeTranscoding(track, tr, clientId) {
  const u = new URL(tr.url);
  u.searchParams.set('client_id', clientId);
  if (track.track_authorization) u.searchParams.set('track_authorization', track.track_authorization);
  const res = await fetch(u, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`authorize transcoding HTTP ${res.status}`);
  const j = await res.json();
  return j.url || null;
}

/** Ambil semua segment dari playlist HLS dan gabungkan menjadi buffer MP3 tunggal. */
async function mergeHlsSegments(playlistUrl) {
  const plRes = await fetch(playlistUrl, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!plRes.ok) throw new Error(`playlist HLS HTTP ${plRes.status}`);
  const m3u8 = await plRes.text();
  const segments = m3u8
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const parts = [];
  let total = 0;
  for (const seg of segments.slice(0, 400)) {
    const r = await fetch(seg, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    parts.push(buf);
    total += buf.length;
  }
  if (!parts.length) throw new Error('Tidak ada segment HLS yang berhasil diunduh');
  return { buffer: Buffer.concat(parts), size: total };
}

export async function resolveTrack(soundcloudUrl) {
  const clientId = await getClientId();
  return api('/resolve', { url: soundcloudUrl }, clientId);
}

/**
 * Download track SoundCloud.
 * @returns {Promise<object>} metadata + link stream/download.
 */
export async function downloadSoundCloud(soundcloudUrl) {
  const clientId = await getClientId();
  let track;
  try {
    track = await api('/resolve', { url: soundcloudUrl }, clientId);
  } catch (e) {
    if (e.status === 404) throw new Error('Track tidak ditemukan (URL salah atau track dihapus)');
    throw e;
  }
  if (track.kind !== 'track') throw new Error('URL bukan halaman track SoundCloud');

  const transcodings = track.media?.transcodings || [];
  const progressive = transcodings.find((x) => x.format.protocol === 'progressive');
  const hlsMp3 = transcodings.find((x) => x.format.protocol === 'hls' && x.preset === 'mp3_1_0');
  const hlsAny = transcodings.find((x) => x.format.protocol === 'hls');
  const chosen = progressive || hlsMp3 || hlsAny;
  if (!chosen) throw new Error('Track tidak memiliki format audio yang tersedia');

  const signedUrl = await authorizeTranscoding(track, chosen, clientId);
  const isPreview = /cf-preview-media/.test(signedUrl || '');
  const fullDurationMs = track.full_duration || track.duration;

  const result = {
    id: String(track.id),
    title: track.title,
    permalink_url: track.permalink_url,
    duration_ms: track.policy === 'SNIP' ? track.duration : fullDurationMs,
    artwork_url: track.artwork_url?.replace('-large.jpg', '-t500x500.jpg') || null,
    user: track.user ? { username: track.user.username, avatar_url: track.user.avatar_url } : null,
    genre: track.genre || null,
    playback_count: track.playback_count ?? null,
    policy: track.policy,
    format: chosen.preset.replace('mp3_', '').includes('aac') ? 'aac' : 'mp3',
    protocol: chosen.format.protocol,
    is_preview: isPreview,
    expires_note: 'Link stream kedaluwarsa ±1 jam',
    stream_url: signedUrl,
  };

  // Progressive = file tunggal; sediakan juga gabungan HLS bila diminta via opsi.
  if (chosen.format.protocol === 'progressive') {
    result.download_url = signedUrl;
    result.filename = `${track.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_')}.mp3`;
  }

  return result;
}

/**
 * Unduh & gabungkan audio menjadi buffer (dipakai endpoint dengan ?raw=1).
 * Prioritas: progressive (file tunggal) -> HLS mp3 digabung.
 */
export async function getAudioBuffer(soundcloudUrl) {
  const clientId = await getClientId();
  const track = await api('/resolve', { url: soundcloudUrl }, clientId);
  if (track.kind !== 'track') throw new Error('URL bukan halaman track SoundCloud');

  const transcodings = track.media?.transcodings || [];
  const progressive = transcodings.find((x) => x.format.protocol === 'progressive');
  const hlsMp3 = transcodings.find((x) => x.format.protocol === 'hls' && x.preset === 'mp3_1_0');

  if (progressive) {
    const url = await authorizeTranscoding(track, progressive, clientId);
    const res = await fetch(url, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`unduh progressive HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, filename: filenameOf(track), is_preview: /cf-preview-media/.test(url) };
  }

  if (hlsMp3) {
    const url = await authorizeTranscoding(track, hlsMp3, clientId);
    const merged = await mergeHlsSegments(url);
    return { buffer: merged.buffer, filename: filenameOf(track), is_preview: false };
  }

  throw new Error('Tidak ada format audio yang bisa diunduh untuk track ini');
}

function filenameOf(track) {
  return `${track.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 80)}.mp3`;
}
