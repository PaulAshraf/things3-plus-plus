import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface Anchor {
  x: number;
  y: number;
  /** Bottom edge of the thing that opened it; the popover goes below (or above if no room). */
  bottom: number;
  top: number;
}

export function anchorOf(el: Element | null): Anchor {
  const r = el?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0);
  return { x: r.left + r.width / 2, y: r.top, bottom: r.bottom, top: r.top };
}

/** A floating macOS-style popover, or a bottom sheet on phones. Closes on outside click / Escape. */
export function Popover({ anchor, onClose, children, width = 260 }: { anchor: Anchor; onClose: () => void; children: ComponentChildren; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    let left = Math.round(anchor.x - w / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = anchor.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.top - h - 8);
    setPos({ left, top });
  }, [anchor.x, anchor.bottom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const phone = window.matchMedia("(max-width: 760px)").matches;
  return (
    <>
      <div class="popover-backdrop" onMouseDown={onClose} onTouchStart={onClose} />
      <div ref={ref} class={`popover${phone ? " sheet-on-phone" : ""}`} style={{ left: `${pos.left}px`, top: `${pos.top}px`, width: phone ? undefined : `${width}px` }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>
  );
}
