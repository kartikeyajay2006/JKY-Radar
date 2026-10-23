/** @import { ProjectDTO, Role } from '@jky/shared' */
import { NavLink, Outlet, useParams, useOutletContext } from 'react-router';
import { useEffect } from 'react';

import { ErrorState, Skeleton } from '@/components/ui/primitives';
import { ProtocolBadge } from '@/components/radar/badges';
import { useCurrentWorkspace } from '@/components/layout/workspace';
import { useProject } from '@/lib/queries';
import { cn } from '@/lib/cn';

/** @typedef {{ project: ProjectDTO & { role: Role } }} ProjectCtx */
export const useProjectCtx = () => /** @type {ProjectCtx} */ (useOutletContext());

export default function ProjectLayout() {
  const { pid } = useParams();
  const q = useProject(pid);
  const { setCurrent, current } = useCurrentWorkspace();
  useEffect(() => {
    if (q.data && current?.id !== q.data.workspaceId) setCurrent(q.data.workspaceId);
  }, [q.data, current, setCurrent]);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const p = q.data;
  const tabs = [
    { to: '', label: 'Overview', end: true },
    { to: 'versions', label: 'Versions' },
    { to: 'compare', label: 'Compare' },
    { to: 'consumers', label: 'Consumers' },
    { to: 'policies', label: 'Release policy' },
  ];
  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[26px] leading-tight font-semibold">{p.name}</h1>
          <ProtocolBadge protocol={p.protocol} />
        </div>
        {p.description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{p.description}</p>}
        <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Project sections">
          {tabs.map((t) => (
            <NavLink
              key={t.label}
              to={`/app/projects/${p.id}${t.to ? `/${t.to}` : ''}`}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  '-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap',
                  isActive
                    ? 'border-accent font-medium text-fg'
                    : 'border-transparent text-muted hover:text-fg',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet context={/** @satisfies {ProjectCtx} */ ({ project: p })} />
    </div>
  );
}
