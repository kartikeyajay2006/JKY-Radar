import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  ChevronRight,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Radar,
  Settings,
  X,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Logo } from '@/components/radar/logo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/overlay';
import { Field, Input } from '@/components/ui/field';
import { Spinner } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useInvalidate, useNotifications } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './theme-toggle';
import { CommandPalette } from './command-palette';
import { CrumbProvider, useCrumbList, useCurrentWorkspace, WorkspaceProvider } from './workspace';

/** @import { WorkspaceDTO } from '@jky/shared' */

/** @param {{ open: boolean; onOpenChange: (o: boolean) => void }} props */
function NewWorkspaceDialog({ open, onOpenChange }) {
  const [name, setName] = useState('');
  const inv = useInvalidate();
  const { setCurrent } = useCurrentWorkspace();
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<WorkspaceDTO>>} */ (
          api.post('/workspaces', { name })
        )
      ).data,
    onSuccess: async (w) => {
      await inv(['workspaces']);
      setCurrent(w.id);
      onOpenChange(false);
      setName('');
      toast.success(`Created ${w.name}`);
      navigate(`/app/workspaces/${w.id}/projects`);
    },
    onError: (e) => toast.error(/** @type {Error} */ (e).message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create a workspace"
      description="Workspaces hold projects, members and release policies. Data never crosses workspaces."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={m.isPending}
            disabled={name.trim().length < 2}
            onClick={() => m.mutate()}
          >
            Create workspace
          </Button>
        </>
      }
    >
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Payments platform"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && name.trim().length >= 2 && m.mutate()}
          />
        )}
      </Field>
    </Dialog>
  );
}

function WorkspaceSwitcher() {
  const { workspaces, current, setCurrent } = useCurrentWorkspace();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2 text-left hover:border-line-strong"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-accent-soft text-xs font-semibold text-accent">
              {current?.name.slice(0, 1).toUpperCase() ?? '?'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{current?.name ?? 'No workspace'}</span>
              <span className="block text-[11px] text-muted capitalize">{current?.role.toLowerCase()}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="w-60">
          <MenuLabel>Workspaces</MenuLabel>
          {workspaces.map((w) => (
            <MenuItem
              key={w.id}
              onSelect={() => {
                setCurrent(w.id);
                navigate(`/app/workspaces/${w.id}/projects`);
              }}
            >
              <span className="truncate">{w.name}</span>
              {w.id === current?.id && <span className="ml-auto text-xs text-accent">Current</span>}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => setCreating(true)}>
            <Plus className="size-4" /> New workspace
          </MenuItem>
        </MenuContent>
      </Menu>
      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

/** @param {{ onNavigate?: () => void }} props */
function Sidebar({ onNavigate }) {
  const { current } = useCurrentWorkspace();
  const notes = useNotifications();
  const unread = notes.data?.meta?.unread ?? 0;
  const items = [
    { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: current ? `/app/workspaces/${current.id}/projects` : '/app', label: 'Projects', icon: Boxes },
    { to: '/app/activity', label: 'Activity', icon: Activity },
    { to: '/app/notifications', label: 'Notifications', icon: Bell, badge: unread },
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ];
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <Link to="/app" onClick={onNavigate} className="px-1">
        <Logo />
      </Link>
      <WorkspaceSwitcher />
      <nav className="space-y-0.5" aria-label="App">
        {items.map((it) => (
          <NavLink
            key={it.label}
            to={it.to}
            end={it.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-fg-soft hover:bg-raised hover:text-fg',
                isActive && 'bg-raised font-medium text-fg',
              )
            }
          >
            <it.icon className="size-4" aria-hidden />
            {it.label}
            {!!it.badge && (
              <span className="tabular ml-auto rounded-full bg-accent-solid px-1.5 text-[11px] font-medium text-accent-fg">
                {it.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-0.5 border-t border-line pt-4">
        <Link
          to="/demo"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-fg-soft hover:bg-raised hover:text-fg"
        >
          <Radar className="size-4" /> Public demo
        </Link>
        <Link
          to="/docs"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-fg-soft hover:bg-raised hover:text-fg"
        >
          <BookOpen className="size-4" /> Docs and rules
        </Link>
      </div>
    </div>
  );
}

function Breadcrumbs() {
  const crumbs = useCrumbList();
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />}
            {c.to && i < crumbs.length - 1 ? (
              <Link to={c.to} className="truncate text-muted hover:text-fg">
                {c.label}
              </Link>
            ) : (
              <span
                className="truncate font-medium"
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              >
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
          aria-label="Account menu"
        >
          {user.name.slice(0, 1).toUpperCase()}
        </button>
      </MenuTrigger>
      <MenuContent>
        <div className="px-2.5 py-2">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted">{user.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem onSelect={() => navigate('/app/settings')}>
          <Settings className="size-4" /> Settings
        </MenuItem>
        <MenuItem
          onSelect={async () => {
            await signOut();
            navigate('/');
          }}
        >
          <LogOut className="size-4" /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Shell() {
  const [mobile, setMobile] = useState(false);
  const notes = useNotifications();
  const unread = notes.data?.meta?.unread ?? 0;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-sunken/40 lg:block">
        <Sidebar />
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobile(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-line bg-bg">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3"
              aria-label="Close navigation"
              onClick={() => setMobile(false)}
            >
              <X className="size-5" />
            </Button>
            <Sidebar onNavigate={() => setMobile(false)} />
          </div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <MenuIcon className="size-5" />
          </Button>
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1.5">
            <CommandPalette />
            <Link
              to="/app/notifications"
              className="relative rounded-md p-2 text-fg-soft hover:bg-raised hover:text-fg"
              aria-label={`Notifications, ${unread} unread`}
            >
              <Bell className="size-4" />
              {unread > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent" />}
            </Link>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main id="app-main" className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading your workspace" />
      </div>
    );
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return (
    <WorkspaceProvider>
      <CrumbProvider>
        <Shell />
      </CrumbProvider>
    </WorkspaceProvider>
  );
}
