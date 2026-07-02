'use client';

import React, { useState } from 'react';
import Image from 'next/image';

/**
 * BlogImage — Komponen gambar untuk blog dengan fallback otomatis ke favicon
 * jika gambar gagal dimuat.
 *
 * Props:
 * - src        : URL gambar utama
 * - alt        : Teks alternatif
 * - className  : CSS class untuk <Image>
 * - fill       : Gunakan layout fill (boolean)
 * - sizes      : Responsive sizes attribute
 * - priority   : Priority loading (boolean)
 * - containerClassName : CSS class untuk wrapper div
 * - width / height      : Ukuran tetap (jika tidak pakai fill)
 * - unoptimized         : Skip Next.js optimization (default true untuk gambar remote)
 */
export default function BlogImage({
    src,
    alt = '',
    className = '',
    fill = false,
    sizes,
    priority = false,
    containerClassName = '',
    width,
    height,
    unoptimized = true,
}) {
    const [imgError, setImgError] = useState(false);
    const [imgSrc, setImgSrc] = useState(src);

    const handleError = () => {
        if (!imgError) {
            setImgError(true);
            setImgSrc('/favicon.ico');
        }
    };

    if (!imgSrc) return null;

    const imageElement = (
        <Image
            src={imgSrc}
            alt={alt}
            fill={fill}
            width={!fill ? width : undefined}
            height={!fill ? height : undefined}
            className={`${className} ${imgError ? 'p-4 object-contain' : ''}`}
            unoptimized={unoptimized}
            sizes={sizes}
            priority={priority}
            onError={handleError}
        />
    );

    if (containerClassName) {
        return <div className={containerClassName}>{imageElement}</div>;
    }

    return imageElement;
}
