// Spring physics as pure functions. No DOM, no clock: the engine and the loop recorder both call these.
//
// Parameters are Apple's two designer-facing ones (WWDC 2018, "Designing Fluid Interfaces"):
//   damping:  damping ratio. 1 = critically damped, no overshoot. Below 1 it overshoots.
//   response: seconds for one undamped period. Lower is snappier. It is not a duration; settle time emerges.
// Mass is 1, so stiffness = (2π / response)² and friction = 4π · damping / response.

export type SpringConfig = { damping: number; response: number };
export type SpringState = { x: number; v: number };

export const SPRING = {
  ui: { damping: 1, response: 0.35 }, // default for everything: graceful, no overshoot
  move: { damping: 1, response: 0.4 }, // reposition (reorder, thumb, inspector)
  press: { damping: 1, response: 0.16 }, // pointer-down feedback
  flick: { damping: 0.8, response: 0.3 }, // only after a gesture that carried momentum
  fade: { damping: 1, response: 0.2 }, // reduced-motion cross-fade
} as const satisfies Record<string, SpringConfig>;

// Exact solution of x'' = -k(x - target) - c·x' after dt seconds.
// It is exact, so one 16 ms step and sixteen 1 ms steps land on the same value: frame rate never changes the path.
export function stepSpring(s: SpringState, target: number, cfg: SpringConfig, dt: number): SpringState {
  const w0 = (2 * Math.PI) / cfg.response;
  const z = cfg.damping;
  const y0 = s.x - target;
  const v0 = s.v;
  let y: number, v: number;
  if (z < 1) {
    const a = z * w0;
    const wd = w0 * Math.sqrt(1 - z * z);
    const e = Math.exp(-a * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
    y = e * (y0 * c + ((v0 + a * y0) / wd) * sn);
    v = e * (v0 * c - ((a * v0 + w0 * w0 * y0) / wd) * sn);
  } else if (z === 1) {
    const e = Math.exp(-w0 * dt), k = v0 + w0 * y0;
    y = e * (y0 + k * dt);
    v = e * (v0 - w0 * k * dt);
  } else {
    const q = w0 * Math.sqrt(z * z - 1);
    const r1 = -z * w0 + q, r2 = -z * w0 - q;
    const c1 = (v0 - r2 * y0) / (r1 - r2), c2 = y0 - c1;
    const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
    y = c1 * e1 + c2 * e2;
    v = c1 * r1 * e1 + c2 * r2 * e2;
  }
  return { x: target + y, v };
}

export const atRest = (s: SpringState, target: number, eps = 0.001) =>
  Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 20;

// Where a flick comes to rest under exponential scroll deceleration. This is the form Apple ships,
// not the textbook v²/2a. velocity is in px/s.
export const project = (velocity: number, decelerationRate = 0.998) =>
  ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);

// Progressive resistance past a boundary: the further you pull, the less it follows. Never exceeds `dimension`.
export const rubberband = (overshoot: number, dimension: number, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

// Release velocity from the last ~100 ms of pointer samples. A finger that stopped before lifting carries none.
export function velocityTracker(windowMs = 100) {
  const pts: [number, number][] = [];
  return {
    add(tMs: number, x: number) {
      const last = pts[pts.length - 1];
      if (last && last[0] === tMs) last[1] = x; // same timestamp (coalesced events): keep the newest position
      else pts.push([tMs, x]);
      while (pts.length > 2 && tMs - pts[0]![0] > windowMs) pts.shift();
    },
    // px/s at time `nowMs`
    get(nowMs: number): number {
      const a = pts[0], b = pts[pts.length - 1];
      if (!a || !b || a === b || nowMs - b[0] > windowMs) return 0;
      return ((b[1] - a[1]) / (b[0] - a[0])) * 1000;
    },
  };
}
