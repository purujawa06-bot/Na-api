/**
 * Dramabox Scraper Library
 * Scrapes www.dramabox.com for short dramas, tags, and search results.
 * Uses __NEXT_DATA__ from SSR pages.
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
 * Extract __NEXT_DATA__ JSON from HTML
 */
function extractNextData(html) {
  const $ = cheerio.load(html);
  const script = $('#__NEXT_DATA__').html();
  if (!script) throw new Error('__NEXT_DATA__ not found');
  return JSON.parse(script);
}

/**
 * Fetch a page and extract __NEXT_DATA__
 */
async function fetchPage(path) {
  const url = `${BASE_URL}${path}`;
  const { data } = await axios.get(url, { headers: HEADERS });
  return extractNextData(data);
}

/**
 * Map book item from __NEXT_DATA__ (browse page format)
 */
function mapBrowseBook(book) {
  return {
    id: book.bookId,
    title: book.bookName,
    slug: book.replacedBookName || book.bookNameEn,
    cover: book.cover,
    rating: book.ratings,
    description: book.introduction,
    labels: book.labels || [],
    tags: book.tags || [],
    typeTwoNames: book.typeTwoNames || [],
    chapters: book.chapterCount,
    language: book.language,
    status: book.status,
    free: Boolean(book.free),
    shelfTime: book.shelfTime,
    viewCount: book.viewCountDisplay,
  };
}

/**
 * Map book item from search page __NEXT_DATA__
 */
function mapSearchBook(book) {
  return {
    id: book.bookId,
    title: book.bookName,
    slug: book.bookNameEn,
    cover: book.coverWap,
    rating: book.commentScore || book.extendMap?.ratingFive ? 'N/A' : 'N/A',
    description: book.introduction,
    author: book.author,
    protagonist: book.protagonist,
    labels: book.markNames || [],
    tags: Object.values(book.tagV3 || {}),
    typeOne: book.bookTypeOne ? Object.values(book.bookTypeOne)[0] : null,
    typeTwo: book.bookTypeTwo ? Object.values(book.bookTypeTwo)[0] : null,
    chapters: book.totalChapterNum,
    language: book.languages ? book.languages[0] : null,
    status: book.status,
    free: Boolean(book.canFree),
    isAdvert: Boolean(book.isAdvert),
    isSvip: Boolean(book.isSvip),
    shelfTime: book.shelfTime,
    videoDuration: book.totalVideoDuration,
    commentScore: book.commentScore,
    clickNum: book.clickNum,
    collectionNum: book.extendMap?.collectionNum,
    lastChapterName: book.lastChapterName,
    lastChapterTime: book.lastChapterUtime,
  };
}

/**
 * Get list of all available tags/categories
 */
async function getTags() {
  const data = await fetchPage('/browse');
  const types = data.props.pageProps.types;
  return types.map(t => ({
    id: t.id,
    name: t.name,
    slug: t.replaceName,
  }));
}

/**
 * Browse dramas by tag ID
 * @param {number} tagId - Tag ID from getTags()
 * @param {number} page - Page number (default: 1)
 */
async function browseByTag(tagId, page = 1) {
  const data = await fetchPage(`/browse/${tagId}/${page}`);
  const pageProps = data.props.pageProps;
  
  const bookList = (pageProps.bookList || []).map(mapBrowseBook);
  
  return {
    tagId,
    tagName: pageProps.typeTwoName || null,
    page: pageProps.pageNo || page,
    totalPages: pageProps.totalPage || 0,
    totalItems: pageProps.totalNum || bookList.length,
    books: bookList,
    types: pageProps.types ? pageProps.types.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.replaceName,
      checked: t.checked,
    })) : [],
  };
}

/**
 * Search dramas by keyword
 * @param {string} query - Search keyword
 * @param {number} page - Page number (default: 1)
 */
async function searchDramas(query, page = 1) {
  const encodedQuery = encodeURIComponent(query);
  const data = await fetchPage(`/search?q=${encodedQuery}&page=${page}`);
  const pageProps = data.props.pageProps;
  
  const mainList = (pageProps.similarList || []).map(mapSearchBook);
  const bookList = (pageProps.bookList || []).map(mapBrowseBook);
  const actorList = pageProps.actorList || [];
  
  return {
    query,
    page: pageProps.pageNo || page,
    totalPages: pageProps.totalPage || 0,
    totalItems: pageProps.totalNum || mainList.length,
    isEmpty: pageProps.isEmpty || false,
    results: mainList.length > 0 ? mainList : bookList,
    actors: actorList,
  };
}

/**
 * Get drama detail by slug
 * @param {string} slug - Drama slug (e.g., 'Step-Back-I-m-the-Hidden-King')
 */
async function getDramaDetail(slug) {
  const data = await fetchPage(`/drama/${slug}`);
  const pageProps = data.props.pageProps;
  return pageProps;
}

module.exports = {
  getTags,
  browseByTag,
  searchDramas,
  getDramaDetail,
  BASE_URL,
};
