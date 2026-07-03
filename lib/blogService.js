const pool = require('./db');
const { v4: uuidv4 } = require('uuid');

// Helper untuk membuat excerpt (cuplikan) dari markdown
const createExcerpt = (markdown, length = 120) => {
    if (!markdown) return '';
    const plainText = markdown
        .replace(/!\[.*?\]\(.*?\)/g, '') 
        .replace(/\[.*?\]\(.*?\)/g, '$1') 
        .replace(/#{1,6}\s/g, '') 
        .replace(/(\*\*|__)(.*?)\1/g, '$2') 
        .replace(/(\*|_)(.*?)\1/g, '$2') 
        .replace(/`{3}.*?`{3}/gs, '') 
        .replace(/`(.+?)`/g, '$1') 
        .replace(/\n/g, ' ')
        .trim();
    
    return plainText.length > length ? plainText.substring(0, length) + '...' : plainText;
};

// Inisialisasi tabel jika belum ada
const ensureTableExists = async () => {
    try {
        const query = `
            CREATE TABLE IF NOT EXISTS blogs (
                id UUID PRIMARY KEY,
                tag TEXT NOT NULL,
                image TEXT,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;
        await pool.query(query);
    } catch (err) {
        // DB offline — return silently (build/static-gen phase)
    }
};

// Helper untuk ekstrak judul dari konten markdown (H1 pertama)
const extractTitle = (content) => {
    if (!content) return '';
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '';
};

// Helper untuk normalisasi string (lowercase, hapus white-space berlebih)
const normalizeStr = (str) => {
    return str.toLowerCase().replace(/\s+/g, ' ').trim();
};

// Cari blog duplikat berdasarkan tag + judul (dari H1)
const findDuplicate = async (tag, title) => {
    if (!title) return null;
    const normalizedTitle = normalizeStr(title);
    
    try {
        // Ambil semua blog dengan tag yang sama
        const result = await pool.query(
            'SELECT id, content, tag FROM blogs WHERE tag = $1 ORDER BY created_at DESC',
            [tag]
        );
        
        for (const row of result.rows) {
            const existingTitle = extractTitle(row.content);
            if (existingTitle && normalizeStr(existingTitle) === normalizedTitle) {
                return row.id; // Duplikat ditemukan
            }
        }
        return null;
    } catch (error) {
        if (error.code === 'ECONNREFUSED') return null;
        console.error("Duplicate check error:", error);
        return null; // Kalau gagal cek, lanjut create baru
    }
};

const blogService = {
    getAll: async (page = 1, limit = 5) => {
        try {
            await ensureTableExists();
        } catch (e) {
            // not reachable (caught inside), but safety
        }
        
        const limitVal = parseInt(limit, 10);
        const pageVal = parseInt(page, 10);
        const offset = (pageVal - 1) * limitVal;

        try {
            const countResult = await pool.query('SELECT COUNT(*) FROM blogs');
            const totalPosts = parseInt(countResult.rows[0].count, 10);
            const totalPages = Math.ceil(totalPosts / limitVal);

            const result = await pool.query(
                'SELECT id, tag, image, LEFT(content, 2000) as content, created_at, updated_at FROM blogs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
                [limitVal, offset]
            );

            const posts = result.rows.map(row => ({
                id: row.id,
                tag: row.tag,
                image: row.image,
                content: row.content,
                createdAt: row.created_at.toISOString(),
                updatedAt: row.updated_at.toISOString(),
                excerpt: createExcerpt(row.content)
            }));

            return {
                posts,
                totalPosts,
                totalPages,
                currentPage: pageVal
            };
        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                return { posts: [], totalPosts: 0, totalPages: 1, currentPage: 1 };
            }
            throw new Error('Failed to fetch posts from Database.');
        }
    },

    getById: async (id) => {
        try {
            await ensureTableExists();
        } catch (e) {}
        try {
            const result = await pool.query('SELECT * FROM blogs WHERE id = $1', [id]);
            
            if (result.rows.length === 0) return null;
            const row = result.rows[0];

            return {
                id: row.id,
                tag: row.tag,
                image: row.image,
                content: row.content,
                createdAt: row.created_at.toISOString(),
                updatedAt: row.updated_at.toISOString(),
                excerpt: createExcerpt(row.content)
            };
        } catch (error) {
            if (error.code === 'ECONNREFUSED') return null;
            throw new Error('Failed to fetch post details.');
        }
    },

    create: async (postData) => {
        try {
            await ensureTableExists();
        } catch (e) {}
        const { image, content, tag } = postData;
        
        // 🚫 CEK DUPLIKAT: Cari berdasarkan tag + judul (H1)
        const title = extractTitle(content);
        const existingId = await findDuplicate(tag, title);
        
        if (existingId) {
            // UPDATE blog yang sudah ada (refresh konten + timestamp)
            const updated = await blogService.update(existingId, { image, content, tag });
            return { ...updated, duplicate: true, message: 'Post updated (duplicate title)' };
        }
        
        // ✨ Tidak ada duplikat → buat baru
        const id = uuidv4();
        const createdAt = new Date();
        
        try {
            const query = `
                INSERT INTO blogs (id, tag, image, content, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $5)
                RETURNING *
            `;
            const values = [id, tag, image || '', content, createdAt];
            const result = await pool.query(query, values);
            const row = result.rows[0];

            // AUTO-CONTROL: Limit to 500 items
            const pruneQuery = `
                DELETE FROM blogs 
                WHERE id NOT IN (
                    SELECT id FROM blogs 
                    ORDER BY created_at DESC 
                    LIMIT 500
                )
            `;
            await pool.query(pruneQuery);

            // Fresh create — return with duplicate: false
            return {
                id: row.id,
                tag: row.tag,
                image: row.image,
                content: row.content,
                createdAt: row.created_at.toISOString(),
                updatedAt: row.updated_at.toISOString(),
                duplicate: false
            };
        } catch (error) {
            console.error("Database Create Error:", error);
            throw new Error('Failed to create post in Database.');
        }
    },

    update: async (id, postData) => {
        try {
            await ensureTableExists();
        } catch (e) {}
        const { image, content, tag } = postData;
        const updatedAt = new Date();

        try {
            // Bangun query dinamis
            let fields = ['updated_at = $2'];
            let values = [id, updatedAt];
            let idx = 3;

            if (tag !== undefined) { fields.push(`tag = $${idx++}`); values.push(tag); }
            if (image !== undefined) { fields.push(`image = $${idx++}`); values.push(image); }
            if (content !== undefined) { fields.push(`content = $${idx++}`); values.push(content); }

            const query = `
                UPDATE blogs 
                SET ${fields.join(', ')}
                WHERE id = $1
                RETURNING *
            `;

            const result = await pool.query(query, values);

            if (result.rows.length === 0) {
                throw new Error('Post not found');
            }

            const row = result.rows[0];
            return {
                id: row.id,
                tag: row.tag,
                image: row.image,
                content: row.content,
                createdAt: row.created_at.toISOString(),
                updatedAt: row.updated_at.toISOString()
            };
        } catch (error) {
            console.error("Database Update Error:", error);
            throw error;
        }
    },

    delete: async (id) => {
        try {
            await ensureTableExists();
        } catch (e) {}
        try {
            const result = await pool.query('DELETE FROM blogs WHERE id = $1', [id]);
            if (result.rowCount === 0) {
                throw new Error('Post not found');
            }
            return { message: 'Post deleted successfully.' };
        } catch (error) {
            console.error("Database Delete Error:", error);
            throw error;
        }
    }
};

module.exports = blogService;