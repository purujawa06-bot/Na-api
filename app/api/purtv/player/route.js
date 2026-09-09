/**
 * @title PurTV Player Resolver
 * @summary Resolve samehadaku player_ajax → iframe src
 * @description POST ke admin-ajax.php samehadaku untuk mendapatkan iframe embed.
 *              Dipakai untuk anime (samehadaku) yang player-nya di-load via AJAX.
 *              Coba direct fetch dulu, fallback ke proxy jika kena Cloudflare 403.
 * @method GET
 * @path /api/purtv/player
 * @param {string} query.post - data-post dari streamingLinks
 * @param {string} query.nume - data-nume dari streamingLinks
 * @param {string} [query.type=SCHTML] - data-type
 * @param {string} [query.slug] - slug episode (untuk Referer)
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/player?post=12345&nume=1&type=schtml&slug=one-piece-episode-1000')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const HOST = 'https://v2.samehadaku.how';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const CF_PROXY = 'https://vercel-api-beta-red.vercel.app/api/fetch';

async function fetchPlayer({ post, nume, type, slug }) {
  const url = `${HOST}/wp-admin/admin-ajax.php`;
  const body = new URLSearchParams({ action: 'player_ajax', post, nume, type });
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': UA,
    'Referer': slug ? `${HOST}/${slug}/` : HOST,
    'Origin': HOST,
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': '*/*',
  };

  // Try direct fetch
  let res = await fetch(url, { method: 'POST', headers, body: body.toString(), redirect: 'follow' }).catch(() => null);
  let text = res ? await res.text().catch(() => '') : '';

  // If blocked by Cloudflare, try via proxy (GET proxy with POST emulation not ideal, but try)
  if (!res || res.status === 403 || /Just a moment|challenge-error-text/.test(text)) {
    // Try proxy as GET with query params (some proxies support it)
    try {
      const proxyUrl = `${CF_PROXY}?get=${encodeURIComponent(url)}`;
      const proxyRes = await fetch(proxyUrl, { headers: { 'user-agent': UA } });
      if (proxyRes.ok) {
        const proxyText = await proxyRes.text();
        if (!/Just a moment/.test(proxyText)) {
          text = proxyText;
          res = proxyRes;
        }
      }
    } catch {}
  }

  if (!text || /Just a moment|challenge-error-text/.test(text)) {
    throw new Error('Player diblokir Cloudflare (coba lagi nanti)');
  }

  // Extract iframe src from response HTML
  const m = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (m && m[1]) {
    let src = m[1];
    // Handle protocol-relative URLs
    if (src.startsWith('//')) src = 'https:' + src;
    return { iframe: src, raw: text.slice(0, 5000) };
  }

  // Sometimes response is direct URL or contains src in different format
  const m2 = text.match(/src=["'](https?:\/\/[^"']+)["']/i);
  if (m2 && m2[1]) return { iframe: m2[1], raw: text.slice(0, 5000) };

  // If no iframe, return raw for debugging
  if (text.trim().length < 500 && text.includes('http')) {
    const urlMatch = text.match(/(https?:\/\/[^\s"'<>]+)/);
    if (urlMatch) return { iframe: urlMatch[1], raw: text.slice(0, 5000) };
  }

  throw new Error('Iframe tidak ditemukan di respons player');
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const post = searchParams.get('post');
  const nume = searchParams.get('nume');
  const type = searchParams.get('type') || 'schtml';
  const slug = searchParams.get('slug') || '';

  if (!post || !nume) {
    return NextResponse.json({ success: false, error: 'Parameter post dan nume wajib diisi' }, { status: 400 });
  }

  try {
    const data = await fetchPlayer({ post, nume, type, slug });
    return NextResponse.json({ success: true, ...data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 502 });
  }
}
