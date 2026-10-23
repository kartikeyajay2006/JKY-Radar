import { forwardRef, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/** @import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react' */

const control =
  'w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-fg placeholder:text-faint transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60 aria-[invalid=true]:border-breaking';

export const Input =
  /** @type {import('react').ForwardRefExoticComponent<InputHTMLAttributes<HTMLInputElement> & import('react').RefAttributes<HTMLInputElement>>} */ (
    forwardRef(function Input({ className, ...p }, ref) {
      return <input ref={ref} className={cn(control, 'h-9', className)} {...p} />;
    })
  );

export const Textarea =
  /** @type {import('react').ForwardRefExoticComponent<TextareaHTMLAttributes<HTMLTextAreaElement> & import('react').RefAttributes<HTMLTextAreaElement>>} */ (
    forwardRef(function Textarea({ className, ...p }, ref) {
      return (
        <textarea ref={ref} className={cn(control, 'min-h-24 py-2 leading-relaxed', className)} {...p} />
      );
    })
  );

export const Select =
  /** @type {import('react').ForwardRefExoticComponent<SelectHTMLAttributes<HTMLSelectElement> & import('react').RefAttributes<HTMLSelectElement>>} */ (
    forwardRef(function Select({ className, children, ...p }, ref) {
      return (
        <div className="relative">
          <select ref={ref} className={cn(control, 'h-9 appearance-none pr-8', className)} {...p}>
            {children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
        </div>
      );
    })
  );

/** @param {{ label: string; hint?: ReactNode; error?: string; children: (id: string, describedBy?: string) => ReactNode; className?: string; }} props */
export function Field({ label, hint, error, children, className }) {
  const id = useId();
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-fg-soft">
        {label}
      </label>
      {children(id, descId)}
      {(hint || error) && (
        <p id={descId} className={cn('text-xs', error ? 'text-breaking' : 'text-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
