/**
 * cloudscraper lokal — tiruan cloudscraper@4.6.0 (npm) tanpa rantai `request`.
 *
 * Kenapa dibuat sendiri:
 *   - cloudscraper npm menarik `request` + `request-promise` (deprecated) yang
 *     membawa vuln TANPA fix: form-data@2.x, qs@6.5.x, tough-cookie@2.5.0,
 *     uuid@3.4.0 — membuat `npm audit --audit-level=high` merah permanen.
 *   - Satu-satunya pemakai di repo ini: lib/quillbot-web.js
 *     (`client.post({uri, body, headers, simple:false, resolveWithFullResponse:true})`
 *     + `cloudscraper.defaults({jar})` + `cloudscraper.jar()`).
 *
 * Yang ditiru dari source asli (codemanki/cloudscraper):
 *   - Header default ala Chrome (rotasi UA) — lihat lib/headers.js + browsers.json
 *   - Deteksi Cloudflare/sucuri via header `server` + content-type HTML
 *   - Validasi respons: captcha (__cf_chl_captcha_tk__/why_captcha) & cf-error-code
 *   - Solver IUAM `jschl` (ekstrak jschl_vc/pass + JS setTimeout → eval node:vm)
 *   - Solver redirect `S='base64'` (sucuri_cloudproxy_js / You are being redirected)
 *   - Loop `challengesToSolve` (default 3) + delay sesuai timeout CF
 *     (dibatasi `cloudflareMaxTimeout`) — serverless-safe (node:vm, bukan jsdom).
 *
 * Yang disederhanakan (tidak dipakai repo ini):
 *   - Transport diganti `fetch` native + `tough-cookie` root (aman, sudah ada
 *     di package.json) sebagai cookie jar — bukan `request`/`request-promise`.
 *   - `onCaptcha` tidak interaktif: langsung throw CaptchaError (QuillBot tak
 *     pernah memicu captcha; kalau kena, retry identitas di quillbot-web.js).
 *   - `agentOptions.ciphers` + brotli manual diabaikan (fetch Node 22 sudah
 *     menangani gzip/deflate/br otomatis).
 *
 * API kompatibel yg dipakai:
 *   import cloudscraper from './cloudscraper.js';
 *   cloudscraper.jar()                    -> CookieJar baru
 *   cloudscraper.defaults({jar, headers}) -> instance turunan
 *   client.post({uri, body, headers, timeout, simple:false,
 *                resolveWithFullResponse:true}) -> {statusCode, body, headers}
 */

import { CookieJar } from 'tough-cookie';
import { runInNewContext } from 'node:vm';

// ---------------- Error (tiru errors.js asli, tanpa request-promise-core) ----------------

function makeError(name, errorType, customize) {
  function CustomError(cause, options, response) {
    if (cause instanceof Error && cause.errorType !== undefined && cause.name !== 'Error') {
      return cause;
    }
    const msg = typeof cause === 'string' ? cause : cause?.message || String(cause ?? 'error');
    const e = new Error(msg);
    e.name = name;
    e.errorType = errorType;
    e.cause = cause;
    e.options = options;
    e.response = response;
    if (typeof customize === 'function') {
      try { customize(e); } catch {}
    }
    if (Error.captureStackTrace) Error.captureStackTrace(e, CustomError);
    return e;
  }
  CustomError.prototype.errorType = errorType;
  Object.defineProperty(CustomError, 'name', { configurable: true, value: name });
  return CustomError;
}

const ERROR_CODES = {
  520: 'Web server is returning an unknown error',
  521: 'Web server is down',
  522: 'Connection timed out',
  523: 'Origin is unreachable',
  524: 'A timeout occurred',
  525: 'SSL handshake failed',
  526: 'Invalid SSL certificate',
  527: 'Railgun Listener to Origin Error',
  530: 'Origin DNS error',
  1000: 'DNS points to prohibited IP',
  1001: 'DNS resolution error',
  1002: 'Restricted or DNS points to Prohibited IP',
  1003: 'Access Denied: Direct IP Access Not Allowed',
  1004: 'Host Not Configured to Serve Web Traffic',
  1005: 'Access Denied: IP of banned ASN/ISP',
  1010: "The owner of this website has banned your access based on your browser's signature",
  1011: 'Access Denied (Hotlinking Denied)',
  1012: 'Access Denied',
  1013: 'HTTP hostname and TLS SNI hostname mismatch',
  1016: 'Origin DNS error',
  1018: 'Domain is misconfigured',
  1020: 'Access Denied (Custom Firewall Rules)',
  1006: 'Access Denied: Your IP address has been banned',
  1007: 'Access Denied: Your IP address has been banned',
  1008: 'Access Denied: Your IP address has been banned',
};

export const RequestError = makeError('RequestError', 0);
export const CaptchaError = makeError('CaptchaError', 1);
export const CloudflareError = makeError('CloudflareError', 2, (e) => {
  const code = e.cause;
  if (code !== null && code !== undefined && !Number.isNaN(Number(code))) {
    const desc = ERROR_CODES[Number(code)];
    if (desc) e.message = `${code}, ${desc}`;
  }
});
export const ParserError = makeError('ParserError', 3, (e) => {
  e.message =
    '\n### Cloudflare may have changed their technique, or there may be a bug.\n' +
    '### Bug Reports: https://github.com/codemanki/cloudscraper/issues\n' +
    '### Check the detailed exception message that follows for the cause.\n\n' +
    e.message;
});

// ---------------- Header default ala Chrome (tiru lib/headers.js) ----------------

const CHROME_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function getDefaultHeaders(extra = {}) {
  return {
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': pick(CHROME_UAS),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    ...extra,
  };
}

function caseless(headers = {}) {
  const out = {};
  for (const k of Object.keys(headers)) out[k.toLowerCase()] = headers[k];
  return out;
}

// ---------------- Email-decode (tiru lib/email-decode.js, opsional) ----------------

const EMAIL_PATTERN =
  '<([a-z]+)(?: [^>]*)?' +
  '(?:' +
  ' href=[\'"]?(\\/cdn-cgi\\/l\\/email-protection#([a-f0-9]{4,}))' + '|' +
  ' data-cfemail=["\']?([a-f0-9]{4,})' +
  '(?:[^<]*\\/>|[^<]*?<\\/\\1>)' +
  ')';
const emailRe = new RegExp(EMAIL_PATTERN, 'gi');

function decodeCfEmail(hexStr) {
  const key = parseInt(hexStr.substr(0, 2), 16);
  let email = '';
  for (let i = 2; i < hexStr.length; i += 2) {
    email += String.fromCharCode(parseInt(hexStr.substr(i, 2), 16) ^ key);
  }
  try {
    return decodeURIComponent(escape(email));
  } catch {
    return email;
  }
}

function decodeEmails(html) {
  let match;
  emailRe.lastIndex = 0;
  while ((match = emailRe.exec(html)) !== null) {
    let result;
    if (match[2] !== undefined) result = match[0].replace(match[2], 'mailto:' + decodeCfEmail(match[3]));
    else result = decodeCfEmail(match[4]);
    html = html.substr(0, match.index) + result + html.substr(emailRe.lastIndex);
    emailRe.lastIndex = match.index + result.length - 1;
  }
  return html;
}

// ---------------- Sandbox node:vm (tiru lib/sandbox.js) ----------------

const VM_OPTIONS = {
  filename: 'iuam-challenge.js',
  contextOrigin: 'cloudflare:iuam-challenge.js',
  contextCodeGeneration: { strings: true, wasm: false },
  timeout: 5000,
};

const VM_ENV = `
  (function (global) {
    const cache = Object.create(null);
    const keys = [];
    const { body, href } = global;
    Object.defineProperties(global, {
      document: {
        value: {
          createElement: function () {
            return { firstChild: { href: href } };
          },
          getElementById: function (id) {
            if (keys.indexOf(id) === -1) {
              const re = new RegExp(' id=[\\'"]?' + id + '[^>]*>([^<]*)');
              const match = body.match(re);
              keys.push(id);
              cache[id] = match === null ? match : { innerHTML: match[1] };
            }
            return cache[id];
          }
        }
      },
      location: { value: { reload: function () {} } }
    })
  }(this));
`;

function sandboxEval(code, ctx) {
  return runInNewContext(VM_ENV + code, ctx, VM_OPTIONS);
}

function sandboxContext(options = {}) {
  const { body = '', hostname = '' } = options;
  const atob = Object.setPrototypeOf(
    function (str) {
      try {
        return Buffer.from(str, 'base64').toString('binary');
      } catch {}
    },
    null,
  );
  return Object.setPrototypeOf({ body, href: 'http://' + hostname + '/', atob }, null);
}

// ---------------- Inti request via fetch ----------------

function resolveUrl(uri, qs) {
  let url = typeof uri === 'string' ? uri : uri?.url || uri?.href;
  if (!url) throw new TypeError('Expected `uri`/`url` option as string');
  if (qs && typeof qs === 'object') {
    const sep = url.includes('?') ? '&' : '?';
    url += sep + new URLSearchParams(qs).toString();
  }
  return url;
}

async function fetchOnce(opts) {
  const url = resolveUrl(opts.uri ?? opts.url, opts.qs);
  const u = new URL(url);
  const jar = opts.jar instanceof CookieJar ? opts.jar : null;

  const headers = { ...(opts.headers ?? {}) };
  if (jar) {
    try {
      const cookieStr = await jar.getCookieString(url);
      if (cookieStr) headers.Cookie = headers.Cookie ? headers.Cookie + '; ' + cookieStr : cookieStr;
    } catch {}
  }

  let body;
  if (opts.form && typeof opts.form === 'object') {
    body = new URLSearchParams(opts.form).toString();
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
  } else if (opts.json !== undefined && typeof opts.json === 'object' && opts.json !== null && opts.body === undefined) {
    body = JSON.stringify(opts.json);
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  } else if (opts.body !== undefined) {
    body = opts.body;
  }

  const controller = new AbortController();
  const timeout = Number(opts.timeout) || 0;
  const timer = timeout > 0 ? setTimeout(() => controller.abort(new Error(`ETIMEDOUT ${url}`)), timeout) : null;
  const startedAt = Date.now();

  let res;
  try {
    res = await fetch(url, {
      method: (opts.method || 'GET').toUpperCase(),
      headers,
      body,
      redirect: opts.followAllRedirects === false ? 'manual' : 'follow',
      signal: controller.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  const rawHeaders = {};
  res.headers.forEach((v, k) => {
    rawHeaders[k] = rawHeaders[k] ? rawHeaders[k] + ', ' + v : v;
  });

  if (jar) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : null;
    const list = setCookies ?? (rawHeaders['set-cookie'] ? [rawHeaders['set-cookie']] : []);
    for (const sc of list) {
      try {
        await jar.setCookie(sc, url, { ignoreError: true });
      } catch {}
    }
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const response = {
    statusCode: res.status,
    statusMessage: res.statusText,
    headers: rawHeaders,
    body: buf,
    request: { uri: { hostname: u.hostname, href: url, protocol: u.protocol, host: u.host } },
    responseStartTime: startedAt,
  };
  return { response, buf };
}

function detectRecaptchaVersion(body) {
  if (/__cf_chl_captcha_tk__=(.*)/i.test(body)) return 'ver2';
  if (body.indexOf('why_captcha') !== -1 || /cdn-cgi\/l\/chk_captcha/i.test(body)) return 'ver1';
  return false;
}

function validateResponse(options, response, body) {
  const recaptchaVer = detectRecaptchaVersion(body);
  if (recaptchaVer) {
    response.isCaptcha = true;
    throw new CaptchaError('captcha', options, response);
  }
  const match = body.match(/<\w+\s+class="cf-error-code">(.*)<\/\w+>/i);
  if (match) {
    throw new CloudflareError(parseInt(match[1], 10), options, response);
  }
  return false;
}

async function performWithChallenge(userOpts, defaults) {
  const options = {
    challengesToSolve: defaults.challengesToSolve ?? 3,
    cloudflareMaxTimeout: defaults.cloudflareMaxTimeout ?? 30000,
    decodeEmails: defaults.decodeEmails ?? false,
    followAllRedirects: defaults.followAllRedirects ?? true,
    headers: { ...getDefaultHeaders(), ...(defaults.headers ?? {}), ...(userOpts.headers ?? {}) },
    jar: userOpts.jar ?? defaults.jar ?? null,
    timeout: userOpts.timeout ?? defaults.timeout ?? 0,
    method: userOpts.method ?? (userOpts.uri || userOpts.url ? undefined : 'GET'),
    uri: userOpts.uri ?? userOpts.url,
    url: userOpts.url ?? userOpts.uri,
    body: userOpts.body,
    form: userOpts.form,
    qs: userOpts.qs,
    json: userOpts.json,
    simple: userOpts.simple,
    resolveWithFullResponse: userOpts.resolveWithFullResponse,
    realEncoding: userOpts.encoding ?? userOpts.realEncoding ?? 'utf8',
    onCaptcha: userOpts.onCaptcha,
  };
  if (!options.method) options.method = options.body !== undefined || options.form !== undefined ? 'POST' : 'GET';

  let attemptOptions = { ...options };
  const maxChallenges = Number(options.challengesToSolve) || 0;
  let remaining = maxChallenges;

  for (;;) {
    const { response, buf } = await fetchOnce(attemptOptions);
    const headers = caseless(response.headers);
    response.isCloudflare = /^(cloudflare|sucuri)/i.test('' + (headers.server ?? ''));
    response.isHTML = /text\/html/i.test('' + (headers['content-type'] ?? ''));

    let stringBody = '';
    try {
      stringBody = buf.toString('utf8');
    } catch {
      stringBody = '';
    }

    if (response.isCloudflare && response.isHTML) {
      if (!buf.length) throw new CloudflareError(response.statusCode, attemptOptions, response);

      try {
        validateResponse(attemptOptions, response, stringBody);
      } catch (err) {
        if (err?.name === 'CaptchaError' || err instanceof Error && err.name === 'CaptchaError') {
          // Tak ada solver interaktif di repo ini — lempar agar retry identitas.
          throw err;
        }
        throw err;
      }

      const isChallenge = stringBody.indexOf("a = document.getElementById('jschl-answer');") !== -1;
      const isRedirectChallenge =
        stringBody.indexOf('You are being redirected') !== -1 || stringBody.indexOf('sucuri_cloudproxy_js') !== -1;

      if (isChallenge) {
        if (remaining <= 0) {
          const e = new CloudflareError('Cloudflare challenge loop', attemptOptions, response);
          e.errorType = 4;
          throw e;
        }
        attemptOptions = await solveJschlChallenge(attemptOptions, response, stringBody);
        remaining -= 1;
        continue;
      }
      if (isRedirectChallenge) {
        if (remaining <= 0) {
          const e = new CloudflareError('Cloudflare challenge loop', attemptOptions, response);
          e.errorType = 4;
          throw e;
        }
        attemptOptions = solveRedirectChallenge(attemptOptions, response, stringBody);
        remaining -= 1;
        continue;
      }
      if (response.statusCode === 503) {
        if (remaining <= 0) {
          const e = new CloudflareError('Cloudflare challenge loop', attemptOptions, response);
          e.errorType = 4;
          throw e;
        }
        attemptOptions = await solveJschlChallenge(attemptOptions, response, stringBody);
        remaining -= 1;
        continue;
      }
    }

    // Selesai — bentuk hasil ala request-promise.
    let outBody = buf;
    if (typeof options.realEncoding === 'string') {
      outBody = buf.toString(options.realEncoding);
      if (response.isHTML && options.decodeEmails) outBody = decodeEmails(outBody);
      response.body = outBody;
    } else {
      response.body = buf;
    }

    const ok = response.statusCode >= 200 && response.statusCode < 300;
    // simple default true (ala request-promise); quillbot selalu simple:false.
    if (!ok && options.simple !== false) {
      const err = new Error(`StatusCodeError: ${response.statusCode}`);
      err.statusCode = response.statusCode;
      err.response = response;
      err.error = outBody;
      throw err;
    }

    if (options.resolveWithFullResponse) return response;
    return response.body ?? outBody;
  }
}

async function solveJschlChallenge(options, response, body) {
  const uri = response.request.uri;
  const payload = {};
  let match;

  match = body.match(/name="(.+?)" value="(.+?)"/);
  if (match) payload[match[1]] = match[2];

  match = body.match(/name="jschl_vc" value="(\w+)"/);
  if (!match) throw new ParserError('challengeId (jschl_vc) extraction failed', options, response);
  payload.jschl_vc = match[1];

  match = body.match(/name="pass" value="(.+?)"/);
  if (!match) throw new ParserError('Attribute (pass) value extraction failed', options, response);
  payload.pass = match[1];

  match = body.match(/getElementById\('cf-content'\)[\s\S]+?setTimeout.+?\r?\n([\s\S]+?a\.value\s*=.+?)\r?\n(?:[^{<>]*},\s*(\d{4,}))?/);
  if (!match) throw new ParserError('setTimeout callback extraction failed', options, response);

  let timeout = parseInt(options.cloudflareTimeout, 10);
  if (Number.isNaN(timeout)) {
    if (match[2] !== undefined) {
      timeout = parseInt(match[2], 10);
      if (timeout > options.cloudflareMaxTimeout) timeout = options.cloudflareMaxTimeout;
    } else {
      throw new ParserError('Failed to parse challenge timeout', options, response);
    }
  }

  response.challenge = match[1] + '; a.value';
  try {
    const ctx = sandboxContext({ hostname: uri.hostname, body });
    payload.jschl_answer = sandboxEval(response.challenge, ctx);
  } catch (err) {
    err.message = 'Challenge evaluation failed: ' + err.message;
    throw new ParserError(err, options, response);
  }
  if (Number.isNaN(Number(payload.jschl_answer))) {
    throw new ParserError('Challenge answer is not a number', options, response);
  }

  const next = { ...options, headers: { ...(options.headers ?? {}), Referer: uri.href } };
  match = body.match(/id="challenge-form" action="(.+?)" method="(.+?)"/);
  if (match && match[2] && match[2] === 'POST') {
    next.uri = next.url = uri.protocol + '//' + uri.host + match[1];
    next.form = payload;
    next.method = 'POST';
    delete next.qs;
  } else {
    next.uri = next.url = uri.protocol + '//' + uri.host + '/cdn-cgi/l/chk_jschl';
    next.qs = payload;
    next.method = 'GET';
    delete next.form;
    delete next.body;
  }
  delete next.baseUrl;
  next.uri = next.url = String(next.uri).replace(/&amp;/g, '&');

  const wait = Math.max(0, timeout - (Date.now() - response.responseStartTime));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return next;
}

function solveRedirectChallenge(options, response, body) {
  const uri = response.request.uri;
  const match = body.match(/S='([^']+)'/);
  if (!match) throw new ParserError('Cookie code extraction failed', options, response);
  const code = Buffer.from(match[1], 'base64').toString('ascii');
  try {
    const ctx = sandboxContext();
    sandboxEval(code, ctx);
    const cookieStr = ctx.document?.cookie;
    if (cookieStr && options.jar instanceof CookieJar) {
      options.jar.setCookieSync
        ? options.jar.setCookieSync(cookieStr, uri.href, { ignoreError: true })
        : options.jar.setCookie(cookieStr, uri.href, { ignoreError: true }).catch(() => {});
    }
  } catch (err) {
    err.message = 'Cookie code evaluation failed: ' + err.message;
    throw new ParserError(err, options, response);
  }
  return { ...options };
}

// ---------------- Pabrik instance (tiru defaults() asli) ----------------

function createInstance(defaultParams = {}) {
  const base = {
    // Cookies aktif by default (tiru request.jar() bawaan cloudscraper asli)
    // agar clearance challenge bertahan antar request dalam satu instance.
    jar: defaultParams.jar ?? new CookieJar(),
    headers: defaultParams.headers ? { ...defaultParams.headers } : getDefaultHeaders(),
    cloudflareMaxTimeout: defaultParams.cloudflareMaxTimeout ?? 30000,
    followAllRedirects: defaultParams.followAllRedirects ?? true,
    challengesToSolve: defaultParams.challengesToSolve ?? 3,
    decodeEmails: defaultParams.decodeEmails ?? false,
    timeout: defaultParams.timeout ?? 0,
  };

  async function req(opts = {}) {
    if (typeof opts === 'string') return performWithChallenge({ uri: opts }, base);
    return performWithChallenge(opts, base);
  }
  req.get = (opts = {}) => {
    const o = typeof opts === 'string' ? { uri: opts } : { ...opts };
    o.method = 'GET';
    return performWithChallenge(o, base);
  };
  req.post = (opts = {}) => {
    const o = typeof opts === 'string' ? { uri: opts } : { ...opts };
    o.method = o.method || 'POST';
    return performWithChallenge(o, base);
  };
  req.defaults = (params = {}) => {
    const merged = {
      ...base,
      ...params,
      headers: { ...base.headers, ...(params.headers ?? {}) },
    };
    // Jar baru tiap defaults({jar}) — cerminkan perilaku request.defaults.
    if (params.jar !== undefined) merged.jar = params.jar;
    return createInstance(merged);
  };
  req.jar = () => new CookieJar();
  req.defaultParams = base;
  return req;
}

const cloudscraper = createInstance();

export default cloudscraper;
export { cloudscraper };
