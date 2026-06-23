const axios = require('axios');
const { uploadToTmp } = require('./uploader');

/**
 * Fake FLUX Pro Unlimited - HF Space Gradio Wrapper
 * Source: llamameta-fake-flux-pro-unlimited.hf.space
 */
class FakeFluxPro {
    constructor() {
        this.baseUrl = 'https://llamameta-fake-flux-pro-unlimited.hf.space';
        this.client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Origin': this.baseUrl,
                'Referer': this.baseUrl + '/',
            },
            timeout: 120000
        });
        // Cookie jar sederhana
        this._cookies = {};
    }

    _generateSession() {
        return 'sess-' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }

    /**
     * Generate image from prompt using HF Space Gradio API
     */
    async generate(prompt, model = 'turbo') {
        const sessionHash = this._generateSession();

        // Step 1: Hit homepage dulu untuk dapetin session cookie
        await this.client.get('/', {
            headers: {
                'Accept': 'text/html',
                'X-Fern-Session': sessionHash,
            }
        });

        // Step 2: Join queue
        const joinPayload = {
            data: [prompt, model],
            event_data: null,
            fn_index: 0,
            session_hash: sessionHash
        };

        let joinRes;
        try {
            joinRes = await this.client.post('/gradio_api/queue/join', joinPayload, {
                headers: { 'X-Fern-Session': sessionHash }
            });
        } catch (err) {
            throw new Error(`Gradio queue join failed: ${err.message}`);
        }

        const eventId = joinRes.data?.event_id;
        if (!eventId) {
            throw new Error('Failed to get event_id from Gradio queue');
        }

        // Step 3: Subscribe to SSE and wait for completion
        const imageUrl = await this._waitForCompletion(sessionHash, eventId);
        if (!imageUrl) {
            throw new Error('Failed to get image URL from Gradio stream');
        }

        // Step 4: Download the image
        const imgRes = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': this.baseUrl + '/',
            },
            timeout: 30000
        });

        return Buffer.from(imgRes.data);
    }

    /**
     * Wait for SSE stream completion and extract image URL
     * Uses axios with streaming response
     */
    _waitForCompletion(sessionHash, eventId) {
        return new Promise((resolve, reject) => {
            const url = `${this.baseUrl}/gradio_api/queue/data?session_hash=${sessionHash}`;
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    reject(new Error('Gradio SSE timeout after 75s'));
                }
            }, 75000);

            axios.get(url, {
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'X-Fern-Session': sessionHash,
                    'Referer': this.baseUrl + '/',
                },
                timeout: 120000,
            }).then(response => {
                const stream = response.data;
                let buffer = '';
                let lastEventId = null;

                stream.on('data', (chunk) => {
                    if (resolved) return;

                    buffer += chunk.toString();
                    const parts = buffer.split('\n\n');
                    // Keep last incomplete part in buffer
                    buffer = parts.pop() || '';

                    for (const part of parts) {
                        if (!part.trim()) continue;

                        const lines = part.split('\n');
                        let dataLine = '';
                        let eventType = '';

                        for (const line of lines) {
                            if (line.startsWith('id: ')) {
                                lastEventId = line.slice(4).trim();
                            } else if (line.startsWith('event: ')) {
                                eventType = line.slice(7).trim();
                            } else if (line.startsWith('data: ')) {
                                dataLine = line.slice(6);
                            }
                        }

                        if (!dataLine) continue;

                        try {
                            const data = JSON.parse(dataLine);
                            
                            if (data.msg === 'process_completed') {
                                resolved = true;
                                clearTimeout(timeout);
                                stream.destroy();

                                if (data.success && data.output?.data?.[0]?.url) {
                                    resolve(data.output.data[0].url);
                                } else {
                                    reject(new Error('Gradio process completed but no image URL'));
                                }
                                return;
                            }

                            if (data.msg === 'process_starts') {
                                // Generation starts - continue waiting
                                continue;
                            }

                            if (data.msg === 'estimation') {
                                // Queue estimation - continue waiting
                                continue;
                            }

                            if (data.msg === 'unexpected_error') {
                                resolved = true;
                                clearTimeout(timeout);
                                stream.destroy();
                                reject(new Error(`Gradio error: ${data.message || 'unknown error'}`));
                                return;
                            }

                            if (data.msg === 'close_stream') {
                                // Stream closing - but we should have gotten completed already
                                if (!resolved) {
                                    resolved = true;
                                    clearTimeout(timeout);
                                    stream.destroy();
                                    reject(new Error('Gradio stream closed without completion'));
                                }
                                return;
                            }
                        } catch (e) {
                            // Skip unparseable data
                        }
                    }
                });

                stream.on('end', () => {
                    if (!resolved) {
                        clearTimeout(timeout);
                        reject(new Error('Gradio SSE stream ended before completion'));
                    }
                });

                stream.on('error', (err) => {
                    if (!resolved) {
                        clearTimeout(timeout);
                        reject(new Error(`SSE stream error: ${err.message}`));
                    }
                });
            }).catch(err => {
                clearTimeout(timeout);
                reject(new Error(`SSE connection failed: ${err.message}`));
            });
        });
    }
}

/**
 * Main function for Na-api
 */
async function generateFluxV2(prompt) {
    if (!prompt) {
        throw new Error('Parameter prompt diperlukan.');
    }

    try {
        const api = new FakeFluxPro();
        const buffer = await api.generate(prompt);

        // Upload ke penyimpanan sementara
        const proxyUrl = await uploadToTmp(buffer, `flux-v2-${Date.now()}.webp`);

        return {
            success: true,
            result: {
                url: proxyUrl,
                prompt: prompt,
                type: 'text-to-image',
                source: 'hf-space-fake-flux-pro'
            }
        };

    } catch (error) {
        throw error;
    }
}

module.exports = { generateFluxV2 };