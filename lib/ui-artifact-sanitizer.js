/**
 * Middleware sanitizer: buang markup UI aplikasi chat yang bocor ke `content`.
 *
 * Latar belakang: model web (gemini-lite/deepseek-v4/easemate via mode auto)
 * kadang meniru markup UI aplikasi chat asalnya sehingga blok seperti ini
 * bocor mentah ke content jawaban:
 *
 *   <ElicitationsGroup message="Apa yang mau Anda lakukan selanjutnya?">
 *   <Elicitation label="..." query="..." queryintent="CLICKABLESUGGESTION" />
 *   </ElicitationsGroup>
 *
 * Sanitizer pasif: teks tanpa token "Elicitation" lolos utuh, aman dipasang
 * untuk semua provider. Prose jawaban AI TIDAK disentuh — hanya markup dibuang,
 * termasuk grup tak tertutup (stream terpotong sebelum </ElicitationsGroup>).
 */

// Grup utuh (open .. close) dan grup tak tertutup di ekor teks.
const GROUP_FULL_RE = /<ElicitationsGroup\b[^>]*>[\s\S]*?<\/ElicitationsGroup>/g;
const GROUP_DANGLING_RE = /<ElicitationsGroup\b[^>]*>[\s\S]*$/;
// Tag elicitation yatim (di luar grup / sisa grup terpotong). \b mencegah
// kecocokan dengan "ElicitationsGroup".
const ORPHAN_TAG_RE = /<\/?Elicitation\b[^>]*>/g;

/** Deteksi cepat apakah teks memuat token artefak (untuk skip kerja bila bersih). */
const HINT_RE = /Elicitation/;

/**
 * Sanitasi teks utuh (jalur generate): buang grup utuh, grup tak tertutup,
 * lalu tag yatim. Prose lain lolos apa adanya.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeUiArtifacts(text) {
  return text
    .replace(GROUP_FULL_RE, '')
    .replace(GROUP_DANGLING_RE, '')
    .replace(ORPHAN_TAG_RE, '');
}

// Nama token yang bisa membuka region buangan. Urutan bebas; pencocokan prefix
// dipakai untuk menahan ekor chunk yang terpotong di tengah token.
const TOKENS = ['<ElicitationsGroup', '<Elicitation', '</ElicitationsGroup>', '</Elicitation>'];
// Token pembuka nama lengkap + karakter pembatas (spasi, tutup, slash).
const TOKEN_NAMED_RE = /^<(\/?)Elicitation(?:sGroup)?(?=[\s/>])/;
const CLOSE_GROUP = '</ElicitationsGroup>';

// ponytail: tahan maksimal 8 KB menunggu '>' open-tag; lebih dari itu dianggap
// sampah markup dan dibuang. Naikkan bila provider mengirim atribut raksasa.
const MAX_TAG_HOLD = 8192;

/**
 * State machine streaming: idle (teruskan teks, tahan ekor yang bisa jadi awal
 * token) dan blok (buang semua sampai </ElicitationsGroup>).
 * Memori blok O(1): isi blok tidak perlu disimpan, cukup 19 karakter ekor
 * untuk mendeteksi close yang terbelah antar-chunk.
 * @returns {{feed(text:string, emit:(t:string)=>void):void, flush(emit:(t:string)=>void):void}}
 */
function createUiArtifactMachine() {
  let pending = ''; // mode idle: teks ditahan (kandidat awal token)
  let tail = ''; // mode blok: ekor <= CLOSE.length-1 utk deteksi close terbelah
  let inBlock = false;

  function feedIdle(text, emit) {
    pending += text;
    for (;;) {
      const i = pending.indexOf('<');
      if (i < 0) {
        if (pending) { emit(pending); pending = ''; }
        return;
      }
      const rest = pending.slice(i);
      const named = TOKEN_NAMED_RE.exec(rest);
      if (!named) {
        // Belum tentu token: kalau masih prefix salah satu token, tahan & tunggu.
        if (TOKENS.some((t) => t.startsWith(rest))) {
          if (i > 0) { emit(pending.slice(0, i)); pending = rest; }
          return;
        }
        // '<' biasa (mis. "5<6" atau "<div>"): teruskan, lanjut pindai.
        emit(pending.slice(0, i + 1));
        pending = pending.slice(i + 1);
        continue;
      }
      const gt = pending.indexOf('>', i);
      if (gt < 0) {
        // Tag belum ketutup: tahan dari '<' (cap anti-bengkak).
        if (rest.length > MAX_TAG_HOLD) { pending = ''; return; }
        if (i > 0) { emit(pending.slice(0, i)); pending = rest; }
        return;
      }
      // Tag lengkap sudah pasti artefak: loloskan dulu prose sebelum '<',
      // baru buang tag-nya.
      if (i > 0) emit(pending.slice(0, i));
      pending = pending.slice(gt + 1);
      if (named[1]) continue; // close-tag yatim (sisa grup terpotong)
      if (rest.startsWith('<ElicitationsGroup')) {
        // Buka grup: masuk mode blok — sisa setelah '>' HARUS ikut ke blok,
        // bukan tertinggal di pending (nanti menelan delta berikutnya).
        inBlock = true;
        tail = '';
        const remainder = pending;
        pending = '';
        if (feedBlock(remainder, emit)) continue;
        return;
      }
      // Tag elicitation yatim: sudah dibuang, lanjut pindai.
    }
  }

  /** Proses mode blok. Return true bila blok tertutup & kembali idle. */
  function feedBlock(text, emit) {
    tail += text;
    const c = tail.indexOf(CLOSE_GROUP);
    if (c >= 0) {
      pending = tail.slice(c + CLOSE_GROUP.length);
      tail = '';
      inBlock = false;
      return true;
    }
    if (tail.length > CLOSE_GROUP.length - 1) tail = tail.slice(-(CLOSE_GROUP.length - 1));
    return false;
  }

  return {
    feed(text, emit) {
      if (inBlock) {
        // Blok ketutup: sisanya ada di `pending`, proses langsung mode idle.
        if (!feedBlock(text, emit)) return;
        feedIdle('', emit);
        return;
      }
      feedIdle(text, emit);
    },
    flush(emit) {
      if (inBlock) {
        // Grup tak tertutup sampai stream habis: seluruh blok adalah artefak, buang.
        inBlock = false;
        tail = '';
        pending = '';
        return;
      }
      // pending hanya berisi kandidat prefix token yang tak selesai
      // (prose sebelumnya sudah diloloskan) -> buang, jangan bocorkan fragmen.
      pending = '';
    },
  };
}

/**
 * Pipakan stream part provider lewat state machine.
 * @param {ReadableStream} stream
 * @returns {ReadableStream}
 */
export function uiArtifactPipe(stream) {
  const machine = createUiArtifactMachine();
  let lastId = 'ui-artifact';
  const emit = (delta, ctl) => ctl.enqueue({ type: 'text-delta', id: lastId, delta });
  return stream.pipeThrough(new TransformStream({
    transform(part, ctl) {
      if (part.type !== 'text-delta') {
        // Part non-teks datang saat buffer belum kosong: kosongkan dulu supaya urutan output tetap benar.
        machine.flush((t) => emit(t, ctl));
        ctl.enqueue(part);
        return;
      }
      if (part.id) lastId = part.id;
      machine.feed(part.delta, (t) => emit(t, ctl));
    },
    flush(ctl) {
      machine.flush((t) => emit(t, ctl));
    },
  }));
}

/**
 * Middleware sanitizer markup UI bocoran. Pasif utk teks bersih; aman
 * dipasang untuk semua provider (mode auto bisa jatuh ke provider mana pun).
 */
export const uiArtifactSanitizerMiddleware = {
  specificationVersion: 'v4',

  async wrapStream({ doStream }) {
    const res = await doStream();
    return { ...res, stream: uiArtifactPipe(res.stream) };
  },

  async wrapGenerate({ doGenerate }) {
    const res = await doGenerate();
    if (!res.content?.some((c) => c.type === 'text' && HINT_RE.test(c.text ?? ''))) return res;
    const content = res.content.map((c) => (
      c.type === 'text' && HINT_RE.test(c.text ?? '') ? { ...c, text: sanitizeUiArtifacts(c.text) } : c
    ));
    return { ...res, content };
  },
};
