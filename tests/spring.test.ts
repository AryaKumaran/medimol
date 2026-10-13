import { describe, expect, it } from "vitest";
import { atRest, project, rubberband, SPRING, stepSpring, velocityTracker, type SpringConfig } from "../web/src/motion/spring";
import { advance, clock, Spring } from "../web/src/motion/engine";

const run = (cfg: SpringConfig, seconds: number, dt: number, s = { x: 0, v: 0 }, target = 100) => {
  const path = [s.x];
  for (let t = 0; t < seconds - 1e-9; t += dt) path.push((s = stepSpring(s, target, cfg, dt)).x);
  return { s, path };
};

describe("stepSpring", () => {
  const configs: SpringConfig[] = [SPRING.ui, SPRING.flick, { damping: 0.5, response: 0.5 }, { damping: 1.6, response: 0.4 }];

  it("frame rate never changes the path (the solution is exact)", () => {
    for (const cfg of configs) {
      const a = run(cfg, 0.5, 1 / 60).s;
      const b = run(cfg, 0.5, 1 / 240).s;
      const c = stepSpring({ x: 0, v: 0 }, 100, cfg, 0.5);
      expect(a.x).toBeCloseTo(c.x, 6);
      expect(b.x).toBeCloseTo(c.x, 6);
      expect(a.v).toBeCloseTo(c.v, 5);
    }
  });

  it("matches the differential equation x'' = -k·x - c·x'", () => {
    for (const cfg of configs) {
      const k = (2 * Math.PI / cfg.response) ** 2, c = (4 * Math.PI * cfg.damping) / cfg.response;
      const h = 1e-5, s0 = { x: 37, v: -120 };
      const a = stepSpring(s0, 0, cfg, h);
      expect((a.v - s0.v) / h).toBeCloseTo(-k * s0.x - c * s0.v, -1); // forward difference, loose tolerance
    }
  });

  it("critically damped never overshoots; under-damped does; both settle", () => {
    const crit = run(SPRING.ui, 2, 1 / 60);
    expect(Math.max(...crit.path)).toBeLessThanOrEqual(100);
    expect(atRest(crit.s, 100)).toBe(true);
    const bouncy = run(SPRING.flick, 2, 1 / 60);
    expect(Math.max(...bouncy.path)).toBeGreaterThan(100);
    expect(atRest(bouncy.s, 100)).toBe(true);
  });

  it("carries velocity through a retarget (no brick wall on reversal)", () => {
    const mid = run(SPRING.ui, 0.1, 1 / 60).s;
    expect(mid.v).toBeGreaterThan(0);
    const after = stepSpring(mid, 0, SPRING.ui, 1 / 600); // reverse the target
    expect(after.v).toBeGreaterThan(0); // still moving the old way for a moment
    expect(Math.abs(after.v - mid.v)).toBeLessThan(mid.v * 0.2); // and velocity is continuous
  });

  it("an initial velocity toward the target arrives sooner", () => {
    const slow = stepSpring({ x: 0, v: 0 }, 100, SPRING.ui, 0.1).x;
    const fast = stepSpring({ x: 0, v: 800 }, 100, SPRING.ui, 0.1).x;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe("gesture math", () => {
  it("project uses Apple's exponential-decay form", () => {
    expect(project(1000)).toBeCloseTo(499, 6); // (1000/1000)·0.998/0.002
    expect(project(-1000)).toBeCloseTo(-499, 6);
    expect(project(0)).toBe(0);
    expect(project(1000, 0.99)).toBeCloseTo(99, 6);
  });

  it("rubberband follows less and less and never passes the dimension", () => {
    expect(rubberband(0, 400)).toBe(0);
    let prev = 0, prevGain = Infinity;
    for (const o of [10, 50, 200, 1000, 100_000]) {
      const r = rubberband(o, 400);
      expect(r).toBeGreaterThan(prev);
      expect(r).toBeLessThan(400);
      expect(r / o).toBeLessThan(prevGain);
      prev = r;
      prevGain = r / o;
    }
    expect(rubberband(-50, 400)).toBeCloseTo(-rubberband(50, 400), 9);
  });

  it("velocityTracker reads px/s from recent samples and drops stale ones", () => {
    const t = velocityTracker();
    expect(t.get(0)).toBe(0);
    for (let i = 0; i <= 10; i++) t.add(i * 10, i * 5); // 5 px per 10 ms
    expect(t.get(100)).toBeCloseTo(500, 6);
    expect(t.get(400)).toBe(0); // paused before release: no momentum
    const same = velocityTracker();
    same.add(0, 0);
    same.add(16, 8);
    same.add(16, 16); // coalesced: newest position wins, no division by zero
    expect(same.get(16)).toBeCloseTo(1000, 6);
  });
});

describe("engine", () => {
  it("steps springs and timers only when advanced, and settles exactly on target", () => {
    const seen: number[] = [];
    const s = new Spring(0, SPRING.ui, () => seen.push(s.x));
    let rested = 0;
    s.to(10, { onRest: () => rested++ });
    expect(seen).toEqual([]);
    for (let i = 0; i < 120; i++) advance(1 / 60);
    expect(s.x).toBe(10);
    expect(s.v).toBe(0);
    expect(rested).toBe(1);
    const n = seen.length;
    advance(1 / 60);
    expect(seen.length).toBe(n); // at rest: nothing is written

    const fired: string[] = [];
    clock.after(50, () => fired.push("b"));
    clock.after(20, () => fired.push("a"));
    const cancel = clock.after(30, () => fired.push("x"));
    cancel();
    advance(0.01);
    expect(fired).toEqual([]);
    advance(0.05);
    expect(fired).toEqual(["a", "b"]);
  });

  it("a spring sent somewhere new from its own onRest keeps going (fade out, then back in)", () => {
    const s = new Spring(1);
    s.to(0, { onRest: () => s.to(1) });
    let low = 1;
    for (let i = 0; i < 400; i++) (advance(1 / 60), (low = Math.min(low, s.x)));
    expect(low).toBe(0);
    expect(s.x).toBe(1);
  });

  it("an interrupted spring keeps its value and velocity; a replaced onRest never fires", () => {
    const s = new Spring(0);
    let stale = 0;
    s.to(100, { onRest: () => stale++ });
    for (let i = 0; i < 6; i++) advance(1 / 60);
    const { x, v } = s;
    expect(x).toBeGreaterThan(0);
    s.to(0);
    expect(s.x).toBe(x);
    expect(s.v).toBe(v);
    for (let i = 0; i < 240; i++) advance(1 / 60);
    expect(s.x).toBe(0);
    expect(stale).toBe(0);
  });
});
