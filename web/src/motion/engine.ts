import { atRest, SPRING, stepSpring, type SpringConfig } from "./spring";

// One clock for everything that moves or waits. Live, requestAnimationFrame drives it.
// With ?capture in the URL nothing drives it: the loop recorder calls window.__medimol.advance(ms) once per
// video frame, so every recorded frame is an exact function of time. CSS transitions and keyframes could not
// be stepped this way, which is one reason the project bans them (tests/no-css-motion.test.ts).
export const capture = typeof location !== "undefined" && new URLSearchParams(location.search).has("capture");

let now = 0; // seconds on the engine clock
let timers: { at: number; fn: () => void }[] = [];
const active = new Set<Spring>();
const dirty = new Set<() => void>();
let raf = 0;
let last = 0;

export const clock = {
  now: () => now * 1000,
  // Engine-clock timeout. Returns a cancel function.
  after(ms: number, fn: () => void): () => void {
    const t = { at: now + ms / 1000, fn };
    timers.push(t);
    wake();
    return () => {
      timers = timers.filter((x) => x !== t);
    };
  },
};

// Queue a DOM write for the end of this frame, so an element with several springs is written once.
export const invalidate = (write: () => void) => dirty.add(write);

export function advance(dt: number): void {
  now += dt;
  const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
  timers = timers.filter((t) => t.at > now);
  for (const t of due) t.fn();
  for (const s of [...active]) if (!s.step(dt)) active.delete(s);
  for (const write of dirty) write();
  dirty.clear();
}

function wake() {
  if (capture || raf || typeof requestAnimationFrame === "undefined") return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function frame(t: number) {
  raf = 0;
  advance(Math.min((t - last) / 1000, 0.064)); // a tab coming back from the background must not teleport things
  last = t;
  if (active.size || timers.length) raf = requestAnimationFrame(frame);
}

export class Spring {
  x: number;
  v = 0;
  target: number;
  private onRest?: () => void;

  constructor(x: number, public config: SpringConfig = SPRING.ui, private onChange?: () => void) {
    this.x = this.target = x;
  }

  // Retarget from the live value and the live velocity. This is what makes every motion interruptible.
  to(target: number, o: { velocity?: number; config?: SpringConfig; onRest?: () => void } = {}) {
    this.target = target;
    if (o.config) this.config = o.config;
    if (o.velocity !== undefined) this.v = o.velocity;
    this.onRest = o.onRest;
    active.add(this);
    wake();
  }

  // 1:1 tracking while a finger is down: no animation, no lag.
  jump(x: number) {
    this.x = this.target = x;
    this.v = 0;
    this.onRest = undefined;
    active.delete(this);
  }

  // Move the value without touching target or velocity (layout changed under a moving element).
  shift(dx: number) {
    this.x += dx;
  }

  step(dt: number): boolean {
    const s = stepSpring(this, this.target, this.config, dt);
    const moving = !atRest(s, this.target);
    this.x = moving ? s.x : this.target;
    this.v = moving ? s.v : 0;
    this.onChange?.();
    if (!moving) {
      const done = this.onRest;
      this.onRest = undefined;
      done?.();
    }
    return moving || this.x !== this.target; // onRest may have sent it somewhere new
  }
}

declare global {
  interface Window {
    __medimol?: { advance(ms: number): void; idle(): boolean };
  }
}
if (capture) window.__medimol = { advance: (ms) => advance(ms / 1000), idle: () => !active.size && !timers.length };
