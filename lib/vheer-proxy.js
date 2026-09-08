/**
 * Helper untuk offload job lama (long-running) ke Background HTTP Job API
 * di https://nirkyy-a.hf.space/ sehingga tidak kena timeout serverless
 * Vercel (max 60s).
 *
 * Alur:
 *   1. POST /create/{job_id}  -> jalankan HTTP request di background
 *   2. GET  /{job_id}         -> "process" (masih jalan) atau raw HTTP response
 *
 * Job disimpan 1 jam di memori proxy, lalu dihapus otomatis.
 */

const PROXY_BASE = process.env.PROXY_JOB_BASE || 'https://nirkyy-a.hf.space';

/**
 * Escape aman untuk konten XML (agar prompt/body tidak merusak struktur).
 */
function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Buat job background di proxy.
 * @param {string} jobId - id job (boleh sama untuk overwrite job lama)
 * @param {object} opts
 * @param {'get'|'post'} [opts.method='get']
 * @param {string} opts.targetUrl - URL yang dipanggil proxy
 * @param {object} [opts.headers={}] - headers JSON
 * @param {object} [opts.body={}] - body JSON (POST) / query params (GET)
 * @returns {Promise<{job_id:string}>}
 */
export async function createProxyJob(jobId, { method = 'get', targetUrl, headers = {}, body = {} }) {
  const xml = [
    '<root>',
    `<method>${method === 'post' ? 'post' : 'get'}</method>`,
    `<target_url>${xmlEscape(targetUrl)}</target_url>`,
    `<request_header>${xmlEscape(JSON.stringify(headers))}</request_header>`,
    `<request_body>${xmlEscape(JSON.stringify(body))}</request_body>`,
    '</root>',
  ].join('');

  const r = await fetch(`${PROXY_BASE}/create/${encodeURIComponent(jobId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml' },
    body: xml,
  });
  if (!r.ok) {
    const err = new Error(`Proxy create gagal: HTTP ${r.status}`);
    err.status = 502;
    throw err;
  }
  return r.json();
}

/**
 * Cek hasil job.
 * @returns {Promise<{running:boolean, status?:number, body?:string, raw?:string}>}
 *          - running=true  -> masih diproses ("process")
 *          - running=false -> selesai, body berisi raw HTTP response
 */
export async function getProxyJob(jobId) {
  const r = await fetch(`${PROXY_BASE}/${encodeURIComponent(jobId)}`);
  if (r.status === 404) {
    return { running: false, status: 404, body: '', raw: '' };
  }
  const text = await r.text();
  if (text.trim() === 'process') {
    return { running: true, raw: text };
  }
  return { running: false, status: r.status, body: text, raw: text };
}

/**
 * Coba parse raw HTTP response dari proxy menjadi { status, headers, body }.
 * Proxy mengembalikan persis respons asli (status line, headers, body).
 */
export function parseRawHttpResponse(raw) {
  try {
    const idx = raw.indexOf('\r\n\r\n');
    if (idx === -1) {
      // fallback: anggap seluruhnya body
      return { status: 200, headers: {}, body: raw };
    }
    const head = raw.slice(0, idx);
    const body = raw.slice(idx + 4);
    const lines = head.split('\r\n');
    const statusMatch = lines[0].match(/HTTP\/\S+\s+(\d+)/);
    const status = statusMatch ? Number(statusMatch[1]) : 200;
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const m = lines[i].match(/^([^:]+):\s*(.*)$/);
      if (m) headers[m[1].toLowerCase()] = m[2];
    }
    return { status, headers, body };
  } catch {
    return { status: 200, headers: {}, body: raw };
  }
}