const axios = require('axios');
const cheerio = require('cheerio');

/**
 * DeepSeek V4 - Free Chat via deep-seek.ai proxy (OpenRouter)
 * Source: https://deep-seek.ai/chat
 */
class DeepSeekV4 {
    constructor() {
        this.baseUrl = 'https://deep-seek.ai';
        this.client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/event-stream',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': this.baseUrl,
                'Referer': this.baseUrl + '/chat',
            },
            timeout: 120000
        });
        this._csrf = null;
        this._cookies = {};
    }

    /**
     * Refresh session: dapetin CSRF token + cookies
     */
    async _refreshSession() {
        const resp = await this.client.get('/chat', {
            headers: { 'Accept': 'text/html' },
            responseType: 'text'
        });

        // Parse CSRF token
        const $ = cheerio.load(resp.data);
        this._csrf = $('meta[name="csrf-token"]').attr('content');
        if (!this._csrf) throw new Error('Gagal dapetin CSRF token');

        // Extract cookies from response headers
        const cookies = resp.headers['set-cookie'] || [];
        cookies.forEach(c => {
            const [keyVal] = c.split(';');
            const [key, ...valParts] = keyVal.split('=');
            this._cookies[key.trim()] = valParts.join('=');
        });

        return true;
    }

    /**
     * Build cookie string for requests
     */
    _cookieString() {
        return Object.entries(this._cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    /**
     * Send a message to DeepSeek-V4 and get streaming response
     * @param {string} message - User message
     * @param {object} options
     * @param {string} options.model - Model ID: deepseek/deepseek-v4-flash, deepseek/deepseek-r1, deepseek/deepseek-v3.2
     * @param {Array} options.history - Previous messages [{role, content}]
     * @returns {Promise<ReadableStream>} - SSE stream
     */
    async chat(message, options = {}) {
        const model = options.model || 'deepseek/deepseek-v4-flash';
        const history = options.history || [];

        // Refresh session
        await this._refreshSession();

        // Build messages array
        const messages = [
            ...history,
            { role: 'user', content: message }
        ];

        // Make request as stream
        const url = `${this.baseUrl}/api/chat`;
        const parsedUrl = new URL(url);
        const mod = parsedUrl.protocol === 'https:' ? require('https') : require('http');

        return new Promise((resolve, reject) => {
            const body = JSON.stringify({
                model: model,
                messages: messages
            });

            const req = mod.request(url, {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'X-CSRF-TOKEN': this._csrf,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Origin': this.baseUrl,
                    'Referer': this.baseUrl + '/chat',
                    'Cookie': this._cookieString(),
                    'Content-Length': Buffer.byteLength(body)
                }
            }, (res) => {
                if (res.statusCode !== 200) {
                    let data = '';
                    res.on('data', c => data += c.toString());
                    res.on('end', () => reject(new Error(`API error ${res.statusCode}: ${data}`)));
                    return;
                }
                resolve(res);
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Parse SSE stream from DeepSeek-V4
     * Returns async generator that yields { content, reasoning, done }
     */
    async *streamResponse(message, options = {}) {
        const stream = await this.chat(message, options);

        const buffer = [];
        let currentEvent = '';
        let accumulated = '';

        for await (const chunk of stream) {
            const text = chunk.toString();
            buffer.push(text);
            const lines = text.split('\n');

            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7).trim();
                    continue;
                }

                if (line.startsWith('data: ')) {
                    const data = line.slice(6);

                    if (data === '[DONE]') {
                        yield { content: null, reasoning: null, done: true };
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        const choice = parsed.choices?.[0]?.delta || {};

                        const delta = {
                            content: choice.content || null,
                            reasoning: choice.reasoning || null,
                            done: false
                        };

                        if (delta.content) accumulated += delta.content;
                        yield delta;
                    } catch (e) {
                        // Skip unparseable data
                    }

                    currentEvent = '';
                }
            }
        }

        yield { content: null, reasoning: null, done: true };
    }
}

/**
 * Main function for Na-api
 * Returns object with content, model used, reasoning
 */
async function chatDeepSeekV4(message, options = {}) {
    if (!message) throw new Error('Parameter message wajib diisi.');

    const model = options.model || 'deepseek/deepseek-v4-flash';

    try {
        const api = new DeepSeekV4();

        // Jika streaming mode, return async generator
        if (options.stream) {
            return api.streamResponse(message, options);
        }

        // Non-streaming: collect all chunks
        let fullContent = '';
        let fullReasoning = '';

        for await (const delta of api.streamResponse(message, options)) {
            if (delta.done) break;
            if (delta.content) fullContent += delta.content;
            if (delta.reasoning) fullReasoning += delta.reasoning;
        }

        return {
            success: true,
            result: {
                content: fullContent,
                reasoning: fullReasoning || null,
                model: model,
                source: 'deep-seek.ai'
            }
        };

    } catch (error) {
        throw error;
    }
}

module.exports = { DeepSeekV4, chatDeepSeekV4 };