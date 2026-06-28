/**
 * @title Monica AI Chat
 * @summary Chat AI Monica dengan dukungan auto-login & multi-endpoint.
 * @description Monica AI client yang support login, register, dan auto-refresh session. 
 *              Bisa pake session token existing atau login via email/password.
 * @method POST
 * @path /api/ai/monica
 * @response json
 * @param {string} body.prompt - Pesan yang ingin dikirim ke AI.
 * @param {string} [body.sessionId] - Session token Monica (optional jika pake email+password).
 * @param {string} [body.email] - Email untuk login otomatis.
 * @param {string} [body.password] - Password untuk login otomatis.
 * @param {string} [body.action] - "chat" (default), "login", "register", "check_session", "user_info".
 * @param {string} [body.inviteCode] - Kode invite untuk register.
 * @example
 * fetch('/api/ai/monica', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ 
 *     "prompt": "Halo, apa kabar?",
 *     "email": "user@email.com",
 *     "password": "password123"
 *   })
 * })
 */
const MonicaClient = require('../../monica');

const monicaController = async (req) => {
    const { 
        prompt, 
        sessionId, 
        email, 
        password, 
        action = 'chat',
        inviteCode = '',
        conversationId,
        botUid = 'monica',
        language = 'auto',
        locale = 'en'
    } = req.body;

    // Default session from public gist (free tier)
    const defaultSession = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODI1NDkyNDAsImlzcyI6Im1vbmljYSIsInVzZXJfaWQiOjIwNDE2NDY3NywidXNlcl9uYW1lIjoiQW5hQm90IiwianRpIjoiZDM5NDg1MWE5NjE1NDhkMjg2M2M2MzkzNmJkYjI0N2QiLCJjbGllbnRfdHlwZSI6ImFuZHJvaWQifQ.Vzk4JXRP3QG1Eh2kTnL_A9cbAyosjkZGHfccc3KNxwA";

    const client = new MonicaClient(sessionId || defaultSession, {
        email: email || '',
        password: password || '',
        autoRefresh: true
    });

    switch (action) {
        // ========== AUTH ACTIONS ==========
        case 'login': {
            if (!email || !password) {
                throw new Error("Parameter 'email' dan 'password' wajib diisi untuk action 'login'.");
            }
            const result = await client.login(email, password, inviteCode);
            return {
                success: result.code === 0,
                author: 'PuruBoy',
                message: result.code === 0 ? 'Login berhasil!' : (result.msg || result.message || 'Login gagal'),
                session_id: client.sessionId,
                data: result
            };
        }

        case 'register': {
            if (!email || !password) {
                throw new Error("Parameter 'email' dan 'password' wajib diisi untuk action 'register'.");
            }
            const result = await client.register(email, password, { inviteCode });
            return {
                success: result.code === 0,
                author: 'PuruBoy',
                message: result.code === 0 ? 'Registrasi berhasil! Silakan cek email untuk verifikasi.' : (result.msg || result.message || 'Registrasi gagal'),
                session_id: client.sessionId,
                data: result
            };
        }

        case 'check_session': {
            const result = await client.checkSession();
            return {
                success: result.code === 0,
                author: 'PuruBoy',
                user: result.user || null,
                valid: result.code === 0,
                session_id: client.sessionId,
                data: result
            };
        }

        case 'user_info': {
            const user = await client.getUserInfo();
            return {
                success: !!user,
                author: 'PuruBoy',
                user: user,
                session_id: client.sessionId
            };
        }

        // ========== CHAT ==========
        case 'chat':
        default: {
            if (!prompt) {
                throw new Error("Parameter 'prompt' wajib diisi untuk chat.");
            }

            // Auto login if email+password provided but no session
            if (email && password && (!sessionId || sessionId === defaultSession)) {
                const loginResult = await client.login(email, password);
                if (loginResult.code !== 0) {
                    throw new Error(`Login gagal: ${loginResult.msg || loginResult.message || 'unknown error'}`);
                }
            }

            // Check session validity first
            const sessionCheck = await client.checkSession().catch(() => null);
            if (!sessionCheck || sessionCheck.code !== 0) {
                // If we have credentials, try one more login attempt
                if (email && password) {
                    const retryLogin = await client.login(email, password);
                    if (retryLogin.code !== 0) {
                        throw new Error(`Session invalid dan login gagal: ${retryLogin.msg || 'unknown error'}`);
                    }
                } else {
                    throw new Error('Session token tidak valid. Gunakan sessionId baru atau login via email+password.');
                }
            }

            const result = await client.chat(prompt, { 
                conversationId, 
                botUid, 
                language, 
                locale 
            });

            return {
                success: true,
                author: 'PuruBoy',
                result: result.content,
                follow_suggestions: result.followSuggestions,
                session_id: client.sessionId,
                metadata: {
                    finished: result.finished,
                    raw_messages_count: result.rawMessages.length
                }
            };
        }
    }
};

module.exports = monicaController;
