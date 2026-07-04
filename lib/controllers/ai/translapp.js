/**
 * @title Translapp AI
 * @summary AI Text Processing dengan Translapp.
 * @description Memproses teks dengan berbagai modul AI seperti ringkasan, parafrase, terjemahan, penyesuaian nada, dll.
 * @method POST
 * @path /api/ai/translapp
 * @response json
 * @param {string} body.text - Teks yang akan diproses.
 * @param {string} body.module - Modul pemrosesan: SUMMARIZE, PARAPHRASE, EXPAND, TONE, TRANSLATE, REPLY, GRAMMAR.
 * @param {string} [body.to] - Parameter tambahan tergantung modul (bahasa target untuk TRANSLATE, nada untuk TONE, dll).
 * @param {string} [body.customTone] - Nada kustom jika memilih TONE dengan opsi "Other".
 * @example
 * async function processText() {
 *   try {
 *     const response = await fetch('/api/ai/translapp', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "text": "Hello, how are you?",
 *         "module": "TRANSLATE", 
 *         "to": "jawa"
 *       })
 *     });
 * 
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error('Error:', error);
 *   }
 * }
 * 
 * processText();
 */
const axios = require('axios');
const { createHash, randomUUID } = require('crypto');

const translapp = {
  api: {
    base: 'https://translapp.info',
    endpoint: '/ai/g/ask',
  },

  headers: {
    'user-agent': 'Postify/1.0.0',
    'content-type': 'application/json',
    'accept-language': 'en',
  },

  modules: [
    'SUMMARIZE',
    'PARAPHRASE',
    'EXPAND',
    'TONE',
    'TRANSLATE',
    'REPLY',
    'GRAMMAR',
  ],

  tones: [
    'Friendly',
    'Romantic',
    'Sarcastic',
    'Humour',
    'Social',
    'Angry',
    'Sad',
    'Other',
  ],

  replies: ['Short', 'Medium', 'Long'],

  _shorten: (input) => {
    if (input.length >= 5) return input.substring(0, 5);
    return 'O'.repeat(5 - input.length) + input;
  },

  _hashString: (str) => createHash('sha256').update(str, 'utf8').digest('hex'),

  request: async (text, module = 'SUMMARIZE', to = '', customTone = '') => {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return {
        success: false,
        code: 400,
        result: { error: 'Teks wajib diisi bree, kagak boleh kosong 🫵🏻' },
      };
    }

    if (!module || !translapp.modules.includes(module)) {
      return {
        success: false,
        code: 400,
        result: {
          error: `Module wajib diisi bree, pilih salah satu yak: ${translapp.modules.join(', ')} 🗿`,
        },
      };
    }

    if (module === 'TONE') {
      if (!to || !translapp.tones.includes(to)) {
        return {
          success: false,
          code: 400,
          result: {
            error: `Parameter 'to' untuk TONE wajib diisi, pilih salah satu bree: ${translapp.tones.join(', ')} 🙈️`,
          },
        };
      }
      if (to === 'Other' && (!customTone || customTone.trim() === '')) {
        return {
          success: false,
          code: 400,
          result: {
            error: "Kalo TONE pilih Other, customTone wajib diisi (contoh: 'Shy') 😳",
          },
        };
      }
    } else if (module === 'TRANSLATE') {
      if (!to || typeof to !== 'string' || to.trim() === '') {
        return {
          success: false,
          code: 400,
          result: {
            error: "Parameter 'to' untuk TRANSLATE wajib diisi, input bahasa targetnya (contoh: 'English') 🙈️",
          },
        };
      }
    } else if (module === 'REPLY') {
      if (!to || !translapp.replies.includes(to)) {
        return {
          success: false,
          code: 400,
          result: {
            error: `Parameter 'to' untuk REPLY wajib diisi, pilih salah satu bree: ${translapp.replies.join(', ')} 🙈️`,
          },
        };
      }
    }

    try {
      const inputx = translapp._shorten(text);
      const prefix = `${inputx}ZERO`;
      const key = translapp._hashString(prefix);
      const userId = `GALAXY_AI${randomUUID()}`;
      const toValue = module === 'TONE' && to === 'Other' ? customTone : to;

      const payload = {
        k: key,
        module,
        text,
        to: toValue,
        userId,
      };

      const response = await axios.post(
        `${translapp.api.base}${translapp.api.endpoint}`,
        payload,
        { headers: translapp.headers }
      );

      const { data } = response;

      return {
        success: true,
        code: 200,
        result: {
          module,
          input: text,
          to: toValue,
          output: data.message,
        },
      };
    } catch (error) {
      return {
        success: false,
        code: error.response?.status || 500,
        result: {
          error: error.response?.data?.message || error.message || 'Error bree..',
        },
      };
    }
  },
};

const translappController = async (req) => {
    const { text, module, to, customTone } = req.body;

    if (!text) {
        throw new Error("Parameter 'text' wajib diisi.");
    }

    if (!module) {
        throw new Error("Parameter 'module' wajib diisi.");
    }

    const result = await translapp.request(text, module, to, customTone);

    if (result.success) {
        return {
            success: true,
            author: 'Tiyanz',
            result: result.result
        };
    } else {
        throw new Error(result.result.error || 'Terjadi kesalahan saat memproses teks.');
    }
};

module.exports = translappController;