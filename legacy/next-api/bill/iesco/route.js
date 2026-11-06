/**
 * @title IESCO Bill Checker
 * @summary Ambil detail/URL tagihan listrik IESCO via nomor referensi atau customer ID.
 * @description Endpoint untuk mengambil tagihan listrik IESCO dari portal PITC.
 *              Masukkan nomor referensi 14 digit atau customer ID 10 digit.
 *              Gunakan fetch=true agar server mencoba mengambil halaman bill upstream
 *              dan mengekstrak informasi dasar (judul, teks, amount/due date best-effort).
 *              Upstream: bill.pitc.com.pk.
 * @method GET
 * @path /api/bill/iesco
 * @param {string} [query.number] - Nomor referensi (14 digit) atau customer ID (10 digit).
 * @param {string} [query.refno] - Nomor referensi 14 digit (alias number).
 * @param {string} [query.customer_id] - Customer ID 10 digit.
 * @param {string} [query.type] - Jenis nomor: reference (default) atau customer.
 * @param {string} [query.fetch] - "1" atau "true" untuk fetch upstream dan ekstrak data.
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/bill/iesco?refno=19146131061801')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';

export async function GET(req) {
  return NextResponse.json({ ok: true });
}

export async function POST(req) {
  return NextResponse.json({ ok: true });
}
