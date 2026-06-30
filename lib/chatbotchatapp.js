const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://chatbotchatapp.com';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let cookieJar = {};

function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return;
  (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]).forEach((c) => {
    const parts = c.split(';')[0].split('=');
    if (parts.length >= 2) cookieJar[parts[0].trim()] = parts.slice(1).join('=');
  });
}

function getCookieString() {
  return Object.entries(cookieJar)
    .map(([k, v]) => k + '=' + v)
    .join('; ');
}

function genNonce() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const instance = axios.create({
  headers: { 'User-Agent': USER_AGENT },
  withCredentials: true,
  maxRedirects: 5,
  timeout: 60000,
});

async function getPageConfig() {
  const res = await instance.get(BASE_URL, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  parseCookies(res.headers['set-cookie']);

  const html = res.data;
  const ypp = html.match(/ypp\s*=\s*"([^"]+)"/)?.[1];
  const csrfToken = html.match(/csrf-token" content="([^"]+)"/)?.[1];

  if (!csrfToken) throw new Error('Gagal mendapatkan CSRF token');
  if (!ypp) throw new Error('Gagal mendapatkan ypp key');

  return { csrfToken, ypp };
}

async function getTimestamp(csrfToken, ypp) {
  const params = new URLSearchParams({ href: BASE_URL + '/', ypp });
  const res = await instance.post(BASE_URL + '/api/get-timestamp', params.toString(), {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRF-TOKEN': csrfToken,
      Referer: BASE_URL + '/',
      Origin: BASE_URL,
      Cookie: getCookieString(),
    },
  });
  parseCookies(res.headers['set-cookie']);

  if (!res.data || !res.data.status) {
    throw new Error(res.data?.message || 'Gagal mendapatkan timestamp');
  }
  return res.data;
}

function generateRequestId(timestamp, nonce, messages, keyToken) {
  const msgContent = messages[timestamp % messages.length].content;
  const s = { timestamp, nonce, messages: msgContent };

  let str = '';
  for (const [key, val] of Object.entries(s)) {
    str += key + String(val);
  }
  str += 'keyToken' + keyToken;
  str += 'vv1';

  return crypto.createHash('md5').update(str).digest('hex');
}

async function chat(prompt, options = {}) {
  const model = options.model || 'auto';
  const keyToken = 'XXXXXXYYY';

  const { csrfToken, ypp } = await getPageConfig();

  const tsData = await getTimestamp(csrfToken, ypp);
  const timestamp = tsData.timestamp;

  const nonce = genNonce();
  const messages = [{ role: 'user', content: prompt }];
  const id = generateRequestId(timestamp, nonce, messages, keyToken);

  const payload = {
    id,
    timestamp,
    nonce,
    messages,
    url: BASE_URL + '/',
    modal: model,
  };

  const res = await instance.post(BASE_URL + '/api', payload, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken,
      Accept: 'text/event-stream',
      Referer: BASE_URL + '/',
      Origin: BASE_URL,
      Cookie: getCookieString(),
    },
    responseType: 'stream',
    timeout: options.timeout || 60000,
  });

  const result = await parseSSEStream(res.data);
  return result;
}

function parseSSEStream(stream) {
  return new Promise((resolve, reject) => {
    let fullText = '';
    let buffer = '';
    let conversationId = null;
    let streamEnded = false;

    const finish = () => {
      streamEnded = true;
      resolve({ message: fullText, conversationId });
    };

    stream.on('data', (chunk) => {
      if (streamEnded) return;
      buffer += chunk.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (data.conversationId) {
              conversationId = data.conversationId;
            }

            if (data.choices) {
              for (const choice of data.choices) {
                if (choice.content && choice.content.parts) {
                  for (const part of choice.content.parts) {
                    if (part.text) {
                      fullText += part.text;
                    }
                  }
                }
                if (choice.finishReason === 'STOP' || choice.finishReason === 'MAX_TOKENS') {
                  finish();
                  return;
                }
              }
            }
          } catch {
            // Ignore parse error
          }
        } else if (line.startsWith('id: ')) {
          try {
            const errData = JSON.parse(line.slice(4).trim());
            if (errData.code) {
              const errorMessages = {
                1003: 'Kesalahan autentikasi. Silakan login.',
                1004: 'Silakan login untuk melanjutkan.',
                1006: 'Terjadi kesalahan, silakan coba lagi.',
                1017: 'Batas chatting hari ini tercapai.',
                1019: 'Batas chatting tercapai.',
              };
              reject(
                new Error(errorMessages[errData.code] || errData.message || 'API Error: ' + errData.code)
              );
              return;
            }
          } catch {
            // ignore
          }
        }
      }
    });

    stream.on('end', () => {
      if (!streamEnded) finish();
    });

    stream.on('error', (err) => {
      if (fullText) {
        resolve({ message: fullText, conversationId });
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      if (!streamEnded) {
        if (fullText) {
          finish();
        } else {
          reject(new Error('Timeout'));
        }
      }
    }, 55000);
  });
}

const MODELS = {
  AUTO: 'auto',
  GPT5: 'model-chatgpt-5',
  GPT_OSS: 'model-gpt-oss',
  DEEPSEEK_R1: 'model-deepseek-r1-0528',
  DEEPSEEK_V3: 'model-deepseek-v3-1',
  QWEN_35: 'model-qwen-3-5',
  MISTRAL_LARGE3: 'model-mistral-large-3',
  PIXTRAL: 'model-pixtral',
  DEVSTRAL2: 'model-devstral-2',
};

module.exports = { chat, MODELS };
