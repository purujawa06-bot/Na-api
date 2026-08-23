/**
 * @title Daftar Model DeepSeek
 * @summary List model AI yang tersedia (format OpenAI /v1/models).
 * @description Mengembalikan daftar model chat.deepseek.com yang bisa dipakai di endpoint
 *              /api/chat/completions, dalam format kompatibel OpenAI.
 * @method GET
 * @path /api/models
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/models')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CREATED = 1704067200; // 2024-01-01
const MODELS = [
  { id: 'deepseek-chat', thinking: false, desc: 'DeepSeek V3 via web (cepat)' },
  { id: 'deepseek-reasoner', thinking: true, desc: 'DeepSeek R1 via web (reasoning)' },
];

export async function GET() {
  return NextResponse.json({
    object: 'list',
    data: MODELS.map((m) => ({
      id: m.id,
      object: 'model',
      created: CREATED,
      owned_by: 'deepseek-web',
      thinking: m.thinking,
      description: m.desc,
    })),
  });
}
