/**
 * Middleware sanitizer: konversi blok tool-call format native DeepSeek (DSML)
 * menjadi format Qwen3-Coder XML sebelum sampai ke qwen3CoderToolMiddleware.
 *
 * Latar belakang: DeepSeek V4 (via NoteGPT) kadang mengabaikan instruksi
 * protokol Qwen3-Coder dan memakai bias training-nya sendiri (markup internal
 * "DSML" berdelimiter fullwidth bar U+FF5C), contoh:
 *
 *   <｜｜DSML｜｜tool_call>
 *   <｜｜DSML｜｜invoke name="exec">
 *   <｜｜DSML｜｜parameter name="action">run</｜｜DSML｜｜parameter>
 *   </｜｜DSML｜｜invoke>
 *   </｜｜DSML｜｜tool_calls>
 *
 * Tanpa konversi, markup mentah bocor ke `content` dan tool call tidak terparse.
 * Sanitizer ini pasif: teks tanpa marker `<｜｜DSML｜｜` lolos utuh apa adanya,
 * sehingga aman dipasang untuk semua provider (mode auto bisa jatuh ke deepseek).
 */

const MARKER = '<｜｜DSML｜｜';

// Close tag pembungkus blok; open-nya bisa "tool_call" tapi close "tool_calls"
// (inkonsistensi memang ada di output model) — terima keduanya.
const CLOSE_RE = /<\/｜｜DSML｜｜tool_calls?>/;

const INVOKE_RE = /<｜｜DSML｜｜invoke\s+name=(["'])([\s\S]*?)\1\s*>([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
const PARAM_RE = /<｜｜DSML｜｜parameter\s+name=(["'])([\s\S]*?)\1\s*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g;

/** Batas ukuran blok yang diakumulasi (anti memory-bloat kalau close tak kunjung datang). */
const MAX_BLOCK = 100_000;

/**
 * Konversi satu region DSML (dari marker pembuka sampai close tag) menjadi
 * Qwen3-Coder XML. Mengembalikan null bila tidak ada invoke — penelefon
 * harus me-lewatkan teks mentah apa adanya.
 * @param {string} region
 * @returns {string|null}
 */
export function convertDsml(region) {
  let out = '';
  for (const inv of region.matchAll(INVOKE_RE)) {
    const name = inv[2].trim();
    if (!name) continue;
    out += `<tool_call>\n<function=${name}>\n`;
    for (const p of inv[3].matchAll(PARAM_RE)) {
      out += `<parameter=${p[2].trim()}>\n${p[3]}\n</parameter>\n`;
    }
    out += '</function>\n</tool_call>\n';
  }
  return out || null;
}

/**
 * State machine streaming: menahan maksimal MARKER.length-1 karakter ekor buffer
 * selama belum pasti apakah itu awal marker, lalu mengubah blok DSML utuh.
 * @returns {{feed(text:string, emit:(t:string)=>void):void, flush(emit:(t:string)=>void):void}}
 */
function createDsmlMachine() {
  let pending = ''; // mode idle: teks yang ditahan (prefix marker yang belum pasti)
  let block = '';   // mode blok: akumulasi region DSML
  let inBlock = false;

  /** Proses teks dalam mode idle: cari marker, sisanya diteruskan kecuali ekor prefix. */
  function feedIdle(text, emit) {
    pending += text;
    for (;;) {
      const i = pending.indexOf(MARKER);
      if (i >= 0) {
        if (i > 0) emit(pending.slice(0, i));
        block = pending.slice(i);
        pending = '';
        inBlock = true;
        // Blok mungkin sudah lengkap dalam delta yang sama.
        if (!feedBlock('', emit)) return;
        continue; // sisa setelah close sudah jadi `pending`, lanjut cari marker berikutnya
      }
      // Tahan ekor yang masih bisa jadi awal marker (marker terpotong antar-chunk).
      let k = Math.min(pending.length, MARKER.length - 1);
      while (k > 0 && !MARKER.startsWith(pending.slice(pending.length - k))) k--;
      if (k < pending.length) emit(pending.slice(0, pending.length - k));
      pending = pending.slice(pending.length - k);
      return;
    }
  }

  /**
   * Proses teks dalam mode blok. Return false bila masih menunggu kelanjutan blok,
   * true bila blok selesai/skip dan keadaan kembali idle (sisa teks ada di `pending`).
   */
  function feedBlock(text, emit) {
    block += text;
    const m = CLOSE_RE.exec(block);
    if (m) {
      const converted = convertDsml(block.slice(0, m.index + m[0].length));
      emit(converted ?? block.slice(0, m.index + m[0].length));
      pending = block.slice(m.index + m[0].length);
      block = '';
      inBlock = false;
      return true;
    }
    // ponytail: cap 100 KB per blok; kalau upstream menghasilkan blok lebih besar
    // tanpa close, lempar mentah (perilaku sama seperti tanpa sanitizer).
    if (block.length > MAX_BLOCK) {
      emit(block);
      block = '';
      inBlock = false;
      return true;
    }
    return false;
  }

  return {
    feed(text, emit) {
      if (inBlock) feedBlock(text, emit);
      else feedIdle(text, emit);
    },
    flush(emit) {
      if (inBlock) {
        // Blok tak tertutup (stream terpotong): lempar mentah, jangan hilangkan teks.
        emit(block);
        block = '';
        inBlock = false;
      }
      if (pending) {
        emit(pending);
        pending = '';
      }
    },
  };
}

/**
 * Pipakan stream part provider lewat state machine DSML.
 * Dipakai wrapStream di bawah; diekspor untuk keperluan test.
 * @param {ReadableStream} stream
 * @returns {ReadableStream}
 */
export function dsmlPipe(stream) {
  const machine = createDsmlMachine();
  let lastId = 'dsml';
  const emit = (delta, ctl) => ctl.enqueue({ type: 'text-delta', id: lastId, delta });
  return stream.pipeThrough(new TransformStream({
    transform(part, ctl) {
      if (part.type !== 'text-delta') {
        // Part non-teks (mis. finish) datang saat buffer belum kosong:
        // kosongkan dulu supaya urutan output tetap benar.
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
 * LanguageModelV4Middleware. CATATAN: paket `ai` hanya mengenali hook
 * transformParams/wrapGenerate/wrapStream — hook transformStream dari tipe
 * @ai-sdk/provider TIDAK pernah dipanggil, jadi streaming ditangani wrapStream.
 */
export const dsmlSanitizerMiddleware = {
  specificationVersion: 'v4',

  async wrapStream({ doStream }) {
    const res = await doStream();
    return { ...res, stream: dsmlPipe(res.stream) };
  },

  async wrapGenerate({ doGenerate }) {
    const res = await doGenerate();
    if (!res.content?.some((c) => c.type === 'text' && c.text?.includes(MARKER))) return res;
    const content = res.content.map((c) => {
      if (c.type !== 'text' || !c.text?.includes(MARKER)) return c;
      // Pindai berurutan: region = marker .. close tag pertama setelahnya
      // (jangan split per marker — tag invoke/parameter di dalam blok juga
      // diawali marker dan akan memecah blok jadi potongan tanpa close).
      const text = c.text;
      let out = '';
      let i = 0;
      for (;;) {
        const start = text.indexOf(MARKER, i);
        if (start < 0) { out += text.slice(i); break; }
        out += text.slice(i, start);
        const m = CLOSE_RE.exec(text.slice(start));
        if (!m) { out += text.slice(start); break; }
        const end = start + m.index + m[0].length;
        out += (convertDsml(text.slice(start, end)) ?? text.slice(start, end));
        i = end;
      }
      return { ...c, text: out };
    });
    return { ...res, content };
  },
};
