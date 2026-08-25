/**
 * @title Daftar Model AI
 * @summary List model AI yang tersedia (format OpenAI /v1/models).
 * @description Mengembalikan daftar model yang bisa dipakai di endpoint
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
import { ALL_MODEL_IDS } from '../../../lib/ai-provider-web.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CREATED = 1704067200; // 2024-01-01
const MODELS = [
  { id: 'gemini-lite', thinking: false, desc: 'Gemini Flash-Lite via gemini.google.com (tercepat)' },
  { id: 'deepseek-v4', thinking: true, desc: 'DeepSeek V4 via notegpt.io/ai-chat (tanpa login, bisa reasoning)' },
  { id: 'auto', thinking: false, desc: 'Default: gemini-lite dulu, fallback otomatis ke deepseek-v4 bila error/konten kosong' },
];

export async function GET() {
  return NextResponse.json({
    object: 'list',
    data: MODELS.map((m) => ({
      id: m.id,
      object: 'model',
      created: CREATED,
      owned_by: m.id.startsWith('gemini') ? 'gemini-web' : m.id === 'auto' ? 'auto-web' : 'notegpt-web',
      thinking: m.thinking,
      description: m.desc,
    })),
    default: ALL_MODEL_IDS.includes('auto') ? 'auto' : ALL_MODEL_IDS[0],
  });
}
