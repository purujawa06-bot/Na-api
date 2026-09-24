/**
 * Web search via Bing — tanpa API key.
 *
 * Strategi ganda (HTML + RSS) karena relevansi Bing dari IP datacenter US
 * tidak stabil untuk query Indonesia multi-kata:
 *   - HTML kadang "Tidak ada hasil" / hasil ngaco (mis. "membuat rendang"
 *     -> 0 hasil, "cara membuat rendang" -> cuma match kata "cara").
 *   - RSS (?format=rss) ringan, URL langsung (tanpa redirect /ck/a),
 *     kadang justru pas untuk query yang gagal di HTML.
 * Hasil digabung, dedupe, lalu di-ranking berdasarkan kecocokan kata query
 * di title/snippet/url supaya yang paling relevan naik ke atas.
 *
 * Lapisan pemulih (karena Bing datacenter kadang mengembalikan sampah total
 * untuk query valid, mis. "siapa penemu lampu" -> forum Inggris/Cina acak):
 *   1. Auto-koreksi typo huruf ganda ("penemuu" -> "penemu"), 1x retry,
 *      diterima hanya bila hasilnya relevan (flag `corrected_from`).
 *   2. Fallback Wikipedia (API resmi, stabil) bila Bing tetap tak relevan
 *      (flag `fallback: 'wikipedia'`, `source` ikut berubah).
 *
 * Param cc/setlang/mkt sengaja TIDAK dipakai: terbukti bikin hasil makin
 * ngaco (query pecah, 0 hasil / sampah Zhihu). Lang hanya via header
 * Accept-Language.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function buildHeaders(lang) {
  return {
    'user-agent': UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': lang === 'id' ? 'id-ID,id;q=0.9,en-US;q=0.8' : 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
  };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeHtmlEntities(str) {
  return str
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x2f;/g, '/')
    .replace(/&#0183;/g, '·')
    .replace(/&#32;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode URL redirect Bing (/ck/a?...u=<base64url>).
 * Jika bukan redirect Bing, kembalikan apa adanya.
 */
function decodeBingUrl(url) {
  if (!url.includes('bing.com/ck/a')) return url;
  try {
    const u = new URL(url);
    const enc = u.searchParams.get('u');
    if (enc) {
      // Bing pakai base64url (tanpa padding). Kadang ada prefix 'a1'.
      let b64 = enc.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      if (decoded.startsWith('http')) return decoded;
    }
  } catch {
    /* fallback ke URL asli */
  }
  return url;
}

/**
 * Parse hasil pencarian dari HTML Bing.
 * Hasil ada dalam <li class="b_algo"> dengan <h2><a href="...">Title</a></h2>
 * dan snippet di <p> di dalam block.
 */
function parseBingResults(html) {
  const results = [];
  const seen = new Set();

  // Ambil semua block <li class="b_algo"> (atribut bisa bervariasi)
  const algoBlocks = html.match(/<li class="b_algo"[^>]*>[\s\S]*?<\/li>/gi) || [];

  for (const block of algoBlocks) {
    // URL + title dari <h2><a href="...">
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    let url = decodeHtmlEntities(linkMatch[1].trim());
    url = decodeBingUrl(url);
    const title = decodeHtmlEntities(linkMatch[2]);

    if (!url || !title) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    // Snippet dari <p> pertama dalam block
    let snippet = null;
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (snippetMatch) {
      snippet = decodeHtmlEntities(snippetMatch[1]) || null;
    }

    results.push({ title, url, snippet });
  }

  return results;
}

/**
 * Parse hasil dari Bing RSS (?format=rss).
 * Ringan: <item><title>..<link>..<description>.., URL langsung tanpa redirect.
 */
function parseRssResults(xml) {
  const results = [];
  const seen = new Set();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  for (const item of items) {
    const t = item.match(/<title>([\s\S]*?)<\/title>/i);
    const l = item.match(/<link>([\s\S]*?)<\/link>/i);
    const d = item.match(/<description>([\s\S]*?)<\/description>/i);
    if (!t || !l) continue;

    const title = decodeHtmlEntities(t[1]);
    const url = decodeHtmlEntities(l[1].trim());
    const snippet = d ? decodeHtmlEntities(d[1]) || null : null;

    if (!url || !title) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    results.push({ title, url, snippet });
  }

  return results;
}

/** Normalisasi URL untuk dedupe antar sumber. */
function normalizeUrl(u) {
  try {
    const p = new URL(u);
    const host = p.hostname.toLowerCase().replace(/^www\./, '');
    let path = p.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    return `${host}${path}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/** Skor relevansi: kecocokan tiap kata query di title/snippet/url. */
function scoreResult(r, words) {
  const title = (r.title || '').toLowerCase();
  const snippet = (r.snippet || '').toLowerCase();
  const url = (r.url || '').toLowerCase();
  let score = 0;
  for (const w of words) {
    if (title.includes(w)) score += 3;
    if (snippet.includes(w)) score += 1;
    if (url.includes(w)) score += 1;
  }
  return score;
}

/**
 * Saran koreksi typo sederhana: susutkan huruf berulang dalam tiap kata
 * ("penemuu" -> "penemu", "lamppu" -> "lampu"). Return null jika tak ada
 * kata yang berubah. Tanpa kamus — hanya dipakai sebagai retry saat hasil
 * query asli nihil/tak relevan, dan hanya diterima bila hasil retry relevan.
 */
function squeezeWord(w) {
  // Hanya kata alfabet (huruf+angka) min 4 char; URL/angka dibiarkan.
  if (!/^[a-z0-9]{4,}$/i.test(w)) return w;
  const squeezed = w.replace(/(.)\1+/g, '$1');
  return squeezed.length >= 3 ? squeezed : w;
}

function suggestCorrection(query) {
  const words = String(query).trim().split(/\s+/);
  let changed = false;
  const fixed = words.map((w) => {
    const s = squeezeWord(w);
    if (s !== w) changed = true;
    return s;
  });
  if (!changed) return null;
  const out = fixed.join(' ');
  return out.toLowerCase() === String(query).trim().toLowerCase() ? null : out;
}

/**
 * Kata yang diduga typo: mengandung huruf ganda TAPI tidak muncul di satu
 * pun hasil (kasus "penemuu": Bing tak mengindeksnya, hasilnya sampah yang
 * cuma match kata umum seperti "siapa"/"lampu"). Kata ganda yang valid
 * ("massa", "menggambarkan") selalu muncul di hasil relevan -> bukan suspect.
 */
function findSuspectTypo(query, merged) {
  const words = String(query).trim().split(/\s+/).filter((w) => squeezeWord(w) !== w);
  if (!words.length || !merged.length) return null;
  const all = merged
    .map((r) => `${r.title || ''} ${r.snippet || ''} ${r.url || ''}`.toLowerCase())
    .join('\n');
  return words.find((w) => !all.includes(w.toLowerCase())) || null;
}

/** GET dengan retry 3x + backoff. Hanya 429/503 & network error yang di-retry. */
async function fetchText(url, headers) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      if (res.status === 429 || res.status === 503) {
        throw new Error(`Bing rate-limit (${res.status})`);
      }
      if (!res.ok) {
        const e = new Error(`Bing HTTP ${res.status}`);
        e.fatal = true;
        throw e;
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (e.fatal || attempt === 3) break;
      await delay(1000 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr || new Error('Gagal menghubungi Bing');
}

/**
 * Cari via Bing (HTML + RSS, digabung & di-ranking).
 * Jika query asli nihil/tak relevan (skor 0) dan ada dugaan typo huruf
 * ganda, otomatis coba sekali dengan query terkoreksi; bila relevan,
 * hasil koreksi dikembalikan dengan flag `corrected_from`.
 * @param {string} query - kata kunci
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - jumlah hasil (1-20)
 * @param {string} [opts.lang='id'] - 'id' atau 'en'
 * @returns {Promise<{source:string, query:string, lang:string, limit:number, result_count:number, results:Array, corrected_from?:string}>}
 */
export async function searchBing(query, opts = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error("Parameter 'query' wajib diisi.");
  }
  const limit = Math.min(Math.max(parseInt(opts.limit) || 10, 1), 20);
  const lang = opts.lang === 'en' ? 'en' : 'id';
  const original = query.trim();

  const first = await doSearch(original, { limit, lang });
  if (first.best >= first.needed && !findSuspectTypo(original, first.merged)) {
    return strip(first, limit);
  }
  if (opts._retried) return strip(first, limit);

  // Hasil nihil/tak relevan -> coba koreksi typo sekali.
  const corrected = suggestCorrection(original);
  if (corrected) {
    const second = await doSearch(corrected, { limit, lang });
    if (second.best >= second.needed && second.best >= first.best) {
      const out = strip(second, limit);
      out.query = corrected;
      out.corrected_from = original;
      return out;
    }
  }

  // Bing tetap tak relevan -> fallback Wikipedia (API stabil, relevan
  // untuk pengetahuan umum). Coba query asli dulu lalu query koreksi.
  const wikiQueries = [original];
  if (corrected && corrected !== original) wikiQueries.push(corrected);
  const wiki = await searchWikipediaFallback(wikiQueries, { limit, lang });
  if (wiki) {
    wiki.limit = limit;
    wiki.lang = lang;
    if (wiki.query !== original) wiki.corrected_from = original;
    return wiki;
  }

  // Semua gagal -> kembalikan hasil asli. Saran koreksi hanya bila Bing
  // mengembalikan hasil tapi tak relevan (dugaan typo kuat); bila Bing
  // nol total, hasilnya memang tidak ada -> tanpa saran menyesatkan.
  const out = strip(first, limit);
  if (corrected && first.merged.length > 0) out.suggestion = corrected;
  return out;
}

/**
 * Fallback ke Wikipedia saat Bing tak relevan. Mencoba tiap query kandidat
 * berurutan (asli dulu, lalu koreksi), mengembalikan hasil pertama yang
 * relevan. Relevan = minimal satu kata kunci muncul di hasil (coverage>0);
 * ranking sendiri dengan title-match berbobot agar artikel tepat naik.
 */
async function searchWikipediaFallback(queries, { limit, lang }) {
  const host = lang === 'en' ? 'en.wikipedia.org' : 'id.wikipedia.org';
  const headers = {
    'user-agent': 'Na-api/1.0 (https://github.com/purujawa06-bot/Na-api)',
    accept: 'application/json',
  };
  for (const q of queries) {
    try {
      const words = q.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);
      if (!words.length) continue;
      // Kata konten = kata terpanjang (mis. "fotosintesis" dari
      // "pengertian fotosintesis") untuk title-match via opensearch.
      const keyword = [...words].sort((a, b) => b.length - a.length)[0];
      const [full, open] = await Promise.all([
        fetch(
          `https://${host}/w/api.php?action=query&list=search` +
            `&srsearch=${encodeURIComponent(q)}&format=json&srlimit=10`,
          { headers, signal: AbortSignal.timeout(15000) }
        )
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(
          `https://${host}/w/api.php?action=opensearch&search=${encodeURIComponent(keyword)}&limit=5&format=json`,
          { headers, signal: AbortSignal.timeout(15000) }
        )
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      const merged = [];
      const seen = new Set();
      const push = (r) => {
        const key = (r.title || '').toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        // Lewati halaman navigasi/namespace Wikipedia (bukan artikel):
        // "Halaman Utama", "Wikipedia:...", "Bantuan:...", dll.
        const raw = key.replace(/ — wikipedia$/, '');
        if (raw === 'halaman utama' || raw === 'main page' || raw.includes(':')) return;
        merged.push(r);
      };
      // Opensearch (title-match) didahulukan agar artikel tepat menang ranking.
      if (Array.isArray(open) && Array.isArray(open[1])) {
        open[1].forEach((t, i) => {
          push({
            title: `${t} — Wikipedia`,
            url: Array.isArray(open[3]) && open[3][i] ? open[3][i] : `https://${host}/wiki/${encodeURIComponent(String(t).replace(/ /g, '_'))}`,
            snippet: (Array.isArray(open[2]) && open[2][i]) || null,
          });
        });
      }
      for (const s of (full?.query?.search || []).slice(0, 10)) {
        push({
          title: `${s.title} — Wikipedia`,
          url: `https://${host}/wiki/${encodeURIComponent(String(s.title).replace(/ /g, '_'))}`,
          snippet: decodeHtmlEntities(s.snippet || '') || null,
        });
      }
      if (!merged.length) continue;
      merged.forEach((r, i) => {
        const all = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();
        r._c = words.filter((w) => all.includes(w)).length;
        r._s = scoreResult(r, words);
        r._i = i;
      });
      merged.sort((a, b) => b._c - a._c || b._s - a._s || a._i - b._i);
      if (merged[0]._c === 0) continue; // tak satu kata pun nyambung -> tolak
      const results = merged
        .slice(0, limit)
        .map(({ title, url, snippet }) => ({ title, url, snippet }));
      return {
        source: host,
        query: q,
        result_count: results.length,
        results,
        fallback: 'wikipedia',
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Ambil hasil mentah + ranking; `best` = skor relevansi tertinggi. */
async function doSearch(query, { limit, lang }) {
  // JANGAN pakai cc=/setlang=/mkt= : param itu bikin Bing ngaco
  // di IP datacenter (query multi-kata pecah, b_no / 0 hasil).
  // Lang hanya via header Accept-Language.
  const q = encodeURIComponent(query.trim());
  const htmlUrl = `https://www.bing.com/search?q=${q}&count=${limit + 5}`;
  const rssUrl = `https://www.bing.com/search?format=rss&q=${q}`;
  const headers = buildHeaders(lang);

  // Ambil dua sumber paralel; satu gagal tidak menggagalkan yang lain.
  const [html, xml] = await Promise.all([
    fetchText(htmlUrl, headers).catch(() => null),
    fetchText(rssUrl, headers).catch(() => null),
  ]);

  if (!html && !xml) {
    throw new Error('Gagal menghubungi Bing (HTML+RSS)');
  }

  const merged = [];
  const seen = new Set();
  const push = (r) => {
    if (!r.url || !r.title) return;
    const key = normalizeUrl(r.url);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(r);
  };

  if (html) parseBingResults(html).forEach(push);
  if (xml) parseRssResults(xml).forEach(push);

  if (merged.length === 0) {
    // Bing HTTP 200 tapi nol hasil parseable (mis. <li class="b_no">
    // "Tidak ada hasil" untuk query langka / tidak terindeks).
    // Itu kondisi valid -> sukses kosong, BUKAN 502.
    return { source: 'bing.com', query: query.trim(), lang, limit, best: 0, needed: 1, merged: [] };
  }

  // Ranking: coverage (berapa kata query berbeda yang muncul di hasil)
  // menentukan relevansi; skor kemunculan menentukan urutan.
  // Kata pendek (<3 char seperti "di"/"ke") diabaikan karena match di mana-mana.
  // Syarat relevan: query 1 kata -> 1 kata cocok; query multi-kata -> min 2 kata.
  const words = query.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);
  const needed = words.length >= 2 ? 2 : 1;
  merged.forEach((r, i) => {
    const all = `${r.title || ''} ${r.snippet || ''} ${r.url || ''}`.toLowerCase();
    r._c = words.filter((w) => all.includes(w)).length;
    r._s = scoreResult(r, words);
    r._i = i;
  });
  merged.sort((a, b) => b._c - a._c || b._s - a._s || a._i - b._i);

  return {
    source: 'bing.com',
    query: query.trim(),
    lang,
    limit,
    best: merged.length ? merged[0]._c : 0,
    needed,
    merged,
  };
}

/** Bentuk respons akhir: potong sesuai limit + buang field internal. */
function strip(searched, limit) {
  const results = searched.merged
    .slice(0, limit)
    .map(({ title, url, snippet }) => ({ title, url, snippet }));
  return {
    source: searched.source,
    query: searched.query,
    lang: searched.lang,
    limit,
    result_count: results.length,
    results,
  };
}
