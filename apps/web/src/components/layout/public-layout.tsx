import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Menu as MenuIcon, X } from 'lucide-react';
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
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="JKY-Radar home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm text-fg-soft hover:text-fg',
                    isActive && l.to === '/demo' && 'text-fg',
                  )
                }
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
          <nav className="border-t border-line px-4 py-3 md:hidden" aria-label="Mobile">
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
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto grid grid-cols-1 max-w-7xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-3">
            <Logo />
            <p className="max-w-xs text-muted">One Radar. Every API. Know what breaks before you ship.</p>
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
