/**
 * Client dramabox.com — data drama pendek tanpa browser.
 * Semua halaman dramabox.com di-render server-side (Next.js SSG/SSR):
 *   - Beranda   : /<locale>                 -> bigList (featured) & smallData (seksi).
 *   - Detail    : /<locale>/drama/<bookId>  -> bookInfo, chapterList, recommends.
 *   - Video     : /<locale>/video/<bookId>/<chapterId> -> chapterList berisi URL mp4.
 *   - Pencarian : /<locale>/search?searchValue=<q>&page=<n> (param ASLI = searchValue).
 *   - Kategori  : /<locale>/browse/<typeId>/<page> -> types + bookList.
 * Cukup fetch HTTPS biasa; tidak perlu menjalankan browser.
 */

const HOST = 'https://www.dramabox.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const ACCEPT_LANG = 'id-ID,id;q=0.9,en;q=0.8';

export const DRAMABOX_LOCALES = [
  'en', 'zhHans', 'ko', 'zh', 'es', 'in', 'ja', 'de', 'fr', 'pt', 'ar', 'th', 'tl', 'vi', 'it', 'tr', 'pl',
];

function headersFor(locale) {
  return {
    'user-agent': UA,
    'accept-language': locale === 'in' ? ACCEPT_LANG : `${locale},en;q=0.9`,
    'accept': 'text/html,application/xhtml+xml,*/*',
  };
}

async function getPageData(url, locale = 'in') {
  const res = await fetch(url, { headers: headersFor(locale), redirect: 'follow' });
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
  return data;
}

function cleanBook(raw, locale) {
  return {
    id: raw.bookId || raw.originalBookId || raw.action || null,
    title: raw.bookName || raw.name || null,
    author: raw.author || null,
    synopsis: raw.introduction || null,
    cover: raw.cover || null,
    tags: raw.labels || raw.tags || [],
    ratings: typeof raw.ratings === 'number' ? raw.ratings : null,
    views: raw.viewCountDisplay || raw.viewCount || null,
    episodes: typeof raw.chapterCount === 'number' ? raw.chapterCount : null,
    status: raw.lastUpdateTimeDisplay || null,
    genre: [raw.typeOneName, raw.typeTwoName].filter(Boolean),
    url:
      raw.bookId && (raw.replacedBookName || raw.bookNameEn)
        ? `${HOST}/${locale}/drama/${raw.bookId}/${raw.replacedBookName || raw.bookNameEn}`
        : null,
  };
}

function cleanChapter(ch) {
  return {
    id: ch.id,
    name: ch.name || null,
    index: ch.index ?? null,
    unlock: !!ch.unlock,
    duration: typeof ch.duration === 'number' ? ch.duration : null,
    cover: ch.cover || null,
    date: ch.utime || null,
    price: ch.chapterPrice ?? 0,
    new: !!ch.new,
    video_url: ch.unlock && ch.mp4 ? ch.mp4 : null,
  };
}

export async function fetchDramaboxHome(locale = 'in') {
  const data = await getPageData(`${HOST}/${locale}`, locale);
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

export async function fetchDramaboxDetail(bookId, locale = 'in') {
  const data = await getPageData(`${HOST}/${locale}/drama/${bookId}`, locale);
  const pp = data.props?.pageProps || {};
  const b = pp.bookInfo || {};
  const performers = (b.performerList || []).map((p) => ({
    id: p.performerId,
    name: p.performerName,
    avatar: p.performerAvatar || null,
    videoCount: p.videoCount ?? null,
  }));

  return {
    buildId: data.buildId || null,
    locale: data.locale || locale,
    book: {
      id: b.bookId || bookId,
      title: b.bookName || null,
      cover: b.cover || null,
      synopsis: b.introduction || null,
      tags: b.labels || b.tags || [],
      views: b.viewCount ?? null,
      followers: b.followCount ?? null,
      episodes: typeof b.chapterCount === 'number' ? b.chapterCount : null,
      language: b.language || null,
      genre: b.typeTwoNames || [b.typeTwoName].filter(Boolean),
      shelfTime: b.shelfTime || null,
      performers,
      url: b.bookId ? `${HOST}/${locale}/drama/${b.bookId}/${b.bookNameEn || b.replacedBookName}` : null,
    },
    episodes: (pp.chapterList || []).map(cleanChapter),
    tabs: pp.tabData || [],
    related: (pp.recommends || []).map((r) => cleanBook(r, locale)),
    languages: pp.languages || [],
  };
}

export async function fetchDramaboxStream(bookId, chapterId, locale = 'in') {
  const data = await getPageData(`${HOST}/${locale}/video/${bookId}/${chapterId}`, locale);
  const pp = data.props?.pageProps || {};
  const chapter = (pp.chapterList || []).find((c) => String(c.id) === String(chapterId));
  if (!chapter) throw new Error('Episode tidak ditemukan');
  if (!chapter.unlock || !chapter.mp4) {
    throw new Error('Episode ini berbayar dan tidak tersedia gratis');
  }
  return {
    buildId: data.buildId || null,
    locale: data.locale || locale,
    bookId,
    chapterId: String(chapterId),
    chapter: {
      id: chapter.id,
      name: chapter.name || null,
      index: chapter.index ?? null,
      duration: typeof chapter.duration === 'number' ? chapter.duration : null,
      cover: chapter.cover || null,
      date: chapter.utime || null,
    },
    video_url: chapter.mp4,
    expires: (chapter.mp4.match(/[?&]Expires=(\d+)/) || [])[1]
      ? parseInt((chapter.mp4.match(/[?&]Expires=(\d+)/) || [])[1], 10)
      : null,
  };
}

export async function fetchDramaboxSearch(keyword, page = 1, locale = 'in') {
  const data = await getPageData(`${HOST}/${locale}/search?searchValue=${encodeURIComponent(keyword)}&page=${page}`, locale);
  const pp = data.props?.pageProps || {};
  const slug = (raw) => raw.bookNameEn || raw.replacedBookName || raw.bookNameLower || raw.bookName;
  const results = (pp.bookList || []).map((b) => ({
    id: b.bookId,
    title: b.bookName || null,
    author: b.author || null,
    cover: b.coverWap || b.coverCutWap || null,
    synopsis: b.introduction || null,
    protagonist: b.protagonist || null,
    genres: (b.typeTwoList || []).map((t) => t.name),
    episodes: typeof b.totalChapterNum === 'number' ? b.totalChapterNum : null,
    status: b.lastChapterName || b.updateStatus || null,
    chapterId: b.chapterId || null,
    views: b.clickNum ?? null,
    url: b.bookId && b.chapterId ? `${HOST}/${locale}/video/${b.bookId}_${slug(b)}/${b.chapterId}_Episode-1` : null,
  }));
  const similar = (pp.similarList || []).map((b) => cleanBook(b, locale));

  return {
    buildId: data.buildId || null,
    locale: data.locale || locale,
    keyword: pp.sValue || keyword,
    page: pp.pageNo ?? page,
    totalPage: pp.totalPage ?? 0,
    total: pp.totalNum ?? 0,
    isEmpty: !!pp.isEmpty,
    results,
    similar,
  };
}

export async function fetchDramaboxCategory(typeId, page = 1, locale = 'in') {
  const data = await getPageData(`${HOST}/${locale}/browse/${typeId}/${page}`, locale);
  const pp = data.props?.pageProps || {};
  const categories = (pp.types || []).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.replaceName || t.name,
    checked: !!t.checked,
  }));
  const typeName = (pp.types || []).find((t) => t.id === Number(typeId))?.name || pp.typeTwoName || null;

  return {
    buildId: data.buildId || null,
    locale: data.locale || locale,
    category: { id: typeId === 'all' ? 'all' : Number(typeId) || typeId, name: typeName },
    page: pp.pageNo ?? page,
    pages: pp.pages ?? 0,
    categories,
    results: (pp.bookList || []).map((b) => cleanBook(b, locale)),
  };
}
