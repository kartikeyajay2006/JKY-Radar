import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionDTO, UserDTO } from '@jky/shared';
import { api, setCsrfToken } from './api';

interface AuthState {
  user: UserDTO | null;
  loading: boolean;
  signIn: (s: SessionDTO) => void;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const r = await api.get<SessionDTO | null>('/auth/session');
      if (!r.data) return null;
      setCsrfToken(r.data.csrfToken);
      return r.data.user;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const value: AuthState = {
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
