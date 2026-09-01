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
    desc: 'Model AI cepat dan ringan',
    thinking: false,
    chainable: true,
    ownedBy: 'gemini-web',
  },
  {
    id: 'easemate',
    label: 'EaseMate AI',
    desc: 'Model AI alternatif',
    thinking: false,
    chainable: true,
    ownedBy: 'easemate-web',
  },
  {
    id: 'gemini-share',
    label: 'Gemini Share',
    desc: 'Model AI dari Gemini',
    thinking: false,
    chainable: true,
    ownedBy: 'gemini-share',
  },
  {
    id: 'puru',
    label: 'OpenCode Zen (Big Pickle)',
    desc: 'Model AI via OpenCode Zen endpoint gratis (big-pickle)',
    thinking: false,
    chainable: true,
    ownedBy: 'puru-openai',
  },
  {
    id: 'quillbot',
    label: 'QuillBot AI',
    desc: 'Model AI chat dari QuillBot (gpt-4.1-mini)',
    thinking: false,
    chainable: true,
    ownedBy: 'quillbot-web',
  },
  {
    id: 'auto',
    label: 'Auto (Fallback)',
    desc: 'Otomatis memilih model terbaik',
    thinking: false,
    chainable: false,
    ownedBy: 'auto-web',
  },
];

/** Semua ID model publik (urutan tampilan). */
const ALL_MODEL_IDS = MODELS.map((m) => m.id);

/** ID provider yang sah untuk rantai auto (urutan = urutan default). */
const AUTO_CHAIN_ALLOWED = MODELS.filter((m) => m.chainable).map((m) => m.id);

/** Urutan default rantai auto (tetap 3 utama; gemini-share bisa ditambah via panel admin bila perlu). */
const AUTO_CHAIN_DEFAULT = ['gemini-lite', 'easemate'];

module.exports = { MODELS, ALL_MODEL_IDS, AUTO_CHAIN_ALLOWED, AUTO_CHAIN_DEFAULT };
