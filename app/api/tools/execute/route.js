/**
 * @title Puru AI Tools Executor
 * @summary Eksekusi satu tool untuk agent loop client-side Puru AI.
 * @description Endpoint yang mengeksekusi satu tool (search_web, crawl_web,
 *              search_docs, endpoint_info, fetch) dan mengembalikan hasilnya
 *              sebagai JSON. Dipakai oleh halaman /puru-ai untuk menjalankan
 *              agentic loop di sisi client (streaming via /api/chat/completions).
 * @method POST
 * @path /api/tools/execute
 * @param {string} body.name - Nama tool: search_web | crawl_web | search_docs | endpoint_info | fetch
 * @param {object} [body.args] - Argumen tool sesuai definisi
 * @response json
 * @example
 * fetch('/api/tools/execute', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         name: 'search_web',
 *         args: { query: 'nodejs tutorial', limit: 5 }
 *     })
 * }).then(res => res.json()).then(console.log);
 */
import { loadDocs, executeTool, getToolDefinitions } from '../../../../lib/puru-tools.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, args } = body || {};
  if (!name || typeof name !== 'string') {
    return Response.json({ success: false, error: 'Tool name wajib diisi' }, { status: 400 });
  }

  const docs = await loadDocs();
  const { tools } = getToolDefinitions(docs);
  const known = tools.some((t) => t.function.name === name);
  if (!known) {
    return Response.json({ success: false, error: `Tool "${name}" tidak dikenal` }, { status: 400 });
  }

  try {
    const result = await executeTool(name, args || {}, docs);
    return Response.json({ success: true, name, result });
  } catch (err) {
    return Response.json({ success: false, name, error: err.message || 'Tool execution failed' }, { status: 500 });
  }
}

export async function GET() {
  const docs = await loadDocs();
  const { tools } = getToolDefinitions(docs);
  return Response.json({
    endpoint: '/api/tools/execute',
    method: 'POST',
    body: { name: 'string (nama tool)', args: 'object (argumen tool)' },
    tools: tools.map((t) => t.function.name),
  });
}