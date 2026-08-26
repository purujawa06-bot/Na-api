/**
 * @title Daftar Model AI
 * @summary List model AI yang tersedia (format OpenAI /v1/models).
 * @description Mengembalikan daftar model yang bisa dipakai di endpoint
 *              /api/chat/completions, dalam format kompatibel OpenAI.
 *              Sumber data: registry tunggal lib/ai-models.js — model baru
 *              cukup ditambah di sana, otomatis muncul di sini, di docs,
 *              dan di panel admin.
 * @method GET
 * @path /api/models
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/models')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import aiModels from '../../../lib/ai-models.js';

const { MODELS, ALL_MODEL_IDS } = aiModels;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CREATED = 1704067200; // 2024-01-01

export async function GET() {
  return NextResponse.json({
    object: 'list',
    data: MODELS.map((m) => ({
      id: m.id,
      object: 'model',
      created: CREATED,
      owned_by: m.ownedBy,
      thinking: m.thinking,
      label: m.label,
      desc: m.desc,
      chainable: m.chainable,
      description: m.desc,
    })),
    default: ALL_MODEL_IDS.includes('auto') ? 'auto' : ALL_MODEL_IDS[0],
  });
}
