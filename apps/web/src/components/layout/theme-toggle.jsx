import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';

/** @import { ThemePref } from '@/lib/theme' */

export function ThemeToggle() {
  const { pref, resolved, setPref } = useTheme();
  /** @type {Array<[ThemePref, string, typeof Sun]>} */
  const opts = [
    ['light', 'Light', Sun],
    ['dark', 'Dark', Moon],
    ['system', 'Match system', Monitor],
  ];
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${pref}`}>
          {resolved === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
      </MenuTrigger>
      <MenuContent>
        {opts.map(([v, label, Icon]) => (
          <MenuItem key={v} onSelect={() => setPref(v)} aria-checked={pref === v} role="menuitemradio">
            <Icon className="size-4" />
            {label}
            {pref === v && <span className="ml-auto text-xs text-accent">Active</span>}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
