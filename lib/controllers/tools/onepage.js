/**
 * @title OnePage Host
 * @summary Buat halaman web instan.
 * @description Membuat dan meng-host halaman HTML statis secara gratis menggunakan layanan 1page. Berguna untuk membuat landing page sementara atau berbagi kode HTML hasil render.
 * @method POST
 * @path /api/tools/onepage
 * @response json
 * @param {string} body.name - Nama atau slug halaman (contoh: 'halaman-saya').
 * @param {string} body.html - Konten kode HTML lengkap.
 * @example
 * async function createPage() {
 *   const res = await fetch('/api/tools/onepage', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ 
 *       "name": "promo-today", 
 *       "html": "<h1>Selamat Datang</h1><p>Ini halaman otomatis.</p>" 
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { createPage } = require('../../onepage');

const onepageController = async (req) => {
    const { name, html } = req.body;

    if (!name || !html) {
        throw new Error("Parameter 'name' dan 'html' wajib diisi dalam body JSON.");
    }

    const result = await createPage(name, html);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = onepageController;