import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const IG_URL = 'https://www.instagram.com/reel/DVDX96NCdXc/';

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    return { name, ms: Date.now() - t0, ok: true, ...out };
  } catch (e) {
    return { name, ms: Date.now() - t0, ok: false, error: String((e && e.message) || e).slice(0, 400) };
  }
}

function uniq(re, text, limit = 12) {
  const set = new Set();
  let m;
  while ((m = re.exec(text)) && set.size < limit) set.add(m[0]);
  return [...set];
}

export async function GET() {
  const results = await Promise.all([
    probe('instasave-recheck', async () => {
      const body = new URLSearchParams({
        url: IG_URL,
        instaLink:
          'https://www.instagram.com/graphql/query?query_hash=2b0673e0dc4580674a88d426fe00ea90&variables={"shortcode":"DVDX96NCdXc"}',
      });
      const res = await fetch('https://api.instasave.website/media', {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', referer: 'https://instasave.website/', origin: 'https://instasave.website' },
        body,
      });
      return { status: res.status, body: (await res.text()).slice(0, 250) };
    }),

    probe('sssinstagram-home', async () => {
      const res = await fetch('https://sssinstagram.com/id', { headers: { 'user-agent': UA } });
      const html = await res.text();
      return {
        status: res.status,
        len: html.length,
        apiHints: uniq(/(?:fetch\(|axios|action=|["'])[^"']*(?:\/api\/|ajax)[^"']*/g, html),
        tokenHints: uniq(/(?:data-token|_token|name="token")[^>]{0,80}/g, html),
      };
    }),

    probe('snapinsta-home', async () => {
      const res = await fetch('https://snapinsta.app/', { headers: { 'user-agent': UA } });
      const html = await res.text();
      return {
        status: res.status,
        len: html.length,
        token: (html.match(/name="token"[^>]*value="([^"]+)"/) || html.match(/data-token="([^"]+)"/) || [])[1] || null,
        apiHints: uniq(/(?:action=|["'])https?:\/\/api\.[^"']*/g, html),
      };
    }),

    probe('snapinsta-ajax', async () => {
      const body = new URLSearchParams({ url: IG_URL, lang: 'en' });
      const res = await fetch('https://api.snapinsta.app/api/ajax', {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', referer: 'https://snapinsta.app/' },
        body,
      });
      return { status: res.status, body: (await res.text()).slice(0, 300) };
    }),

    probe('indown-home', async () => {
      const res = await fetch('https://indown.io/', { headers: { 'user-agent': UA } });
      const html = await res.text();
      return {
        status: res.status,
        len: html.length,
        csrf: (html.match(/name="_token"[^>]*value="([^"]+)"/) || [])[1] ? true : false,
      };
    }),

    probe('imginn-post', async () => {
      const res = await fetch(`https://imginn.com/p/${'DVDX96NCdXc'}/`, { headers: { 'user-agent': UA } });
      const html = await res.text();
      return {
        status: res.status,
        len: html.length,
        hasVideo: /<video/.test(html),
        cdnLinks: uniq(/https:\/\/[^"' ]*scontent[^"' ]*/g, html, 3),
      };
    }),
  ]);

  return NextResponse.json({ probed_at: new Date().toISOString(), results });
}
