import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** @import { ComponentProps, ReactNode } from 'react' */

/** @param {{ open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; }} props */
export function Dialog({ open, onOpenChange, title, description, children, footer, wide }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow)] focus:outline-none',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm text-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className="rounded-md p-1 text-muted hover:bg-raised hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;
/** @param {ComponentProps<typeof Dropdown.Content>} props */
export function MenuContent({ className, align = 'end', ...p }) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow)]',
          className,
        )}
        {...p}
      />
    </Dropdown.Portal>
  );
}
/** @param {ComponentProps<typeof Dropdown.Item>} props */
export function MenuItem({ className, ...p }) {
  return (
    <Dropdown.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fg-soft outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-raised data-[highlighted]:text-fg',
        className,
      )}
      {...p}
    />
  );
}
export const MenuSeparator = () => <Dropdown.Separator className="my-1 h-px bg-line" />;
/** @param {{ children: ReactNode }} props */
export const MenuLabel = ({ children }) => (
  <Dropdown.Label className="px-2.5 py-1 text-xs text-muted">{children}</Dropdown.Label>
);

export const Tabs = TabsPrimitive.Root;
/** @param {ComponentProps<typeof TabsPrimitive.List>} props */
export function TabsList({ className, ...p }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'no-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line',
        className,
      )}
      {...p}
    />
  );
}
/** @param {ComponentProps<typeof TabsPrimitive.Trigger>} props */
export function TabsTrigger({ className, ...p }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm whitespace-nowrap text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg',
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/** @param {{ label: ReactNode; children: ReactNode }} props */
export function Tip({ label, children }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-fg-soft shadow-[var(--shadow)]"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
export const TooltipProvider = TooltipPrimitive.Provider;
