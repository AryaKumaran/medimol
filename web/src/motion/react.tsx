import {
  useEffect, useId, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore,
  type ButtonHTMLAttributes, type CSSProperties, type PointerEvent, type ReactNode,
} from "react";
import { clock, invalidate, Spring } from "./engine";
import { SPRING, type SpringConfig } from "./spring";

const BASE = { x: 0, y: 0, scale: 1, scaleX: 1, opacity: 1, blur: 0 };
type Key = keyof typeof BASE;
export type Pose = Partial<Record<Key, number>>;

export const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// A set of independent springs (X and Y never share one) bound to one element.
// It only ever writes compositor properties, and writes them straight to the element, never through React state.
export class Motion {
  el: HTMLElement | null = null;
  onRender?: () => void; // values that must follow this element continuously (a scrim under a dragged sheet)
  private springs = new Map<Key, Spring>();

  constructor(private initial: Pose = {}, private config: SpringConfig = SPRING.ui, private unit: "px" | "%" = "px") {}

  private spring(k: Key): Spring {
    let s = this.springs.get(k);
    if (!s) this.springs.set(k, (s = new Spring(this.initial[k] ?? BASE[k], this.config, () => invalidate(this.render))));
    return s;
  }

  get = (k: Key): number => this.springs.get(k)?.x ?? this.initial[k] ?? BASE[k];

  // Spring toward a pose from wherever the element is right now, keeping its velocity.
  // Reduced motion: position and scale change at once, opacity cross-fades.
  to(pose: Pose, o: { config?: SpringConfig; velocity?: Pose; onRest?: () => void } = {}) {
    const keys = Object.keys(pose) as Key[];
    const calm = reduced();
    let pending = keys.length;
    const rest = o.onRest && (() => void (--pending === 0 && o.onRest!()));
    for (const k of keys) {
      if (calm && k !== "opacity") {
        this.spring(k).jump(pose[k]!);
        rest?.();
      } else this.spring(k).to(pose[k]!, { config: calm ? SPRING.fade : (o.config ?? this.config), velocity: o.velocity?.[k], onRest: rest });
    }
    if (calm) this.render();
  }

  jump(pose: Pose) {
    for (const k of Object.keys(pose) as Key[]) this.spring(k).jump(pose[k]!);
    this.render();
  }

  shift(pose: Pose) {
    for (const k of Object.keys(pose) as Key[]) this.spring(k).shift(pose[k]!);
    this.render();
  }

  attach = (el: HTMLElement | null) => {
    this.el = el;
    this.render();
  };

  render = () => {
    const el = this.el;
    if (!el) return;
    const g = this.get, u = this.unit;
    const x = g("x"), y = g("y"), sx = g("scale") * g("scaleX"), sy = g("scale");
    el.style.transform = x || y || sx !== 1 || sy !== 1 ? `translate3d(${x}${u},${y}${u},0) scale(${sx},${sy})` : "";
    el.style.opacity = g("opacity") === 1 ? "" : `${g("opacity")}`;
    if (this.springs.has("blur")) el.style.filter = g("blur") > 0.05 ? `blur(${g("blur")}px)` : "";
    this.onRender?.();
  };
}

export const useMotion = (initial?: Pose, config?: SpringConfig, unit?: "px" | "%") =>
  useState(() => new Motion(initial, config, unit))[0];

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
  );
}

// Feedback on pointer-down, not on release. The commit stays on click, so keyboard and assistive tech work,
// and keyboard activation never animates. Dragging off cancels the highlight; dragging back re-arms it.
export function press(m: Motion, depth = 0.97) {
  const down = () => m.to({ scale: depth }, { config: SPRING.press });
  const up = () => m.to({ scale: 1 }, { config: SPRING.press });
  return {
    onPointerDown: down, onPointerUp: up, onPointerCancel: up, onPointerLeave: up,
    onPointerEnter: (e: PointerEvent) => void (e.buttons && down()),
  };
}

export function Pressable({ motion, depth, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { motion?: Motion; depth?: number }) {
  const own = useMotion();
  const m = motion ?? own;
  return <button type="button" ref={m.attach} {...press(m, depth)} {...p} />;
}

// Segmented control. Native radios underneath give arrow keys, focus and form semantics for free.
export function Segmented<T extends string>({ label, value, options, onChange, className = "" }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange(v: T): void; className?: string;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const thumb = useMotion({ x: i * 100 }, SPRING.move, "%"); // % of its own width: segments are equal
  const byPointer = useRef(false);
  const name = useId();
  useLayoutEffect(() => {
    if (byPointer.current) thumb.to({ x: i * 100 });
    else thumb.jump({ x: i * 100 }); // keyboard changes repeat quickly and must not animate
    byPointer.current = false;
  }, [i]);
  const up = () => thumb.to({ scale: 1 }, { config: SPRING.press });
  return (
    <div
      className={`seg ${className}`} role="radiogroup" aria-label={label} style={{ "--n": options.length } as CSSProperties}
      onPointerDown={() => { byPointer.current = true; thumb.to({ scale: 0.95 }, { config: SPRING.press }); }}
      onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onKeyDown={() => (byPointer.current = false)}
    >
      <span className="seg-thumb" ref={thumb.attach} aria-hidden="true" />
      {options.map((o) => (
        <label key={o.value} className="seg-item">
          <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

// Keeps a node mounted until its exit spring has settled. Enter and exit travel the same path.
// Create the Motion with `hidden` as its initial pose.
export function usePresence(open: boolean, m: Motion, hidden: Pose, shown: Pose, config?: SpringConfig): boolean {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useLayoutEffect(() => {
    if (open) m.to(shown, { config });
    else if (mounted) m.to(hidden, { config, onRest: () => setMounted(false) });
  }, [open, mounted]);
  return mounted;
}

// Fades and lifts its children in, on mount or when scrolled into view.
export function Reveal({ children, delay = 0, inView = false, className }: { children: ReactNode; delay?: number; inView?: boolean; className?: string }) {
  const m = useMotion({ opacity: 0, y: 14 });
  useEffect(() => {
    const show = () => clock.after(delay, () => m.to({ opacity: 1, y: 0 }));
    if (!inView || !m.el) return show();
    let cancel = () => {};
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      cancel = show();
    }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(m.el);
    return () => { io.disconnect(); cancel(); };
  }, []);
  return <div ref={m.attach} className={className}>{children}</div>;
}

// A bar whose length springs to its value (scaleX, so no layout).
export function Fill({ value, className = "" }: { value: number; className?: string }) {
  const m = useMotion({ scaleX: 0 }, SPRING.move);
  useEffect(() => m.to({ scaleX: Math.max(0, Math.min(1, value)) }), [value]);
  return <span className={`fill ${className}`} ref={m.attach} />;
}

// A number that springs to its new value instead of snapping.
export function Num({ value, format = (x: number) => String(Math.round(x)) }: { value: number; format?: (x: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useRef(format);
  fmt.current = format;
  const [s] = useState(() => {
    const write = () => void (ref.current && (ref.current.textContent = fmt.current(s.x)));
    const s: Spring = new Spring(value, SPRING.ui, () => invalidate(write));
    return s;
  });
  useEffect(() => {
    if (!reduced()) return s.to(value);
    s.jump(value);
    if (ref.current) ref.current.textContent = format(value);
  }, [value]);
  return <span ref={ref} className="num">{format(s.x)}</span>;
}

type Item = { m: Motion; el: HTMLElement | null; at: { top: number; left: number; width: number } | null; leaving: boolean };

// A spring-driven list or grid. When the order changes each item keeps its on-screen position and springs home
// (FLIP, with separate X and Y springs); new items materialise with a short stagger; items that left fade out
// without holding space. offsetTop/offsetLeft ignore transforms, so an interrupted reorder continues from where
// each item really is. The container must be position: relative. Render `order` (it includes items fading out).
// With enter: false nothing is revealed for you: every item starts invisible and the caller shows each one
// when it is ready (used where items hold their place in the layout before they exist on screen).
export function useFlip(keys: string[], { enter = true } = {}) {
  const items = useRef(new Map<string, Item>()).current;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const present = new Set(keys);
  const gone = [...items.keys()].filter((k) => !present.has(k));

  useLayoutEffect(() => {
    for (const k of gone) {
      const it = items.get(k)!;
      if (it.leaving) continue;
      if (!it.el || !it.at) { items.delete(k); continue; }
      it.leaving = true;
      Object.assign(it.el.style, { position: "absolute", top: `${it.at.top}px`, left: `${it.at.left}px`, width: `${it.at.width}px`, pointerEvents: "none" });
      it.m.to(reduced() ? { opacity: 0 } : { opacity: 0, scale: 0.98 }, { onRest: () => { items.delete(k); redraw(); } });
    }
    for (const k of keys) {
      const it = items.get(k);
      if (it?.leaving && it.el) Object.assign(it.el.style, { position: "", top: "", left: "", width: "", pointerEvents: "" });
    }
    // Everything is back in its final flow position: measure once, then move.
    let entering = 0;
    for (const k of keys) {
      const it = items.get(k);
      if (!it?.el) continue;
      const at = { top: it.el.offsetTop, left: it.el.offsetLeft, width: it.el.offsetWidth };
      if (!it.at) {
        it.m.jump({ opacity: 0, y: 10, scale: 0.98 });
        if (enter) clock.after(Math.min(entering++, 12) * 35, () => void (it.leaving || it.m.to({ opacity: 1, y: 0, scale: 1 })));
      } else if (at.top !== it.at.top || at.left !== it.at.left || it.leaving) {
        it.m.shift({ x: it.at.left - at.left, y: it.at.top - at.top });
        it.m.to({ opacity: 1, x: 0, y: 0, scale: 1 });
      }
      it.leaving = false;
      it.at = at;
    }
  });

  return {
    order: [...keys, ...gone],
    // The Motion to put on the item's element (ref={m.attach}); it can carry press feedback too.
    motion(k: string): Motion {
      let it = items.get(k);
      if (!it) {
        const m = new Motion({ opacity: 0 }, SPRING.move);
        const made: Item = { m, el: null, at: null, leaving: false };
        const attach = m.attach;
        m.attach = (el) => { made.el = el; attach(el); };
        items.set(k, (it = made));
      }
      return it.m;
    },
  };
}

// Makes a box whose content just changed height look like it grows or shrinks on a spring, without animating
// layout. The box is held at the taller height while clip-path moves its visible bottom edge, and everything
// marked .rides (the content after the box) travels with that edge. clip-path cuts a box-shadow off, so the
// shadow belongs on a parent as filter: drop-shadow, which follows the clipped shape.
export function useGrow(radius = "1.125rem") {
  const box = useRef<HTMLDivElement>(null);
  const laid = useRef<number | null>(null); // layout height as of the last pass
  const [s] = useState(() => {
    const write = () => {
      const cut = s.x > 0.25 ? s.x : 0;
      if (box.current) box.current.style.clipPath = cut ? `inset(0 0 ${cut}px 0 round ${radius})` : "";
      for (const el of document.querySelectorAll<HTMLElement>(".rides")) el.style.transform = cut ? `translate3d(0,${-cut}px,0)` : "";
    };
    const s: Spring & { write?: () => void } = new Spring(0, SPRING.move, () => invalidate(write)); // value = px hidden at the bottom
    s.write = write;
    return s as Spring & { write: () => void };
  });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = laid.current === null ? null : laid.current - s.x; // height on screen a moment ago
    el.style.minHeight = "";
    const h = el.offsetHeight; // height the new content wants
    const settle = () => {
      el.style.minHeight = "";
      laid.current = h;
      s.jump(0);
      s.write();
    };
    if (seen === null || reduced() || Math.abs(h - seen) < 1) return settle();
    const hold = Math.max(h, seen);
    el.style.minHeight = `${hold}px`;
    laid.current = hold;
    s.shift(hold - seen - s.x); // the visible edge stays exactly where it was
    s.write();
    s.to(hold - h, { onRest: settle });
  });
  useEffect(() => () => void (s.jump(0), s.write()), []);
  return box;
}
