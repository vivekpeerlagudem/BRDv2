/**
 * AI provider drivers for the tool conversation (`converse`). No network: the OpenAI-compatible driver gets a fake
 * `fetch` with recorded responses, the Anthropic driver a fake client, and the mock runs as it does in development.
 */
import { describe, expect, it } from 'vitest';
import { AnthropicAiProvider, type AnthropicMessagesClient } from './anthropic.ts';
import { MockAiProvider } from './mock-ai.ts';
import { type FetchLike, OpenAiCompatibleProvider, simplifySchema, toWireMessages } from './openai-compatible.ts';
import type { AiConverseRequest, AiMessage } from './ports.ts';

const KEY = 'test-key-not-real-0123456789';
const TOOLS = [
  {
    name: 'list_deals',
    description: 'Lists deals the user may see',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['open', 'won', 'lost'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        since: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
      },
    },
  },
];
const request = (over: Partial<AiConverseRequest> = {}): AiConverseRequest => ({
  requestId: '00000000-0000-4000-8000-000000000001',
  feature: 'copilot_chat',
  model: 'test-model',
  effort: 'low',
  maxTokens: 1000,
  timeoutMs: 5000,
  system: 'You are the CRM assistant.',
  tools: TOOLS,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'How many open deals?' }] }],
  userRef: 'u_1',
  ...over,
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const sseBody = (chunks: unknown[]) => new Response([...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), 'data: [DONE]\n\n'].join(''), { status: 200 });

describe('OpenAI-compatible driver', () => {
  it('reduces a tool schema to the subset every provider accepts', () => {
    expect(simplifySchema(TOOLS[0]?.inputSchema)).toEqual({
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['open', 'won', 'lost'] },
        limit: { type: 'integer', description: '(min 1, max 50)' },
        since: { type: 'string', nullable: true, description: '(format: date)' },
      },
    });
  });

  it('writes tool results as "tool" messages and echoes provider extras on tool calls', () => {
    const history: AiMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Q' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'c1', name: 'list_deals', input: { status: 'open' }, meta: { extra_content: { google: { thought_signature: 'sig' } } } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', toolCallId: 'c1', name: 'list_deals', content: '{"count":3}' }] },
    ];
    expect(toWireMessages('SYS', history)).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'Q' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'list_deals', arguments: '{"status":"open"}' },
            extra_content: { google: { thought_signature: 'sig' } },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"count":3}' },
    ]);
  });

  it('accepts a fractional time limit (the loop computes it from performance.now())', async () => {
    const fetchFake: FetchLike = async () =>
      json({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: 'OK' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const provider = new OpenAiCompatibleProvider({ baseUrl: 'https://llm.example/v1/', apiKey: KEY, fetch: fetchFake });
    await expect(provider.converse(request({ timeoutMs: 59_972.0259 }))).resolves.toMatchObject({ stopReason: 'end' });
  });

  it('sends the key only in the Authorization header and maps a tool-call answer', async () => {
    const seen: { url: string; headers: Record<string, string>; body: any }[] = [];
    const fetchFake: FetchLike = async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return json(
        {
          model: 'test-model-001',
          choices: [{ finish_reason: 'stop', message: { content: null, tool_calls: [{ function: { name: 'list_deals', arguments: '{"status":"open"}' } }] } }],
          usage: { prompt_tokens: 120, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 100 } },
        },
        200,
        { 'x-request-id': 'req_1' },
      );
    };
    const provider = new OpenAiCompatibleProvider({ baseUrl: 'https://llm.example/v1/', apiKey: KEY, fetch: fetchFake });
    const result = await provider.converse(request());
    expect(seen[0]?.url).toBe('https://llm.example/v1/chat/completions');
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(seen[0]?.body)).not.toContain(KEY);
    expect(seen[0]?.body.tools[0].function.parameters.additionalProperties).toBeUndefined();
    expect(result.stopReason).toBe('tool_calls'); // although the provider said "stop"
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: 'tool_call', name: 'list_deals', input: { status: 'open' } });
    expect((result.content[0] as { id: string }).id).toMatch(/^call_/); // the provider sent no id
    expect(result).toMatchObject({ model: 'test-model-001', inputTokens: 20, cacheReadTokens: 100, outputTokens: 9, providerRequestId: 'req_1' });
  });

  it('streams text deltas and assembles tool-call fragments by index', async () => {
    const deltas: string[] = [];
    const fetchFake: FetchLike = async (_url, init) => {
      expect(JSON.parse(init.body).stream).toBe(true);
      return sseBody([
        { model: 'm', choices: [{ delta: { content: 'You have ' } }] },
        { choices: [{ delta: { content: '3 open deals.' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'list_deals', arguments: '{"sta' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tus":"won"}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 50, completion_tokens: 12 } },
      ]);
    };
    const provider = new OpenAiCompatibleProvider({ baseUrl: 'https://llm.example/v1', apiKey: KEY, fetch: fetchFake });
    const result = await provider.converse(request({ onTextDelta: (t) => deltas.push(t) }));
    expect(deltas).toEqual(['You have ', '3 open deals.']);
    expect(result.content).toEqual([
      { type: 'text', text: 'You have 3 open deals.' },
      { type: 'tool_call', id: 'call_a', name: 'list_deals', input: { status: 'won' } },
    ]);
    expect(result).toMatchObject({ stopReason: 'tool_calls', inputTokens: 50, outputTokens: 12 });
  });

  it.each([
    [401, 'auth', false],
    [429, 'rate_limited', true],
    [500, 'server_error', true],
    [503, 'overloaded', true],
    [400, 'bad_request', false],
  ] as const)('maps HTTP %i to %s without leaking the key or the response body', async (status, kind, retryable) => {
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://llm.example/v1',
      apiKey: KEY,
      fetch: async () => json({ error: { message: `bad key ${KEY}` } }, status, { 'retry-after': '2' }),
    });
    const error = await provider.converse(request()).catch((e) => e);
    expect(error).toMatchObject({ name: 'AiProviderError', kind, retryable, status });
    expect(String(error.message)).not.toContain(KEY);
    if (kind === 'rate_limited') expect(error.retryAfterMs).toBe(2000);
  });

  it('reports a network failure and a missing configuration as provider errors', async () => {
    const down = new OpenAiCompatibleProvider({
      baseUrl: 'https://llm.example/v1',
      apiKey: KEY,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(down.converse(request())).rejects.toMatchObject({ kind: 'network', retryable: true });
    const unset = new OpenAiCompatibleProvider({});
    expect(unset.status().configured).toBe(false);
    await expect(unset.converse(request())).rejects.toMatchObject({ kind: 'auth' });
  });

  it('marks unparseable tool arguments instead of guessing', async () => {
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://llm.example/v1',
      apiKey: KEY,
      fetch: async () =>
        json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'x', function: { name: 'list_deals', arguments: '{"status":' } }] } }] }),
    });
    const result = await provider.converse(request());
    expect(result.content[0]).toMatchObject({ type: 'tool_call', input: { __invalid_json: '{"status":' } });
  });
});

describe('Anthropic driver: converse', () => {
  it('sends tools and messages in the Messages API shape and maps tool_use blocks', async () => {
    const bodies: any[] = [];
    const client = {
      messages: {
        create: async (body: any) => {
          bodies.push(body);
          return {
            model: 'claude-test',
            stop_reason: 'tool_use',
            content: [
              { type: 'text', text: 'Checking.' },
              { type: 'tool_use', id: 'toolu_1', name: 'list_deals', input: { status: 'open' } },
            ],
            usage: { input_tokens: 30, output_tokens: 8, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 },
          };
        },
      },
    } as unknown as AnthropicMessagesClient;
    const history: AiMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Q' }] },
      { role: 'assistant', content: [{ type: 'tool_call', id: 'toolu_0', name: 'list_deals', input: { status: 'won' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolCallId: 'toolu_0', name: 'list_deals', content: '{"count":1}', isError: false }] },
    ];
    const result = await new AnthropicAiProvider({ client }).converse(request({ messages: history }));
    expect(bodies[0].tools[0]).toMatchObject({ name: 'list_deals', input_schema: { type: 'object' } });
    expect(bodies[0].tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(bodies[0].messages[1].content[0]).toEqual({ type: 'tool_use', id: 'toolu_0', name: 'list_deals', input: { status: 'won' } });
    expect(bodies[0].messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_0', content: '{"count":1}' });
    expect(bodies[0].tool_choice).toBeUndefined(); // forced tool choice is rejected by current models
    expect(result.stopReason).toBe('tool_calls');
    expect(result.content).toEqual([
      { type: 'text', text: 'Checking.' },
      { type: 'tool_call', id: 'toolu_1', name: 'list_deals', input: { status: 'open' } },
    ]);
    expect(result).toMatchObject({ inputTokens: 30, outputTokens: 8, cacheReadTokens: 400 });
  });

  it('streams text through the SDK stream helper when a delta handler is given', async () => {
    const deltas: string[] = [];
    const final = { model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Three.' }], usage: { input_tokens: 5, output_tokens: 2 } };
    const client = {
      messages: {
        create: async () => final,
        stream: () => ({
          on(event: string, handler: (t: string) => void) {
            if (event === 'text') {
              handler('Thr');
              handler('ee.');
            }
            return this;
          },
          finalMessage: async () => final,
        }),
      },
    } as unknown as AnthropicMessagesClient;
    const result = await new AnthropicAiProvider({ client }).converse(request({ onTextDelta: (t) => deltas.push(t) }));
    expect(deltas).toEqual(['Thr', 'ee.']);
    expect(result).toMatchObject({ stopReason: 'end', content: [{ type: 'text', text: 'Three.' }] });
  });

  it('reports a refusal as a stop reason, not as content', async () => {
    const client = {
      messages: { create: async () => ({ model: 'c', stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }) },
    } as unknown as AnthropicMessagesClient;
    expect((await new AnthropicAiProvider({ client }).converse(request())).stopReason).toBe('refusal');
  });
});

describe('Mock provider: converse', () => {
  it('plays scripted steps in order, then falls back to its own answer', async () => {
    const mock = new MockAiProvider();
    mock.enqueueConverse({ toolCalls: [{ name: 'list_deals', input: { status: 'open' } }] }, { text: 'You have 3 open deals.' });
    const first = await mock.converse(request());
    expect(first.stopReason).toBe('tool_calls');
    expect(first.content[0]).toMatchObject({ type: 'tool_call', name: 'list_deals', input: { status: 'open' } });
    const deltas: string[] = [];
    const second = await mock.converse(request({ onTextDelta: (t) => deltas.push(t) }));
    expect(second).toMatchObject({ stopReason: 'end', content: [{ type: 'text', text: 'You have 3 open deals.' }] });
    expect(deltas.join('')).toBe('You have 3 open deals.');
    expect(mock.converseCalls).toHaveLength(2);
    const third = await mock.converse(request({ tools: [] }));
    expect(third.stopReason).toBe('end');
    expect(third.content[0]?.type).toBe('text');
  });

  it('can be slowed down and can fail on demand', async () => {
    const mock = new MockAiProvider();
    mock.delayMs = 30;
    mock.enqueueConverse({ text: 'ok' });
    const started = performance.now();
    await mock.converse(request());
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
    mock.delayMs = 0;
    const { AiProviderError } = await import('./ports.ts');
    mock.enqueueConverse(new AiProviderError('overloaded', 'busy'));
    await expect(mock.converse(request())).rejects.toMatchObject({ kind: 'overloaded' });
  });
});
