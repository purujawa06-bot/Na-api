/**
 * @title Brat Generator
 * @summary Brat Generator (Text to Image).
 * @description Membuat meme teks gaya "Brat" berdasarkan input teks menggunakan API eksternal yang cepat. Mengembalikan URL gambar hasil (PNG) yang sudah diproses menjadi URL publik.
 * @method POST
 * @path /api/tools/brat
 * @response json
 * @param {string} body.text - Teks yang akan ditampilkan pada gambar.
 * @example
 * async function createBrat() {
 *   const res = await fetch('/api/tools/brat', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "text": "hai kamu siapa sih😈" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { generateBrat } = require('../../brat');

const bratController = async (req) => {
    const { text } = req.body;
    const origin = req.origin || '';

    if (!text) {
        throw new Error("Parameter 'text' wajib diisi.");
    }

    const url = await generateBrat(text);

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            url: origin + url
        }
    };
};

module.exports = bratController;