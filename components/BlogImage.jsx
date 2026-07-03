'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

/**
 * BlogImage — Komponen gambar untuk blog dengan fallback otomatis ke favicon
 * jika gambar gagal dimuat (error sertifikat, koneksi, dll.)
 * atau tidak kunjung selesai dimuat dalam 3 detik.
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
 * - timeout    : Waktu tunggu dalam ms sebelum fallback ke favicon (default 3000)
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
    timeout = 3000,
}) {
    const [imgError, setImgError] = useState(false);
    const [imgSrc, setImgSrc] = useState(src);
    const [timedOut, setTimedOut] = useState(false);
    const timeoutRef = useRef(null);
    const loadedRef = useRef(false);    // ref, bukan state, agar tidak trigger re-render
    const mountedRef = useRef(true);

    // Reset state ketika src berubah
    useEffect(() => {
        setImgError(false);
        setImgSrc(src);
        setTimedOut(false);
        loadedRef.current = false;

        // Fallback ke favicon jika gambar tidak selesai dimuat dalam 'timeout' ms
        timeoutRef.current = setTimeout(() => {
            if (mountedRef.current && !loadedRef.current) {
                setTimedOut(true);
                setImgSrc('/favicon.ico');
                setImgError(true);
            }
        }, timeout);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
        // loaded TIDAK di-deps — pakai loadedRef biar gak reset loop
    }, [src, timeout]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const handleError = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (!imgError && !loadedRef.current) {
            setImgError(true);
            setImgSrc('/favicon.ico');
        }
    };

    const handleLoad = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        loadedRef.current = true;
        setTimedOut(false);
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
            onLoad={handleLoad}
        />
    );

    if (containerClassName) {
        return <div className={containerClassName}>{imageElement}</div>;
    }

    return imageElement;
}
