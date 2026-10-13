import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { capture, clock } from "./engine";
import { project, rubberband, SPRING, velocityTracker } from "./spring";
import { reduced, useMedia, useMotion } from "./react";

// In a recording every frame shares one engine timestamp; live, the event's own timestamp is the precise one.
const stamp = (e: PointerEvent) => (capture ? clock.now() : e.timeStamp);

// A panel you can throw. Wide screens: a floating inspector on the right that leaves the page usable (no scrim).
// Narrow screens: a modal bottom sheet over a scrim that dims with the drag.
// It tracks the pointer 1:1 from where it was grabbed, rubber-bands past its open edge, decides open or closed
// from where the release velocity would carry it, hands that velocity to the spring, and can be caught mid-flight.
export function Sheet({ open, onClose, label, header, children }: {
  open: boolean; onClose(): void; label: string; header: ReactNode; children: ReactNode;
}) {
  const wide = useMedia("(min-width: 900px)");
  const axis = wide ? "x" : "y";
  const m = useMotion({}, SPRING.move);
  const host = useRef<HTMLDialogElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const thrown = useRef(false);
  const drag = useRef<{ id: number; start: number; origin: number; active: boolean; track: ReturnType<typeof velocityTracker> } | null>(null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const closedAt = () => (m.el ? (wide ? m.el.offsetWidth + 32 : m.el.offsetHeight) : 0);
  const unmount = () => {
    shown.current = false;
    setMounted(false);
  };

  useLayoutEffect(() => {
    const d = host.current;
    if (!mounted || !d) return;
    m.onRender = () => {
      const size = closedAt();
      if (scrim.current && size) scrim.current.style.opacity = `${Math.max(0, Math.min(1, 1 - m.get(axis) / size)) * m.get("opacity")}`;
    };
    if (open) {
      // Start off-screen, on the side it will leave by. With reduced motion it does not travel: it fades in place.
      if (!shown.current) m.jump({ x: 0, y: 0, ...(reduced() ? { opacity: 0 } : { [axis]: closedAt() }) });
      shown.current = true;
      if (!wide && !d.open) d.showModal(); // focus trap, inert page and Escape for free
      m.to({ [axis]: 0, opacity: 1 });
    } else {
      if (!wide && d.open) d.close(); // give the page back at once; the panel keeps moving
      if (!thrown.current) m.to(reduced() ? { opacity: 0 } : { [axis]: closedAt() }, { onRest: unmount });
      thrown.current = false;
    }
  }, [open, mounted, wide]);

  useEffect(() => {
    if (!open || !wide) return;
    const onKey = (e: KeyboardEvent) => void (e.key === "Escape" && onClose());
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, wide]);

  if (!mounted) return null;

  const at = (e: PointerEvent) => (wide ? e.clientX : e.clientY);
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag.current) return; // a second finger must not steal the drag
    drag.current = { id: e.pointerId, start: at(e), origin: 0, active: false, track: velocityTracker() };
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.active) {
      if (Math.abs(at(e) - d.start) < 10) return; // hysteresis: a tap on the header is not a drag
      d.active = true;
      d.start = at(e);
      d.origin = m.get(axis); // grab it where it is, even mid-flight
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    d.track.add(stamp(e), at(e));
    const p = d.origin + at(e) - d.start;
    m.jump({ [axis]: p < 0 ? rubberband(p, closedAt()) : p });
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    const v = d.track.get(stamp(e));
    const size = closedAt();
    const dismiss = m.get(axis) + project(v) > size / 2; // where the throw would land, not where the finger let go
    m.to({ [axis]: dismiss ? size : 0 }, { config: SPRING.flick, velocity: { [axis]: v }, onRest: dismiss ? unmount : undefined });
    if (dismiss) {
      thrown.current = true;
      onClose();
    }
  };

  return (
    <dialog
      ref={host} className="sheet-host" aria-label={label} open={wide || undefined}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      {!wide && <div ref={scrim} className="scrim" onClick={onClose} />}
      <div ref={m.attach} className={`sheet ${wide ? "sheet-side" : "sheet-bottom"}`}>
        <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {!wide && <span className="sheet-handle" aria-hidden="true" />}
          {header}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </dialog>
  );
}
