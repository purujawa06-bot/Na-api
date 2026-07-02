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
    const [loaded, setLoaded] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const timeoutRef = useRef(null);
    const mountedRef = useRef(true);

    // Reset state when src changes
    useEffect(() => {
        setImgError(false);
        setImgSrc(src);
        setLoaded(false);
        setTimedOut(false);

        // Set timeout: fallback ke favicon jika gambar tidak selesai dimuat dalam 'timeout' ms
        timeoutRef.current = setTimeout(() => {
            if (mountedRef.current && !loaded) {
                setTimedOut(true);
                setImgSrc('/favicon.ico');
                setImgError(true);
            }
        }, timeout);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [src, timeout, loaded]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const handleError = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (!imgError) {
            setImgError(true);
            setImgSrc('/favicon.ico');
        }
    };

    const handleLoad = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setLoaded(true);
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
