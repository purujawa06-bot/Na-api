/**
 * @title Al-Quran Digital
 * @summary Al-Quran Digital Kemenag.
 * @description Mengambil data ayat-ayat suci Al-Quran beserta terjemahan dan teks latin langsung dari sumber web-api Kemenag. Respons telah dirapikan dan dibersihkan dari properti bernilai null untuk efisiensi data.
 * @method GET
 * @path /api/tools/quran
 * @response json
 * @param {string} query.surah - Nomor surah (1-114).
 * @param {string} [query.ayah] - Nomor ayat spesifik atau daftar ayat dipisah koma (contoh: "1,2,3"). Default: "all".
 * @example
 * async function getQuran() {
 *   const res = await fetch('/api/tools/quran?surah=10&ayah=1,2');
 *   const data = await res.json();
 *   console.log(data.result.data);
 * }
 */
const quran = require('../../quran');

const quranController = async (req) => {
    const { surah, ayah } = req.query;

    if (!surah) {
        throw new Error("Parameter 'surah' (nomor surah) wajib diisi.");
    }

    const surahMeta = await quran.getSurahInfo(surah);
    if (!surahMeta) {
        throw new Error(`Surah dengan nomor ${surah} tidak ditemukan.`);
    }

    const resultAyahs = await quran.fetchAyahs(surahMeta.id, surahMeta.num_ayah, ayah || "all");

    // Merapikan data dan menghapus nilai null atau field yang tidak diperlukan
    const cleanedData = resultAyahs.map(item => {
        const cleanedAyah = {
            id: item.id,
            ayah: item.ayah,
            arabic: item.arabic,
            latin: item.latin,
            translation: item.translation,
            footnotes: item.footnotes
        };

        // Hapus properti yang bernilai null secara rekursif/iteratif
        Object.keys(cleanedAyah).forEach(key => {
            if (cleanedAyah[key] === null || cleanedAyah[key] === undefined) {
                delete cleanedAyah[key];
            }
        });

        return cleanedAyah;
    });

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            info: {
                nomor_surah: surahMeta.id,
                nama_latin: surahMeta.latin,
                arti: surahMeta.translation,
                total_ayat: surahMeta.num_ayah,
                total_ayat_diambil: cleanedData.length
            },
            data: cleanedData
        }
    };
};

module.exports = quranController;