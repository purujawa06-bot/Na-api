/**
 * Dramabox Scraper Library
 * Scrapes www.dramabox.com for short dramas, tags, and search results.
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

function extractNextData(html) {
  const $ = cheerio.load(html);
  const script = $('#__NEXT_DATA__').html();
  if (!script) throw new Error('__NEXT_DATA__ not found');
  return JSON.parse(script);
}

async function fetchPage(path) {
  const url = `${BASE_URL}${path}`;
  const { data } = await axios.get(url, { headers: HEADERS });
  return extractNextData(data);
}

function mapBook(book) {
  if (!book) return null;
  return {
    id: book.bookId || book.action,
    title: book.bookName || book.name,
    slug: book.replacedBookName || book.bookNameEn || book.bookNameLower,
    cover: book.cover,
    rating: book.ratings || book.commentScore || 'N/A',
    description: book.introduction,
    labels: book.labels || book.markNames || [],
    tags: book.tags || [],
    chapters: book.chapterCount || book.totalChapterNum,
    status: book.status,
    viewCount: book.viewCountDisplay || book.clickNum,
    language: book.language || (book.languages ? book.languages[0] : 'en'),
  };
}

/**
 * Get Home Page Data
 */
async function getHome() {
  const data = await fetchPage('/');
  const pageProps = data.props.pageProps;
  
  return {
    trending: (pageProps.bigList || []).map(mapBook),
    recommendations: (pageProps.smallData || []).map(section => ({
      section: section.name,
      books: (section.items || []).map(mapBook)
    }))
  };
}

/**
 * Get Drama Detail
 */
async function getDetail(slug) {
  const data = await fetchPage(`/drama/${slug}`);
  const book = data.props.pageProps.bookInfo;
  
  if (!book) throw new Error('Drama not found');

  return {
    ...mapBook(book),
    fullDescription: book.introduction,
    totalEpisodes: book.totalEpisodes,
    // Chapters are usually in a separate list or within pageProps
    chapters: data.props.pageProps.chapterList || [] 
  };
}

/**
 * Get Episode/Chapter List
 */
async function getChapters(slug) {
  const data = await fetchPage(`/drama/${slug}`);
  return data.props.pageProps.chapterList || [];
}

/**
 * Get Tags List
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
 * Browse by Tag
 */
async function browseByTag(tagId, page = 1) {
  const data = await fetchPage(`/browse/${tagId}/${page}`);
  const pageProps = data.props.pageProps;
  
  return {
    tagId,
    tagName: pageProps.typeTwoName || null,
    page: pageProps.pageNo || page,
    totalPages: pageProps.totalPage || 0,
    books: (pageProps.bookList || []).map(mapBook),
  };
}

/**
 * Search Dramas
 */
async function searchDramas(query, page = 1) {
  const encodedQuery = encodeURIComponent(query);
  const data = await fetchPage(`/search?q=${encodedQuery}&page=${page}`);
  const pageProps = data.props.pageProps;
  
  const results = (pageProps.similarList || pageProps.bookList || []).map(mapBook);
  
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
