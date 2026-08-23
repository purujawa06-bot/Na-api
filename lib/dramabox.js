/**
 * Client dramabox.com — data drama pendek tanpa browser.
 * Halaman beranda dramabox.com di-render server-side (Next.js SSG):
 *   1. GET https://www.dramabox.com/<locale> -> HTML berisi <script id="__NEXT_DATA__">.
 *   2. Parse JSON di dalamnya -> props.pageProps.bigList (featured) & smallData (seksi).
 * Cukup fetch HTTPS biasa; tidak perlu menjalankan browser.
 */

const HOST = 'https://www.dramabox.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const ACCEPT_LANG = 'id-ID,id;q=0.9,en;q=0.8';

export const DRAMABOX_LOCALES = [
  'en', 'zhHans', 'ko', 'zh', 'es', 'in', 'ja', 'de', 'fr', 'pt', 'ar', 'th', 'tl', 'vi', 'it', 'tr', 'pl',
];

function cleanBook(raw, locale) {
  return {
    id: raw.bookId || raw.originalBookId || raw.action || null,
    title: raw.bookName || raw.name || null,
    author: raw.author || null,
    synopsis: raw.introduction || null,
    cover: raw.cover || null,
    tags: raw.labels || raw.tags || [],
    views: raw.viewCountDisplay || raw.viewCount || null,
    episodes: typeof raw.chapterCount === 'number' ? raw.chapterCount : null,
    status: raw.lastUpdateTimeDisplay || null,
    genre: [raw.typeOneName, raw.typeTwoName].filter(Boolean),
    url:
      raw.bookId && raw.replacedBookName
        ? `${HOST}/${locale}/drama/${raw.bookId}/${raw.replacedBookName}`
        : null,
  };
}

export async function fetchDramaboxHome(locale = 'in') {
  const res = await fetch(`${HOST}/${locale}`, {
    headers: {
      'user-agent': UA,
      'accept-language': ACCEPT_LANG,
      'accept': 'text/html,application/xhtml+xml,*/*',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`dramabox.com gagal diakses (HTTP ${res.status})`);

  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Data __NEXT_DATA__ tidak ditemukan di halaman dramabox.com');

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('Gagal memparse data dramabox.com');
  }

  const pp = data.props?.pageProps || {};
  const featured = (pp.bigList || []).map((b) => cleanBook(b, locale));
  const sections = (pp.smallData || []).map((s) => ({
    id: s.id,
    title: s.name,
    style: s.style,
    hasMore: !!s.more,
    items: (s.items || []).map((i) => cleanBook(i, locale)),
  }));

  return {
    buildId: data.buildId || null,
    locale: data.locale || locale,
    featured,
    sections,
  };
}
