/**
 * Registry tunggal model AI (sumber kebenaran).
 * Semua daftar model lain diturunkan dari sini:
 *   - lib/ai-provider-web.js  : ALL_MODEL_IDS + rantai auto
 *   - lib/settingsService.js  : ID sah rantai auto
 *   - app/api/models/route.js : /api/models
 *   - lib/docsService.js      : @choice model di docs
 *   - public/admin.html       : daftar model panel admin (via /api/models)
 *
 * CommonJS (bukan ESM) agar bisa direquire dari modul CJS (settingsService,
 * docsService) maupun diimport dari ESM (ai-provider-web, route Next).
 *
 * Field:
 *   id        ID publik model
 *   label     label tampilan (panel admin / docs)
 *   desc      deskripsi singkat (/api/models)
 *   thinking  model punya mode reasoning (flag UI)
 *   chainable bisa masuk rantai fallback model 'auto'
 *   ownedBy   nama provider internal (nilai `owned_by` /api/models)
 */
const MODELS = [
  {
    id: 'gemini-lite',
    label: 'Gemini Flash-Lite',
    desc: 'Gemini Flash-Lite via gemini.google.com (tercepat)',
    thinking: false,
    chainable: true,
    ownedBy: 'gemini-web',
  },
  {
    id: 'deepseek-v4',
    label: 'DeepSeek V4 (NoteGPT)',
    desc: 'DeepSeek V4 via notegpt.io/ai-chat (tanpa login, bisa reasoning)',
    thinking: true,
    chainable: true,
    ownedBy: 'notegpt-web',
  },
  {
    id: 'easemate',
    label: 'EaseMate AI',
    desc: 'EaseMate AI via api.easemate.ai (sign WASM, kuota per-IP)',
    thinking: false,
    chainable: true,
    ownedBy: 'easemate-web',
  },
  {
    id: 'gemini-share',
    label: 'Gemini Share',
    desc: 'Balasan tetap dari shared conversation Gemini (lib/gemini-share-web.js)',
    thinking: false,
    chainable: false,
    ownedBy: 'gemini-share',
  },
  {
    id: 'auto',
    label: 'Auto (Fallback)',
    desc: 'Default: menyusuri rantai fallback (urutan dari panel admin)',
    thinking: false,
    chainable: false,
    ownedBy: 'auto-web',
  },
];

/** Semua ID model publik (urutan tampilan). */
const ALL_MODEL_IDS = MODELS.map((m) => m.id);

/** ID provider yang sah untuk rantai auto (urutan = urutan default). */
const AUTO_CHAIN_ALLOWED = MODELS.filter((m) => m.chainable).map((m) => m.id);

/** Urutan default rantai auto (default: gemini-lite -> deepseek-v4 -> easemate). */
const AUTO_CHAIN_DEFAULT = [...AUTO_CHAIN_ALLOWED];

module.exports = { MODELS, ALL_MODEL_IDS, AUTO_CHAIN_ALLOWED, AUTO_CHAIN_DEFAULT };
