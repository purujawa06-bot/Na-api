/**
 * Dramabox Scraper Library
 * Scrapes www.dramabox.com for short dramas.
 * Note: Drama detail pages are NOT server-side rendered (client-side React).
 * We use data from SSR pages: Home, Browse, and Search.
 */
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.dramabox.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.dramabox.com/',
};

/**
 * Extract __NEXT_DATA__ JSON from SSR HTML
 */
function extractNextData(html) {
  const $ = cheerio.load(html);
  const script = $('#__NEXT_DATA__').html();
  if (!script) throw new Error('__NEXT_DATA__ not found on page');
  return JSON.parse(script);
}

/**
 * Fetch HTML and extract __NEXT_DATA__
 */
async function fetchNextData(path) {
  const url = `${BASE_URL}${path}`;
  const { data } = await axios.get(url, { headers: HEADERS });
  return extractNextData(data);
}

/**
 * Fetch Next.js JSON data route directly (more efficient)
 * The JSON route returns { pageProps: {...} }
 * The __NEXT_DATA__ fallback returns { props: { pageProps: {...} } }
 */
async function fetchJsonData(buildId, path) {
  const url = `${BASE_URL}/_next/data/${buildId}${path}.json`;
  try {
    const { data } = await axios.get(url, { headers: { ...HEADERS, Accept: 'application/json' } });
    return data;
  } catch (e) {
    // Fallback: fetch HTML and extract __NEXT_DATA__
    return fetchNextData(path);
  }
}

/**
 * Normalize pageProps from both JSON route and __NEXT_DATA__ formats
 * JSON route: { pageProps: {...} }
 * __NEXT_DATA__: { props: { pageProps: {...} } }
 */
function getPageProps(data) {
  if (!data) return {};
  // Direct JSON route format
  if (data.pageProps) return data.pageProps;
  // __NEXT_DATA__ format
  if (data.props && data.props.pageProps) return data.props.pageProps;
  // Fallback: return empty
  return {};
}

/**
 * Get current buildId from home page
 */
async function getBuildId() {
  try {
    const html = await axios.get(`${BASE_URL}/en`, { headers: HEADERS }).then(r => r.data);
    const match = html.match(/"buildId":"([^"]+)"/);
    if (match) return match[1];
  } catch (e) {
    // ignore
  }
  return 'dramabox_prod_20260609';
}

/**
 * Map book data from browse/search responses
 */
function mapBook(book) {
  if (!book) return null;
  return {
    id: book.bookId || book.action || '',
    title: book.bookName || book.name || 'Unknown',
    slug: book.replacedBookName || book.bookNameEn || book.bookNameLower || '',
    cover: book.cover || book.coverWap || '',
    rating: book.ratings || book.commentScore || 'N/A',
    description: book.introduction || '',
    labels: book.labels || book.markNames || [],
    tags: book.tags || [],
    chapters: book.chapterCount || book.totalChapterNum || 0,
    status: book.status,
    viewCount: book.viewCountDisplay || book.clickNum || 0,
    language: book.language || (book.languages ? book.languages[0] : 'en'),
    typeTwoNames: book.typeTwoNames || [],
    episodeCount: book.chapterCount || 0,
  };
}

/**
 * Search for a book in browse page data by slug or bookId
 */
async function findBook(identifier, isId = false) {
  const buildId = await getBuildId();

  // Try browse pages first (tagId 0 = all, 161 = Romance, etc.)
  const tagIds = [0, 161, 260, 534, 189, 253, 249, 184, 185, 288];

  for (const tagId of tagIds) {
    try {
      const data = await fetchJsonData(buildId, `/browse/${tagId}`);
      const pageProps = getPageProps(data);
      const books = pageProps.bookList || [];

      const found = books.find(b => {
        if (isId) return String(b.bookId) === String(identifier);
        const slug = b.replacedBookName || b.bookNameEn || b.bookNameLower;
        return slug === identifier || slug?.toLowerCase() === identifier?.toLowerCase();
      });

      if (found) return mapBook(found);
    } catch (e) {
      // Continue to next tag
    }
  }

  // Fallback: search by name keywords derived from slug
  try {
    const keywords = identifier.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    const data = await fetchJsonData(buildId, `/en/search?q=${encodeURIComponent(keywords)}`);
    const pageProps = getPageProps(data);
    const books = pageProps.similarList || pageProps.bookList || [];

    const found = books.find(b => {
      const slug = b.replacedBookName || b.bookNameEn || b.bookNameLower;
      return slug?.toLowerCase() === identifier?.toLowerCase() || String(b.bookId) === String(identifier);
    });
    if (found) return mapBook(found);
    // Return first result if no exact match
    if (books.length > 0) return mapBook(books[0]);
  } catch (e) {
    // Ignore
  }

  return null;
}

/**
 * Get Home Page Data (Trending + Recommendations)
 */
async function getHome() {
  const buildId = await getBuildId();
  const data = await fetchJsonData(buildId, '/en');
  const pageProps = getPageProps(data);

  // bigList = featured/trending carousel
  const trending = (pageProps.bigList || []).map(mapBook).filter(Boolean);

  // smallData = categorized sections (e.g. "Must-sees", "Trending")
  const rawSections = pageProps.smallData || [];
  const recommendations = rawSections.map(section => ({
    section: section.name || 'Section',
    books: (section.items || []).map(mapBook).filter(Boolean),
  })).filter(s => s.books.length > 0);

  return {
    trending,
    recommendations,
  };
}

/**
 * Get Drama Detail by slug or bookId
 */
async function getDetail(identifier) {
  if (!identifier) throw new Error('Parameter slug atau bookId wajib diisi');

  // Try as slug first
  let book = await findBook(identifier, false);

  // If not found, try as bookId
  if (!book) {
    book = await findBook(identifier, true);
  }

  if (!book) throw new Error('Drama tidak ditemukan');

  return book;
}

/**
 * Get Chapter Count (episode list is client-side only)
 */
async function getChapters(identifier) {
  if (!identifier) throw new Error('Parameter slug atau bookId wajib diisi');

  // Try as slug first
  let book = await findBook(identifier, false);

  if (!book) {
    book = await findBook(identifier, true);
  }

  if (!book) throw new Error('Drama tidak ditemukan');

  return {
    id: book.id,
    title: book.title,
    slug: book.slug,
    totalEpisodes: book.episodeCount || book.chapters || 0,
    episodes: [],
    note: 'Episode list is only available through the Dramabox mobile app or client-side rendering. Web scraping can only provide the total episode count.',
  };
}

/**
 * Get all available tags/categories
 */
async function getTags() {
  const buildId = await getBuildId();
  const data = await fetchJsonData(buildId, '/en/browse');
  const pageProps = getPageProps(data);
  const types = pageProps.types || [];
  return types.map(t => ({
    id: t.id,
    name: t.name,
    slug: t.replaceName,
  }));
}

/**
 * Browse dramas by tag ID
 */
async function browseByTag(tagId, page = 1) {
  const buildId = await getBuildId();

  // Browse tag pages don't support page numbers in SSR
  const data = await fetchJsonData(buildId, `/browse/${tagId}`);
  const pageProps = getPageProps(data);

  const books = (pageProps.bookList || []).map(mapBook).filter(Boolean);

  return {
    tagId,
    tagName: pageProps.typeTwoName || null,
    page: 1,
    totalPages: 1,
    books,
    types: (pageProps.types || []).map(t => ({
      id: t.id,
      name: t.name,
      slug: t.replaceName,
      checked: t.checked,
    })),
  };
}

/**
 * Search dramas by keyword
 */
async function searchDramas(query, page = 1) {
  const buildId = await getBuildId();
  const encodedQuery = encodeURIComponent(query);
  const data = await fetchJsonData(buildId, `/en/search?q=${encodedQuery}`);
  const pageProps = getPageProps(data);

  const results = (pageProps.similarList || pageProps.bookList || []).map(mapBook).filter(Boolean);

  return {
    query,
    page: pageProps.pageNo || page,
    totalPages: pageProps.totalPage || 0,
    results,
  };
}

module.exports = {
  getHome,
  getDetail,
  getChapters,
  getTags,
  browseByTag,
  searchDramas,
  BASE_URL,
};
