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
import { MODELS as GEMINI_MODELS } from '../../../lib/gemini-web.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CREATED = 1704067200; // 2024-01-01
const MODELS = [
  { id: 'deepseek-chat', thinking: false, desc: 'DeepSeek V3 via web (cepat)' },
  { id: 'deepseek-reasoner', thinking: true, desc: 'DeepSeek R1 via web (reasoning)' },
  { id: 'gemini-flash', thinking: false, desc: 'Gemini 3.6 Flash via gemini.google.com (serbaguna)' },
  { id: 'gemini-flash-lite', thinking: false, desc: 'Gemini 3.5 Flash-Lite via gemini.google.com (tercepat)' },
];

export async function GET() {
  return NextResponse.json({
    object: 'list',
    data: MODELS.map((m) => ({
      id: m.id,
      object: 'model',
      created: CREATED,
      owned_by: m.id.startsWith('gemini') ? 'gemini-web' : 'deepseek-web',
      thinking: m.thinking,
      description: m.desc,
    })),
  });
}

