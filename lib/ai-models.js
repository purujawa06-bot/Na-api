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
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    desc: 'Model AI Gemini 3.6 Flash',
    thinking: false,
    chainable: true,
    ownedBy: 'gemini-web',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    desc: 'Model AI dari Gemini',
    thinking: false,
    chainable: true,
    ownedBy: 'gemini-share',
  },
  {
    id: 'gemini-1.5-flash',
    label: 'Gemini 1.5 Flash',
    desc: 'Model AI Gemini 1.5 Flash',
    thinking: false,
    chainable: true,
    ownedBy: 'easemate-web',
  },
  {
    id: 'claude-opus-4',
    label: 'Claude Opus 4',
    desc: 'Model AI Claude Opus 4',
    thinking: false,
    chainable: true,
    ownedBy: 'puru-openai',
  },
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    desc: 'Model AI chat GPT-4.1 Mini',
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

/** Urutan default rantai auto (tetap 3 utama; gemini bisa ditambah via panel admin bila perlu). */
const AUTO_CHAIN_DEFAULT = ['gemini-3.6-flash', 'gemini-1.5-flash'];

module.exports = { MODELS, ALL_MODEL_IDS, AUTO_CHAIN_ALLOWED, AUTO_CHAIN_DEFAULT };
