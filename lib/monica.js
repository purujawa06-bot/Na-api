/**
 * Monica AI Client - Upgraded with Auto Login & Auto Refresh
 * =========================================================
 * Fitur:
 * - Chat dengan session token (existing)
 * - Login via email/password (login_by_email_v2)
 * - Register akun baru (register_by_email)
 * - One-step login (Google/Apple)
 * - Auto-refresh token saat 401/expired
 * - Token management otomatis
 */

class MonicaClient {
  /**
   * @param {string} sessionId - JWT token dari session_id cookie
   * @param {Object} options
   * @param {string} [options.clientId] - x-client-id header
   * @param {string} [options.email] - Email for auto-login
   * @param {string} [options.password] - Password for auto-login
   * @param {boolean} [options.autoRefresh] - Auto refresh on 401 (default: true)
   */
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.baseUrl = "https://api.monica.im";
    this.options = options;
    this.autoRefresh = options.autoRefresh !== undefined ? options.autoRefresh : true;
    
    // Credentials for auto-refresh
    this._email = options.email || '';
    this._password = options.password || '';

    this.defaultHeaders = {
      "user-agent": "Mozilla/5.0 (Linux; Android 12; SM-F936U Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36",
      "x-client-locale": "en",
      "x-client-version": "5.13.7",
      "x-product-name": "monica-app",
      "cookie": `session_id=${this.sessionId}`,
      "accept-encoding": "gzip",
      "host": "api.monica.im",
      "content-type": "application/json",
      "x-time-zone": "Asia/Makassar;-480",
      "x-client-id": options.clientId || "d2f7fbaf-4450-4f3e-8f63-87c61cccd155",
      "x-client-type": "android"
    };
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /** Update session ID after login/refresh */
  _updateSession(newSessionId) {
    this.sessionId = newSessionId;
    this.defaultHeaders["cookie"] = `session_id=${this.sessionId}`;
  }

  /** Auto-refresh wrapper: if 401 or permission error, try to re-login */
  async _request(url, method = 'POST', body = null, retried = false) {
    const options = {
      method,
      headers: { ...this.defaultHeaders },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${this.baseUrl}${url}`, options);

    // Check HTTP error
    if (!response.ok) {
      if ((response.status === 401) && this.autoRefresh && !retried && this._email && this._password) {
        console.log('[Monica] ⚠️ HTTP 401, auto-refresh...');
        await this.login(this._email, this._password);
        return this._request(url, method, body, true);
      }
      
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    // For chat endpoint, also check body for code !== 0 (e.g. permission error)
    if (url.includes('/chat') || url.includes('/custom_bot')) {
      const clone = response.clone();
      const text = await clone.text();
      
      // Check if it's a JSON error response (not SSE)
      if (text.startsWith('{')) {
        try {
          const errData = JSON.parse(text);
          if (errData.code === 403 && errData.msg === 'permission error') {
            if (this.autoRefresh && !retried && this._email && this._password) {
              console.log('[Monica] ⚠️ Permission error (token invalid), auto-refresh...');
              await this.login(this._email, this._password);
              return this._request(url, method, body, true);
            }
            throw new Error(`Permission error: ${errData.msg}`);
          }
          if (errData.code && errData.code !== 0) {
            throw new Error(`API error ${errData.code}: ${errData.msg || JSON.stringify(errData)}`);
          }
        } catch(e) {
          if (e.message.includes('Permission error') || e.message.includes('API error')) throw e;
          // If it's valid JSON but not an error, it's fine
        }
      }
    }

    return response;
  }

  // ============================
  // AUTHENTICATION METHODS
  // ============================

  /**
   * Login via email & password
   * Endpoint: POST /api/user/login_by_email_v2
   * @param {string} email
   * @param {string} password
   * @param {string} [inviteCode='']
   * @returns {Promise<Object>} response data with session_id token in Set-Cookie
   */
  async login(email, password, inviteCode = '') {
    const response = await fetch(`${this.baseUrl}/api/user/login_by_email_v2`, {
      method: 'POST',
      headers: {
        "content-type": "application/json",
        "x-client-locale": "en",
        "x-client-version": "5.13.7",
        "x-product-name": "monica-app",
        "x-client-id": this.options.clientId || "d2f7fbaf-4450-4f3e-8f63-87c61cccd155",
        "x-client-type": "android",
        "user-agent": this.defaultHeaders["user-agent"],
        "x-time-zone": "Asia/Makassar;-480"
      },
      body: JSON.stringify({
        email,
        password,
        invite_code: inviteCode,
        recaptcha_token: ''
      })
    });

    const data = await response.json();

    if (data.code === 0) {
      // Extract session_id from Set-Cookie header
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/session_id=([^;]+)/);
        if (match && match[1]) {
          this._updateSession(match[1]);
        }
      }
      // Also check response body for token
      if (data.session_id) {
        this._updateSession(data.session_id);
      }
      if (data.token) {
        this._updateSession(data.token);
      }
      
      // Save credentials for auto-refresh
      this._email = email;
      this._password = password;
    }

    return data;
  }

  /**
   * Register new account
   * Endpoint: POST /api/user/register_by_email
   * @param {string} email
   * @param {string} password
   * @param {Object} [options]
   * @param {string} [options.inviteCode='']
   * @param {string} [options.recaptchaToken='']
   * @param {string} [options.locale='en']
   * @returns {Promise<Object>} response data
   */
  async register(email, password, options = {}) {
    const response = await fetch(`${this.baseUrl}/api/user/register_by_email`, {
      method: 'POST',
      headers: {
        "content-type": "application/json",
        "x-client-locale": "en",
        "x-client-version": "5.13.7",
        "x-product-name": "monica-app",
        "x-client-id": this.options.clientId || "d2f7fbaf-4450-4f3e-8f63-87c61cccd155",
        "x-client-type": "android",
        "user-agent": this.defaultHeaders["user-agent"],
        "x-time-zone": "Asia/Makassar;-480"
      },
      body: JSON.stringify({
        email,
        password,
        invite_code: options.inviteCode || '',
        recaptcha_token: options.recaptchaToken || '',
        locale: options.locale || 'en'
      })
    });

    const data = await response.json();

    if (data.code === 0) {
      // Auto login after successful register
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/session_id=([^;]+)/);
        if (match && match[1]) {
          this._updateSession(match[1]);
        }
      }
      if (data.session_id) {
        this._updateSession(data.session_id);
      }
      if (data.token) {
        this._updateSession(data.token);
      }
      
      this._email = email;
      this._password = password;
    }

    return data;
  }

  /**
   * One-step login (Google/Apple/OAuth)
   * Endpoint: POST /api/user/one_step_login
   * @param {string} credential - OAuth token or credential string
   * @param {string} selectBy - 'google', 'apple', 'email', etc.
   * @returns {Promise<Object>}
   */
  async oneStepLogin(credential, selectBy) {
    const response = await fetch(`${this.baseUrl}/api/user/one_step_login`, {
      method: 'POST',
      headers: {
        "content-type": "application/json",
        "x-client-locale": "en",
        "x-client-version": "5.13.7",
        "x-product-name": "monica-app",
        "x-client-id": this.options.clientId || "d2f7fbaf-4450-4f3e-8f63-87c61cccd155",
        "x-client-type": "android",
        "user-agent": this.defaultHeaders["user-agent"],
        "x-time-zone": "Asia/Makassar;-480"
      },
      body: JSON.stringify({
        credential,
        select_by: selectBy
      })
    });

    const data = await response.json();

    if (data.code === 0) {
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/session_id=([^;]+)/);
        if (match && match[1]) {
          this._updateSession(match[1]);
        }
      }
      if (data.session_id) {
        this._updateSession(data.session_id);
      }
      if (data.token) {
        this._updateSession(data.token);
      }
    }

    return data;
  }

  /**
   * Check current token validity
   * Endpoint: GET /api/user/me
   * @returns {Promise<Object>} user info
   */
  async checkSession() {
    const response = await this._request('/api/user/me', 'GET');
    return response.json();
  }

  /**
   * Get user info
   * @returns {Promise<Object>}
   */
  async getUserInfo() {
    const data = await this.checkSession();
    if (data.code === 0 && data.user) {
      return data.user;
    }
    return null;
  }

  // ============================
  // CHAT METHODS
  // ============================

  /**
   * Send chat message to Monica AI
   * @param {string} message
   * @param {Object} [options]
   * @param {string} [options.conversationId]
   * @param {string} [options.botUid='monica']
   * @param {boolean} [options.isIncognito=false]
   * @param {boolean} [options.useMemorySuggestion=true]
   * @param {string} [options.useModel='']
   * @param {boolean} [options.useNewMemory=true]
   * @param {string} [options.language='auto']
   * @param {string} [options.locale='en']
   * @returns {Promise<Object>} parsed chat response
   */
  async chat(message, options = {}) {
    try {
      const conversationId = options.conversationId || `conv:${this.generateUUID()}`;
      const botUid = options.botUid || "monica";
      const replyItemId = `item:${this.generateUUID()}`;
      const questionItemId = `item:${this.generateUUID()}`;
      const preGeneratedReplyId = `item:${this.generateUUID()}`;
      const taskUid = `task:${this.generateUUID()}`;

      const requestBody = {
        bot_uid: botUid,
        data: {
          conversation_id: conversationId,
          is_incognito: options.isIncognito || false,
          items: [
            {
              data: { type: "text", content: "" },
              item_id: replyItemId,
              item_type: "reply",
              parent_item_id: "_root_",
              summary: ""
            },
            {
              data: { content: message, type: "text" },
              item_id: questionItemId,
              item_type: "question",
              parent_item_id: replyItemId,
              summary: ""
            }
          ],
          pre_generated_reply_id: preGeneratedReplyId,
          pre_parent_item_id: questionItemId,
          use_memory_suggestion: options.useMemorySuggestion !== undefined ? options.useMemorySuggestion : true,
          use_model: options.useModel || "",
          use_new_memory: options.useNewMemory !== undefined ? options.useNewMemory : true
        },
        language: options.language || "auto",
        locale: options.locale || "en",
        task_type: "chat_with_custom_bot",
        task_uid: taskUid,
        tool_data: { sys_skill_list: [] }
      };

      const response = await this._request('/api/custom_bot/chat', 'POST', requestBody);

      return await this._processChatResponse(response);

    } catch (error) {
      console.error("[Monica] Error in chat:", error.message);
      throw error;
    }
  }

  /**
   * Process SSE (Server-Sent Events) response
   * @param {Response} response
   * @returns {Promise<Object>}
   * @private
   */
  async _processChatResponse(response) {
    const text = await response.text();
    const lines = text.split('\n');

    let fullContent = "";
    let followSuggestions = [];
    let finished = false;
    const rawMessages = [];

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith('data:')) {
        line = line.substring(5).trim();
      }
      if (!line) continue;

      try {
        const json = JSON.parse(line);
        rawMessages.push(json);

        if (json.text) {
          fullContent += json.text;
        }

        if (json.follow_suggestions && Array.isArray(json.follow_suggestions)) {
          followSuggestions = json.follow_suggestions;
        }

        if (json.finished === true) {
          finished = true;
        }
      } catch (e) {
        console.warn("[Monica] Failed to parse SSE line:", line);
      }
    }

    return {
      content: fullContent,
      followSuggestions,
      finished,
      rawMessages,
      rawResponse: text
    };
  }
}

module.exports = MonicaClient;
