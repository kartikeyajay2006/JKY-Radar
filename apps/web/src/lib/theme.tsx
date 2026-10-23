import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const Ctx = createContext<{ pref: ThemePref; resolved: 'light' | 'dark'; setPref: (p: ThemePref) => void }>({
  pref: 'system',
  resolved: 'dark',
  setPref: () => {},
});

const read = (): ThemePref => {
  try {
    const v = localStorage.getItem('jky-theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(read);
  const [systemDark, setSystemDark] = useState(
    () => !window.matchMedia('(prefers-color-scheme: light)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => setSystemDark(!mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0F1217' : '#F5F6F8');
  }, [resolved]);
  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      if (p === 'system') localStorage.removeItem('jky-theme');
      else localStorage.setItem('jky-theme', p);
    } catch {
      /* storage unavailable */
    }
  }, []);
  return <Ctx.Provider value={{ pref, resolved, setPref }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
