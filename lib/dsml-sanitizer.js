/**
 * Middleware sanitizer: konversi blok tool-call format native DeepSeek (DSML)
 * menjadi format Qwen3-Coder XML sebelum sampai ke qwen3CoderToolMiddleware.
 *
 * Latar belakang: DeepSeek kadang mengabaikan instruksi
 * protokol Qwen3-Coder dan memakai bias training-nya sendiri (markup internal
 * "DSML" berdelimiter fullwidth bar U+FF5C). Model memakai SETIDAKNYA dua
 * dialek — keduanya ditangani di sini:
 *
 *   <｜｜DSML｜｜tool_call>                      <｜｜DSML｜｜tool_calls>
 *   <｜｜DSML｜｜invoke name="exec">             <｜｜DSML｜｜function="exec">
 *   <｜｜DSML｜｜parameter name="action">run     <｜｜DSML｜｜parameter="action">run
 *   </｜｜DSML｜｜parameter>                     </｜｜DSML｜｜parameter>
 *   </｜｜DSML｜｜invoke>                        </｜｜DSML｜｜function>
 *   </｜｜DSML｜｜tool_calls>                    </｜｜DSML｜｜tool_calls>
 *
 * Tanpa konversi, markup mentah bocor ke `content` dan tool call tidak terparse.
 * Konversi berbasis scanner tag: SEMUA region antara marker `<｜｜DSML｜｜` dan
 * close-tag struktural dikonsumsi (markup tak dikenal ikut ditelan) supaya
 * dialek baru tidak pernah bocor sebagai teks mentah.
 *
 * Sanitizer ini pasif: teks tanpa marker `<｜｜DSML｜｜` lolos utuh apa adanya,
 * sehingga aman dipasang untuk semua provider (mode auto bisa jatuh ke model DeepSeek).
 *
 * Target output bisa dipilih via createDsmlSanitizerMiddleware({ target }):
 *   - "qwen"  (default): <tool_call><function=x><parameter=p>v</parameter>...</function></tool_call>
 *   - "morph":           <x><p>v</p>...</x>
 */

const MARKER = '<｜｜DSML｜｜';

// Close tag penutup blok. Open wrapper bisa "tool_call" tapi close "tool_calls"
// (inkonsistensi memang ada di output model) — terima keduanya. Blok tanpa
// wrapper juga didukung: ditutup langsung oleh </function> / </invoke>.
const CLOSE_RE = /<\/｜｜DSML｜｜(?:tool_calls?|invoke|function)>/;

// Semua tag DSML (buka & tutup), dipakai scanner convertDsml.
const TAG_RE = /<(\/?)｜｜DSML｜｜([^>]*)>/g;

// Deteksi mode idle: awal blok (marker) ATAU close-tag yatim — sisa wrapper
// yang tertinggal ketika blok sudah ditutup lebih awal oleh </function>.
const IDLE_TAG_RE = /<｜｜DSML｜｜|<\/｜｜DSML｜｜[^>]*>/;

// Ekor terpanjang yang perlu ditahan saat menunggu kelanjutan antar-chunk
// (kedua pola deteksi berawalan '<' dan berhenti pada panjang prefix ini).
const MAX_TAIL = '</｜｜DSML｜｜'.length;

// Close-tag yang baru setengah datang di ekor buffer (nama tag belum ketutup '>').
const PARTIAL_CLOSE_RE = /<\/｜｜DSML｜｜[^>\s]*$/;

// Open wrapper tool_call(s) — kalau masih terbuka, close invoke/function di
// dalamnya TIDAK mengakhiri blok (tunggu close wrapper agar region utuh).
const WRAPPER_OPEN_RE = /<｜｜DSML｜｜tool_calls?>/;

/**
 * Cari akhir blok dalam `str` (diawali marker): posisi close PERTAMA yang sah.
 * Close invoke/function di-skip bila wrapper masih terbuka di depannya.
 * Return -1 bila belum ada.
 */
function findBlockEnd(str) {
  let from = 0;
  for (;;) {
    const m = CLOSE_RE.exec(str.slice(from));
    if (!m) return -1;
    const end = from + m.index + m[0].length;
    if (m[0].includes('tool_call') || !WRAPPER_OPEN_RE.test(str.slice(0, end))) return end;
    from = end; // close prematur di dalam wrapper: lanjut cari berikutnya
  }
}

// Open call: dialek lama `invoke name="x"` / dialek baru `function="x"`.
const CALL_OPEN_RE = /^(?:invoke\s+name|function)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/;
// Open parameter: dialek lama `parameter name="x"` / dialek baru `parameter="x"`.
const PARAM_OPEN_RE = /^parameter(?:\s+name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/;

/** Ambil nilai atribut dari match grup 3-alternatif, buang kutip liar + spasi. */
const attrVal = (m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/^['"]+|['"]+$/g, '').trim();

/**
 * Konversi satu region DSML menjadi XML protokol target via scanner tag.
 * Selalu mengembalikan string ("" bila region tak mengandung call utuh):
 * markup di dalam region sengaja ditelan agar tak pernah bocor mentah.
 * @param {string} region
 * @param {"qwen"|"morph"} [target]
 * @returns {string}
 */
export function convertDsml(region, target = 'qwen') {
  const morph = target === 'morph';
  let out = '';
  let fn = null; // nama fungsi yang sedang terbuka
  let body = ''; // XML parameter untuk fungsi terbuka
  let param = null; // nama parameter yang sedang terbuka
  let vStart = 0; // posisi awal nilai parameter mentah di region

  for (const m of region.matchAll(TAG_RE)) {
    const attrs = m[2].trim();
    if (m[1]) {
      // Tag tutup: selesaikan call / parameter yang sedang terbuka.
      if ((attrs === 'invoke' || attrs === 'function') && fn !== null) {
        out += morph ? `<${fn}>\n${body}</${fn}>\n` : `<tool_call>\n<function=${fn}>\n${body}</function>\n</tool_call>\n`;
        fn = null;
        body = '';
      } else if (attrs === 'parameter' && param !== null) {
        // ponytail: morph parser tidak trim isi elemen — nilai dipadatkan satu baris
        body += morph
          ? `<${param}>${region.slice(vStart, m.index).trim()}</${param}>\n`
          : `<parameter=${param}>\n${region.slice(vStart, m.index)}\n</parameter>\n`;
        param = null;
      }
      continue; // wrapper close (tool_calls?) dan tag asing: ditelan
    }
    if (param === null) {
      const c = attrs.match(CALL_OPEN_RE);
      if (c) {
        if (fn !== null) {
          // Call sebelumnya tak tertutup rapat: simpan apa yang sudah ada.
          out += morph ? `<${fn}>\n${body}</${fn}>\n` : `<tool_call>\n<function=${fn}>\n${body}</function>\n</tool_call>\n`;
        }
        fn = attrVal(c);
        body = '';
        continue;
      }
      const p = attrs.match(PARAM_OPEN_RE);
      if (p && fn !== null) {
        param = attrVal(p);
        vStart = m.index + m[0].length;
      }
    }
    // wrapper open (tool_call/tool_calls) dan tag asing: ditelan
  }
  if (fn !== null) {
    // Call terakhir tanpa close (region terpotong): simpan best-effort.
    out += morph ? `<${fn}>\n${body}</${fn}>\n` : `<tool_call>\n<function=${fn}>\n${body}</function>\n</tool_call>\n`;
  }
  return out;
}

/** Batas ukuran blok yang diakumulasi (anti memory-bloat kalau close tak kunjung datang). */
const MAX_BLOCK = 100_000;

/**
 * State machine streaming: menahan maksimal MARKER.length-1 karakter ekor buffer
 * selama belum pasti apakah itu awal marker, lalu mengubah blok DSML utuh.
 * @returns {{feed(text:string, emit:(t:string)=>void):void, flush(emit:(t:string)=>void):void}}
 */
function createDsmlMachine(target = 'qwen') {
  let pending = ''; // mode idle: teks yang ditahan (prefix marker yang belum pasti)
  let block = ''; // mode blok: akumulasi region DSML
  let inBlock = false;

  /** Proses teks dalam mode idle: cari marker/close yatim, sisanya diteruskan kecuali ekor '<'. */
  function feedIdle(text, emit) {
    pending += text;
    for (;;) {
      const m = pending.match(IDLE_TAG_RE);
      if (m) {
        if (m.index > 0) emit(pending.slice(0, m.index));
        if (m[0] === MARKER) {
          block = pending.slice(m.index);
          pending = '';
          inBlock = true;
          // Blok mungkin sudah lengkap dalam delta yang sama.
          if (!feedBlock('', emit)) return;
          continue; // sisa setelah close sudah jadi `pending`, lanjut cari marker berikutnya
        }
        // Close-tag yatim tanpa blok (sisa wrapper setelah pemotongan awal): buang.
        pending = pending.slice(m.index + m[0].length);
        continue;
      }
      // Tahan ekor yang masih bisa jadi awal marker/close tag terpotong:
      // (a) sejak '<' terakhir bila masih dalam panjang prefix, atau
      // (b) close-tag setengah jalan (nama belum ketutup '>').
      const j = pending.lastIndexOf('<');
      if (j >= 0 && pending.length - j <= MAX_TAIL) {
        if (j > 0) emit(pending.slice(0, j));
        pending = pending.slice(j);
        return;
      }
      const pm = PARTIAL_CLOSE_RE.exec(pending);
      if (pm && pm.index < pending.length) {
        emit(pending.slice(0, pm.index));
        pending = pm[0];
        return;
      }
      if (pending) { emit(pending); pending = ''; }
      return;
    }
  }

  /**
   * Proses teks dalam mode blok. Return false bila masih menunggu kelanjutan blok,
   * true bila blok selesai/skip dan keadaan kembali idle (sisa teks ada di `pending`).
   */
  function feedBlock(text, emit) {
    block += text;
    const end = findBlockEnd(block);
    if (end >= 0) {
      emit(convertDsml(block.slice(0, end), target));
      pending = block.slice(end);
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
        // Blok tak tertutup (stream terpotong): konversi best-effort supaya
        // markup tetap tidak bocor mentah.
        emit(convertDsml(block, target));
        block = '';
        inBlock = false;
      }
      if (pending) {
        // Sisa pending bisa memuat close-tag yatim dsb.: proses ulang dulu,
        // lalu buang sisa ekor yang memang bukan markup.
        feedIdle('', emit);
        if (pending) { emit(pending); pending = ''; }
      }
    },
  };
}

/**
 * Pipakan stream part provider lewat state machine DSML.
 * Dipakai wrapStream di bawah; diekspor untuk keperluan test.
 * @param {ReadableStream} stream
 * @param {"qwen"|"morph"} [target]
 * @returns {ReadableStream}
 */
export function dsmlPipe(stream, target = 'qwen') {
  const machine = createDsmlMachine(target);
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
 * Sanitasi teks utuh (jalur generate): konversi tiap blok DSML,
 * buang close-tag yatim, sisanya lolos apa adanya.
 * @param {string} text
 * @param {"qwen"|"morph"} [target]
 * @returns {string}
 */
function sanitizeFull(text, target = 'qwen') {
  let out = '';
  let i = 0;
  for (;;) {
    const rel = text.slice(i);
    const m = rel.match(IDLE_TAG_RE);
    if (!m) return out + rel;
    out += rel.slice(0, m.index);
    const at = i + m.index;
    if (m[0] !== MARKER) { // close-tag yatim tanpa blok: buang
      i = at + m[0].length;
      continue;
    }
    const c = findBlockEnd(rel.slice(m.index));
    if (c < 0) return out + convertDsml(rel.slice(m.index), target); // blok tak tertutup: best-effort
    const end = at + c;
    out += convertDsml(text.slice(at, end), target);
    i = end;
  }
}

/**
 * Middleware sanitizer dengan target protokol output ("qwen" default | "morph").
 * CATATAN: paket `ai` hanya mengenali hook transformParams/wrapGenerate/wrapStream
 * — hook transformStream dari tipe @ai-sdk/provider TIDAK pernah dipanggil, jadi
 * streaming ditangani wrapStream.
 */
export function createDsmlSanitizerMiddleware({ target = 'qwen' } = {}) {
  return {
    specificationVersion: 'v4',

    async wrapStream({ doStream }) {
      const res = await doStream();
      return { ...res, stream: dsmlPipe(res.stream, target) };
    },

    async wrapGenerate({ doGenerate }) {
      const res = await doGenerate();
      if (!res.content?.some((c) => c.type === 'text' && c.text?.includes(MARKER))) return res;
      const content = res.content.map((c) => {
        if (c.type !== 'text' || !c.text?.includes(MARKER)) return c;
        // Pindai berurutan via sanitizeFull: region = marker .. close tag pertama
        // setelahnya (jangan split per marker — tag di dalam blok juga ber-marker).
        return { ...c, text: sanitizeFull(c.text, target) };
      });
      return { ...res, content };
    },
  };
}

export const dsmlSanitizerMiddleware = createDsmlSanitizerMiddleware();
