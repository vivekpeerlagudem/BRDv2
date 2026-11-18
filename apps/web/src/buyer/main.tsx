/**
 * Buyer surface (separate origin, no internal session) — DOCUMENT-SHARING-DESIGN.md.
 *  1. The share token arrives in the URL FRAGMENT (#token): browsers never send it to servers, logs or scanners.
 *  2. This page posts it once to /public/v1/session/exchange and removes it from the address bar.
 *  3. Everything afterwards uses an HttpOnly cookie bound to that one link.
 * The same file also serves the hosted lead form (/f?form=<key>).
 */
import { renderHtml, type Snapshot } from '@crm/proposal';
import { type FormEvent, StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, api } from '../lib/api.ts';
import '../styles.css';

type State = {
  state: 'loading' | 'unavailable' | 'withdrawn' | 'expired' | 'link_expired' | 'needs_identity' | 'ready';
  recipientName?: string;
  notice?: string;
};
interface View {
  snapshot: Snapshot;
  superseded: boolean;
  outcome: string | null;
  signatureRequested: boolean;
  actions: { accept: boolean; decline: boolean; download: boolean };
}
const MESSAGES: Record<string, [string, string]> = {
  unavailable: ['This proposal is not available', 'The link may be incorrect or no longer active. Please contact the person who sent it to you.'],
  withdrawn: ['This proposal has been withdrawn', 'Please contact the sender for an updated proposal.'],
  expired: ['This proposal has expired', 'Please contact the sender if you would like an updated proposal.'],
  link_expired: ['This link has expired', 'Please ask the sender for a new link.'],
};
const btn = 'rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50';

function Notice({ kind }: { kind: string }) {
  const [title, text] = MESSAGES[kind] ?? MESSAGES.unavailable!;
  return (
    <main className="mx-auto mt-24 max-w-md rounded-lg border border-line bg-white p-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
    </main>
  );
}

function ProposalApp() {
  const [state, setState] = useState<State>({ state: 'loading' });
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [declining, setDeclining] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const load = async () => {
    try {
      const s = await api<State>('GET', '/public/v1/session');
      setState(s);
      if (s.state === 'ready') setView(await api<View>('GET', '/public/v1/proposal'));
    } catch {
      setState({ state: 'unavailable' });
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on page load
  useEffect(() => {
    void (async () => {
      const token = location.hash.slice(1);
      if (token) {
        history.replaceState(null, '', location.pathname); // remove the token from the address bar and history
        try {
          await api('POST', '/public/v1/session/exchange', { token });
        } catch {
          return setState({ state: 'unavailable' });
        }
      }
      await load();
    })();
  }, []);

  // View tracking: a view is counted by the first heartbeat, sent only while the page is actually visible.
  useEffect(() => {
    if (!view) return;
    let viewSessionId: string | null = null;
    let last = Date.now();
    const beat = async () => {
      if (document.visibilityState !== 'visible') {
        last = Date.now();
        return;
      }
      viewSessionId ??= (await api<{ viewSessionId: string }>('POST', '/public/v1/views/start', {})).viewSessionId;
      const activeSeconds = Math.min(20, Math.round((Date.now() - last) / 1000));
      last = Date.now();
      await api('POST', '/public/v1/views/heartbeat', { viewSessionId, activeSeconds }).catch(() => undefined);
    };
    const first = setTimeout(() => void beat(), 3000);
    const timer = setInterval(() => void beat(), 15000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [view]);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  };
  const identify = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(() => api('POST', '/public/v1/identity', { name: f.get('name'), email: f.get('email') }));
  };

  if (state.state === 'loading') return <p className="p-8 text-center text-sm text-muted">Loading…</p>;
  if (state.state === 'needs_identity')
    return (
      <main className="mx-auto mt-16 max-w-md space-y-4 rounded-lg border border-line bg-white p-6">
        <h1 className="text-lg font-semibold">Open the proposal</h1>
        <button type="button" className={`${btn} w-full bg-brand text-white`} onClick={() => void act(() => api('POST', '/public/v1/identity/continue', {}))}>
          Continue as {state.recipientName}
        </button>
        <form onSubmit={identify} className="space-y-3 border-t border-line pt-4">
          <p className="text-sm font-medium">I’m someone else</p>
          <label className="block text-sm">
            Your name
            <input name="name" required className="mt-1 w-full rounded-md border border-line px-2.5 py-1.5" />
          </label>
          <label className="block text-sm">
            Your email
            <input name="email" type="email" required className="mt-1 w-full rounded-md border border-line px-2.5 py-1.5" />
          </label>
          <p className="text-xs text-muted">{state.notice}</p>
          <button type="submit" className={`${btn} w-full border border-line bg-white`}>
            View proposal
          </button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </main>
    );
  if (state.state !== 'ready' || !view) return <Notice kind={state.state} />;

  return (
    <div className="mx-auto max-w-4xl p-3 pb-28">
      {view.superseded && (
        <p role="status" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-warn">
          A newer version of this proposal has been sent to you. This version is shown for reference only.
        </p>
      )}
      {view.outcome && (
        <p role="status" className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-ok">
          This proposal has been {view.outcome === 'accept' ? 'accepted' : view.outcome === 'decline' ? 'declined' : 'signed'}. Thank you.
        </p>
      )}
      {view.signatureRequested && (
        <p role="status" className="mb-3 rounded-md bg-brand-soft px-3 py-2 text-sm text-brand">
          A signature has been requested — please check your email for the signing link.
        </p>
      )}
      {/* The document is the same HTML used for the PDF, shown in a sandboxed frame (no scripts). */}
      <iframe
        ref={frame}
        title={view.snapshot.title}
        sandbox=""
        srcDoc={renderHtml(view.snapshot)}
        className="h-[78vh] w-full rounded-lg border border-line bg-white"
      />
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white p-3">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-end gap-2">
          {error && (
            <span role="alert" className="mr-auto text-sm text-danger">
              {error}
            </span>
          )}
          <a className={`${btn} border border-line bg-white`} href="/public/v1/download">
            Download PDF
          </a>
          {view.actions.decline && (
            <button type="button" className={`${btn} border border-line bg-white`} onClick={() => setDeclining(true)}>
              Decline
            </button>
          )}
          {view.actions.accept && (
            <button
              type="button"
              className={`${btn} bg-brand text-white`}
              onClick={() => void act(() => api('POST', '/public/v1/response', { response: 'accept' }))}
            >
              Accept proposal
            </button>
          )}
        </div>
        {declining && (
          <form
            className="mx-auto mt-2 flex max-w-4xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get('reason');
              void act(() => api('POST', '/public/v1/response', { response: 'decline', reason })).then(() => setDeclining(false));
            }}
          >
            <input
              name="reason"
              required
              aria-label="Reason for declining"
              placeholder="Please tell us why"
              className="flex-1 rounded-md border border-line px-2.5 py-1.5 text-sm"
            />
            <button type="submit" className={`${btn} bg-danger text-white`}>
              Confirm decline
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function LeadForm({ formKey }: { formKey: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = Object.fromEntries([...new FormData(e.currentTarget).entries()].filter(([, v]) => v !== ''));
    try {
      await api('POST', `/public/v1/forms/${encodeURIComponent(formKey)}/submissions`, body);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.errors[0] ? err.errors[0].message : 'Please check the form and try again.');
    }
  };
  const input = 'mt-1 w-full rounded-md border border-line px-2.5 py-1.5';
  if (done)
    return (
      <main className="mx-auto mt-16 max-w-md rounded-lg border border-line bg-white p-6 text-center text-sm">Thank you — we will be in touch shortly.</main>
    );
  return (
    <main className="mx-auto mt-8 max-w-md rounded-lg border border-line bg-white p-6">
      <h1 className="mb-3 text-lg font-semibold">Contact our sales team</h1>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <label className="block">
          First name
          <input name="firstName" className={input} />
        </label>
        <label className="block">
          Last name
          <input name="lastName" className={input} />
        </label>
        <label className="block">
          Work email
          <input name="email" type="email" required className={input} />
        </label>
        <label className="block">
          Company
          <input name="company" className={input} />
        </label>
        <label className="block">
          How can we help?
          <textarea name="message" className={input} />
        </label>
        {/* Honeypot: hidden from people, filled by bots (BR-LED-006). */}
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <button type="submit" className={`${btn} w-full bg-brand text-white`}>
          Send
        </button>
      </form>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
const formKey = new URLSearchParams(location.search).get('form');
createRoot(root).render(<StrictMode>{location.pathname === '/f' && formKey ? <LeadForm formKey={formKey} /> : <ProposalApp />}</StrictMode>);
