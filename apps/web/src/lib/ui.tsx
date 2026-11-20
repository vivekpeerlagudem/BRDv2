/**
 * Small component kit in the shadcn/ui style (own code, Tailwind tokens from styles.css). One place for buttons,
 * fields, dialogs, tables, badges, loading / empty / error states and toasts so every page behaves the same.
 */
import { type UseQueryResult, useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Inbox, Search, X } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  createContext,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ApiError } from './api.ts';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    secondary: 'bg-white text-brand border border-line-strong hover:border-brand hover:bg-brand-soft',
    danger: 'bg-danger text-white hover:bg-red-700',
    ghost: 'text-muted hover:bg-surface hover:text-ink',
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded px-3.5 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        styles,
        className,
      )}
    />
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="block text-sm">
      <span className="mb-1 block text-[13px] font-medium tracking-label text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}
const inputClass =
  'w-full rounded border border-line bg-white px-2.5 text-sm text-ink shadow-xs transition-colors placeholder:text-faint hover:border-line-strong focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15 disabled:bg-surface disabled:text-muted';
export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cx(inputClass, 'h-8', props.className)} />;
export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={cx(inputClass, 'h-8 cursor-pointer pr-7', props.className)} />
);
export const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={cx(inputClass, 'min-h-24 py-2 leading-relaxed', props.className)} />
);

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-line bg-white', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: 'bg-slate-100 text-slate-600',
  info: 'bg-info-soft text-info-ink',
  ok: 'bg-green-50 text-green-700',
  warn: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-700',
};
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium leading-4 tracking-label', TONES[tone])}>
      {children}
    </span>
  );
}
// ───────────── record identity (Twenty-style chips) ─────────────
const AVATAR_TINTS = [
  'bg-blue-100 text-blue-800',
  'bg-violet-100 text-violet-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-cyan-100 text-cyan-800',
  'bg-slate-200 text-slate-700',
];
const hashOf = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const initialsOf = (s: string) =>
  s
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';
/**
 * Initials on a stable tint derived from the name — square for organizations, round for people.
 * The initials are CSS generated content (data-initials), so they are decorative only: they never become part of a
 * row's text (copy/paste, find-in-page, assistive tech and tests all see just the record name).
 */
export function Avatar({ name, shape = 'circle', size = 'sm' }: { name: string; shape?: 'circle' | 'square'; size?: 'sm' | 'md' | 'lg' }) {
  const dim = { sm: 'size-5 text-xs', md: 'size-7 text-xs', lg: 'size-10 text-sm' }[size];
  return (
    <span
      aria-hidden
      data-initials={initialsOf(name)}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold before:content-[attr(data-initials)]',
        shape === 'circle' ? 'rounded-full' : 'rounded-md',
        dim,
        AVATAR_TINTS[hashOf(name) % AVATAR_TINTS.length],
      )}
    />
  );
}
/** Class for a record name link inside tables and lists: ink text, accent on hover. */
export const recordLink = 'inline-flex max-w-full items-center gap-2 font-medium text-ink transition-colors hover:text-brand';
/** Owner / person display: small round avatar + name. */
export function PersonChip({ name }: { name?: string | null }) {
  if (!name) return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-ink">
      <Avatar name={name} />
      <span className="truncate">{name}</span>
    </span>
  );
}
/** List filter input with a leading search icon. */
export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx('relative', props.className)}>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <input {...props} className={cx(inputClass, 'h-8 pl-8')} />
    </div>
  );
}
/** Vertical field list for a record's side panel (label above value, Twenty-style). */
export function FieldList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 py-2 text-sm first:pt-0 last:pb-0">
          <dt className="text-[13px] text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v || <span className="text-faint">Empty</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export const statusTone = (s: string): keyof typeof TONES =>
  ['won', 'signed', 'accepted', 'active', 'completed'].includes(s)
    ? 'ok'
    : ['lost', 'declined', 'void', 'voided', 'revoked', 'deactivated', 'expired'].includes(s)
      ? 'danger'
      : ['sent', 'viewed', 'open', 'pending'].includes(s)
        ? 'info'
        : 'neutral';

/** Page title bar: title + optional subtitle on the left, primary actions on the right, hairline divider below. */
export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="-mx-4 mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 pb-4 lg:-mx-6 lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-heading text-ink">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-line bg-white px-6 py-12 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-muted">
        <Inbox className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export const Skeleton = ({ rows = 4 }: { rows?: number }) => (
  <div role="status" aria-busy="true" aria-label="Loading" className="overflow-hidden rounded-lg border border-line bg-white">
    {Array.from({ length: rows }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
      <div key={i} className="flex items-center gap-3 border-b border-line px-3 py-3 last:border-0">
        <div className="h-3 w-1/4 animate-pulse rounded bg-surface" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface" />
        <div className="ml-auto h-3 w-16 animate-pulse rounded bg-surface" />
      </div>
    ))}
  </div>
);
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      {notFound ? 'This record does not exist or you do not have access to it.' : error instanceof Error ? error.message : 'Something went wrong.'}
      {retry && !notFound && (
        <Button variant="ghost" className="ml-2" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
/** Renders loading, error and data states for a query in one consistent way. */
export function Query<T>({ q, children, rows }: { q: UseQueryResult<T>; children: (data: T) => ReactNode; rows?: number }) {
  if (q.isPending) return <Skeleton rows={rows} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  return <>{children(q.data)}</>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-surface text-sm text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="h-9 whitespace-nowrap px-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&_td]:h-9 [&_td]:px-3 [&_td]:py-1 [&_tr]:transition-colors [&_tr:hover]:bg-brand-soft/60">{children}</tbody>
      </table>
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={cx('m-auto w-[min(92vw,theme(maxWidth.lg))] rounded-xl border border-line bg-white p-0 shadow-pop', wide && 'w-[min(94vw,56rem)]')}
    >
      {open && (
        <>
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
        </>
      )}
    </dialog>
  );
}

// ───────────── toasts ─────────────
type Toast = { id: number; message: string; tone: 'ok' | 'danger' };
const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'flex items-start gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm shadow-pop',
              t.tone === 'ok' ? 'border-line text-ink' : 'border-red-200 text-red-700',
            )}
          >
            {t.tone === 'ok' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Form helper: runs a mutation, maps server field errors back to inputs, shows a toast on success and failure.
 * `fieldError(name)` returns the message for a field (from the server's problem JSON).
 */
export function useAction<TIn, TOut>(fn: (input: TIn) => Promise<TOut>, opts: { success?: string; onDone?: (out: TOut) => void } = {}) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      if (opts.success) toast(opts.success);
      opts.onDone?.(out);
    },
    onError: (e) => {
      if (!(e instanceof ApiError) || e.errors.length === 0) toast(e instanceof Error ? e.message : 'Something went wrong', 'danger');
    },
  });
  const fieldError = (name: string) => (m.error instanceof ApiError ? m.error.errors.find((x) => x.path === name)?.message : undefined);
  return { run: m.mutate, runAsync: m.mutateAsync, busy: m.isPending, error: m.error, fieldError };
}

export function formValues(e: FormEvent<HTMLFormElement>): Record<string, string | undefined> {
  e.preventDefault();
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of new FormData(e.currentTarget).entries()) out[k] = typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  return out;
}

export function ConfirmButton({
  label,
  confirm,
  onConfirm,
  variant = 'danger',
  disabled,
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  variant?: 'danger' | 'secondary';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Please confirm">
        <p className="text-sm text-ink">{confirm}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {label}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
