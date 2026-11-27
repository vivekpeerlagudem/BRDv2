import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSseChunk, postStream, type StreamEvent } from './sse.ts';

describe('SSE reader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses complete blocks and keeps the unfinished rest', () => {
    const r = parseSseChunk('event: status\ndata: {"text":"Thinking…"}\n\nevent: delta\ndata: {"text":"Hi"}\n\nevent: del');
    expect(r.events).toEqual([
      { event: 'status', data: { text: 'Thinking…' } },
      { event: 'delta', data: { text: 'Hi' } },
    ]);
    expect(r.rest).toBe('event: del');
  });

  it('reads a streamed response split at awkward places', async () => {
    const parts = ['event: delta\nda', 'ta: {"text":"Hel"}\n', '\nevent: done\ndata: {"answer":"Hello"}\n\n'];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    );
    const seen: StreamEvent[] = [];
    await postStream('/api/v1/copilot/conversations/x/turns', { message: 'hi' }, (e) => seen.push(e));
    expect(seen.map((e) => e.event)).toEqual(['delta', 'done']);
    expect(seen[1]?.data.answer).toBe('Hello');
  });

  it('turns an HTTP error into an error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 'NOT_FOUND', title: 'Conversation not found' }), { status: 404 })),
    );
    const seen: StreamEvent[] = [];
    await postStream('/x', {}, (e) => seen.push(e));
    expect(seen).toEqual([{ event: 'error', data: { code: 'NOT_FOUND', message: 'Conversation not found' } }]);
  });
});
