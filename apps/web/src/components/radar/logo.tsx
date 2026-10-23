import { cn } from '@/lib/cn';

export function RadarMark({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-raised" />
      <circle
        cx="16"
        cy="16"
        r="10.5"
        fill="none"
        stroke="var(--accent)"
        strokeOpacity=".35"
        strokeWidth="1.4"
      />
      <circle
        cx="16"
        cy="16"
        r="5.6"
        fill="none"
        stroke="var(--accent)"
        strokeOpacity=".6"
        strokeWidth="1.4"
      />
      <g className={animated ? 'radar-sweep' : undefined}>
        <path d="M16 16 L26 11" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
      </g>
      <circle
        cx="21.6"
        cy="20.6"
        r="2"
        fill="var(--breaking)"
        className={animated ? 'radar-blip' : undefined}
      />
      <circle cx="16" cy="16" r="1.6" fill="var(--fg)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <RadarMark />
      <span className="text-[15px] font-semibold tracking-tight">
        JKY<span className="text-muted">-</span>Radar
      </span>
    </span>
  );
}
