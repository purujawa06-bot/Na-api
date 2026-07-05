// Memindahkan file dari server/api/lib/svara.js ke lib/svara.js
// Credit: Daffa dari nbscript (https://whatsapp.com/channel/0029VbBmAXAHAdNWOpWN531c)
const axios = require('axios');

const svara = {
  api: {
    base: 'https://svara.aculix.net',
    endpoint: {
      generate: '/generate-speech',
    },
  },

  headers: {
    'user-agent': 'NB Android/1.0.0',
    'accept-encoding': 'gzip',
    'content-type': 'application/json',
  },


  cid: new Uint8Array([
    0x24, 0x52, 0x43, 0x41, 0x6e, 0x6f, 0x6e, 0x79,
    0x6d, 0x6f, 0x75, 0x73, 0x49, 0x44, 0x3a, 0x31,
    0x33, 0x65, 0x38, 0x37, 0x35, 0x33, 0x61, 0x65,
    0x36, 0x31, 0x39, 0x34, 0x63, 0x37, 0x62, 0x39,
    0x32, 0x37, 0x33, 0x32, 0x64, 0x36, 0x36, 0x64,
    0x37, 0x30, 0x32, 0x33, 0x30, 0x37, 0x32
  ]),

  auth: new Uint8Array([
    0x77, 0x76, 0x65, 0x62, 0x6e, 0x79, 0x75, 0x36, 0x36, 0x36, 0x38, 0x37, 0x35, 0x36, 0x68, 0x34,
    0x35, 0x67, 0x66, 0x65, 0x63, 0x64, 0x66, 0x65, 0x67, 0x6e, 0x68, 0x6d, 0x75, 0x36, 0x6b, 0x6a,
    0x35, 0x68, 0x36, 0x34, 0x67, 0x35, 0x33, 0x66, 0x76, 0x72, 0x62, 0x67, 0x6e, 0x79, 0x35
  ]),

  voiceX: {
    'alloy': 'af_alloy', 'aoede': 'af_aoede', 'bella': 'af_bella', 'heart': 'af_heart',
    'jessica': 'af_jessica', 'kore': 'af_kore', 'nicole': 'af_nicole', 'nova': 'af_nova',
    'river': 'af_river', 'sarah': 'af_sarah', 'sky': 'af_sky',
    'adam': 'am_adam', 'echo': 'am_echo', 'eric': 'am_eric', 'fenrir': 'am_fenrir',
    'liam': 'am_liam', 'michael': 'am_michael', 'onyx': 'am_onyx', 'puck': 'am_puck',
    'santa': 'am_santa',
    'alice': 'bf_alice', 'emma': 'bf_emma', 'isabella': 'bf_isabella', 'lily': 'bf_lily',
    'daniel': 'bm_daniel', 'fable': 'bm_fable', 'george': 'bm_george', 'lewis': 'bm_lewis',
    'anaya': 'hf_alpha', 'riya': 'hf_beta', 'arjun': 'hm_omega', 'kabir': 'hm_psi',
    'dora': 'ef_dora',
    'santiago': 'em_alex', 'noel': 'em_santa',
    'siwis': 'ff_siwis',
    'aiko': 'jf_alpha', 'gongitsune': 'jf_gongitsune', 'nezumi': 'jf_nezumi',
    'tebukuro': 'jf_tebukuro', 'kumo': 'jm_kumo',
    'sara': 'if_sara', 'nicola': 'im_nicola',
    'doras': 'pf_dora', 
    'alex': 'pm_alex', 'antonio': 'pm_santa',
    'xiaobei': 'zf_xiaobei', 'xiaoni': 'zf_xiaoni', 'xiaoxiao': 'zf_xiaoxiao',
    'xiaoyi': 'zf_xiaoyi', 'yunjian': 'zm_yunjian', 'yunxi': 'zm_yunxi',
    'yunxia': 'zm_yunxia', 'yunyang': 'zm_yunyang'
  },

  getVoiceId: function(vn) {
    const i = vn.toLowerCase().trim();
    return this.voiceX[i];
  },

  generate: async function(text, vn) {
    if (!text?.trim()) {
      return {
        success: false,
        code: 400,
        author: 'Tiyanz x Daffa (nbscript)',
        result: { 
            error: 'Parameter `text` tidak boleh kosong.'
         },
      };
    }

    if (text.length > 300) {
      return {
        success: false,
        code: 413,
        author: 'Tiyanz x Daffa (nbscript)',
        result: { 
            error: 'Panjang `text` maksimal 300 karakter.'
         },
      };
    }

    const voiceId = this.getVoiceId(vn);
    if (!voiceId) {
      const av = Object.keys(this.voiceX).join(', ');
      return {
        success: false,
        code: 422,
        author: 'Tiyanz x Daffa (nbscript)',
        result: { 
            error: `Nama voice "${vn}" tidak valid. Pilih salah satu dari: ${av}`
         },
      };
    }

    const decoder = new TextDecoder();
    const ciu = decoder.decode(this.cid);
    const toket = decoder.decode(this.auth);

    const body = {
      customerId: ciu,
      text: text,
      voice: voiceId,
    };

    try {
      const res = await axios.post(
        `${this.api.base}${this.api.endpoint.generate}`,
        body,
        { 
          headers: { 
            ...this.headers,
            authorization: toket
          } 
        }
      );

      const { outputUrl } = res.data;

      return {
        success: true,
        code: 200,
        author: 'Tiyanz x Daffa (nbscript)',
        result: {
          audio: outputUrl,
          voice: voiceId,
          text_length: text.length,
        },
      };
    } catch (err) {
      return {
        success: false,
        code: err.response?.status || 500,
        author: 'Tiyanz x Daffa (nbscript)',
        result: {
          error: err.message || 'Terjadi kesalahan internal.',
        },
      };
    }
  },
};

module.exports = { svara };