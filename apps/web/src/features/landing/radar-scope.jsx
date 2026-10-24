import { useEffect, useMemo, useRef, useState } from 'react';
import { SEVERITY_LABEL } from '@jky/radar-core';

/** @import { Finding, FindingSeverity } from '@jky/radar-core' */

/**
 * The scope's rings are its legend: the closer a contact sits to the centre, the more it breaks.
 * Each band is [inner radius, outer radius] in a 200-unit viewBox centred on 0,0.
 * @type {Array<{ severity: FindingSeverity; band: [number, number]; color: string; short: string }>}
 */
export const RINGS = [
  { severity: 'breaking', band: [12, 30], color: 'var(--scope-breaking)', short: 'breaking' },
  { severity: 'potentially_breaking', band: [33, 50], color: 'var(--scope-potential)', short: 'potential' },
  { severity: 'needs_review', band: [53, 70], color: 'var(--scope-review)', short: 'review' },
  { severity: 'non_breaking', band: [73, 88], color: 'var(--scope-safe)', short: 'safe' },
];
const RING_BY_SEV = Object.fromEntries(RINGS.map((r) => [r.severity, r]));

const PERIOD_MS = 6000; // one revolution
const GLOW_MS = 2600; // how long a contact stays lit after the sweep passes
const TRAIL_DEG = 54;
const REST = 0.42; // contacts stay readable between sweeps
const LABEL_SECTOR = 16; // bearings near north are kept clear for the ring labels
const TRAIL_SLICES = 40;

/** Small, stable string hash so a finding always lands on the same bearing. @param {string} s */
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** @param {number} r @param {number} deg 0 = north, clockwise */
const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
};
/** SVG path for a ring sector between two bearings. @param {number} r @param {number} a0 @param {number} a1 */
const wedge = (r, a0, a1) => {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
};

/**
 * @typedef {{ finding: Finding; bearing: number; x: number; y: number; color: string }} Contact
 */

/**
 * Places findings on the scope. Bearings come from the fingerprint, so the same release always draws
 * the same picture; contacts in one band are nudged apart so they never sit on top of each other.
 * @param {Finding[]} findings
 * @returns {Contact[]}
 */
function plot(findings) {
  /** @type {Contact[]} */
  const out = [];
  for (const f of findings) {
    const ring = RING_BY_SEV[f.severity];
    if (!ring) continue;
    const h = hash(f.fingerprint);
    let bearing = LABEL_SECTOR + (h % (360 - 2 * LABEL_SECTOR));
    const peers = out.filter((c) => c.finding.severity === f.severity);
    for (
      let tries = 0;
      tries < 12 && peers.some((c) => Math.abs(((c.bearing - bearing + 540) % 360) - 180) < 24);
      tries++
    )
      bearing = LABEL_SECTOR + ((bearing - LABEL_SECTOR + 37) % (360 - 2 * LABEL_SECTOR));
    const [lo, hi] = ring.band;
    const r = lo + 3 + (((h >>> 9) % 1000) / 1000) * (hi - lo - 6);
    const [x, y] = polar(r, bearing);
    out.push({ finding: f, bearing, x, y, color: ring.color });
  }
  return out;
}

/**
 * The hero instrument. Draws the live engine's findings as contacts; the sweep lights each one as it
 * passes and the readout below names the most recent contact.
 * @param {{ findings: Finding[] | null; className?: string }} props
 */
export function RadarScope({ findings, className }) {
  const contacts = useMemo(() => plot(findings ?? []), [findings]);
  const sweepRef = useRef(/** @type {SVGGElement | null} */ (null));
  const blipRefs = useRef(/** @type {Array<SVGGElement | null>} */ ([]));
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [active, setActive] = useState(/** @type {number} */ (0));
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    setActive(0);
    if (reduced) {
      sweepRef.current?.setAttribute('transform', 'rotate(42)');
      blipRefs.current.forEach((g) => {
        g?.style.setProperty('opacity', '1');
        g?.querySelector('[data-ping]')?.setAttribute('r', '0');
      });
      return;
    }
    let raf = 0;
    let visible = true;
    let last = -1;
    const start = performance.now();
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(tick);
    });
    if (rootRef.current) io.observe(rootRef.current);

    /** @param {number} now */
    function tick(now) {
      raf = 0;
      if (!visible) return;
      const deg = (((now - start) / PERIOD_MS) * 360) % 360;
      sweepRef.current?.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
      let newest = -1;
      let newestAge = Infinity;
      contacts.forEach((c, i) => {
        const g = blipRefs.current[i];
        if (!g) return;
        const age = (((deg - c.bearing + 360) % 360) / 360) * PERIOD_MS;
        const glow = Math.max(0, 1 - age / GLOW_MS);
        g.style.opacity = (REST + (1 - REST) * glow).toFixed(3);
        const ping = g.querySelector('[data-ping]');
        if (ping) {
          const t = Math.min(1, age / 1100);
          ping.setAttribute('r', (2 + t * 11).toFixed(2));
          ping.setAttribute('stroke-opacity', (0.9 * (1 - t)).toFixed(3));
        }
        if (age < newestAge) {
          newestAge = age;
          newest = i;
        }
      });
      if (newest !== last && newest >= 0) {
        last = newest;
        setActive(newest);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [contacts, reduced]);

  const counts = useMemo(() => {
    /** @type {Record<string, number>} */
    const c = {};
    for (const x of contacts) c[x.finding.severity] = (c[x.finding.severity] ?? 0) + 1;
    return c;
  }, [contacts]);
  const label =
    findings === null
      ? 'Radar scope: starting the engine.'
      : `Radar scope showing ${contacts.length} contacts: ${RINGS.map((r) => `${counts[r.severity] ?? 0} ${SEVERITY_LABEL[r.severity].toLowerCase()}`).join(', ')}.`;
  const current = contacts[active] ?? null;

  return (
    <div ref={rootRef} className={className}>
      <svg viewBox="-104 -104 208 208" className="block h-auto w-full" role="img" aria-label={label}>
        <defs>
          <radialGradient id="scope-face" r="0.5">
            <stop offset="0" stopColor="#0e2654" />
            <stop offset="1" stopColor="#06112a" />
          </radialGradient>
        </defs>
        <circle r="94" fill="url(#scope-face)" stroke="var(--scope-grid)" strokeWidth="0.6" />

        {/* bearing ticks */}
        {Array.from({ length: 72 }, (_, i) => {
          const deg = i * 5;
          const major = deg % 30 === 0;
          const [x0, y0] = polar(major ? 89 : 91.5, deg);
          const [x1, y1] = polar(94, deg);
          return (
            <line
              key={deg}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={major ? 'var(--scope-muted)' : 'var(--scope-grid)'}
              strokeWidth={major ? 0.6 : 0.4}
            />
          );
        })}
        {Array.from({ length: 12 }, (_, i) => {
          const [x, y] = polar(99.5, i * 30);
          return (
            <text
              key={i}
              x={x}
              y={y}
              fill="var(--scope-muted)"
              fontSize="4"
              textAnchor="middle"
              dominantBaseline="central"
              className="font-mono"
            >
              {String(i * 30).padStart(3, '0')}
            </text>
          );
        })}

        {/* severity rings, which double as the legend */}
        {RINGS.map((r) => (
          <circle
            key={r.severity}
            r={r.band[1]}
            fill="none"
            stroke="var(--scope-grid)"
            strokeWidth="0.5"
            strokeDasharray={r.severity === 'breaking' ? undefined : '1 1.4'}
          />
        ))}
        <line x1="-94" y1="0" x2="94" y2="0" stroke="var(--scope-grid-soft)" strokeWidth="0.4" />
        <line x1="0" y1="-94" x2="0" y2="94" stroke="var(--scope-grid-soft)" strokeWidth="0.4" />
        {RINGS.map((r) => (
          <text
            key={r.severity}
            x="1.6"
            y={-r.band[1] + 4.2}
            fill={r.color}
            fillOpacity="0.85"
            fontSize="3.4"
            className="font-mono"
          >
            {r.short}
          </text>
        ))}

        {/* the sweep */}
        <g ref={sweepRef}>
          {Array.from({ length: TRAIL_SLICES }, (_, i) => {
            const step = TRAIL_DEG / TRAIL_SLICES;
            return (
              <path
                key={i}
                d={wedge(94, -(i + 1) * step, -i * step + 0.3)}
                fill="var(--scope-phosphor)"
                fillOpacity={(0.2 * (1 - i / TRAIL_SLICES) ** 1.6).toFixed(3)}
              />
            );
          })}
          <line x1="0" y1="0" x2="0" y2="-94" stroke="var(--scope-phosphor)" strokeWidth="0.9" />
        </g>

        {/* contacts */}
        {contacts.map((c, i) => (
          <g
            key={c.finding.fingerprint}
            ref={(el) => {
              blipRefs.current[i] = el;
            }}
            style={{ opacity: REST }}
          >
            <circle data-ping cx={c.x} cy={c.y} r="0" fill="none" stroke={c.color} strokeWidth="0.6" />
            <circle cx={c.x} cy={c.y} r="5" fill={c.color} fillOpacity="0.16" />
            <circle cx={c.x} cy={c.y} r="2.1" fill={c.color} />
          </g>
        ))}
        {current && (
          <circle
            cx={current.x}
            cy={current.y}
            r="7.5"
            fill="none"
            stroke="var(--scope-text)"
            strokeOpacity="0.7"
            strokeWidth="0.5"
            strokeDasharray="2 1.6"
          />
        )}
        <circle r="1.8" fill="var(--scope-phosphor)" />
      </svg>

      {/* readout: the contact the sweep passed most recently */}
      <div className="mt-4 min-h-[76px] rounded-lg border border-[color:var(--scope-grid)] bg-[rgba(4,12,30,0.55)] px-4 py-3">
        {findings === null ? (
          <p className="font-mono text-xs text-[color:var(--scope-muted)]">Starting engine…</p>
        ) : current ? (
          <>
            <p className="flex items-center gap-2 text-xs">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: current.color }}
                aria-hidden
              />
              <span style={{ color: current.color }}>{SEVERITY_LABEL[current.finding.severity]}</span>
              <span className="ml-auto truncate font-mono text-[11px] text-[color:var(--scope-muted)]">
                {current.finding.ruleId}
              </span>
            </p>
            <p className="mt-1 truncate text-[15px] font-medium text-[color:var(--scope-text)]">
              {current.finding.title}
            </p>
            <p className="truncate font-mono text-[11.5px] text-[color:var(--scope-text-soft)]">
              {current.finding.logicalPath}
            </p>
          </>
        ) : (
          <p className="text-sm text-[color:var(--scope-text-soft)]">
            Clear scope: nothing in this release affects existing clients.
          </p>
        )}
      </div>
    </div>
  );
}
