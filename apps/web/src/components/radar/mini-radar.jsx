import { cn } from '@/lib/cn';

// Bearings (degrees) and radii (% of the scope) of the contacts drawn on the mini radar.
const BLIPS = [
  { bearing: 62, r: 24, cls: 'bg-breaking' },
  { bearing: 205, r: 30, cls: 'bg-breaking' },
  { bearing: 128, r: 52, cls: 'bg-potential' },
  { bearing: 300, r: 70, cls: 'bg-safe' },
];
const SWEEP_S = 5;

/**
 * A small animated radar: CSS-only (a rotating conic gradient and timed pings), so it costs
 * almost nothing and stays smooth. Purely decorative.
 * @param {{ className?: string }} props
 */
export function MiniRadar({ className }) {
  return (
    <div className={cn('relative mx-auto aspect-square w-full max-w-[22rem]', className)} aria-hidden>
      <svg viewBox="-100 -100 200 200" className="absolute inset-0 size-full text-line-strong">
        {[25, 50, 75, 98].map((r) => (
          <circle key={r} r={r} fill="none" stroke="currentColor" strokeWidth="0.6" />
        ))}
        <line x1="-98" y1="0" x2="98" y2="0" stroke="currentColor" strokeWidth="0.4" opacity="0.6" />
        <line x1="0" y1="-98" x2="0" y2="98" stroke="currentColor" strokeWidth="0.4" opacity="0.6" />
      </svg>
      {/* the sweep: a rotating conic gradient, composited on the GPU */}
      <div
        className="auth-sweep absolute inset-[1%] rounded-full"
        style={{ animationDuration: `${SWEEP_S}s` }}
      />
      {BLIPS.map((b) => {
        const a = (b.bearing * Math.PI) / 180;
        return (
          <span
            key={b.bearing}
            className="absolute size-0"
            style={{ left: `${50 + (b.r / 2) * Math.sin(a)}%`, top: `${50 - (b.r / 2) * Math.cos(a)}%` }}
          >
            <span
              className={cn('auth-ping absolute -top-4 -left-4 size-8 rounded-full', b.cls)}
              style={{ animationDuration: `${SWEEP_S}s`, animationDelay: `${(b.bearing / 360) * SWEEP_S}s` }}
            />
            <span
              className={cn('auth-blip absolute -top-1.5 -left-1.5 size-3 rounded-full', b.cls)}
              style={{ animationDuration: `${SWEEP_S}s`, animationDelay: `${(b.bearing / 360) * SWEEP_S}s` }}
            />
          </span>
        );
      })}
      <span className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
    </div>
  );
}
