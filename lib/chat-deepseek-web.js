/**
 * ChatDeepSeekWeb - Custom LangChain Chat Model di atas web chat.deepseek.com.
 *
 * Menerjemahkan input/output OpenAI-style <-> DeepSeek web:
 * - Input:  BaseMessage[] (System/Human/AI) -> prompt terflatten untuk /api/v0/chat/completion
 * - Output: SSE fragments THINK -> additional_kwargs.reasoning_content,
 *           RESPONSE -> content (kompatibel pola OpenAI/OpenRouter)
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, getBufferString } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { streamCompletion } from './deepseek-web.js';

/** Peta model OpenAI-style -> parameter DeepSeek web */
export const MODEL_CONFIG = {
  'deepseek-chat': { thinking: false, search: false },
  'deepseek-v3': { thinking: false, search: false },
  'deepseek-reasoner': { thinking: true, search: false },
  'deepseek-r1': { thinking: true, search: false },
};

function resolveModel(model) {
  return MODEL_CONFIG[model] ?? MODEL_CONFIG['deepseek-chat'];
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return String(content ?? '');
}

/**
 * Gabungkan daftar BaseMessage jadi satu prompt string.
 * - 1 pesan user tanpa system -> kirim apa adanya
 * - selain itu -> transkrip "Human:/AI:" dengan instruksi system di depan
 */
export function flattenToPrompt(messages) {
  const systemParts = messages.filter((m) => m.getType() === 'system').map((m) => textOf(m.content));
  const convo = messages.filter((m) => m.getType() !== 'system');

  if (!convo.length) return systemParts.join('\n\n');
  if (!systemParts.length && convo.length === 1 && convo[0].getType() === 'human') {
    return textOf(convo[0].content);
  }

  let transcript = getBufferString(convo);
  const lastType = convo.at(-1).getType();
  if (lastType === 'ai' && !transcript.endsWith('AI:')) {
    transcript += '\n\nAI:'; // minta lanjutan dari asisten
  }
  const preamble = systemParts.length
    ? `[System]\n${systemParts.join('\n\n')}\n\n`
    : '';
  return preamble + transcript;
}

export class ChatDeepSeekWeb extends BaseChatModel {
  static lc_name() {
    return 'ChatDeepSeekWeb';
  }

  model = 'deepseek-chat';

  constructor(fields = {}) {
    super(fields ?? {});
    this.model = fields.model ?? 'deepseek-chat';
    this.searchEnabled = fields.searchEnabled ?? false;
  }

  _llmType() {
    return 'deepseek_web';
  }

  /**
   * @param {Array<{type:'reasoning'|'content',text:string}>} deltas
   */
  async *_iterDeltas(messages, options) {
    const cfg = resolveModel(this.model);
    yield* streamCompletion({
      prompt: flattenToPrompt(messages),
      thinkingEnabled: cfg.thinking,
      searchEnabled: this.searchEnabled || cfg.search,
    });
  }

  async _generate(messages, _options, _runManager) {
    let content = '';
    let reasoning = '';
    for await (const d of this._iterDeltas(messages, _options)) {
      if (d.type === 'reasoning') reasoning += d.text;
      else content += d.text;
    }
    const message = new AIMessage({
      content,
      additional_kwargs: reasoning ? { reasoning_content: reasoning } : {},
      response_metadata: { model: this.model, provider: 'deepseek-web' },
    });
    return { generations: [{ text: content, message }], llmOutput: {} };
  }

  async *_streamResponseChunks(messages, options, runManager) {
    for await (const d of this._iterDeltas(messages, options)) {
      const chunk =
        d.type === 'reasoning'
          ? new AIMessageChunk({ content: '', additional_kwargs: { reasoning_content: d.text } })
          : new AIMessageChunk({ content: d.text });
      yield new ChatGenerationChunk({ text: d.type === 'content' ? d.text : '', message: chunk });
      void runManager;
    }
  }

  /** JSON serializable representation untuk /models dsb. */
  get info() {
    return { model: this.model, ...resolveModel(this.model), provider: 'deepseek.com/web' };
  }
}

export default ChatDeepSeekWeb;
