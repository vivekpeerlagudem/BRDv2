/**
 * OpenAI-compatible driver for the AiProvider port (Chat Completions wire format over plain `fetch` — no SDK).
 * Works with any endpoint that speaks that format: OpenAI, Gemini's OpenAI endpoint, OpenRouter, Groq, Ollama.
 *  - The base URL and key come from configuration only; the key is sent in the Authorization header and is never
 *    logged, echoed or put into an error message.
 *  - Tool schemas are reduced to the JSON Schema subset every such provider accepts (see `simplifySchema`); the
 *    server validates tool input itself with Zod, so nothing is lost.
 *  - Streaming: text deltas are forwarded as they arrive; tool-call fragments are assembled by index.
 *  - Retries are OFF here: the caller owns retry policy so attempts are counted once.
 * Automated tests inject a fake `fetch`; no test makes a network call.
 */
import { randomUUID } from 'node:crypto';
import {
  type AiContentBlock,
  type AiConverseRequest,
  type AiConverseResult,
  type AiMessage,
  type AiProvider,
  AiProviderError,
  type AiProviderStatus,
  type AiRequest,
  type AiResult,
  type AiStopReason,
} from './ports.ts';

type Json = Record<string, unknown>;
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;

const KEEP = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'nullable']);
/**
 * Reduces a JSON Schema to the subset that OpenAI-compatible providers share. Drops `$schema`, `additionalProperties`,
 * `default`, formats, patterns and numeric/length limits; turns `anyOf: [X, null]` and `type: [X, "null"]` into a
 * nullable X; describes a dropped constraint in the description so the model still sees it.
 */
export function simplifySchema(schema: unknown): Json {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'string' };
  const src = schema as Json;
  const variants = (src.anyOf ?? src.oneOf) as Json[] | undefined;
  if (Array.isArray(variants)) {
    const real = variants.filter((v) => v && (v as Json).type !== 'null');
    const out = simplifySchema(real[0] ?? { type: 'string' });
    if (real.length < variants.length) out.nullable = true;
    if (typeof src.description === 'string' && !out.description) out.description = src.description;
    return out;
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(src)) {
    if (!KEEP.has(key)) continue;
    if (key === 'type' && Array.isArray(value)) {
      const real = value.filter((t) => t !== 'null');
      out.type = real[0] ?? 'string';
      if (real.length < value.length) out.nullable = true;
    } else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, simplifySchema(v)]));
    } else if (key === 'items') out.items = simplifySchema(value);
    else out[key] = value;
  }
  if (src.const !== undefined && out.enum === undefined) out.enum = [src.const];
  if (out.type === undefined) out.type = out.properties ? 'object' : out.enum ? 'string' : 'string';
  const hints: string[] = [];
  if (typeof src.format === 'string') hints.push(`format: ${src.format}`);
  if (typeof src.maxLength === 'number') hints.push(`max ${src.maxLength} characters`);
  if (typeof src.minimum === 'number') hints.push(`min ${src.minimum}`);
  if (typeof src.maximum === 'number') hints.push(`max ${src.maximum}`);
  if (typeof src.maxItems === 'number') hints.push(`at most ${src.maxItems} items`);
  if (hints.length) out.description = [out.description, `(${hints.join(', ')})`].filter(Boolean).join(' ');
  return out;
}

/** Internal messages → Chat Completions messages. Opaque provider data on a tool call (`meta`) is echoed back unchanged. */
export function toWireMessages(system: string, messages: AiMessage[]): Json[] {
  const out: Json[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content
        .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const calls = m.content.filter((b): b is Extract<AiContentBlock, { type: 'tool_call' }> => b.type === 'tool_call');
      const msg: Json = { role: 'assistant', content: text || null };
      if (calls.length)
        msg.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) }, ...(c.meta ?? {}) }));
      out.push(msg);
      continue;
    }
    // A user turn: tool results first (each is its own "tool" message), then any text.
    for (const b of m.content) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolCallId, content: b.content });
    const text = m.content
      .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

const STOP: Record<string, AiStopReason> = {
  stop: 'end',
  tool_calls: 'tool_calls',
  function_call: 'tool_calls',
  length: 'max_tokens',
  content_filter: 'refusal',
};

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    // Unparseable arguments are passed on as-is under a marker; the loop's Zod validation then rejects the call.
    return { __invalid_json: raw.slice(0, 500) };
  }
}

export function mapHttpError(status: number, retryAfter: string | null, requestId?: string): AiProviderError {
  const base = { status, ...(requestId ? { providerRequestId: requestId } : {}) };
  if (status === 401 || status === 403) return new AiProviderError('auth', 'The AI provider rejected the configured credential', base);
  if (status === 429) {
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    const wait = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 60_000) : undefined;
    return new AiProviderError('rate_limited', 'The AI provider is rate limiting requests', { ...base, ...(wait !== undefined ? { retryAfterMs: wait } : {}) });
  }
  if (status === 408) return new AiProviderError('timeout', 'The AI provider timed out', base);
  if (status === 529 || status === 503) return new AiProviderError('overloaded', 'The AI provider is overloaded', base);
  if (status >= 500) return new AiProviderError('server_error', 'The AI provider had an internal error', base);
  return new AiProviderError('bad_request', 'The AI provider rejected the request', base);
}

interface Options {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  /** Model used when a request names a model of another provider family (e.g. the claude-* defaults of older features). */
  defaultModel?: string | undefined;
  reasoningEffort?: string | undefined;
  fetch?: FetchLike;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai';
  readonly simulated = false;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly defaultModel: string | undefined;
  private readonly reasoningEffort: string | undefined;
  private readonly fetchImpl: FetchLike;

  constructor(opts: Options) {
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.defaultModel;
    this.reasoningEffort = opts.reasoningEffort;
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  status(): AiProviderStatus {
    const configured = Boolean(this.baseUrl && this.apiKey);
    let host = 'not set';
    try {
      host = new URL(this.baseUrl).host;
    } catch {}
    return {
      provider: this.name,
      simulated: false,
      configured,
      detail: configured ? `OpenAI-compatible endpoint ${host}; API key present (not verified — no test call is made)` : 'AI_BASE_URL or AI_API_KEY is not set',
    };
  }

  private model(requested: string): string {
    return /^claude-/.test(requested) && this.defaultModel ? this.defaultModel : requested;
  }

  private async post(body: Json, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
    if (!this.baseUrl || !this.apiKey) throw new AiProviderError('auth', 'The AI provider is not configured');
    const timeout = AbortSignal.timeout(Math.max(1, Math.round(timeoutMs))); // must be a whole number of ms
    const signal = outer ? AbortSignal.any([timeout, outer]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new AiProviderError('timeout', 'The AI provider did not answer in time');
      throw new AiProviderError('network', 'Could not reach the AI provider');
    }
    if (!res.ok) {
      // The response body is NOT included: it can echo request content. Status and request id are enough to diagnose.
      try {
        await res.body?.cancel();
      } catch {}
      throw mapHttpError(res.status, res.headers.get('retry-after'), res.headers.get('x-request-id') ?? undefined);
    }
    return res;
  }

  private baseBody(model: string, maxTokens: number): Json {
    const body: Json = { model };
    // OpenAI's own API takes max_completion_tokens; the compatible endpoints take max_tokens.
    if (/api\.openai\.com/.test(this.baseUrl)) body.max_completion_tokens = maxTokens;
    else body.max_tokens = maxTokens;
    if (this.reasoningEffort) body.reasoning_effort = this.reasoningEffort;
    return body;
  }

  async complete(req: AiRequest): Promise<AiResult> {
    const model = this.model(req.model);
    const res = await this.post(
      {
        ...this.baseBody(model, req.maxTokens),
        messages: [
          { role: 'system', content: `${req.system}\n\nReply with one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(req.jsonSchema)}` },
          { role: 'user', content: req.user },
        ],
        response_format: { type: 'json_object' },
      },
      req.timeoutMs,
    );
    const requestId = res.headers.get('x-request-id') ?? undefined;
    const ids = requestId ? { providerRequestId: requestId } : {};
    let data: Json;
    try {
      data = (await res.json()) as Json;
    } catch {
      throw new AiProviderError('server_error', 'The AI provider returned an unreadable answer', ids);
    }
    const choice = ((data.choices as Json[] | undefined) ?? [])[0] ?? {};
    const finish = String(choice.finish_reason ?? 'stop');
    if (finish === 'content_filter') throw new AiProviderError('refused', 'The AI provider declined this request', ids);
    if (finish === 'length') throw new AiProviderError('truncated', 'The AI answer was cut off before it finished', ids);
    const usage = (data.usage ?? {}) as Json;
    const cached = Number(((usage.prompt_tokens_details ?? {}) as Json).cached_tokens ?? 0);
    return {
      text: String(((choice.message ?? {}) as Json).content ?? ''),
      model: String(data.model ?? model),
      inputTokens: Math.max(0, Number(usage.prompt_tokens ?? 0) - cached),
      outputTokens: Number(usage.completion_tokens ?? 0),
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
      ...ids,
    };
  }

  async converse(req: AiConverseRequest): Promise<AiConverseResult> {
    const model = this.model(req.model);
    const stream = Boolean(req.onTextDelta);
    const body: Json = {
      ...this.baseBody(model, req.maxTokens),
      messages: toWireMessages(req.system, req.messages),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: simplifySchema(t.inputSchema) },
            })),
          }
        : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
    const res = await this.post(body, req.timeoutMs, req.signal);
    const requestId = res.headers.get('x-request-id') ?? undefined;
    const ids = requestId ? { providerRequestId: requestId } : {};

    let text = '';
    let finish = 'stop';
    let servedModel = model;
    let usage: Json = {};
    const calls = new Map<number, { id: string; name: string; args: string; meta: Json }>();
    const takeCalls = (list: unknown) => {
      if (!Array.isArray(list)) return;
      list.forEach((raw, position) => {
        const c = raw as Json;
        const index = typeof c.index === 'number' ? c.index : position;
        const fn = (c.function ?? {}) as Json;
        const cur = calls.get(index) ?? { id: '', name: '', args: '', meta: {} };
        if (typeof c.id === 'string' && c.id) cur.id = c.id;
        if (typeof fn.name === 'string' && fn.name) cur.name = fn.name;
        if (typeof fn.arguments === 'string') cur.args += fn.arguments;
        // Provider-specific extras (e.g. Gemini thought signatures) must be sent back with the call: keep them opaque.
        for (const [k, v] of Object.entries(c)) if (!['index', 'id', 'type', 'function'].includes(k)) cur.meta[k] = v;
        calls.set(index, cur);
      });
    };

    if (!stream) {
      let data: Json;
      try {
        data = (await res.json()) as Json;
      } catch {
        throw new AiProviderError('server_error', 'The AI provider returned an unreadable answer', ids);
      }
      const choice = ((data.choices as Json[] | undefined) ?? [])[0] ?? {};
      const message = (choice.message ?? {}) as Json;
      text = typeof message.content === 'string' ? message.content : '';
      takeCalls(message.tool_calls);
      finish = String(choice.finish_reason ?? 'stop');
      servedModel = String(data.model ?? model);
      usage = (data.usage ?? {}) as Json;
    } else {
      if (!res.body) throw new AiProviderError('server_error', 'The AI provider returned no stream', ids);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const handle = (line: string) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let chunk: Json;
        try {
          chunk = JSON.parse(payload) as Json;
        } catch {
          return;
        }
        if (typeof chunk.model === 'string') servedModel = chunk.model;
        if (chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage as Json;
        const choice = ((chunk.choices as Json[] | undefined) ?? [])[0];
        if (!choice) return;
        const delta = (choice.delta ?? {}) as Json;
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          req.onTextDelta?.(delta.content);
        }
        takeCalls(delta.tool_calls);
        if (choice.finish_reason) finish = String(choice.finish_reason);
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl = buffer.indexOf('\n');
          while (nl >= 0) {
            handle(buffer.slice(0, nl).trimEnd());
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf('\n');
          }
        }
        if (buffer.trim()) handle(buffer.trim());
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') throw new AiProviderError('timeout', 'The AI provider did not answer in time', ids);
        throw new AiProviderError('network', 'The connection to the AI provider was lost', ids);
      }
    }

    const content: AiContentBlock[] = [];
    if (text) content.push({ type: 'text', text });
    for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (!c.name) continue;
      content.push({
        type: 'tool_call',
        id: c.id || `call_${randomUUID().slice(0, 12)}`,
        name: c.name,
        input: parseArgs(c.args),
        ...(Object.keys(c.meta).length ? { meta: c.meta } : {}),
      });
    }
    const hasCalls = content.some((b) => b.type === 'tool_call');
    const cached = Number(((usage.prompt_tokens_details ?? {}) as Json).cached_tokens ?? 0);
    return {
      content,
      // Some compatible providers report "stop" even when they return tool calls.
      stopReason: hasCalls ? 'tool_calls' : (STOP[finish] ?? 'end'),
      model: servedModel,
      inputTokens: Math.max(0, Number(usage.prompt_tokens ?? 0) - cached),
      outputTokens: Number(usage.completion_tokens ?? 0),
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
      ...ids,
    };
  }
}
