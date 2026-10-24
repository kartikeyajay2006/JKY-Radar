import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { SEVERITY_LABEL } from '@jky/radar-core';

/** @import { Finding, FindingSeverity } from '@jky/radar-core' */

const RADIUS = 4.3;
const PERIOD_MS = 5200; // one revolution of the sweep
const TRAIL = 1.05; // radians of fading trail behind the sweep
const LABEL_SECTOR = 18; // degrees either side of north kept clear for ring labels
const TAU = Math.PI * 2;

/**
 * The rings are the legend: the closer a contact sits to the centre, the more it breaks.
 * `band` is [inner, outer] radius in scene units; `height` is the contact's beam height.
 * @type {Array<{ severity: FindingSeverity; band: [number, number]; token: string; short: string; height: number }>}
 */
export const RINGS = [
  { severity: 'breaking', band: [0.45, 1.3], token: '--breaking', short: 'breaking', height: 1.05 },
  {
    severity: 'potentially_breaking',
    band: [1.45, 2.3],
    token: '--potential',
    short: 'potential',
    height: 0.75,
  },
  { severity: 'needs_review', band: [2.45, 3.25], token: '--review', short: 'review', height: 0.55 },
  { severity: 'non_breaking', band: [3.4, 4.15], token: '--safe', short: 'safe', height: 0.38 },
];
const RING_BY_SEV = Object.fromEntries(RINGS.map((r) => [r.severity, r]));

/** @param {string} s */
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * @typedef {{ finding: Finding; bearing: number; r: number; x: number; z: number; token: string; height: number }} Contact
 */

/**
 * Stable placement: the bearing comes from the finding's fingerprint, so a release always draws
 * the same picture. Contacts in one band are nudged apart so they never overlap.
 * @param {Finding[]} findings
 * @returns {Contact[]}
 */
function plot(findings) {
  /** @type {Contact[]} */
  const out = [];
  const span = 360 - 2 * LABEL_SECTOR;
  for (const f of findings) {
    const ring = RING_BY_SEV[f.severity];
    if (!ring) continue;
    const h = hash(f.fingerprint);
    let bearing = LABEL_SECTOR + (h % span);
    const peers = out.filter((c) => c.finding.severity === f.severity);
    for (
      let tries = 0;
      tries < 12 && peers.some((c) => Math.abs(((c.bearing - bearing + 540) % 360) - 180) < 26);
      tries++
    )
      bearing = LABEL_SECTOR + ((bearing - LABEL_SECTOR + 41) % span);
    const [lo, hi] = ring.band;
    const r = lo + 0.15 + (((h >>> 9) % 1000) / 1000) * (hi - lo - 0.3);
    const a = (bearing * Math.PI) / 180;
    out.push({
      finding: f,
      bearing,
      r,
      x: r * Math.sin(a),
      z: -r * Math.cos(a),
      token: ring.token,
      height: ring.height,
    });
  }
  return out;
}

/** Reads a colour token from the current theme. @param {string} token */
const themeColor = (token) =>
  new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#888');

/** Soft round glow used for contacts. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** @param {number} r @param {number} [segments] */
const circlePoints = (r, segments = 160) =>
  Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * TAU;
    return new THREE.Vector3(r * Math.sin(a), 0, -r * Math.cos(a));
  });

const easeOutCubic = (/** @type {number} */ t) => 1 - (1 - t) ** 3;
/** Frame-rate independent smoothing. @param {number} cur @param {number} target @param {number} rate @param {number} dt */
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

const DISC_VERTEX = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const DISC_FRAGMENT = /* glsl */ `
  uniform float uSweep;
  uniform float uTrail;
  uniform float uRadius;
  uniform float uIntro;
  uniform float uFill;
  uniform vec3 uAccent;
  varying vec2 vPos;
  void main() {
    float r = length(vPos) / uRadius;
    float a = atan(vPos.x, vPos.y);
    float behind = mod(uSweep - a, 6.28318530718);
    float trail = pow(1.0 - clamp(behind / uTrail, 0.0, 1.0), 2.6);
    float lead = smoothstep(0.035, 0.0, behind);
    float rim = smoothstep(1.0, 0.975, r);
    float fill = mix(uFill * 1.6, uFill * 0.5, r);
    float alpha = (fill + trail * 0.30 * (0.3 + 0.7 * r) + lead * 0.35) * rim * uIntro;
    gl_FragColor = vec4(uAccent, alpha);
  }
`;

/**
 * A live 3D radar drawn with three.js from the in-browser engine run. Each finding is a contact;
 * the sweep lights them in turn and the readout names the most recent one.
 * @param {{ findings: Finding[] | null; className?: string }} props
 */
export default function Radar3D({ findings, className }) {
  const contacts = useMemo(() => plot(findings ?? []), [findings]);
  const mountRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const labelRefs = useRef(/** @type {Array<HTMLSpanElement | null>} */ ([]));
  const contactsRef = useRef(contacts);
  const apiRef = useRef(/** @type {{ sync: () => void } | null} */ (null));
  const [active, setActive] = useState(-1);
  const [failed, setFailed] = useState(false);

  /* ------------------------------------------------------------ scene setup (once) */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /** @type {THREE.WebGLRenderer} */
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    mount.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const root = new THREE.Group();
    scene.add(root);

    /* disc with the sweep trail, drawn in a shader so the trail is perfectly smooth */
    const discMat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERTEX,
      fragmentShader: DISC_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSweep: { value: 0 },
        uTrail: { value: TRAIL },
        uRadius: { value: RADIUS },
        uIntro: { value: reduced ? 1 : 0 },
        uFill: { value: 0.05 },
        uAccent: { value: new THREE.Color() },
      },
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 128), discMat);
    disc.rotation.x = -Math.PI / 2;
    root.add(disc);

    /* rings, spokes and bearing ticks */
    const lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    const faintMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    const guides = new THREE.Group();
    for (const ring of RINGS) {
      guides.add(
        new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePoints(ring.band[1])), lineMat),
      );
    }
    guides.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePoints(RADIUS)), lineMat));
    /** @type {THREE.Vector3[]} */
    const spokes = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      spokes.push(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(RADIUS * Math.sin(a), 0, -RADIUS * Math.cos(a)),
      );
    }
    guides.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), faintMat));
    /** @type {THREE.Vector3[]} */
    const ticks = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const inner = i % 6 === 0 ? RADIUS - 0.22 : RADIUS - 0.1;
      ticks.push(
        new THREE.Vector3(inner * Math.sin(a), 0, -inner * Math.cos(a)),
        new THREE.Vector3(RADIUS * Math.sin(a), 0, -RADIUS * Math.cos(a)),
      );
    }
    guides.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), lineMat));
    guides.position.y = 0.002;
    root.add(guides);

    /* sweep arm */
    const armMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
    const arm = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.004, 0),
        new THREE.Vector3(0, 0.004, -RADIUS),
      ]),
      armMat,
    );
    root.add(arm);

    const hubMat = new THREE.MeshBasicMaterial();
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), hubMat);
    hub.position.y = 0.05;
    root.add(hub);

    /* contacts */
    const sphereGeo = new THREE.SphereGeometry(0.075, 20, 14);
    const pingGeo = new THREE.RingGeometry(0.92, 1, 64);
    const glowTex = glowTexture();
    /**
     * @typedef {{ group: THREE.Group; core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; glow: THREE.Sprite; beam: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; ping: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; contact: Contact; appear: number; target: number }} Blip
     */
    /** @type {Map<string, Blip>} */
    const blips = new Map();

    /** @param {Contact} c */
    const makeBlip = (c) => {
      const color = themeColor(c.token);
      const group = new THREE.Group();
      group.position.set(c.x, 0, c.z);
      const core = new THREE.Mesh(
        sphereGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }),
      );
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0, depthWrite: false }),
      );
      const beam = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, c.height, 0),
        ]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }),
      );
      const ping = new THREE.Mesh(
        pingGeo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ping.rotation.x = -Math.PI / 2;
      ping.position.y = 0.006;
      group.add(beam, ping, glow, core);
      root.add(group);
      return { group, core, glow, beam, ping, contact: c, appear: reduced ? 1 : 0, target: 1 };
    };
    /** @param {Blip} b */
    const disposeBlip = (b) => {
      root.remove(b.group);
      b.core.material.dispose();
      b.glow.material.dispose();
      b.beam.geometry.dispose();
      b.beam.material.dispose();
      b.ping.material.dispose();
    };

    const sync = () => {
      const next = new Set(contactsRef.current.map((c) => c.finding.fingerprint));
      for (const [fp, b] of blips) if (!next.has(fp)) b.target = 0;
      for (const c of contactsRef.current) {
        const b = blips.get(c.finding.fingerprint);
        if (b) {
          b.contact = c;
          b.target = 1;
        } else blips.set(c.finding.fingerprint, makeBlip(c));
      }
      if (reduced) frame(0, performance.now());
    };

    const applyTheme = () => {
      const accent = themeColor('--accent');
      const dark = document.documentElement.classList.contains('dark');
      discMat.uniforms.uAccent.value.copy(accent);
      discMat.uniforms.uFill.value = dark ? 0.055 : 0.04;
      lineMat.color.copy(themeColor('--line-strong'));
      faintMat.color.copy(themeColor('--line'));
      armMat.color.copy(accent);
      hubMat.color.copy(accent);
      for (const b of blips.values()) {
        const c = themeColor(b.contact.token);
        b.core.material.color.copy(c);
        b.glow.material.color.copy(c);
        b.beam.material.color.copy(c);
        b.ping.material.color.copy(c);
      }
      if (reduced) frame(0, performance.now());
    };

    /* sizing: keep the whole disc in frame at any aspect ratio */
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Distance at which the disc (plus its tick ring) fits the width, never closer than a calm default.
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const dist = Math.max(11, (RADIUS * 1.08) / (Math.tan(halfFov) * camera.aspect));
      camera.position.set(0, dist * 0.62, dist * 0.78);
      camera.lookAt(0, -0.5, 0);
      camera.updateProjectionMatrix();
      if (reduced) frame(0, performance.now());
    };

    /* pointer parallax, eased so it never jumps */
    const pointer = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0 };
    /** @param {PointerEvent} e */
    const onPointer = (e) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
    };

    const labelPoint = new THREE.Vector3();
    let start = performance.now();
    let lastActive = -2;

    /** @param {number} dt seconds @param {number} now */
    function frame(dt, now) {
      const elapsed = now - start;
      const intro = reduced ? 1 : easeOutCubic(Math.min(1, elapsed / 1400));
      discMat.uniforms.uIntro.value = intro;
      lineMat.opacity = 0.9 * intro;
      faintMat.opacity = 0.45 * intro;
      root.scale.setScalar(0.94 + 0.06 * intro);

      const sweepDeg = reduced ? 48 : ((elapsed / PERIOD_MS) * 360) % 360;
      const sweep = (sweepDeg * Math.PI) / 180;
      discMat.uniforms.uSweep.value = sweep;
      arm.rotation.y = -sweep;
      armMat.opacity = 0.95 * intro;

      if (!reduced) {
        tilt.x = damp(tilt.x, pointer.y * 0.07, 2.5, dt);
        tilt.y = damp(tilt.y, pointer.x * 0.16, 2.5, dt);
        root.rotation.x = tilt.x;
        root.rotation.y = tilt.y;
      }

      let newest = -1;
      let newestAge = Infinity;
      for (const [fp, b] of blips) {
        b.appear = reduced ? b.target : damp(b.appear, b.target, 5, dt);
        if (b.target === 0 && b.appear < 0.01) {
          disposeBlip(b);
          blips.delete(fp);
          continue;
        }
        const age = reduced ? 0 : (((sweepDeg - b.contact.bearing + 360) % 360) / 360) * PERIOD_MS;
        const glow = Math.exp(-age / 1100);
        const a = b.appear;
        b.group.position.x = damp(b.group.position.x, b.contact.x, 6, reduced ? 1e3 : dt);
        b.group.position.z = damp(b.group.position.z, b.contact.z, 6, reduced ? 1e3 : dt);
        b.core.position.y = b.contact.height * (0.82 + 0.18 * glow);
        b.core.scale.setScalar(a * (1 + 0.35 * glow));
        b.core.material.opacity = a * (0.6 + 0.4 * glow);
        b.glow.position.y = b.core.position.y;
        b.glow.scale.setScalar(a * (0.42 + 0.62 * glow));
        b.glow.material.opacity = a * (0.22 + 0.55 * glow);
        b.beam.scale.y = a * (0.82 + 0.18 * glow);
        b.beam.material.opacity = a * (0.18 + 0.5 * glow);
        const t = reduced ? 1 : Math.min(1, age / 1500);
        b.ping.scale.setScalar(0.05 + 0.62 * easeOutCubic(t));
        b.ping.material.opacity = a * 0.75 * (1 - t) ** 2;
        if (b.target === 1 && age < newestAge) {
          newestAge = age;
          newest = contactsRef.current.findIndex((c) => c.finding.fingerprint === fp);
        }
      }
      if (newest !== lastActive) {
        lastActive = newest;
        setActive(newest);
      }

      renderer.render(scene, camera);

      // ring labels follow the tilted disc
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      RINGS.forEach((ring, i) => {
        const el = labelRefs.current[i];
        if (!el) return;
        labelPoint
          .set(0.12, 0, -ring.band[1] + 0.2)
          .applyMatrix4(root.matrixWorld)
          .project(camera);
        el.style.transform = `translate3d(${((labelPoint.x + 1) / 2) * w}px, ${((1 - labelPoint.y) / 2) * h}px, 0)`;
        el.style.visibility = 'visible';
      });
    }

    /* loop: time-based, clamped after tab switches, paused offscreen */
    let raf = 0;
    let visible = true;
    let last = performance.now();
    /** @param {number} now */
    const loop = (now) => {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame(dt, now);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf && !reduced) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    });
    io.observe(mount);
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true });

    apiRef.current = { sync };
    resize();
    sync();
    applyTheme();
    start = performance.now();
    if (reduced) frame(0, performance.now());
    else raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('pointermove', onPointer);
      for (const b of blips.values()) disposeBlip(b);
      scene.traverse((o) => {
        const m = /** @type {any} */ (o);
        m.geometry?.dispose?.();
        if (m.material && !Array.isArray(m.material)) m.material.dispose?.();
      });
      sphereGeo.dispose();
      pingGeo.dispose();
      glowTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
    };
  }, []);

  /* ------------------------------------------------------------ new engine results */
  useEffect(() => {
    contactsRef.current = contacts;
    apiRef.current?.sync();
  }, [contacts]);

  const counts = useMemo(() => {
    /** @type {Record<string, number>} */
    const c = {};
    for (const x of contacts) c[x.finding.severity] = (c[x.finding.severity] ?? 0) + 1;
    return c;
  }, [contacts]);
  const current = contacts[active] ?? null;
  const label =
    findings === null
      ? 'Radar: starting the engine.'
      : `Radar showing ${contacts.length} findings: ${RINGS.map((r) => `${counts[r.severity] ?? 0} ${SEVERITY_LABEL[r.severity].toLowerCase()}`).join(', ')}.`;

  return (
    <div className={className}>
      <div ref={mountRef} role="img" aria-label={label} className="relative aspect-[1.32] w-full">
        {failed && (
          <p className="absolute inset-0 grid place-items-center text-sm text-muted">
            The 3D radar needs WebGL. The findings are listed in the console below.
          </p>
        )}
        {!failed &&
          RINGS.map((r, i) => (
            <span
              key={r.severity}
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className="radar-label invisible font-mono text-[10px]"
              style={{ color: `var(${r.token})` }}
              aria-hidden
            >
              {r.short}
            </span>
          ))}
      </div>

      <div className="panel mt-3 min-h-[78px] px-4 py-3 shadow-[var(--shadow)]">
        {findings === null ? (
          <p className="text-sm text-muted">Starting engine…</p>
        ) : current ? (
          <div key={current.finding.fingerprint} className="animate-[readout-in_.35s_ease-out]">
            <p className="flex items-center gap-2 text-xs">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: `var(${current.token})` }}
              />
              <span style={{ color: `var(${current.token})` }}>
                {SEVERITY_LABEL[current.finding.severity]}
              </span>
              <span className="ml-auto truncate font-mono text-[11px] text-muted">
                {current.finding.ruleId}
              </span>
            </p>
            <p className="mt-1 truncate text-[15px] font-medium">{current.finding.title}</p>
            <p className="truncate font-mono text-[11.5px] text-muted">{current.finding.logicalPath}</p>
          </div>
        ) : (
          <p className="text-sm text-fg-soft">
            Clear radar: nothing in this release affects existing clients.
          </p>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-fg-soft">
        {RINGS.map((r) => (
          <li key={r.severity} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: `var(${r.token})` }} aria-hidden />
            {r.short}
            <span className="tabular font-mono text-muted">{counts[r.severity] ?? 0}</span>
          </li>
        ))}
        <li className="text-muted sm:ml-auto">Closer to the centre breaks more</li>
      </ul>
    </div>
  );
}
