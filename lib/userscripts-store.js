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



const maiaChessBody = `// ==UserScript==
// @name         Maia Chess Assistant (Ringan)
// @namespace    https://puruboy-api.vercel.app
// @version      {{VERSION}}
// @description  {{DESCRIPTION}}
// @author       PuruBoy
// @icon         {{ORIGIN}}/favicon.jpg
// @match        https://www.chess.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  {{ORIGIN}}/userscripts/maia-chess.user.js
// @updateURL    {{ORIGIN}}/userscripts/maia-chess.user.js
// ==/UserScript==

(function () {
  'use strict';

  var ORIGIN = '{{ORIGIN}}';
  var API_URL = ORIGIN + '/api/chess/maia';
  var ENABLED_KEY = 'maia_chess_enabled';
  var engaged = true;
  try {
    engaged = GM_getValue(ENABLED_KEY, '1') !== '0';
  } catch (e) { engaged = true; }

  GM_addStyle([
    '#maia-fab{position:fixed;left:14px;bottom:14px;z-index:2147483647;display:flex;align-items:center;gap:8px;border-radius:999px;padding:8px 12px;cursor:pointer;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;font-weight:700;color:#fff;background:#1e1e1e;border:1px solid #333;box-shadow:0 8px 22px rgba(0,0,0,.35);user-select:none;transition:all .18s ease;}',
    '#maia-fab .dot{width:9px;height:9px;border-radius:50%;background:#666;flex-shrink:0;}',
    '#maia-fab.on .dot{background:#22c55e;box-shadow:0 0 8px #22c55e;}',
    '#maia-fab .lbl{font-size:11px;color:#ccc;}',
    '#maia-arrow{position:absolute;top:0;left:0;pointer-events:none;z-index:40;overflow:visible;}'
  ].join('\\n'));

  function saveEngaged(v) {
    engaged = v;
    try { GM_setValue(ENABLED_KEY, v ? '1' : '0'); } catch (e) {}
  }

  /* ================= tiny chess engine ================= */
  // square = rank01*8 + file ; rank01 0 = rank1, file 0 = file a
  var FILE_CHARS = 'abcdefgh';

  function Game() {
    this.board = new Array(64);
    this.turn = 'w';
    this.castle = 'KQkq';
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.uci = [];
    this.reset();
  }

  Game.prototype.F = function (r, f) { return r * 8 + f; };
  Game.prototype.rankOf = function (i) { return i >> 3; };
  Game.prototype.fileOf = function (i) { return i & 7; };
  Game.prototype.onBoard = function (r, f) { return r >= 0 && r < 8 && f >= 0 && f < 8; };
  Game.prototype.colorOf = function (p) {
    if (!p || p === ' ') return null;
    return p === p.toUpperCase() ? 'w' : 'b';
  };
  Game.prototype.opp = function (c) { return c === 'w' ? 'b' : 'w'; };
  Game.prototype.typeOf = function (p) { return p ? p.toLowerCase() : ''; };

  Game.prototype.setFen = function (fen) {
    var parts = fen.split(' ');
    var rows = parts[0].split('/');
    var self = this;
    this.board = new Array(64).fill(' ');
    rows.forEach(function (row, ri) {
      var f = 0;
      for (var k = 0; k < row.length; k++) {
        var ch = row.charAt(k);
        if (ch >= '0' && ch <= '9') { f += parseInt(ch, 10); }
        else { self.board[self.F(7 - ri, f)] = ch; f++; }
      }
    });
    if (parts.length > 1) {
      this.turn = parts[1] === 'b' ? 'b' : 'w';
      this.castle = parts.length > 2 ? parts[2] : '-';
      var ep = parts.length > 3 ? parts[3] : '-';
      this.ep = ep === '-' || ep.length < 2 ? -1 : FILE_CHARS.indexOf(ep.charAt(0)) + (parseInt(ep.charAt(1), 10) - 1) * 8;
      this.half = parts.length > 4 ? parseInt(parts[4], 10) || 0 : 0;
      this.full = parts.length > 5 ? parseInt(parts[5], 10) || 1 : 1;
    }
  };

  Game.prototype.fen = function () {
    var out = '';
    var empty = 0;
    for (var r = 7; r >= 0; r--) {
      if (r !== 7) out += '/';
      for (var f = 0; f < 8; f++) {
        var p = this.board[this.F(r, f)];
        if (p === ' ') { empty++; }
        else {
          if (empty) { out += empty; empty = 0; }
          out += p;
        }
      }
      if (empty) { out += empty; empty = 0; }
    }
    var epStr = this.ep === -1 ? '-' : FILE_CHARS[this.fileOf(this.ep)] + (this.rankOf(this.ep) + 1);
    return out + ' ' + this.turn + ' ' + (this.castle || '-') + ' ' + epStr + ' ' + this.half + ' ' + this.full;
  };

  Game.prototype.reset = function () {
    this.setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    this.turn = 'w';
    this.castle = 'KQkq';
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.uci = [];
  };

  Game.prototype.genMoves = function () {
    var self = this;
    var moves = [];
    var color = this.turn;
    var i, p, t, r, f;
    for (i = 0; i < 64; i++) {
      p = this.board[i];
      t = this.typeOf(p);
      if (!p || p === ' ' || this.colorOf(p) !== color) continue;
      r = this.rankOf(i); f = this.fileOf(i);
      if (t === 'p') this.genPawn(moves, i, r, f, color);
      else if (t === 'n') this.genKnight(moves, i, r, f, color);
      else if (t === 'b') this.genSlider(moves, i, r, f, color, [[1,1],[1,-1],[-1,1],[-1,-1]]);
      else if (t === 'r') this.genSlider(moves, i, r, f, color, [[1,0],[-1,0],[0,1],[0,-1]]);
      else if (t === 'q') this.genSlider(moves, i, r, f, color, [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]);
      else if (t === 'k') this.genKing(moves, i, r, f, color);
    }
    var legal = [];
    for (i = 0; i < moves.length; i++) {
      if (!this.makeClone(moves[i]).inCheck(color)) legal.push(moves[i]);
    }
    return legal;
  };

  Game.prototype.inCheck = function (color) {
    var kp = color === 'w' ? 'K' : 'k';
    var ki = -1;
    for (var i = 0; i < 64; i++) if (this.board[i] === kp) { ki = i; break; }
    if (ki === -1) return false;
    return this.squareAttacked(ki, this.opp(color));
  };

  Game.prototype.squareAttacked = function (sq, byColor) {
    var rank = this.rankOf(sq), file = this.fileOf(sq);
    var p, r, f, c, t, i, d, j;
    // pawns: byColor pawns attack diagonally toward rank increasing if white, decreasing if black
    var p1 = byColor === 'w' ? 1 : -1;
    var pr = rank + p1; // wait: white pawns move up (rank01+), attack on their row+1
    // a pawn of byColor sitting at (x,y) attacks (y+dir, x+-1). Here sq is attacked square.
    // White pawn attacks upward => attacker at (rank-1, file-1)/(rank-1,file+1)
    var ar = byColor === 'w' ? rank - 1 : rank + 1;
    for (i = -1; i <= 1; i += 2) {
      r = ar; f = file + i;
      if (this.onBoard(r, f)) {
        p = this.board[this.F(r, f)];
        if (this.typeOf(p) === 'p' && this.colorOf(p) === byColor) return true;
      }
    }
    // knight
    var kn = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
    for (i = 0; i < kn.length; i++) {
      r = rank + kn[i][0]; f = file + kn[i][1];
      if (this.onBoard(r, f)) {
        p = this.board[this.F(r, f)];
        if (this.typeOf(p) === 'n' && this.colorOf(p) === byColor) return true;
      }
    }
    // king
    for (d = -1; d <= 1; d++) for (j = -1; j <= 1; j++) {
      if (d === 0 && j === 0) continue;
      r = rank + d; f = file + j;
      if (this.onBoard(r, f)) {
        p = this.board[this.F(r, f)];
        if (this.typeOf(p) === 'k' && this.colorOf(p) === byColor) return true;
      }
    }
    // sliders
    var dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    for (d = 0; d < dirs.length; d++) {
      r = rank + dirs[d][0]; f = file + dirs[d][1];
      while (this.onBoard(r, f)) {
        p = this.board[this.F(r, f)];
        if (p !== ' ') {
          t = this.typeOf(p); c = this.colorOf(p);
          if (c === byColor && (t === 'q' || (dirs[d][0] !== 0 && dirs[d][1] !== 0 ? t === 'b' : t === 'r'))) return true;
          break;
        }
        r += dirs[d][0]; f += dirs[d][1];
      }
    }
    return false;
  };

  Game.prototype.genPawn = function (moves, i, r, f, color) {
    var self = this;
    var dir = color === 'w' ? 1 : -1;
    var startRank = color === 'w' ? 1 : 6;
    var promoRank = color === 'w' ? 7 : 0;
    var promoPieces = ['q', 'r', 'b', 'n'];
    var to, toR, toF;
    // forward one
    toR = r + dir;
    if (this.onBoard(toR, f) && this.board[this.F(toR, f)] === ' ') {
      if (toR === promoRank) {
        for (var k = 0; k < 4; k++) moves.push({ from: i, to: this.F(toR, f), promotion: promoPieces[k] });
      } else {
        moves.push({ from: i, to: this.F(toR, f) });
        if (r === startRank && this.board[this.F(r + 2 * dir, f)] === ' ') {
          moves.push({ from: i, to: this.F(r + 2 * dir, f) });
        }
      }
    }
    // captures + en passant
    for (var df = -1; df <= 1; df += 2) {
      toF = f + df;
      if (!this.onBoard(toR, toF)) continue;
      to = this.F(toR, toF);
      if (this.colorOf(this.board[to]) === this.opp(color)) {
        if (toR === promoRank) {
          for (var k2 = 0; k2 < 4; k2++) moves.push({ from: i, to: to, promotion: promoPieces[k2], capture: true });
        } else {
          moves.push({ from: i, to: to, capture: true });
        }
      } else if (to === this.ep) {
        moves.push({ from: i, to: to, enPassant: true });
      }
    }
  };

  Game.prototype.genKnight = function (moves, i, r, f, color) {
    var kn = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
    var self = this;
    for (var k = 0; k < kn.length; k++) {
      var nr = r + kn[k][0], nf = f + kn[k][1];
      if (!this.onBoard(nr, nf)) continue;
      var to = this.F(nr, nf);
      if (this.colorOf(this.board[to]) === color) continue;
      moves.push({ from: i, to: to, capture: this.board[to] !== ' ' });
    }
  };

  Game.prototype.genSlider = function (moves, i, r, f, color, dirs) {
    var self = this;
    for (var d = 0; d < dirs.length; d++) {
      var nr = r + dirs[d][0], nf = f + dirs[d][1];
      while (this.onBoard(nr, nf)) {
        var to = this.F(nr, nf);
        var p = this.board[to];
        if (p !== ' ') {
          if (this.colorOf(p) !== color) moves.push({ from: i, to: to, capture: true });
          break;
        }
        moves.push({ from: i, to: to });
        nr += dirs[d][0]; nf += dirs[d][1];
      }
    }
  };

  Game.prototype.genKing = function (moves, i, r, f, color) {
    var self = this;
    var d, j, nr, nf, to, p;
    for (d = -1; d <= 1; d++) for (j = -1; j <= 1; j++) {
      if (d === 0 && j === 0) continue;
      nr = r + d; nf = f + j;
      if (!this.onBoard(nr, nf)) continue;
      to = this.F(nr, nf);
      if (this.colorOf(this.board[to]) === color) continue;
      moves.push({ from: i, to: to, capture: this.board[to] !== ' ' });
    }
    if (this.inCheck(color)) return;
    var ks = color === 'w' ? 'K' : 'k', qs = color === 'w' ? 'Q' : 'q';
    var rank = color === 'w' ? 0 : 7;
    if (this.castle.indexOf(ks) !== -1) {
      if (this.board[this.F(rank, 5)] === ' ' && this.board[this.F(rank, 6)] === ' ' &&
          !this.squareAttacked(this.F(rank, 5), this.opp(color)) &&
          !this.squareAttacked(this.F(rank, 6), this.opp(color))) {
        moves.push({ from: this.F(rank, 4), to: this.F(rank, 6), castle: 'k' });
      }
    }
    if (this.castle.indexOf(qs) !== -1) {
      if (this.board[this.F(rank, 3)] === ' ' && this.board[this.F(rank, 2)] === ' ' && this.board[this.F(rank, 1)] === ' ' &&
          !this.squareAttacked(this.F(rank, 3), this.opp(color)) &&
          !this.squareAttacked(this.F(rank, 2), this.opp(color))) {
        moves.push({ from: this.F(rank, 4), to: this.F(rank, 2), castle: 'q' });
      }
    }
  };

  Game.prototype.makeClone = function (m) {
    var g = new Game();
    g.board = this.board.slice();
    g.turn = this.turn; g.castle = this.castle; g.ep = this.ep;
    g.half = this.half; g.full = this.full;
    g.applyMove(m);
    return g;
  };

  Game.prototype.applyMove = function (m) {
    // applies a generated move object to current board state (mutates)
    var piece = this.board[m.from];
    var color = this.colorOf(piece);
    var type = this.typeOf(piece);
    var castle = this.castle;
    if (type === 'k') castle = castle.replace(color === 'w' ? 'KQ' : 'kq', '');
    var rk = this.rankOf(m.from);
    if (m.from === this.F(0, 0) || m.to === this.F(0, 0)) castle = castle.replace('Q', '');
    if (m.from === this.F(0, 7) || m.to === this.F(0, 7)) castle = castle.replace('K', '');
    if (m.from === this.F(7, 0) || m.to === this.F(7, 0)) castle = castle.replace('q', '');
    if (m.from === this.F(7, 7) || m.to === this.F(7, 7)) castle = castle.replace('k', '');

    var epSquare = -1;
    if (type === 'p' && Math.abs(this.rankOf(m.to) - this.rankOf(m.from)) === 2) {
      var epRank = this.rankOf(m.to);
      var epF = this.fileOf(m.from);
      var enemyPawn = false;
      for (var df = -1; df <= 1; df += 2) {
        if (this.onBoard(epRank, epF + df) &&
            this.typeOf(this.board[this.F(epRank, epF + df)]) === 'p' &&
            this.colorOf(this.board[this.F(epRank, epF + df)]) === this.opp(color)) {
          enemyPawn = true;
        }
      }
      if (enemyPawn) epSquare = this.F((this.rankOf(m.from) + this.rankOf(m.to)) / 2, epF); else epSquare = -1;
    }

    var half;
    if (type === 'p' || m.capture) half = 0; else half = this.half + 1;
    var full = color === 'b' ? this.full + 1 : this.full;

    if (m.castle === 'k') {
      this.board[m.from] = ' ';
      this.board[this.F(rk, 5)] = this.board[this.F(rk, 7)];
      this.board[this.F(rk, 7)] = ' ';
      this.board[m.to] = piece;
    } else if (m.castle === 'q') {
      this.board[m.from] = ' ';
      this.board[this.F(rk, 3)] = this.board[this.F(rk, 0)];
      this.board[this.F(rk, 0)] = ' ';
      this.board[m.to] = piece;
    } else {
      if (m.enPassant) {
        this.board[this.F(this.rankOf(m.from), this.fileOf(m.to))] = ' ';
      }
      this.board[m.from] = ' ';
      if (m.promotion) {
        this.board[m.to] = color === 'w' ? m.promotion.toUpperCase() : m.promotion;
      } else {
        this.board[m.to] = piece;
      }
    }

    this.turn = this.opp(color);
    this.castle = castle;
    this.ep = epSquare;
    this.half = half;
    this.full = full;
  };

  Game.prototype.uciOf = function (m) {
    var uc = FILE_CHARS[this.fileOf(m.from)] + (this.rankOf(m.from) + 1) +
             FILE_CHARS[this.fileOf(m.to)] + (this.rankOf(m.to) + 1);
    if (m.promotion) uc += m.promotion;
    return uc;
  };

  Game.prototype.moveFromSan = function (san) {
    san = (san || '').trim().replace(/[+#]/g, '');
    if (!san) return null;
    var i, k, moves;

    if (san === 'O-O' || san === '0-0' || san === 'O-O+' || san === '0-0+') {
      moves = this.genMoves();
      for (i = 0; i < moves.length; i++) if (moves[i].castle === 'k') return this.uciOf(moves[i]);
      return null;
    }
    if (san === 'O-O-O' || san === '0-0-0' || san === 'O-O-O+' || san === '0-0-0+') {
      moves = this.genMoves();
      for (i = 0; i < moves.length; i++) if (moves[i].castle === 'q') return this.uciOf(moves[i]);
      return null;
    }

    var promo = null;
    var sans = san;
    var eq = san.indexOf('=');
    if (eq !== -1) {
      promo = san.charAt(eq + 1).toLowerCase();
      sans = san.slice(0, eq);
    }

    var piece = 'p';
    var m = sans.match(/^([NBRQK])(.*)$/);
    var destStr = sans;
    if (m) { piece = m[1].toLowerCase(); destStr = m[2]; }
    destStr = destStr.replace('x', '');

    var dfile = destStr.charAt(destStr.length - 2);
    var drank = parseInt(destStr.charAt(destStr.length - 1), 10);
    var df = FILE_CHARS.indexOf(dfile);
    var dr = drank - 1;
    if (df === -1 || isNaN(dr) || dr < 0 || dr > 7) return null;

    moves = this.genMoves();
    var candidates = [];
    for (k = 0; k < moves.length; k++) {
      var mv = moves[k];
      if (this.fileOf(mv.to) !== df || this.rankOf(mv.to) !== dr) continue;
      if (this.typeOf(this.board[mv.from]) !== piece) continue;
      if (!!mv.promotion !== !!promo) continue;
      if (mv.promotion && mv.promotion !== promo) continue;
      candidates.push(mv);
    }

    if (candidates.length > 1) {
      var dis = destStr.slice(0, -2);
      var filtered = [];
      for (k = 0; k < candidates.length; k++) {
        var mk = candidates[k];
        var ok = true;
        if (dis.length >= 2) {
          if (FILE_CHARS.indexOf(dis.charAt(0)) !== this.fileOf(mk.from)) ok = false;
          if (parseInt(dis.charAt(1), 10) !== this.rankOf(mk.from) + 1) ok = false;
        } else if (dis.length === 1) {
          var ch = dis.charAt(0);
          if (FILE_CHARS.indexOf(ch) !== -1) { if (FILE_CHARS.indexOf(ch) !== this.fileOf(mk.from)) ok = false; }
          else if (parseInt(ch, 10) !== this.rankOf(mk.from) + 1) ok = false;
        }
        if (ok) filtered.push(mk);
      }
      if (filtered.length === 1) candidates = filtered;
      else return null;
    }
    if (candidates.length !== 1) return null;
    return this.uciOf(candidates[0]);
  };

  Game.prototype.playUci = function (uci) {
    var res = uci.match(/^([a-h][1-8])([a-h][1-8])([nbrq])?$/);
    if (!res) return false;
    var from = FILE_CHARS.indexOf(res[1].charAt(0)) + (parseInt(res[1].charAt(1), 10) - 1) * 8;
    var to = FILE_CHARS.indexOf(res[2].charAt(0)) + (parseInt(res[2].charAt(1), 10) - 1) * 8;
    var promo = res[3] ? res[3] : null;
    var moves = this.genMoves();
    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i];
      if (mv.from === from && mv.to === to &&
          ((!promo && !mv.promotion) || (promo && mv.promotion === promo))) {
        this.applyMove(mv);
        this.uci.push(uci);
        return true;
      }
    }
    return false;
  };

  /* ================= chess.com DOM reading (sama seperti ACAS) ================= */
  // Baca posisi langsung dari elemen bidak (.piece + square-XX), bukan dari panel
  // move-list (yang berada di shadow DOM web-component dan tidak terbaca selector biasa).
  function boardFrame() {
    return document.querySelector('#board-layout-chessboard > .board')
      || document.querySelector('.board, .board-layout, .chess-board, .board-2d');
  }
  function readFen() {
    var b = boardFrame();
    if (!b) return null;
    var grid = [];
    var pieces = b.querySelectorAll('.piece');
    for (var i = 0; i < pieces.length; i++) {
      var cls = ' ' + (pieces[i].className || '') + ' ';
      var m = cls.match(/\s(b|w)([prnbqk])\s/);
      if (!m) continue;
      var sq = cls.match(/square-(\d)(\d)/);
      if (!sq) continue;
      var file = parseInt(sq[1], 10) - 1;
      var rank01 = parseInt(sq[2], 10) - 1;
      if (!grid[rank01]) grid[rank01] = [];
      grid[rank01][file] = m[1] === 'w' ? m[2].toUpperCase() : m[2];
    }
    var rows = [];
    for (var r = 7; r >= 0; r--) {
      var row = grid[r] || [];
      var s = '', empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = row[f] || ' ';
        if (p === ' ') { empty++; }
        else { if (empty) { s += empty; empty = 0; } s += p; }
      }
      if (empty) s += empty;
      rows.push(s);
    }
    return rows.join('/');
  }
  // ubah basic FEN menjadi array[64] dengan layout engine (index = rank01*8+file)
  function fenPiecesArr(fen) {
    var arr = new Array(64).fill(' ');
    var rows = fen.split('/');
    for (var ri = 0; ri < 8; ri++) {
      var erank = 7 - ri;
      var f = 0;
      for (var k = 0; k < rows[ri].length; k++) {
        var ch = rows[ri].charAt(k);
        if (ch >= '0' && ch <= '9') f += parseInt(ch, 10);
        else { arr[erank * 8 + f] = ch; f++; }
      }
    }
    return arr;
  }
  // skor kecocokan posisi ke target; -1 jika ada bidak target yang bentrok
  function compatibleCur(a, target) {
    var score = 0;
    for (var i = 0; i < 64; i++) {
      if (target[i] === ' ') continue;
      if (a[i] === target[i]) score++;
      else if (a[i] !== ' ' && a[i] !== target[i]) return -1;
    }
    return score;
  }
  // rekonstruksi daftar langkah UCI dari posisi akhir (tanpa menyentuh move-list DOM)
  function reconstructMoves(basicFen) {
    var target = fenPiecesArr(basicFen);
    var g = new Game();
    g.reset();
    var uci = [];
    var guard = 0;
    while (guard++ < 300) {
      var all = true;
      for (var i = 0; i < 64; i++) { if (g.board[i] !== target[i]) { all = false; break; } }
      if (all) return uci;
      var moves = g.genMoves();
      var bestM = null, bestUci = null, bestScore = -1;
      for (var k = 0; k < moves.length; k++) {
        var c = g.makeClone(moves[k]);
        var sc = compatibleCur(c.board, target);
        if (sc < 0) continue;
        if (sc > bestScore) { bestScore = sc; bestM = moves[k]; bestUci = g.uciOf(moves[k]); }
      }
      if (!bestM) return null;
      g.applyMove(bestM);
      uci.push(bestUci);
    }
    return null;
  }

  /* ================= suggestion logic ================= */
  var game = new Game();
  var lastNotasiKey = '';
  var inFlight = false;
  var lastArrow = null;
  var timer = null;

  function clearArrow() {
    lastArrow = null;
    var overlay = document.getElementById('maia-arrow');
    if (overlay) overlay.innerHTML = '';
  }

  function fetchMove() {
    if (inFlight) return;
    inFlight = true;
    fetch(API_URL + '?fen=' + encodeURIComponent(game.fen()), {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      inFlight = false;
      if (data && data.top_move) drawArrow(data.top_move);
      else clearArrow();
    }).catch(function () {
      inFlight = false;
      clearArrow();
    });
  }

  function refresh() {
    if (!engaged) { clearArrow(); return; }
    var posFen = readFen();
    if (!posFen || posFen === lastNotasiKey) return;
    lastNotasiKey = posFen;
    var uciList = reconstructMoves(posFen);
    if (!uciList || uciList.length === 0) { clearArrow(); return; }
    game.reset();
    for (var i = 0; i < uciList.length; i++) game.playUci(uciList[i]);
    if (game.uci.length === 0) { clearArrow(); return; }
    fetchMove();
  }

  /* ================= arrow rendering ================= */
  function resultSquare(coord) {
    return [FILE_CHARS.indexOf(coord.charAt(0)), parseInt(coord.charAt(1), 10) - 1];
  }

  function ensureBoardOverlay() {
    var b = boardFrame();
    if (!b) return null;
    var overlay = document.getElementById('maia-arrow');
    if (!overlay) {
      overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlay.id = 'maia-arrow';
      b.appendChild(overlay);
    }
    var r = b.getBoundingClientRect();
    overlay.setAttribute('width', r.width);
    overlay.setAttribute('height', r.height);
    overlay.setAttribute('viewBox', '0 0 ' + r.width + ' ' + r.height);
    return overlay;
  }

  function orientation() {
    var b = boardFrame();
    if (b && b.classList.contains('flipped')) return 'b';
    return 'w';
  }

  function drawArrow(uci) {
    var b = boardFrame();
    if (!b) return;
    var overlay = ensureBoardOverlay();
    if (!overlay) return;
    var m = uci.match(/^([a-h][1-8])([a-h][1-8])/);
    if (!m) { clearArrow(); return; }
    lastArrow = uci;
    var rect = b.getBoundingClientRect();
    var sq = rect.width / 8;
    var bottom = orientation();
    var from = resultSquare(m[1]);
    var to = resultSquare(m[2]);

    var px = function (s) {
      var file = s[0], rank01 = s[1];
      var col, row;
      if (bottom === 'w') { col = file; row = 7 - rank01; }
      else { col = 7 - file; row = rank01; }
      return [(col + 0.5) * sq, (row + 0.5) * sq];
    };
    var p1 = px(from), p2 = px(to);

    var ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    var len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    var hw = Math.min(15, len * 0.28);
    var hL = Math.min(20, len * 0.34);
    var b1 = [p2[0] - hL * Math.cos(ang - 0.5), p2[1] - hL * Math.sin(ang - 0.5)];
    var b2 = [p2[0] - hL * Math.cos(ang + 0.5), p2[1] - hL * Math.sin(ang + 0.5)];
    var shrink = Math.max(8, hL * 0.6);
    var ex = p2[0] - shrink * Math.cos(ang), ey = p2[1] - shrink * Math.sin(ang);

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M ' + p1[0] + ' ' + p1[1] + ' L ' + ex + ' ' + ey + ' M ' + p2[0] + ' ' + p2[1] + ' L ' + b1[0] + ' ' + b1[1] + ' L ' + b2[0] + ' ' + b2[1] + ' Z');
    path.setAttribute('stroke', 'rgba(34,197,94,0.95)');
    path.setAttribute('stroke-width', Math.max(5, sq * 0.11));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('fill', 'rgba(34,197,94,0.45)');
    overlay.innerHTML = '';
    overlay.appendChild(path);
  }

  /* ================= UI ================= */
  function addFab() {
    if (document.getElementById('maia-fab')) return;
    var fab = document.createElement('div');
    fab.id = 'maia-fab';
    if (engaged) fab.classList.add('on');
    fab.innerHTML = '<span class="dot"></span><span>Maia</span><span class="lbl">' + (engaged ? 'ON' : 'OFF') + '</span>';
    fab.title = 'Maia Chess Assistant: klik untuk aktif/nonaktif';
    fab.addEventListener('click', function () {
      saveEngaged(!engaged);
      fab.classList.toggle('on', engaged);
      fab.querySelector('.lbl').textContent = engaged ? 'ON' : 'OFF';
      if (engaged) refresh(); else clearArrow();
    });
    (document.body || document.documentElement).appendChild(fab);
  }

  var resizeTick = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTick);
    resizeTick = setTimeout(function () { if (lastArrow) drawArrow(lastArrow); }, 200);
  });

  function watchBoard() {
    var target = boardFrame() || document.body;
    var obs = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    });
    obs.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  var bootAttempts = 0;
  function boot() {
    addFab();
    if (boardFrame()) {
      watchBoard();
      refresh();
      return;
    }
    bootAttempts++;
    if (bootAttempts > 40) return;
    setTimeout(boot, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 500); });
  } else {
    setTimeout(boot, 500);
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
  {
    id: 'maia-chess',
    name: 'Maia Chess Assistant (Ringan)',
    file: 'maia-chess.user.js',
    version: '1.0.0',
    author: 'PuruBoy',
    icon: 'fa-chess-knight',
    color: 'from-emerald-500 to-green-600',
    tags: ['Chess', 'Maia', 'AI', 'chess.com'],
    updatedAt: '2026-08-28',
    summary:
      'Asisten catur ringan untuk chess.com yang menyarankan langkah terbaik via Maia AI (KDD 2200) melalui endpoint PuruBoy API — tampil sebagai panah hijau di papan.',
    description:
      'Asisten catur ringan untuk chess.com. Engine pergerakan bawaan memposisikan permainan dari daftar langkah, lalu meminta langkah terbaik dari Maia AI (KDD 2200) via endpoint PuruBoy API dan menampilkannya sebagai panah hijau di papan.',
    features: [
      'Saran langkah terbaik (satu langkah) sebagai panah hijau di papan',
      'Engine pergerakan catur bawaan (SAN ke UCI) tanpa library eksternal',
      'Deteksi orientasi papan otomatis',
      'Tombol aktif/nonaktif ringan yang disimpan antar sesi',
      'Auto-update lewat Tampermonkey / Violentmonkey',
    ],
    match: 'https://www.chess.com/*',
    body: maiaChessBody,
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