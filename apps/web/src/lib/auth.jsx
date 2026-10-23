/** @import { ReactNode } from 'react' */
/** @import { SessionDTO, UserDTO } from '@jky/shared' */
import { createContext, useContext } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, setCsrfToken } from './api';

/**
 * @typedef {Object} AuthState
 * @property {UserDTO | null} user
 * @property {boolean} loading
 * @property {(s: SessionDTO) => void} signIn
 * @property {() => Promise<void>} signOut
 */
const Ctx = createContext(
  /** @type {AuthState} */ ({
    user: null,
    loading: true,
    signIn: () => {},
    signOut: async () => {},
  }),
);

/** @param {{ children: ReactNode }} props */
export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const r = await /** @type {Promise<import('@/lib/api').Envelope<SessionDTO | null>>} */ (
        api.get('/auth/session')
      );
      if (!r.data) return null;
      setCsrfToken(r.data.csrfToken);
      return r.data.user;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  /** @type {AuthState} */
  const value = {
    user: me.data ?? null,
    loading: me.isLoading,
    signIn: (s) => {
      setCsrfToken(s.csrfToken);
      qc.setQueryData(['me'], s.user);
    },
    signOut: async () => {
      try {
        await api.post('/auth/logout');
      } finally {
        setCsrfToken(null);
        qc.clear();
        qc.setQueryData(['me'], null);
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
