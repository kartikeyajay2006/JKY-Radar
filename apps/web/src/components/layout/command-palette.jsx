import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Moon,
  Radar,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { GateBadge } from '@/components/radar/badges';
import { Kbd } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useProjects, useWorkspaceAnalyses } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { useCurrentWorkspace } from './workspace';

/** @import { ReactNode } from 'react' */

/**
 * @typedef {Object} Command
 * @property {string} id
 * @property {string} group
 * @property {string} label
 * @property {string} [hint]
 * @property {ReactNode} icon
 * @property {ReactNode} [trailing]
 * @property {string} [keywords]
 * @property {() => void} run
 */

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl K';

/**
 * Every word of the query must appear somewhere in the label, hint or keywords.
 * Labels that start with the query rank first.
 * @param {Command[]} items
 * @param {string} query
 */
function filter(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const words = q.split(/\s+/);
  const groupOrder = [...new Set(items.map((c) => c.group))];
  return (
    items
      .map((c) => {
        const hay = `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const label = c.label.toLowerCase();
        return { c, score: label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2 };
      })
      .filter((x) => x !== null)
      // Keep groups together (in their original order) and rank matches within each group.
      .sort((a, b) => groupOrder.indexOf(a.c.group) - groupOrder.indexOf(b.c.group) || a.score - b.score)
      .map((x) => x.c)
  );
}

/** @param {{ onClose: () => void }} props */
function PaletteBody({ onClose }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { resolved, setPref } = useTheme();
  const { workspaces, current, setCurrent } = useCurrentWorkspace();
  const projects = useProjects(current?.id);
  const analyses = useWorkspaceAnalyses(current?.id, 1);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef(/** @type {HTMLUListElement | null} */ (null));

  /** @param {string} to */
  const go = (to) => () => {
    onClose();
    navigate(to);
  };

  /** @type {Command[]} */
  const commands = useMemo(() => {
    const wid = current?.id;
    /** @type {Command[]} */
    const list = [
      { id: 'p-overview', group: 'Go to', label: 'Overview', icon: <LayoutDashboard />, run: go('/app') },
      {
        id: 'p-projects',
        group: 'Go to',
        label: 'Projects',
        icon: <Boxes />,
        run: go(wid ? `/app/workspaces/${wid}/projects` : '/app'),
      },
      {
        id: 'p-activity',
        group: 'Go to',
        label: 'Activity and audit log',
        icon: <Activity />,
        run: go('/app/activity'),
      },
      {
        id: 'p-notes',
        group: 'Go to',
        label: 'Notifications',
        icon: <Bell />,
        run: go('/app/notifications'),
      },
      {
        id: 'p-settings',
        group: 'Go to',
        label: 'Settings and members',
        icon: <Settings />,
        keywords: 'invite team roles profile',
        run: go('/app/settings'),
      },
      { id: 'p-demo', group: 'Go to', label: 'Public demo', icon: <Radar />, run: go('/demo') },
      {
        id: 'p-rules',
        group: 'Go to',
        label: 'Rule catalog',
        icon: <BookOpen />,
        keywords: 'docs',
        run: go('/docs/rules'),
      },
    ];
    for (const p of projects.data ?? []) {
      list.push({
        id: `pr-${p.id}`,
        group: 'Projects',
        label: p.name,
        hint: `${p.versionCount} versions`,
        icon: <Boxes />,
        trailing: p.latestAnalysis?.gate ? <GateBadge decision={p.latestAnalysis.gate} /> : null,
        keywords: `${p.protocol} ${p.slug}`,
        run: go(`/app/projects/${p.id}`),
      });
      list.push({
        id: `pc-${p.id}`,
        group: 'Projects',
        label: `Compare versions in ${p.name}`,
        icon: <FileSearch />,
        keywords: 'analysis run diff',
        run: go(`/app/projects/${p.id}/compare`),
      });
    }
    for (const a of analyses.data?.data ?? []) {
      list.push({
        id: `an-${a.id}`,
        group: 'Recent analyses',
        label: `${a.projectName ?? 'Analysis'}: ${a.baseline.label} to ${a.candidate.label}`,
        icon: <Radar />,
        trailing: a.gate ? <GateBadge decision={a.gate} /> : null,
        keywords: `${a.gate ?? ''} ${a.reviewStatus}`,
        run: go(`/app/analyses/${a.id}`),
      });
    }
    for (const w of workspaces) {
      if (w.id === wid) continue;
      list.push({
        id: `ws-${w.id}`,
        group: 'Workspaces',
        label: `Switch to ${w.name}`,
        icon: <Building2 />,
        run: () => {
          setCurrent(w.id);
          onClose();
          navigate(`/app/workspaces/${w.id}/projects`);
        },
      });
    }
    list.push(
      {
        id: 'a-theme',
        group: 'Actions',
        label: resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: resolved === 'dark' ? <Sun /> : <Moon />,
        keywords: 'appearance mode',
        run: () => {
          setPref(resolved === 'dark' ? 'light' : 'dark');
          onClose();
        },
      },
      {
        id: 'a-signout',
        group: 'Actions',
        label: 'Sign out',
        icon: <LogOut />,
        keywords: 'logout',
        run: async () => {
          onClose();
          await signOut();
          navigate('/');
        },
      },
    );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.data, analyses.data, workspaces, current, resolved]);

  const results = useMemo(() => filter(commands, query), [commands, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  /** @param {import('react').KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(results.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-muted" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search projects, analyses and pages"
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
          aria-label="Search commands"
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Commands"
        className="scroll-thin max-h-[min(60vh,420px)] overflow-y-auto p-2"
      >
        {results.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-muted" role="presentation">
            Nothing matches “{query}”.
          </li>
        )}
        {results.map((c, i) => {
          const heading = c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <li key={c.id} role="presentation">
              {heading && (
                <div className="px-3 pt-3 pb-1.5 text-xs font-medium text-muted" role="presentation">
                  {heading}
                </div>
              )}
              <div
                id={`${listId}-${c.id}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => c.run()}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0',
                  i === active ? 'bg-accent-soft text-fg' : 'text-fg-soft',
                )}
              >
                <span className="text-muted">{c.icon}</span>
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="shrink-0 text-xs text-muted">{c.hint}</span>}
                {c.trailing}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Enter</Kbd> to open
        </span>
      </div>
    </>
  );
}

/**
 * Ctrl/⌘ K anywhere in the app opens a searchable list of pages, projects, recent analyses,
 * workspaces and actions.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-64 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-sm text-muted hover:border-line-strong md:flex"
        aria-label={`Search (${PALETTE_SHORTCUT})`}
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1">Search</span>
        <Kbd>{PALETTE_SHORTCUT}</Kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md p-2 text-fg-soft hover:bg-raised hover:text-fg md:hidden"
        aria-label="Search"
      >
        <Search className="size-4" />
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
          <DialogPrimitive.Content
            className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow)] focus:outline-none"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
            {open && <PaletteBody onClose={() => setOpen(false)} />}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
