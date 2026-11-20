import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider, useNavigate } from '@tanstack/react-router';
import { type FormEvent, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, get, post } from './lib/api.ts';
import { useMe } from './lib/me.ts';
import { Button, Field, Input, ToastProvider, useAction } from './lib/ui.tsx';
import { AdminUsersPage, CatalogPage, TemplateEditorPage, TemplatesPage } from './pages/admin.tsx';
import { AiActivityPage, AiSettingsPage } from './pages/ai.tsx';
import { CompaniesPage, CompanyPage, ContactPage, ContactsPage, TasksPage } from './pages/crm.tsx';
import { DashboardPage } from './pages/dashboard.tsx';
import { DealPage, DealsPage } from './pages/deals.tsx';
import { ImportPage } from './pages/import.tsx';
import { LeadsPage } from './pages/leads.tsx';
import { ProposalPage } from './pages/proposal.tsx';
import { ReportsPage } from './pages/reports.tsx';
import { AuditLogPage, SettingsPage } from './pages/settings.tsx';
import './styles.css';

function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signIn = useAction((v: { email: string; password: string }) => api('POST', '/auth/sign-in/email', v), {
    onDone: async () => {
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
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">Sign in to Sales CRM</h1>
          <p className="text-sm text-muted">Use the account your administrator created for you.</p>
        </div>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        {signIn.error && (
          <p role="alert" className="text-sm text-danger">
            {signIn.error.message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={signIn.busy}>
          {signIn.busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => get<{ type: string; id: string; title: string; subtitle?: string }[]>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  const path = (r: { type: string; id: string }) => (r.type === 'deal' ? `/deals/${r.id}` : r.type === 'company' ? `/companies/${r.id}` : '/contacts');
  return (
    <div className="relative w-full max-w-md">
      <Input
        aria-label="Search companies, contacts and deals"
        placeholder="Search companies, contacts, deals…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-line bg-white shadow-lg">
          {results.data?.length ? (
            results.data.map((r) => (
              <a key={r.type + r.id} href={path(r)} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-surface">
                <span>{r.title}</span>
                <span className="text-xs uppercase text-muted">{r.type}</span>
              </a>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-muted">{results.isFetching ? 'Searching…' : 'No results'}</p>
          )}
        </div>
      )}
    </div>
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
  return (
    <div className="relative">
      <Button
        variant="secondary"
        aria-label={`Notifications, ${n.data?.unreadCount ?? 0} unread`}
        onClick={() => {
          setOpen(!open);
          if (!open && n.data?.unreadCount) markRead.run(undefined);
        }}
      >
        Alerts{n.data?.unreadCount ? <span className="rounded-full bg-danger px-1.5 text-xs text-white">{n.data.unreadCount}</span> : null}
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-96 w-80 overflow-y-auto rounded-md border border-line bg-white shadow-lg">
          {n.data?.items.length ? (
            n.data.items.map((i) => (
              <a key={i.id} href={i.linkPath} className="block border-b border-line px-3 py-2 text-sm last:border-0 hover:bg-surface">
                <span className="font-medium">{i.title}</span>
                <span className="block text-xs text-muted">{i.body}</span>
              </a>
            ))
          ) : (
            <p className="px-3 py-4 text-sm text-muted">No alerts yet. You will be told when buyers open, forward or sign proposals.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const me = useMe();
  const qc = useQueryClient();
  if (me.isPending) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (me.isError) {
    location.assign('/login');
    return null;
  }
  const p = me.data.permissions;
  const nav: [string, string, boolean][] = [
    ['/', 'Dashboard', true],
    ['/deals', 'Deals', true],
    ['/companies', 'Companies', true],
    ['/contacts', 'Contacts', true],
    ['/tasks', 'My tasks', true],
    ['/reports', 'Reports', Boolean(p['report.view'])],
    ['/leads', 'Leads', Boolean(p['lead.view'])],
    ['/templates', 'Templates', Boolean(p['content.manage'])],
    ['/catalog', 'Catalogue', Boolean(p['content.manage'])],
    ['/ai', 'AI activity', Boolean(p['ai.use'])],
    ['/admin/users', 'Users', Boolean(p['user.manage'])],
    ['/admin/ai', 'AI settings', Boolean(p['settings.manage'])],
    ['/admin/settings', 'Settings', Boolean(p['settings.manage'])],
    ['/admin/import', 'Import data', Boolean(p['settings.manage'])],
    ['/admin/audit', 'Audit log', Boolean(p['audit.view'])],
  ];
  const signOut = async () => {
    await api('POST', '/auth/sign-out', {}).catch(() => undefined);
    qc.clear();
    location.assign('/login');
  };
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 border-r border-line bg-white md:block">
        <div className="border-b border-line px-4 py-3">
          <p className="text-sm font-semibold text-brand">Sales CRM</p>
          <p className="truncate text-xs text-muted">{me.data.settings.organizationName}</p>
        </div>
        <nav aria-label="Main" className="p-2">
          {nav
            .filter(([, , show]) => show)
            .map(([to, label]) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === '/' }}
                className="block rounded-md px-3 py-1.5 text-sm text-ink hover:bg-surface"
                activeProps={{ className: 'bg-brand-soft font-medium text-brand' }}
              >
                {label}
              </Link>
            ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-2">
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <span className="hidden text-sm text-muted sm:inline">
              {me.data.user.fullName} · {me.data.user.role.replace('_', ' ')}
            </span>
            <Button variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </header>
        <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto border-b border-line bg-white px-2 py-1 md:hidden">
          {nav
            .filter(([, , show]) => show)
            .map(([to, label]) => (
              <Link key={to} to={to} className="whitespace-nowrap rounded px-2 py-1 text-sm">
                {label}
              </Link>
            ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
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
