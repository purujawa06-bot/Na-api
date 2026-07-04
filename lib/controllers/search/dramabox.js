/**
 * @title Dramabox Search
 * @summary Search and browse Dramabox short dramas.
 * @description Mencari drama pendek dari Dramabox berdasarkan kata kunci atau tag/kategori. Bisa juga menampilkan daftar semua tag yang tersedia.
 * @method GET
 * @path /api/search/dramabox
 * @response json
 * @param {string} query.q - Kata kunci pencarian (contoh: CEO, love, revenge).
 * @param {string} query.tag - Nama tag/kategori untuk browsing (contoh: Revenge, Romance, Billionaire).
 * @param {number} query.page - Halaman (default: 1).
 * @param {boolean} query.tags - Set ke true untuk mendapatkan daftar semua tag yang tersedia.
 * @example
 * # Cari drama
 * /api/search/dramabox?q=love
 * 
 * # Browse by tag
 * /api/search/dramabox?tag=Revenge&page=1
 * 
 * # Lihat semua tag
 * /api/search/dramabox?tags=true
 */
const {
  getTags,
  browseByTag,
  searchDramas,
} = require('../../dramabox');

const dramaboxSearchController = async (req) => {
  const { q, tag, tags, page } = req.query;

  // List all available tags
  if (tags === 'true' || tags === '1') {
    const tagList = await getTags();
    return {
      success: true,
      author: 'PuruBoy',
      result: {
        total: tagList.length,
        tags: tagList,
      },
    };
  }

  // Browse by tag
  if (tag) {
    // First get all tags to find the tag ID
    const allTags = await getTags();
    
    // Find tag by name (case-insensitive) or slug
    const foundTag = allTags.find(
      t => t.name.toLowerCase() === tag.toLowerCase() || 
           t.slug.toLowerCase() === tag.toLowerCase() ||
           t.id.toString() === tag
    );

    if (!foundTag) {
      throw new Error(`Tag "${tag}" tidak ditemukan. Gunakan ?tags=true untuk melihat semua tag yang tersedia.`);
    }

    const result = await browseByTag(foundTag.id, parseInt(page) || 1);
    return {
      success: true,
      author: 'PuruBoy',
      result: {
        tag: foundTag,
        page: result.page,
        totalPages: result.totalPages,
        totalItems: result.totalItems,
        books: result.books,
      },
    };
  }

  // Search by keyword
  if (!q) {
    throw new Error("Parameter 'q' (kata kunci), 'tag' (kategori), atau 'tags=true' wajib diisi.");
  }

  const result = await searchDramas(q, parseInt(page) || 1);
  
  return {
    success: true,
    author: 'PuruBoy',
    result: {
      query: result.query,
      page: result.page,
      totalPages: result.totalPages,
      totalItems: result.totalItems,
      results: result.results,
    },
  };
};

module.exports = dramaboxSearchController;
