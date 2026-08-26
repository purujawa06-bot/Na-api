const pool = require('./db');
// ID sah & urutan default rantai auto — SATU sumber: lib/ai-models.js
const { AUTO_CHAIN_ALLOWED, AUTO_CHAIN_DEFAULT } = require('./ai-models');

const ensureSettingsTable = async () => {
    const query = `
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(50) PRIMARY KEY,
            value JSONB NOT NULL
        );
    `;
    await pool.query(query);
};

// ---------------- Rantai fallback model 'auto' (chat completions) ----------------

const AUTO_CHAIN_KEY = 'auto_fallback_chain';
/** Cache in-process agar tiap request chat tidak selalu query DB (Vercel + Neon). */
const AUTO_CHAIN_CACHE_TTL = 60_000;
let autoChainCache = { value: null, expires: 0 };

/** Bersihkan input rantai: buang ID tak dikenal & duplikat; null bila hasilnya kosong. */
function sanitizeAutoChain(raw) {
    if (!Array.isArray(raw)) return null;
    const seen = new Set();
    const chain = [];
    for (const item of raw) {
        if (!AUTO_CHAIN_ALLOWED.includes(item) || seen.has(item)) continue;
        seen.add(item);
        chain.push(item);
    }
    return chain.length ? chain : null;
}

const settingsService = {
    /**
     * Urutan provider untuk model 'auto' pada /api/chat/completions.
     * TIDAK PERNAH throw: DB memang opsional — bila tak tersedia/isinya rusak,
     * kembalikan urutan default supaya endpoint chat tetap hidup.
     */
    getAutoChain: async () => {
        if (autoChainCache.value && Date.now() < autoChainCache.expires) return autoChainCache.value;
        try {
            await ensureSettingsTable();
            const result = await pool.query('SELECT value FROM settings WHERE key = $1', [AUTO_CHAIN_KEY]);
            const stored = result.rows.length ? result.rows[0].value : null;
            const chain = sanitizeAutoChain(stored) ?? AUTO_CHAIN_DEFAULT;
            autoChainCache = { value: chain, expires: Date.now() + AUTO_CHAIN_CACHE_TTL };
            return chain;
        } catch {
            return [...AUTO_CHAIN_DEFAULT];
        }
    },
    /** Simpan urutan fallback baru; throw bila chain tidak valid (dipakai route admin utk 400). */
    setAutoChain: async (chain) => {
        const clean = sanitizeAutoChain(chain);
        if (!clean) {
            throw new Error(`chain tidak valid; gunakan array ID dari ${JSON.stringify(AUTO_CHAIN_ALLOWED)} minimal satu`);
        }
        await ensureSettingsTable();
        const query = `
            INSERT INTO settings (key, value)
            VALUES ($1, $2::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = $2::jsonb
            RETURNING value;
        `;
        await pool.query(query, [AUTO_CHAIN_KEY, JSON.stringify(clean)]);
        autoChainCache = { value: clean, expires: Date.now() + AUTO_CHAIN_CACHE_TTL };
        return clean;
    },
    getFeatured: async () => {
        await ensureSettingsTable();
        const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['featured_endpoint']);
        return result.rows.length ? result.rows[0].value : null;
    },
    setFeatured: async (data) => {
        await ensureSettingsTable();
        const query = `
            INSERT INTO settings (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = $2
            RETURNING value;
        `;
        const result = await pool.query(query, ['featured_endpoint', data]);
        return result.rows[0].value;
    }
};

module.exports = settingsService;