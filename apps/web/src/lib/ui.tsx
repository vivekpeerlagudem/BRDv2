/**
 * Small component kit in the shadcn/ui style (own code, Tailwind tokens from styles.css). One place for buttons,
 * fields, dialogs, tables, badges, loading / empty / error states and toasts so every page behaves the same.
 */
import { type UseQueryResult, useMutation } from '@tanstack/react-query';
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
    secondary: 'bg-white text-ink border border-line hover:bg-surface',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-brand hover:bg-brand-soft',
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
      <span className="mb-1 block font-medium text-ink">{label}</span>
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
const inputClass = 'w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus:border-brand';
export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cx(inputClass, props.className)} />;
export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={cx(inputClass, props.className)} />;
export const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={cx(inputClass, 'min-h-24', props.className)} />
);

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-line bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: 'bg-surface text-muted border-line',
  info: 'bg-brand-soft text-brand border-brand/20',
  ok: 'bg-green-50 text-ok border-green-200',
  warn: 'bg-amber-50 text-warn border-amber-200',
  danger: 'bg-red-50 text-danger border-red-200',
};
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>;
}
export const statusTone = (s: string): keyof typeof TONES =>
  ['won', 'signed', 'accepted', 'active', 'completed'].includes(s)
    ? 'ok'
    : ['lost', 'declined', 'void', 'voided', 'revoked', 'deactivated', 'expired'].includes(s)
      ? 'danger'
      : ['sent', 'viewed', 'open', 'pending'].includes(s)
        ? 'info'
        : 'neutral';

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export const Skeleton = ({ rows = 4 }: { rows?: number }) => (
  <div role="status" aria-busy="true" aria-label="Loading" className="space-y-2">
    {Array.from({ length: rows }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
      <div key={i} className="h-9 animate-pulse rounded-md bg-line/60" />
    ))}
  </div>
);
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-danger">
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
        <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2 [&_tr:hover]:bg-surface/60">{children}</tbody>
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
      className={cx('m-auto w-[min(92vw,theme(maxWidth.lg))] rounded-lg border border-line bg-white p-0 shadow-xl', wide && 'w-[min(94vw,56rem)]')}
    >
      {open && (
        <>
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="rounded px-2 text-lg text-muted hover:bg-surface">
              ×
            </button>
          </header>
          <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
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
              'rounded-md border px-3 py-2 text-sm shadow-md',
              t.tone === 'ok' ? 'border-green-200 bg-white text-ink' : 'border-red-200 bg-red-50 text-danger',
            )}
          >
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
