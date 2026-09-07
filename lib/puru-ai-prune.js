/**
 * Puru AI — Message Pruning
 *
 * Prune history untuk menghemat token/context saat agentic loop.
 * Strategi:
 * - Simpan SEMUA pesan user & assistant (text saja)
 * - Prune tool results pada pesan LAMA (ganti ringkasan singkat)
 * - Pertahankan SEMUA tool results pada pesan BARU (agar AI punya konteks lengkap)
 * - Batasi jumlah pesan berdasarkan MAX_USER_HISTORY
 */

const MAX_USER_HISTORY = 10;
const KEEP_RECENT_USER = 3; // Pertahankan N user message terakhir FULL (tanpa prune)

/**
 * Parse args tool call ke string ringkas.
 */
function summarizeToolArgs(toolName, argsStr) {
  try {
    const args = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr;
    const entries = Object.entries(args || {});
    const parts = entries.slice(0, 2).map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return val.length > 40 ? val.slice(0, 40) + '…' : val;
    });
    return `${toolName}(${parts.join(', ')})`;
  } catch {
    return toolName;
  }
}

/**
 * Prune array messages OpenAI format untuk menghemat context.
 *
 * @param {Array} messages - Array pesan OpenAI [{role, content, tool_calls?, ...}]
 * @param {Object} [opts] - Opsi pruning
 * @param {number} [opts.maxUserMessages=10] - Maks jumlah user messages
 * @param {number} [opts.keepRecent=3] - Jangan prune N user messages terakhir
 * @param {number} [opts.maxToolResultChars=500] - Maks karakter tool result sebelum di-prune
 * @returns {Array} Messages yang sudah di-prune
 */
export function pruneMessages(messages, opts = {}) {
  const {
    maxUserMessages = MAX_USER_HISTORY,
    keepRecent = KEEP_RECENT_USER,
    maxToolResultChars = 500,
  } = opts;

  if (!messages || !messages.length) return messages;

  // 1. Pisahkan system messages dan sisanya
  const systemMsgs = [];
  const nonSystemMsgs = [];
  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      systemMsgs.push(msg);
    } else {
      nonSystemMsgs.push(msg);
    }
  }

  // 2. Hitung user messages untuk batasi jumlah
  const userIdx = [];
  nonSystemMsgs.forEach((m, i) => { if (m.role === 'user') userIdx.push(i); });

  let workingMsgs = nonSystemMsgs;
  if (userIdx.length > maxUserMessages) {
    // Potong dari awal, pertahankan dari user message pertama yang masih boleh ada
    const cutIdx = userIdx[userIdx.length - maxUserMessages];
    workingMsgs = nonSystemMsgs.slice(cutIdx);
  }

  // 3. Tentukan batas "recent" — semua user message setelah indeks ini TIDAK di-prune
  const recentUserCount = workingMsgs.filter((m) => m.role === 'user').length;
  const recentThreshold = Math.max(0, recentUserCount - keepRecent);

  // 4. Prune tool results pada pesan lama
  let currentUserCount = 0;
  const pruned = workingMsgs.map((msg) => {
    if (msg.role === 'user') {
      currentUserCount++;
    }

    // Tool results pada pesan LAMA → ganti ringkasan
    if (msg.role === 'tool' && currentUserCount <= recentThreshold) {
      const resultStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (resultStr && resultStr.length > maxToolResultChars) {
        return {
          ...msg,
          content: `[Pruned — hasil tool terlalu panjang. Asli ${resultStr.length} karakter]`,
        };
      }
    }

    // Assistant messages dengan tool_calls pada pesan LAMA → pertahankan
    // tool_calls (agar format tetap valid), tapi tool results sudah diprune di atas
    return msg;
  });

  // 5. Gabungkan system + pruned
  return [...systemMsgs, ...pruned];
}

/**
 * Prune untuk API context (saat mengirim ke /api/chat/completions).
 * Lebih agresif: tool results pada SEMUA pesan di-truncate,
 * kecuali pesan terakhir yang masih dalam agentic loop.
 *
 * @param {Array} messages - Array pesan OpenAI format
 * @param {number} [maxToolResult=300] - Maks karakter per tool result
 * @returns {Array} Messages yang sudah di-prune untuk API
 */
export function pruneForAPI(messages, maxToolResult = 300) {
  if (!messages || !messages.length) return messages;

  const systemMsgs = [];
  const nonSystem = [];
  for (const msg of messages) {
    if (msg.role === 'system') systemMsgs.push(msg);
    else nonSystem.push(msg);
  }

  // Cari index tool message terakhir (masih dalam agentic loop aktif)
  let lastToolIdx = -1;
  nonSystem.forEach((m, i) => { if (m.role === 'tool') lastToolIdx = i; });

  const pruned = nonSystem.map((msg, i) => {
    if (msg.role === 'tool' && i < lastToolIdx) {
      const resultStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (resultStr && resultStr.length > maxToolResult) {
        return {
          ...msg,
          content: resultStr.slice(0, maxToolResult) + '\n... [truncated for context]',
        };
      }
    }
    return msg;
  });

  return [...systemMsgs, ...pruned];
}
