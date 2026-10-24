import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Github, Menu as MenuIcon, X } from 'lucide-react';
import { Logo } from '@/components/radar/logo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './theme-toggle';

const links = [
  { to: '/demo', label: 'Live demo' },
  { to: '/docs', label: 'Docs' },
  { to: '/docs#formats', label: 'Formats' },
  { to: '/docs/rules', label: 'Rules' },
];

export function PublicLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header
        className={cn(
          'sticky top-0 z-40 border-b bg-bg/80 backdrop-blur-md transition-[border-color,box-shadow] duration-300',
          scrolled ? 'border-line shadow-[0_8px_24px_-16px_rgba(0,0,0,0.45)]' : 'border-transparent',
        )}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="JKY-Radar home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => {
                  const active =
                    isActive && !l.to.includes('#') && (l.to !== '/docs' || pathname === '/docs');
                  return cn(
                    'relative rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-raised hover:text-fg',
                    active ? 'text-fg' : 'text-fg-soft',
                    active &&
                      'after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-accent',
                  );
                }}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <Link to="/app">
                <Button variant="primary" size="sm">
                  Open workspace
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden px-2 text-sm text-fg-soft hover:text-fg sm:block">
                  Sign in
                </Link>
                <Link to="/register" className="hidden sm:block">
                  <Button variant="primary" size="sm">
                    Create free account
                  </Button>
                </Link>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="size-5" /> : <MenuIcon className="size-5" />}
            </Button>
          </div>
        </div>
        {open && (
          <nav className="menu-in border-t border-line px-4 py-3 md:hidden" aria-label="Mobile">
            {[
              ...links,
              ...(user
                ? []
                : [
                    { to: '/login', label: 'Sign in' },
                    { to: '/register', label: 'Create free account' },
                  ]),
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="block rounded-md px-2 py-2 text-sm text-fg-soft hover:bg-raised"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        <div key={pathname} className="page-in">
          <Outlet />
        </div>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto grid grid-cols-1 max-w-7xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-3">
            <Logo />
            <p className="max-w-xs text-muted">One Radar. Every API. Know what breaks before you ship.</p>
            <a
              href="https://github.com/kartikeyajay2006/JKY-Radar"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-soft transition-colors hover:border-line-strong hover:text-fg"
            >
              <Github className="size-3.5" /> Source on GitHub
            </a>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Product</p>
            <Link to="/demo" className="block text-muted hover:text-fg">
              Live demo
            </Link>
            <Link to="/register" className="block text-muted hover:text-fg">
              Create account
            </Link>
            <Link to="/login" className="block text-muted hover:text-fg">
              Sign in
            </Link>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Reference</p>
            <Link to="/docs" className="block text-muted hover:text-fg">
              Documentation
            </Link>
            <Link to="/docs/rules" className="block text-muted hover:text-fg">
              Rule catalog
            </Link>
            <Link to="/docs#limitations" className="block text-muted hover:text-fg">
              Limitations
            </Link>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Trust</p>
            <Link to="/docs#security" className="block text-muted hover:text-fg">
              Security and privacy
            </Link>
            <Link to="/docs#formats" className="block text-muted hover:text-fg">
              Support matrix
            </Link>
          </div>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-7xl px-4 py-4 text-xs text-muted sm:px-6">
            JKY-Radar analyses contract documents you provide. It does not call your APIs or any third-party
            service. Demo data is synthetic.
          </p>
        </div>
      </footer>
    </div>
  );
}
