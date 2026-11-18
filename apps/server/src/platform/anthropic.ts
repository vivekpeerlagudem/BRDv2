/**
 * Anthropic driver for the AiProvider port (official SDK, Messages API).
 *  - No tools, no prefill, no forced tool choice: the model can only return text (ADR-042).
 *  - Structured output: the caller's JSON Schema is sent as `output_config.format`.
 *  - SDK retries are OFF (maxRetries: 0) — the AI engine owns retry policy so attempts are counted and logged once.
 *  - Never constructed unless AI_PROVIDER=anthropic AND a key is present. Automated tests inject a fake `client`;
 *    no test makes a network call.
 */
import Anthropic from '@anthropic-ai/sdk';
import { type AiProvider, AiProviderError, type AiProviderStatus, type AiRequest, type AiResult } from './ports.ts';

/** The one SDK method the driver uses — lets tests substitute a recorded-response client. */
export interface AnthropicMessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number; maxRetries?: number }): Promise<Anthropic.Message>;
  };
}

const retryAfterMs = (error: InstanceType<typeof Anthropic.APIError>): number | undefined => {
  const header = error.headers?.get('retry-after');
  const seconds = header ? Number(header) : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 30_000) : undefined;
};

/** Maps SDK errors to the port's error type. Most specific classes first. */
export function mapAnthropicError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('timeout', 'The AI provider did not answer in time');
  if (error instanceof Anthropic.APIConnectionError) return new AiProviderError('network', 'Could not reach the AI provider');
  if (error instanceof Anthropic.APIError) {
    const base = { ...(error.status !== undefined ? { status: error.status } : {}), ...(error.requestID ? { providerRequestId: error.requestID } : {}) };
    if (error instanceof Anthropic.RateLimitError) {
      const wait = retryAfterMs(error);
      return new AiProviderError('rate_limited', 'The AI provider is rate limiting requests', {
        ...base,
        ...(wait !== undefined ? { retryAfterMs: wait } : {}),
      });
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return new AiProviderError('auth', 'The AI provider rejected the configured credential', base);
    }
    if (error.status === 529) return new AiProviderError('overloaded', 'The AI provider is overloaded', base);
    if (error.status === 408) return new AiProviderError('timeout', 'The AI provider timed out', base);
    if (error.status !== undefined && error.status >= 500) return new AiProviderError('server_error', 'The AI provider had an internal error', base);
    return new AiProviderError('bad_request', 'The AI provider rejected the request', base);
  }
  return new AiProviderError('network', 'Unexpected error while calling the AI provider');
}

export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly simulated = false;
  private readonly client: AnthropicMessagesClient | null;
  private readonly hasKey: boolean;

  constructor(opts: { apiKey?: string | undefined; client?: AnthropicMessagesClient }) {
    this.hasKey = Boolean(opts.apiKey) || Boolean(opts.client);
    this.client = opts.client ?? (opts.apiKey ? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 }) : null);
  }

  status(): AiProviderStatus {
    return {
      provider: this.name,
      simulated: false,
      configured: this.hasKey,
      detail: this.hasKey ? 'API key present (not verified — no test call is made)' : 'ANTHROPIC_API_KEY is not set',
    };
  }

  async complete(req: AiRequest): Promise<AiResult> {
    if (!this.client) throw new AiProviderError('auth', 'The AI provider is not configured');
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          // The system prompt is identical for every call of a feature, so it is the cacheable prefix.
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: req.user }],
          output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.jsonSchema } },
          metadata: { user_id: req.userRef },
        },
        { timeout: req.timeoutMs, maxRetries: 0 },
      );
    } catch (error) {
      throw mapAnthropicError(error);
    }
    const providerRequestId = (message as { _request_id?: string | null })._request_id ?? undefined;
    const ids = providerRequestId ? { providerRequestId } : {};
    // Stop reason is checked before the content is read (a refusal can carry partial or no text).
    if (message.stop_reason === 'refusal') throw new AiProviderError('refused', 'The AI provider declined this request', ids);
    if (message.stop_reason === 'max_tokens') throw new AiProviderError('truncated', 'The AI answer was cut off before it finished', ids);
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      text,
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      ...ids,
    };
  }
}
