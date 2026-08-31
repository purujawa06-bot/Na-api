/**
 * UserScript Store — sumber data tunggal untuk daftar userScript PuruBoy API.
 *
 * File `.user.js` TIDAK disimpan statis; konten di-generate dari sini via
 * buildUserScript() sehingga metadata @downloadURL / @updateURL selalu memakai
 * origin tempat script di-install (dev / vercel / kozow). Alhasil auto-update
 * lewat Tampermonkey / Violentmonkey selalu mengarah ke host yang benar.
 */

const deepseekBody = `// ==UserScript==
// @name         DeepSeek Token Grabber
// @namespace    https://puruboy-api.vercel.app
// @version      {{VERSION}}
// @description  {{DESCRIPTION}}
// @author       PuruBoy
// @icon         {{ORIGIN}}/favicon.jpg
// @match        https://chat.deepseek.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @downloadURL  {{ORIGIN}}/userscripts/deepseek-token.user.js
// @updateURL    {{ORIGIN}}/userscripts/deepseek-token.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (typeof GM_addStyle !== 'function') return;

  var DONE_KEY = 'puruboy_ds_token_done';
  var API_SITE = 'https://puruboy-api.vercel.app/docs';

  GM_addStyle([
    '#puruboy-ds{position:fixed;right:16px;bottom:104px;z-index:2147483647;width:310px;max-width:calc(100vw - 32px);background:#1e1e1e;border:1px solid #323232;border-radius:16px;box-shadow:0 14px 44px rgba(0,0,0,.6);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8e8e8;overflow:hidden;}',
    '#puruboy-ds .head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#252525;border-bottom:1px solid #2e2e2e;}',
    '#puruboy-ds .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;color:#fff;}',
    '#puruboy-ds .logo{width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#f472b6,#a855f7);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;}',
    '#puruboy-ds .close{cursor:pointer;border:none;background:transparent;color:#9a9a9a;font-size:15px;line-height:1;padding:4px 6px;border-radius:6px;}',
    '#puruboy-ds .close:hover{color:#fff;background:#333;}',
    '#puruboy-ds .body{padding:16px 14px;}',
    '#puruboy-ds .title{margin:0 0 6px;font-size:14px;font-weight:700;color:#fff;}',
    '#puruboy-ds .desc{margin:0 0 14px;font-size:12px;line-height:1.6;color:#b0b0b0;}',
    '#puruboy-ds .token{margin-bottom:14px;padding:12px;background:#141414;border:1px dashed #3a3a3a;border-radius:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#7dd3fc;word-break:break-all;text-align:center;}',
    '#puruboy-ds .token.miss{color:#f87171;}',
    '#puruboy-ds .btn{cursor:pointer;border:none;border-radius:10px;padding:11px;font-size:13px;font-weight:700;transition:opacity .2s,transform .15s;width:100%;}',
    '#puruboy-ds .btn:active{transform:scale(.97);}',
    '#puruboy-ds .btn.copy{background:#4d6bfe;color:#fff;}',
    '#puruboy-ds .btn.copy:hover{opacity:.88;}',
    '#puruboy-ds .btn.copy.ok{background:#22c55e;}',
    '#puruboy-ds .btn.link{margin-top:8px;background:#2a2a2a;color:#e8e8e8;text-decoration:none;display:block;text-align:center;}',
    '#puruboy-ds .btn.link:hover{background:#353535;}',
    '#puruboy-ds .foot{margin-top:10px;font-size:10px;color:#8a8a8a;text-align:center;}'
  ].join('\\n'));

  function readToken() {
    var raw = null;
    try {
      raw = window.localStorage.getItem('userToken');
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    var first = raw.trim().charAt(0);
    if (first === '{' || first === '[') {
      try {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          if (typeof obj.value === 'string' && obj.value.length > 4) return obj.value;
          if (typeof obj.token === 'string' && obj.token.length > 4) return obj.token;
        }
      } catch (e) {
        // bukan JSON, pakai raw
      }
    }
    return raw;
  }

  function maskToken(t) {
    if (!t) return '';
    if (t.length <= 10) return '******';
    return t.slice(0, 5) + '******' + t.slice(-4);
  }

  function makePopup() {
    var wrap = document.createElement('div');
    wrap.id = 'puruboy-ds';
    wrap.innerHTML = [
      '<div class="head">',
      '<span class="brand"><span class="logo">P</span>PuruBoy AI</span>',
      '<button class="close" aria-label="Tutup">&#10005;</button>',
      '</div>',
      '<div class="body">',
      '<p class="title"></p>',
      '<p class="desc"></p>',
      '<div class="token"></div>',
      '<button class="btn copy"></button>',
      '<a class="btn link" href="' + API_SITE + '" target="_blank" rel="noopener">Buka PuruBoy API</a>',
      '<div class="foot"></div>',
      '</div>'
    ].join('');

    var title = wrap.querySelector('.title');
    var desc = wrap.querySelector('.desc');
    var tokenEl = wrap.querySelector('.token');
    var copyBtn = wrap.querySelector('.copy');
    var foot = wrap.querySelector('.foot');
    var token = readToken();

    if (token) {
      title.textContent = 'Token berhasil ditemukan!';
      desc.textContent = 'Salin token lalu tempel di kolom userID pada endpoint DeepSeek PuruBoy API.';
      tokenEl.textContent = maskToken(token);
      copyBtn.textContent = 'Salin Token';
      foot.textContent = 'Token hanya diproses di perangkatmu.';

      copyBtn.addEventListener('click', function () {
        var done = function () {
          copyBtn.textContent = 'Tersalin!';
          copyBtn.classList.add('ok');
        };
        if (typeof GM_setClipboard === 'function') {
          try {
            GM_setClipboard(token, done);
            return;
          } catch (e) {}
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(token).then(done, done);
        } else {
          var ta = document.createElement('textarea');
          ta.value = token;
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
          } catch (e) {}
          document.body.removeChild(ta);
          done();
        }
      });
    } else {
      title.textContent = 'Belum login?';
      desc.textContent = 'Masuk/login dulu di chat.deepseek.com, lalu muat ulang halaman ini.';
      tokenEl.textContent = 'userToken belum ditemukan';
      tokenEl.classList.add('miss');
      copyBtn.textContent = 'Muat Ulang';
      foot.textContent = 'Popup ini hanya aktif di chat.deepseek.com.';
      copyBtn.addEventListener('click', function () {
        window.location.reload();
      });
    }

    wrap.querySelector('.close').addEventListener('click', function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      try {
        window.localStorage.setItem(DONE_KEY, '1');
      } catch (e) {}
    });

    (document.body || document.documentElement).appendChild(wrap);
  }

  var tries = 0;
  var maxTries = 15;
  function boot() {
    if (readToken() || tries >= maxTries) {
      makePopup();
      return;
    }
    tries += 1;
    setTimeout(boot, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(boot, 1200);
    });
  } else {
    setTimeout(boot, 1200);
  }
})();
`;
export const SCRIPTS = [
  {
    id: 'deepseek-token',
    name: 'DeepSeek Token Grabber',
    file: 'deepseek-token.user.js',
    version: '1.0.0',
    author: 'PuruBoy',
    icon: 'fa-key',
    color: 'from-cyan-500 to-blue-600',
    tags: ['DeepSeek', 'AI', 'Token', 'Chat'],
    updatedAt: '2026-08-28',
    summary:
      'Popup otomatis di chat.deepseek.com yang menyalin userToken akunmu dalam satu klik. Tanpa buka DevTools lagi, token langsung siap dipakai di endpoint DeepSeek PuruBoy API.',
    description:
      'Popup otomatis di chat.deepseek.com untuk menyalin userToken akunmu — siap pakai untuk endpoint DeepSeek PuruBoy API.',
    features: [
      'Muncul otomatis saat membuka chat.deepseek.com',
      'Salin userToken sekali klik ke clipboard',
      'Deteksi status login (token ada / belum)',
      'Auto-update lewat Tampermonkey / Violentmonkey',
    ],
    match: 'https://chat.deepseek.com/*',
    body: deepseekBody,
  },
];

export function getScript(id) {
  return SCRIPTS.find((s) => s.id === id) || null;
}

export function buildUserScript(id, origin) {
  const script = getScript(id);
  if (!script) return null;
  return script.body
    .replace(/\{\{VERSION\}\}/g, script.version)
    .replace(/\{\{DESCRIPTION\}\}/g, script.description)
    .replace(/\{\{ORIGIN\}\}/g, origin.replace(/\/$/, ''));
}
