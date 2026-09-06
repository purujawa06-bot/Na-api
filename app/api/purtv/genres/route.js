/**
 * @title PurTV Genres
 * @summary Daftar genre donghua.
 * @description Mengambil daftar genre donghua dari sumber PurTV (anichin.cafe
 *              /seri/) untuk dipakai pada filter /api/purtv/list.
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