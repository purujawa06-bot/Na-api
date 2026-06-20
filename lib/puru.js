const axios = require('axios');

const API_BASE = 'https://hollow-isa-nue-api-a32469fb.koyeb.app/v1';
const API_KEY = 'sk-00fa7c868847b760-fbkl9l-e4416500';
const MODEL = 'puru';

/**
 * Chat Completion — OpenAI-compatible.
 * Supports streaming (SSE) & non-streaming.
 * @param {string|Array} messages - String prompt or array of {role, content}
 * @param {Object} [opts] - Optional overrides
 * @param {boolean} [opts.stream=false] - Enable SSE streaming
 * @param {number} [opts.max_tokens=2048] - Max tokens
 * @param {number} [opts.temperature=0.7] - Temperature
 * @returns {Promise<string|AsyncGenerator>} - String (non-stream) or AsyncGenerator (stream)
 */
async function chatCompletion(messages, opts = {}) {
    const {
        stream = false,
        max_tokens = 2048,
        temperature = 0.7,
    } = opts;

    // Normalize messages: if string, wrap as single user msg
    const msgs = typeof messages === 'string'
        ? [{ role: 'user', content: messages }]
        : messages;

    const payload = {
        model: MODEL,
        messages: msgs,
        max_tokens,
        temperature,
        stream,
    };

    if (!stream) {
        // Non-streaming: single request
        const res = await axios.post(`${API_BASE}/chat/completions`, payload, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        });

        const data = res.data;
        if (!data.choices || !data.choices.length) {
            throw new Error('No choices returned from Puru AI');
        }
        return data.choices[0].message.content;
    }

    // Streaming: return async generator yielding SSE chunks
    const response = await axios.post(`${API_BASE}/chat/completions`, payload, {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        },
        responseType: 'stream',
        timeout: 120000,
    });

    const responseStream = response.data;

    async function* generate() {
        let buffer = '';
        for await (const chunk of responseStream) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const dataStr = trimmed.replace('data:', '').trim();
                if (!dataStr || dataStr === '[DONE]') continue;

                try {
                    const json = JSON.parse(dataStr);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta) {
                        yield { type: 'content', content: delta };
                    }
                } catch (e) {
                    // skip parse errors
                }
            }
        }
    }

    return generate();
}

module.exports = { chatCompletion };
