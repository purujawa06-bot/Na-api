/**
 * @title PurTV Genres
 * @summary Daftar genre untuk navigasi dua sumber.
 * @description Mengambil daftar genre dari sumber PurTV (anichin.cafe /seri/).
 *              Slug yang sama dipakai juga utk navigasi genre anime samehadaku
 *              pada /api/purtv/list. Menyertakan `purtv_pagenation`.
 * @method GET
 * @path /api/purtv/genres
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/genres')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchPurtvGenres } from '../../../../lib/purtv.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await fetchPurtvGenres();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}