const tempService = require('./tempService');

/**
 * Automasi pembuatan halaman menggunakan penyimpanan internal (Database)
 * Karena layanan eksternal 1page.ct.ws sering mengalami masalah/suspensi.
 */
async function createPage(pageName, htmlContent) {
    try {
        if (!htmlContent) throw new Error("Konten HTML tidak boleh kosong.");

        // Simpan ke database menggunakan tempService
        // Default TTL adalah 30 menit, kita beri waktu 24 jam (1440 menit) agar lebih awet
        const id = await tempService.save({
            name: pageName,
            html: htmlContent,
            created_at: new Date().toISOString()
        }, 1440);

        // Gunakan host dari env jika tersedia, atau fallback ke relatif path
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
        const pageUrl = `${baseUrl}/p/${id}`;

        return {
            success: true,
            id: id,
            page_url: pageUrl,
            message: "Halaman berhasil dibuat secara internal."
        };

    } catch (error) {
        let errorMsg = "Unknown error";
        if (error) {
            if (error.message) errorMsg = error.message;
            else if (typeof error === 'string') errorMsg = error;
            else errorMsg = JSON.stringify(error);
        }
        throw new Error("Gagal membuat halaman: " + errorMsg);
    }
}

module.exports = { createPage };
