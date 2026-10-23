/** @import { ReactNode } from 'react' */
/** @import { WorkspaceDTO } from '@jky/shared' */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { useWorkspaces } from '@/lib/queries';
import { useAuth } from '@/lib/auth';

/**
 * @typedef {Object} WsState
 * @property {WorkspaceDTO[]} workspaces
 * @property {WorkspaceDTO | null} current
 * @property {(id: string) => void} setCurrent
 * @property {boolean} loading
 */
const Ctx = createContext(
  /** @type {WsState} */ ({ workspaces: [], current: null, setCurrent: () => {}, loading: true }),
);
const KEY = 'jky-workspace';

/** @param {{ children: ReactNode }} props */
export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const q = useWorkspaces(!!user);
  const [id, setId] = useState(
    /** @type {() => string | null} */ (
      () => {
        try {
          return localStorage.getItem(KEY);
        } catch {
          return null;
        }
      }
    ),
  );
  const workspaces = useMemo(() => q.data ?? [], [q.data]);
  const current = workspaces.find((w) => w.id === id) ?? workspaces[0] ?? null;
  useEffect(() => {
    if (current && current.id !== id) setId(current.id);
  }, [current, id]);
  /** @param {string} wid */
  const setCurrent = (wid) => {
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
/**
 * @typedef {Object} Crumb
 * @property {string} label
 * @property {string} [to]
 */
const CrumbCtx = createContext(
  /** @type {{ crumbs: Crumb[]; set: (c: Crumb[]) => void }} */ ({ crumbs: [], set: () => {} }),
);
/** @param {{ children: ReactNode }} props */
export function CrumbProvider({ children }) {
  const [crumbs, set] = useState(/** @type {Crumb[]} */ ([]));
  return <CrumbCtx.Provider value={{ crumbs, set }}>{children}</CrumbCtx.Provider>;
}
/** @param {Crumb[]} crumbs */
export function useCrumbs(crumbs) {
  const { set } = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(crumbs);
    const label = crumbs.at(-1)?.label;
    document.title = label ? `${label} · JKY-Radar` : 'JKY-Radar';
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
export const useCrumbList = () => useContext(CrumbCtx).crumbs;
