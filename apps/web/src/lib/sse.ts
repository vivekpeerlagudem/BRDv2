/**
 * A tiny Server-Sent Events reader for POST requests (EventSource only does GET). It reads the response body as a
 * stream and calls `onEvent` for every complete event block. Used by the Copilot panel.
 */
export interface StreamEvent {
  event: string;
  // biome-ignore lint/suspicious/noExplicitAny: event payloads are typed by the caller per event name
  data: any;
}

/** Splits a buffer into complete event blocks; returns the parsed events and the unfinished rest. */
export function parseSseChunk(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    const raw = data.join('\n');
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {}
    events.push({ event, data: parsed });
  }
  return { events, rest };
}

export async function postStream(path: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    const problem = (await res.json().catch(() => null)) as { title?: string; code?: string } | null;
    onEvent({ event: 'error', data: { code: problem?.code ?? 'UNKNOWN', message: problem?.title ?? `Request failed (${res.status})` } });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseSseChunk(buffer + value);
    buffer = parsed.rest;
    for (const e of parsed.events) onEvent(e);
  }
  if (buffer.trim()) for (const e of parseSseChunk(`${buffer}\n\n`).events) onEvent(e);
}
