/**
 * @title MP4 to MP3 Converter
 * @summary Konversi Video MP4 ke Audio MP3.
 * @description Mengekstrak audio dari file video MP4 dan mengubahnya menjadi format MP3. Endpoint ini menggunakan Server-Sent Events (SSE) untuk memberikan update status proses konversi secara real-time.
 * @method POST
 * @path /api/tools/mp4tomp3
 * @response json
 * @param {string} body.url - URL publik file MP4 yang ingin dikonversi.
 * @example
 * async function convert() {
 *   const res = await fetch('/api/tools/mp4tomp3', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://tiyanz-api.vercel.app/example.mp4" })
 *   });
 *   
 *   const reader = res.body.getReader();
 *   const decoder = new TextDecoder();
 *   while (true) {
 *     const { done, value } = await reader.read();
 *     if (done) break;
 *     console.log(decoder.decode(value));
 *   }
 * }
 */
const mp4tomp3Controller = async (req) => {
    return { status: 'SSE Stream Endpoint' };
};

module.exports = mp4tomp3Controller;