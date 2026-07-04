/**
 * @title ImgBB Uploader
 * @summary Upload Gambar ke ImgBB.
 * @description Mengupload gambar ke ImgBB dan mendapatkan direct link secara gratis. Mendukung format JPG, PNG, BMP, GIF, TIF, WEBP, HEIC, PDF.
 * @method POST
 * @path /api/tools/imgbb
 * @response json
 * @param {file} formData.image - File gambar yang akan diupload.
 * @example
 * // Contoh penggunaan dengan FormData (Browser)
 * const formData = new FormData();
 * formData.append('image', fileInput.files[0]);
 * 
 * const res = await fetch('/api/tools/imgbb', {
 *   method: 'POST',
 *   body: formData
 * });
 * 
 * const data = await res.json();
 * console.log(data);
 */
const { upload } = require('../../imgbb');

const imgbbController = async (req) => {
    // req dalam konteks ini adalah objek custom yang dikirim dari route.js
    // berisi { fileBuffer, fileName }
    
    const { fileBuffer, fileName } = req;
    
    if (!fileBuffer) throw new Error("File gambar wajib diupload.");

    const result = await upload(fileBuffer, fileName || 'image.jpg');

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = imgbbController;