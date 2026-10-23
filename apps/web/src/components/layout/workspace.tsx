import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceDTO } from '@jky/shared';
import { useWorkspaces } from '@/lib/queries';
import { useAuth } from '@/lib/auth';

interface WsState {
  workspaces: WorkspaceDTO[];
  current: WorkspaceDTO | null;
  setCurrent: (id: string) => void;
  loading: boolean;
}
const Ctx = createContext<WsState>({ workspaces: [], current: null, setCurrent: () => {}, loading: true });
const KEY = 'jky-workspace';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const q = useWorkspaces(!!user);
  const [id, setId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const workspaces = useMemo(() => q.data ?? [], [q.data]);
  const current = workspaces.find((w) => w.id === id) ?? workspaces[0] ?? null;
  useEffect(() => {
    if (current && current.id !== id) setId(current.id);
  }, [current, id]);
  const setCurrent = (wid: string) => {
    setId(wid);
    try {
      localStorage.setItem(KEY, wid);
    } catch {
      /* ignore */
    }
  };
  return (
    <Ctx.Provider value={{ workspaces, current, setCurrent, loading: q.isLoading }}>{children}</Ctx.Provider>
  );
}
export const useCurrentWorkspace = () => useContext(Ctx);

/* breadcrumbs */
export interface Crumb {
  label: string;
  to?: string;
}
const CrumbCtx = createContext<{ crumbs: Crumb[]; set: (c: Crumb[]) => void }>({ crumbs: [], set: () => {} });
export function CrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, set] = useState<Crumb[]>([]);
  return <CrumbCtx.Provider value={{ crumbs, set }}>{children}</CrumbCtx.Provider>;
}
export function useCrumbs(crumbs: Crumb[]) {
  const { set } = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(crumbs);
    const label = crumbs.at(-1)?.label;
    document.title = label ? `${label} · JKY-Radar` : 'JKY-Radar';
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
export const useCrumbList = () => useContext(CrumbCtx).crumbs;
