/**
 * Kensium Copilot side panel — available on every page, opened from the rail next to the notification bell.
 * It sends the record that is open on screen as context, streams the answer (SSE), shows tool status lines while
 * the Copilot works, and lists the records it used as source chips. Links come only from server-resolved
 * aliases: the model's text is shown as plain text, never as HTML, images or links.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { Bot, CircleAlert, LoaderCircle, Plus, SendHorizontal, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { post } from '../lib/api.ts';
import { postStream, type StreamEvent } from '../lib/sse.ts';
import { Button } from '../lib/ui.tsx';
import { ActionCard, type CopilotAction } from './copilot-actions.tsx';

type RefType = 'deal' | 'lead' | 'company' | 'contact' | 'proposal' | 'task' | 'user' | 'assignment' | 'action' | 'team';
interface Source {
  alias: string;
  type: RefType;
  id: string;
  label: string;
}
interface Turn {
  id: string;
  question: string;
  answer: string;
  status: string | null;
  tools: { key: number; name: string; done: boolean; ok?: boolean }[];
  sources: Source[];
  actions: CopilotAction[];
  flags: string[];
  error: string | null;
  done: boolean;
}
type Context = { type: 'deal' | 'company' | 'contact' | 'proposal' | 'lead'; id: string } | null;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The record open on screen, from the URL — the server checks again that the user may see it. */
export function contextFromPath(pathname: string): Context {
  const m = new RegExp(`^/(deals|companies|contacts|proposals|leads)/(${UUID})`, 'i').exec(pathname);
  if (!m) return null;
  const type = ({ deals: 'deal', companies: 'company', contacts: 'contact', proposals: 'proposal', leads: 'lead' } as const)[m[1]?.toLowerCase() as 'deals'];
  return { type, id: m[2] as string };
}
/** Where a source chip leads. Only record types with a page get a link. */
export function sourcePath(s: { type: RefType; id: string }): string | null {
  const base: Partial<Record<RefType, string>> = { deal: '/deals/', company: '/companies/', contact: '/contacts/', proposal: '/proposals/' };
  if (base[s.type]) return `${base[s.type]}${s.id}`;
  if (s.type === 'lead') return '/leads';
  if (s.type === 'task') return '/tasks';
  return null;
}
/**
 * Replaces record aliases ([D3]) with the record's name; unknown aliases are dropped. When the answer already wrote the
 * name right before the alias ("Stark ERP [D3]"), the alias is just removed so the name is not shown twice.
 */
export function readable(answer: string, sources: Source[]): string {
  return answer.replace(/\s?\[([A-Z]\d{1,4})\]/g, (whole: string, a: string, offset: number) => {
    const label = sources.find((s) => s.alias === a)?.label;
    if (!label) return '';
    const before = answer.slice(Math.max(0, offset - label.length - 2), offset).toLowerCase();
    if (before.includes(label.toLowerCase())) return '';
    return whole.startsWith(' ') ? ` ${label}` : label;
  });
}
const FLAG_TEXT: Record<string, string> = {
  outside_text_looked_like_instructions: 'Some text in these records was written like an instruction. The Copilot treated it as information only.',
  links_or_images_removed: 'Links or images were removed from the answer.',
  unverified_figures: 'Some figures could not be checked against CRM data.',
};

export function CopilotPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const context = contextFromPath(pathname);
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  });

  const update = (id: string, fn: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));
  const onEvent = (id: string) => (e: StreamEvent) => {
    if (e.event === 'status') update(id, (t) => ({ ...t, status: e.data.text }));
    else if (e.event === 'delta') update(id, (t) => ({ ...t, answer: t.answer + e.data.text }));
    else if (e.event === 'reset') update(id, (t) => ({ ...t, answer: '' }));
    else if (e.event === 'tool')
      update(id, (t) => {
        if (e.data.status === 'started') return { ...t, tools: [...t.tools, { key: t.tools.length, name: e.data.name, done: false }] };
        const i = t.tools.findIndex((x) => x.name === e.data.name && !x.done);
        return i < 0 ? t : { ...t, tools: t.tools.map((x, j) => (j === i ? { ...x, done: true, ok: e.data.ok } : x)) };
      });
    else if (e.event === 'action') update(id, (t) => ({ ...t, actions: [...t.actions, e.data] }));
    else if (e.event === 'error') update(id, (t) => ({ ...t, error: e.data.message, status: null }));
    else if (e.event === 'done')
      update(id, (t) => ({ ...t, answer: e.data.answer, sources: e.data.sources ?? [], flags: e.data.flags ?? [], status: null, done: true }));
  };

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    setBusy(true);
    const id = crypto.randomUUID();
    setTurns((all) => [
      ...all,
      { id, question: message, answer: '', status: 'Thinking…', tools: [], sources: [], actions: [], flags: [], error: null, done: false },
    ]);
    abort.current = new AbortController();
    try {
      let cid = conversationId;
      if (!cid) {
        cid = (await post<{ id: string }>('/copilot/conversations', context ? { context } : {})).id;
        setConversationId(cid);
      }
      await postStream(`/api/v1/copilot/conversations/${cid}/turns`, { message, context }, onEvent(id), abort.current.signal);
      // Writes the Copilot made or proposed show up elsewhere in the app.
      void qc.invalidateQueries({ queryKey: ['copilot-actions'] });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        update(id, (t) => ({ ...t, error: error instanceof Error ? error.message : 'Something went wrong.', status: null }));
    } finally {
      update(id, (t) => ({ ...t, status: null, done: true }));
      setBusy(false);
      abort.current = null;
    }
  }
  function newChat() {
    abort.current?.abort();
    setConversationId(null);
    setTurns([]);
  }

  if (!open) return null;
  return (
    <aside
      aria-label="Copilot"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-white shadow-pop sm:w-[420px]"
      data-testid="copilot-panel"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Bot className="size-4 text-brand" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">Copilot</h2>
        <Button variant="ghost" className="h-7 px-2" onClick={newChat} aria-label="New conversation" title="New conversation">
          <Plus className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" className="h-7 px-2" onClick={onClose} aria-label="Close Copilot" title="Close">
          <X className="size-4" aria-hidden />
        </Button>
      </header>

      <div ref={list} className="flex-1 space-y-5 overflow-y-auto px-4 py-4" aria-live="polite">
        {!turns.length && (
          <div className="space-y-2 pt-6 text-center text-[13px] text-muted">
            <p className="font-medium text-ink">Ask about your deals, leads, tasks and reports.</p>
            <p>The Copilot sees only what you can see. It never sends anything outside the CRM, and changes need your OK or can be undone.</p>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <p className="ml-8 rounded-lg bg-brand-soft px-3 py-2 text-sm text-ink">{t.question}</p>
            {t.tools.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted" data-testid="copilot-tools">
                {t.tools.map((x) => (
                  <li key={x.key} className="flex items-center gap-1.5">
                    {x.done ? (
                      <span aria-hidden className={x.ok === false ? 'text-danger' : 'text-ok'}>
                        {x.ok === false ? '✕' : '✓'}
                      </span>
                    ) : (
                      <LoaderCircle className="size-3 animate-spin" aria-hidden />
                    )}
                    {x.name.replaceAll('_', ' ')}
                  </li>
                ))}
              </ul>
            )}
            {t.status && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <LoaderCircle className="size-3 animate-spin" aria-hidden />
                {t.status}
              </p>
            )}
            {t.answer && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink" data-testid="copilot-answer">
                {t.done ? readable(t.answer, t.sources) : t.answer}
              </p>
            )}
            {t.flags.map((f) => (
              <p key={f} className="flex items-start gap-1.5 text-xs text-warn">
                <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                {FLAG_TEXT[f] ?? f}
              </p>
            ))}
            {t.actions.map((a) => (
              <ActionCard key={a.id} action={a} />
            ))}
            {t.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="copilot-sources">
                {t.sources.map((s) => {
                  const to = sourcePath(s);
                  const chip = 'inline-flex max-w-[180px] items-center gap-1 truncate rounded-full border border-line px-2 py-0.5 text-xs text-muted';
                  return to ? (
                    <Link key={s.alias} to={to} className={`${chip} hover:border-brand hover:text-brand`}>
                      <span className="truncate">{s.label}</span>
                    </Link>
                  ) : (
                    <span key={s.alias} className={chip}>
                      {s.label}
                    </span>
                  );
                })}
              </div>
            )}
            {t.error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-danger">{t.error}</p>}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="shrink-0 border-t border-line p-3">
        {context && <p className="mb-1.5 text-xs text-muted">Using the {context.type} open on this page as context.</p>}
        <div className="flex items-end gap-2">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(e as unknown as FormEvent);
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Ask the Copilot…"
            aria-label="Message to the Copilot"
            className="min-h-[2.5rem] flex-1 resize-none rounded border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          />
          <Button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="h-9 px-3">
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <SendHorizontal className="size-4" aria-hidden />}
          </Button>
        </div>
      </form>
    </aside>
  );
}
