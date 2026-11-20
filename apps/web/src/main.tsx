import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider, useNavigate } from '@tanstack/react-router';
import {
  Bell,
  Bot,
  Building2,
  ChartColumn,
  CornerDownLeft,
  FileText,
  Handshake,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  LoaderCircle,
  LogOut,
  type LucideIcon,
  Menu,
  Package,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Upload,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, get, post } from './lib/api.ts';
import { useMe } from './lib/me.ts';
import { Button, Field, Input, ToastProvider, useAction } from './lib/ui.tsx';
import { AdminUsersPage, CatalogPage, TemplateEditorPage, TemplatesPage } from './pages/admin.tsx';
import { AiActivityPage, AiSettingsPage } from './pages/ai.tsx';
import { CompaniesPage, CompanyPage, ContactPage, ContactsPage, TasksPage } from './pages/crm.tsx';
import { DashboardPage } from './pages/dashboard.tsx';
import { DealPage, DealsPage } from './pages/deals.tsx';
import { ProposalsPage } from './pages/documents.tsx';
import { ImportPage } from './pages/import.tsx';
import { LeadsPage } from './pages/leads.tsx';
import { ProposalPage } from './pages/proposal.tsx';
import { ReportsPage } from './pages/reports.tsx';
import { AuditLogPage, SettingsPage } from './pages/settings.tsx';
import '@fontsource-variable/inter'; // self-hosted Inter (OFL) — Twenty-style typography
import './styles.css';

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/** Kensium logo (white artwork — for the navy rail and hero surfaces). Self-hosted from apps/web/public. */
function KensiumLogo({ className = 'h-6' }: { className?: string }) {
  return <img src="/kensium-logo.svg" alt="Kensium" className={`w-auto select-none ${className}`} draggable={false} />;
}
/** Shared look for items on the Kensium navy navigation rail. */
const railItem =
  'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium tracking-label text-nav-text transition-colors hover:bg-white/[0.06] hover:text-white [&>svg]:size-3.5';

function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signIn = useAction((v: { email: string; password: string }) => api('POST', '/auth/sign-in/email', v), {
    onDone: async () => {
      // An intentional sign-in rebinds this tab to the new user, so it is never flagged as a background swap.
      try {
        sessionStorage.removeItem('crm.uid');
      } catch {}
      await qc.invalidateQueries();
      await navigate({ to: '/' });
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    signIn.run({ email: String(f.get('email')), password: String(f.get('password')) });
  };
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-nav p-4">
      {/* Kensium hero treatment: navy field with a soft green/gold glow */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 size-[28rem] rounded-full bg-accent/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 size-[24rem] rounded-full bg-gold/10 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <KensiumLogo className="h-9" />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Kensium Sales Workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-heading text-white">
            Sign in to <span className="text-gold">Sales CRM</span>
          </h1>
          <p className="mt-1.5 text-[13px] text-nav-text">Use the account your administrator created for you.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg bg-white p-6 shadow-2xl">
          <Field label="Email">
            <Input name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          {signIn.error && (
            <p role="alert" className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">
              <ShieldAlert className="size-4 shrink-0" aria-hidden />
              {signIn.error.message}
            </p>
          )}
          <Button type="submit" className="h-9 w-full" disabled={signIn.busy}>
            {signIn.busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}

// ───────────── navigation model ─────────────
type NavItem = { to: string; label: string; icon: LucideIcon; show: boolean };
type NavGroup = { title?: string; items: NavItem[] };
type SearchHit = { type: string; id: string; title: string; subtitle?: string };
const RESULT_ICON: Record<string, LucideIcon> = { deal: Handshake, company: Building2, contact: Users };
const resultPath = (r: SearchHit) => (r.type === 'deal' ? `/deals/${r.id}` : r.type === 'company' ? `/companies/${r.id}` : `/contacts/${r.id}`);

/**
 * Command menu (⌘K / Ctrl+K): jump to any page, or search companies, contacts and deals. Arrow keys move,
 * Enter opens, Esc closes. Uses the same permission-scoped /search endpoint as before.
 */
function CommandMenu({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: NavGroup[] }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) {
      d.showModal();
      setQ('');
      setActive(0);
    }
    if (!open && d?.open) d.close();
  }, [open]);
  const term = q.trim();
  const results = useQuery({
    queryKey: ['search', term],
    queryFn: () => get<SearchHit[]>(`/search?q=${encodeURIComponent(term)}`),
    enabled: open && term.length >= 2,
  });
  const pages = groups.flatMap((g) => g.items).filter((i) => i.show && i.label.toLowerCase().includes(term.toLowerCase()));
  const options: { key: string; label: string; hint: string; icon: LucideIcon; to: string }[] = [
    ...(term.length >= 2
      ? (results.data ?? []).map((r) => ({
          key: r.type + r.id,
          label: r.title,
          hint: r.subtitle ?? r.type,
          icon: RESULT_ICON[r.type] ?? Search,
          to: resultPath(r),
        }))
      : []),
    ...pages.map((p) => ({ key: `page:${p.to}`, label: p.label, hint: 'Go to page', icon: p.icon, to: p.to })),
  ];
  const go = (to: string) => {
    onClose();
    void navigate({ to });
  };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label="Command menu"
      className="mx-auto mt-[12vh] w-[min(92vw,36rem)] rounded-xl border border-line bg-white p-0 shadow-pop"
    >
      {open && (
        <div>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <Search className="size-4 text-muted" aria-hidden />
            <input
              autoFocus
              aria-label="Search companies, people and opportunities"
              placeholder="Search records or jump to a page…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, options.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter' && options[active]) {
                  e.preventDefault();
                  go(options[active].to);
                }
              }}
              className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
            <kbd className="rounded border border-line px-1.5 py-0.5 text-xs text-muted">Esc</kbd>
          </div>
          <ul className="max-h-[50vh] overflow-y-auto p-1.5">
            {term.length >= 2 && results.isFetching && !results.data && <li className="px-3 py-2 text-[13px] text-muted">Searching…</li>}
            {options.length === 0 && !results.isFetching && <li className="px-3 py-6 text-center text-[13px] text-muted">No matches</li>}
            {options.map((o, i) => (
              <li key={o.key}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(o.to)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${i === active ? 'bg-surface text-ink' : 'text-ink'}`}
                >
                  <o.icon className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <span className="shrink-0 text-xs capitalize text-faint">{o.hint}</span>
                  {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-faint" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  );
}

function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Polling baseline (ADR-023): alerts arrive within 30 s even without a push channel.
  const n = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      get<{ items: { id: string; title: string; body: string; linkPath: string; createdAt: string; readAt: string | null }[]; unreadCount: number }>(
        '/notifications',
      ),
    refetchInterval: 15_000,
  });
  const markRead = useAction(() => post('/notifications/read'), { onDone: () => void qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = n.data?.unreadCount ?? 0;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && unread) markRead.run(undefined);
        }}
        className={railItem}
      >
        <Bell className="size-4" aria-hidden />
        <span className="flex-1 text-left">Notifications</span>
        {unread > 0 && <span className="rounded-full bg-gold px-1.5 text-xs font-semibold leading-4 text-nav">{unread}</span>}
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close notifications" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-line bg-white shadow-pop md:left-full md:top-0 md:ml-2 md:mt-0">
            <p className="border-b border-line px-3 py-2 text-[13px] font-semibold">Notifications</p>
            {n.data?.items.length ? (
              n.data.items.map((i) => (
                <a key={i.id} href={i.linkPath} className="block border-b border-line px-3 py-2.5 text-sm last:border-0 hover:bg-surface">
                  <span className="font-medium">{i.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">{i.body}</span>
                </a>
              ))
            ) : (
              <p className="px-3 py-6 text-center text-[13px] text-muted">No alerts yet. You will be told when buyers open, forward or sign proposals.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SessionChanged({ name, role, onContinue, onSignOut }: { name: string; role: string; onContinue: () => void; onSignOut: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-white p-6 shadow-pop">
        <span className="flex size-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
          <ShieldAlert className="size-5" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">Your session changed</h1>
        <p className="text-sm leading-relaxed text-muted">
          This browser is now signed in as <span className="font-medium text-ink">{name}</span> ({role}). That happens when you sign in as a different user in
          another tab or window — the whole browser shares one session. Open each user in a separate browser profile or a private/incognito window to use
          several at once.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
          <Button onClick={onContinue}>Continue as {name}</Button>
        </div>
      </div>
    </main>
  );
}

function Shell() {
  const me = useMe();
  const qc = useQueryClient();
  const [switched, setSwitched] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // mobile drawer
  const [cmdOpen, setCmdOpen] = useState(false); // ⌘K
  const uid = me.data?.user.id;
  // Bind this tab to the user it signed in as. The whole browser shares one session cookie, so signing in as
  // another user in a different tab/window swaps the session everywhere; this surfaces that switch explicitly
  // on the next load instead of silently rendering a different role (never a silent role change).
  useEffect(() => {
    if (!uid) return;
    const bound = sessionStorage.getItem('crm.uid');
    if (!bound) sessionStorage.setItem('crm.uid', uid);
    else if (bound !== uid) setSwitched(true);
  }, [uid]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const signOut = async () => {
    sessionStorage.removeItem('crm.uid');
    await api('POST', '/auth/sign-out', {}).catch(() => undefined);
    qc.clear();
    location.assign('/login');
  };
  if (me.isPending)
    return (
      <div role="status" className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  if (me.isError) {
    location.assign('/login');
    return null;
  }
  if (switched)
    return (
      <SessionChanged
        name={me.data.user.fullName}
        role={me.data.user.role.replace('_', ' ')}
        onContinue={() => {
          sessionStorage.setItem('crm.uid', me.data.user.id);
          setSwitched(false);
        }}
        onSignOut={signOut}
      />
    );
  const p = me.data.permissions;
  const groups: NavGroup[] = [
    {
      items: [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard, show: true },
        { to: '/deals', label: 'Opportunities', icon: Handshake, show: true },
        { to: '/proposals', label: 'Proposals', icon: FileText, show: true },
        { to: '/companies', label: 'Companies', icon: Building2, show: true },
        { to: '/contacts', label: 'People', icon: Users, show: true },
        { to: '/leads', label: 'Leads', icon: UserPlus, show: Boolean(p['lead.view']) },
        { to: '/tasks', label: 'Tasks', icon: ListChecks, show: true },
        { to: '/reports', label: 'Reports', icon: ChartColumn, show: Boolean(p['report.view']) },
      ],
    },
    {
      title: 'Sales content',
      items: [
        { to: '/templates', label: 'Templates', icon: LayoutTemplate, show: Boolean(p['content.manage']) },
        { to: '/catalog', label: 'Catalogue', icon: Package, show: Boolean(p['content.manage']) },
        { to: '/ai', label: 'AI activity', icon: Sparkles, show: Boolean(p['ai.use']) },
      ],
    },
    {
      title: 'Administration',
      items: [
        { to: '/admin/users', label: 'Users', icon: UserCog, show: Boolean(p['user.manage']) },
        { to: '/admin/ai', label: 'AI settings', icon: Bot, show: Boolean(p['settings.manage']) },
        { to: '/admin/settings', label: 'Settings', icon: Settings, show: Boolean(p['settings.manage']) },
        { to: '/admin/import', label: 'Import data', icon: Upload, show: Boolean(p['settings.manage']) },
        { to: '/admin/audit', label: 'Audit log', icon: ScrollText, show: Boolean(p['audit.view']) },
      ],
    },
  ];
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Mobile drawer scrim */}
      {menuOpen && <button type="button" aria-label="Close menu" className="fixed inset-0 z-30 bg-slate-900/30 md:hidden" onClick={() => setMenuOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[220px] shrink-0 flex-col bg-nav transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Workspace — Kensium brand */}
        <div className="flex h-16 items-center gap-2 px-4">
          <div className="min-w-0 flex-1">
            <img src="/kensium-logo.svg" alt="Kensium" className="h-7 w-auto" draggable={false} />
            <p className="mt-1 truncate text-xs font-semibold uppercase leading-none tracking-[0.08em] text-accent">Sales CRM</p>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="flex size-7 cursor-pointer items-center justify-center rounded text-nav-text hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Utilities */}
        <div className="space-y-0.5 px-2 pb-2">
          <button type="button" onClick={() => setCmdOpen(true)} className={railItem}>
            <Search className="size-4" aria-hidden />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-white/15 px-1 text-xs font-medium leading-4 text-nav-text">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <NotificationBell />
        </div>

        {/* Primary navigation */}
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-3">
          {groups.map((g, gi) => {
            const items = g.items.filter((i) => i.show);
            if (!items.length) return null;
            return (
              <div key={g.title ?? gi} className={gi ? 'mt-5' : 'mt-1'}>
                {g.title && <p className="mb-1.5 px-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-accent">{g.title}</p>}
                <ul className="space-y-0.5">
                  {items.map((i) => (
                    <li key={i.to}>
                      <Link
                        to={i.to}
                        onClick={() => setMenuOpen(false)}
                        activeOptions={{ exact: i.to === '/' }}
                        className={`relative ${railItem}`}
                        activeProps={{
                          className:
                            '!bg-white/[0.08] !text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-accent [&>svg]:text-accent',
                        }}
                      >
                        <i.icon className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{i.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Current user */}
        <div className="flex items-center gap-2 border-t border-white/10 px-3 py-3">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
            {initials(me.data.user.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-5 text-white">{me.data.user.fullName}</p>
            <p data-testid="current-user-role" className="truncate text-xs font-medium capitalize leading-4 tracking-label text-nav-text">
              {me.data.user.role.replace('_', ' ')}
            </p>
          </div>
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signOut()}
            className="flex size-7 cursor-pointer items-center justify-center rounded text-nav-text transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — Kensium navy with logo */}
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 bg-nav px-3 text-white md:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            className="flex size-8 cursor-pointer items-center justify-center rounded text-nav-text hover:bg-white/[0.06] hover:text-white"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="flex flex-1 items-center">
            <img src="/kensium-logo.svg" alt="Kensium" className="h-5 w-auto" draggable={false} />
          </span>
          <button
            type="button"
            aria-label="Search"
            onClick={() => setCmdOpen(true)}
            className="flex size-8 cursor-pointer items-center justify-center rounded text-nav-text hover:bg-white/[0.06] hover:text-white"
          >
            <Search className="size-4" aria-hidden />
          </button>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">
          <Outlet />
        </main>
      </div>

      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} groups={groups} />
    </div>
  );
}

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const shell = createRoute({ getParentRoute: () => rootRoute, id: 'shell', component: Shell });
const r = (path: string, component: () => React.JSX.Element | null) => createRoute({ getParentRoute: () => shell, path, component });
const routeTree = rootRoute.addChildren([
  loginRoute,
  shell.addChildren([
    r('/', DashboardPage),
    r('/deals', DealsPage),
    r('/deals/$id', DealPage),
    r('/companies', CompaniesPage),
    r('/companies/$id', CompanyPage),
    r('/contacts', ContactsPage),
    r('/tasks', TasksPage),
    r('/contacts/$id', ContactPage),
    r('/reports', ReportsPage),
    r('/admin/settings', SettingsPage),
    r('/admin/import', ImportPage),
    r('/admin/audit', AuditLogPage),
    r('/proposals', ProposalsPage),
    r('/proposals/$id', ProposalPage),
    r('/leads', LeadsPage),
    r('/templates', TemplatesPage),
    r('/templates/$id', TemplateEditorPage),
    r('/catalog', CatalogPage),
    r('/admin/users', AdminUsersPage),
    r('/ai', AiActivityPage),
    r('/admin/ai', AiSettingsPage),
  ]),
]);
const router = createRouter({ routeTree });
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: (count, error) => count < 1 && !(error instanceof Error && 'status' in error) },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
