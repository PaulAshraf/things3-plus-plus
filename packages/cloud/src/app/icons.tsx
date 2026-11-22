// Original icon set for things3pp web. Simple geometric glyphs, drawn for this project.
import type { CSSProperties, JSX } from "preact";

type P = { class?: string; color?: string; style?: CSSProperties | string };
const svg = (children: JSX.Element | JSX.Element[], { class: cls = "icon", style }: P, viewBox = "0 0 24 24") => (
  <svg class={cls} viewBox={viewBox} style={style} aria-hidden="true" fill="none">
    {children}
  </svg>
);

export const IconInbox = (p: P) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="4" fill={p.color ?? "var(--blue)"} />
      <path d="M3.5 13h4.2l1.5 2.4h5.6l1.5-2.4h4.2" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" />
    </>,
    p,
  );

export const IconToday = (p: P) =>
  svg(
    <path
      d="M12 2.8l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.1l6.1-.7L12 2.8z"
      fill={p.color ?? "var(--yellow)"}
      stroke={p.color ?? "var(--yellow)"}
      stroke-width="1.2"
      stroke-linejoin="round"
    />,
    p,
  );

export const IconEvening = (p: P) =>
  svg(<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" fill={p.color ?? "var(--moon)"} />, p);

export const IconUpcoming = (p: P) =>
  svg(
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="3.5" fill={p.color ?? "var(--red)"} />
      <rect x="3" y="4.5" width="18" height="5" rx="2" fill="rgba(0,0,0,0.14)" />
      <path d="M8 2.8v3.4M16 2.8v3.4" stroke={p.color ?? "var(--red)"} stroke-width="2" stroke-linecap="round" />
      <circle cx="8.5" cy="14" r="1.3" fill="#fff" />
      <circle cx="12" cy="14" r="1.3" fill="#fff" />
      <circle cx="15.5" cy="14" r="1.3" fill="#fff" />
      <circle cx="8.5" cy="17.3" r="1.3" fill="#fff" opacity=".7" />
    </>,
    p,
  );

export const IconAnytime = (p: P) =>
  svg(
    <>
      <rect x="4" y="3.5" width="16" height="5" rx="1.8" fill={p.color ?? "var(--teal)"} opacity=".55" />
      <rect x="4" y="9.5" width="16" height="5" rx="1.8" fill={p.color ?? "var(--teal)"} opacity=".8" />
      <rect x="4" y="15.5" width="16" height="5" rx="1.8" fill={p.color ?? "var(--teal)"} />
    </>,
    p,
  );

export const IconSomeday = (p: P) =>
  svg(
    <>
      <path d="M4 9h16v9.5A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5V9z" fill={p.color ?? "var(--sand)"} />
      <rect x="2.8" y="4" width="18.4" height="5.5" rx="1.6" fill={p.color ?? "var(--sand)"} opacity=".75" />
      <path d="M9.5 13h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
    </>,
    p,
  );

export const IconLogbook = (p: P) =>
  svg(
    <>
      <rect x="4" y="3" width="16" height="18" rx="3" fill={p.color ?? "var(--green)"} />
      <path d="M8 12.2l2.7 2.7L16.2 9" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
    </>,
    p,
  );

export const IconTrash = (p: P) =>
  svg(
    <>
      <path d="M6 7.5h12l-.9 11.3a2 2 0 0 1-2 1.7H8.9a2 2 0 0 1-2-1.7L6 7.5z" fill={p.color ?? "var(--gray)"} />
      <rect x="4" y="4.6" width="16" height="2.6" rx="1.3" fill={p.color ?? "var(--gray)"} />
      <path d="M10 3.6h4" stroke={p.color ?? "var(--gray)"} stroke-width="2" stroke-linecap="round" />
    </>,
    p,
  );

export const IconArea = (p: P) =>
  svg(
    <>
      <path d="M12 3l8 4.3v9.4L12 21l-8-4.3V7.3L12 3z" fill="none" stroke={p.color ?? "var(--text-2)"} stroke-width="1.8" stroke-linejoin="round" />
      <path d="M4.5 7.6L12 11.8l7.5-4.2M12 11.8V20.5" stroke={p.color ?? "var(--text-2)"} stroke-width="1.8" stroke-linejoin="round" />
    </>,
    p,
  );

export const IconTag = (p: P) =>
  svg(
    <>
      <path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6L21 12l-8.5 8.5-9-7.9z" stroke={p.color ?? "currentColor"} stroke-width="1.8" stroke-linejoin="round" />
      <circle cx="8" cy="8" r="1.6" fill={p.color ?? "currentColor"} />
    </>,
    p,
  );

export const IconFlag = (p: P) =>
  svg(
    <>
      <path d="M5.5 21V4" stroke={p.color ?? "currentColor"} stroke-width="2" stroke-linecap="round" />
      <path d="M6 4.5h11.5l-2.6 4.2 2.6 4.3H6z" fill={p.color ?? "currentColor"} />
    </>,
    p,
  );

export const IconCalendar = (p: P) =>
  svg(
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={p.color ?? "currentColor"} stroke-width="1.8" />
      <path d="M3.5 10h17M8 3v4M16 3v4" stroke={p.color ?? "currentColor"} stroke-width="1.8" stroke-linecap="round" />
    </>,
    p,
  );

export const IconChecklist = (p: P) =>
  svg(
    <>
      <path d="M4 6.5l1.6 1.6L8.5 5M4 13l1.6 1.6L8.5 11.5" stroke={p.color ?? "currentColor"} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M11.5 7h8.5M11.5 13.5h8.5M5 19h15" stroke={p.color ?? "currentColor"} stroke-width="1.8" stroke-linecap="round" />
    </>,
    p,
  );

export const IconNotes = (p: P) =>
  svg(
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" stroke={p.color ?? "currentColor"} stroke-width="1.8" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke={p.color ?? "currentColor"} stroke-width="1.8" stroke-linecap="round" />
    </>,
    p,
  );

export const IconRepeat = (p: P) =>
  svg(
    <path
      d="M4.5 11V9.5A3.5 3.5 0 0 1 8 6h11m0 0l-3-3m3 3l-3 3M19.5 13v1.5A3.5 3.5 0 0 1 16 18H5m0 0l3 3m-3-3l3-3"
      stroke={p.color ?? "currentColor"}
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />,
    p,
  );

export const IconBell = (p: P) =>
  svg(
    <>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5z" stroke={p.color ?? "currentColor"} stroke-width="1.8" stroke-linejoin="round" />
      <path d="M10 20.5h4" stroke={p.color ?? "currentColor"} stroke-width="1.8" stroke-linecap="round" />
    </>,
    p,
  );

export const IconPlus = (p: P) => svg(<path d="M12 5v14M5 12h14" stroke={p.color ?? "currentColor"} stroke-width="2.2" stroke-linecap="round" />, p);
export const IconCheck = (p: P) =>
  svg(<path d="M5 12.5l4.5 4.5L19 7.5" stroke={p.color ?? "currentColor"} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />, p);
export const IconX = (p: P) => svg(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke={p.color ?? "currentColor"} stroke-width="2.4" stroke-linecap="round" />, p);
export const IconSearch = (p: P) =>
  svg(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" stroke={p.color ?? "currentColor"} stroke-width="2" />
      <path d="M15.5 15.5L20 20" stroke={p.color ?? "currentColor"} stroke-width="2.2" stroke-linecap="round" />
    </>,
    p,
  );
export const IconMove = (p: P) =>
  svg(<path d="M4 12h14m0 0l-5-5m5 5l-5 5" stroke={p.color ?? "currentColor"} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />, p);
export const IconChevronLeft = (p: P) =>
  svg(<path d="M15 5l-7 7 7 7" stroke={p.color ?? "currentColor"} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />, p);
export const IconChevronRight = (p: P) =>
  svg(<path d="M9 5l7 7-7 7" stroke={p.color ?? "currentColor"} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />, p);
export const IconGear = (p: P) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" stroke={p.color ?? "currentColor"} stroke-width="1.8" />
      <path
        d="M12 2.8l1.6 2.4 2.8-.6.6 2.8 2.4 1.6-1.2 2.6 1.2 2.6-2.4 1.6-.6 2.8-2.8-.6L12 21.2l-1.6-2.4-2.8.6-.6-2.8L4.6 15l1.2-2.6L4.6 9.8 7 8.2l.6-2.8 2.8.6L12 2.8z"
        stroke={p.color ?? "currentColor"}
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </>,
    p,
  );
export const IconKey = (p: P) =>
  svg(
    <>
      <circle cx="8" cy="15" r="4.5" stroke={p.color ?? "currentColor"} stroke-width="1.9" />
      <path d="M11.3 11.7L20 3m-3.5 3.5l2.5 2.5M14 9l2 2" stroke={p.color ?? "currentColor"} stroke-width="1.9" stroke-linecap="round" />
    </>,
    p,
  );
export const IconLaptop = (p: P) =>
  svg(
    <>
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.8" stroke={p.color ?? "currentColor"} stroke-width="1.8" />
      <path d="M2.5 19h19" stroke={p.color ?? "currentColor"} stroke-width="1.8" stroke-linecap="round" />
    </>,
    p,
  );
export const IconHeading = (p: P) =>
  svg(<path d="M5 6h14M5 12h9M5 18h6" stroke={p.color ?? "currentColor"} stroke-width="2" stroke-linecap="round" />, p);
export const IconMore = (p: P) =>
  svg(
    <>
      <circle cx="6" cy="12" r="1.7" fill={p.color ?? "currentColor"} />
      <circle cx="12" cy="12" r="1.7" fill={p.color ?? "currentColor"} />
      <circle cx="18" cy="12" r="1.7" fill={p.color ?? "currentColor"} />
    </>,
    p,
  );

/** The app icon: a blue rounded square with a white check. Not the Things logo. */
export const AppIcon = (p: P) => (
  <svg class={p.class ?? "app-icon"} viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="ai-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4aa3ff" />
        <stop offset="1" stop-color="#1767e6" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#ai-g)" />
    <rect x="17" y="17" width="30" height="30" rx="8" fill="none" stroke="#fff" stroke-width="4" opacity=".95" />
    <path d="M24 32.5l6 6 12.5-13" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
  </svg>
);

/** Project progress pie. */
export function Pie({ done, total, class: cls = "pie", color = "var(--blue)" }: { done: number; total: number; class?: string; color?: string }) {
  const r = 7;
  const frac = total ? done / total : 0;
  const angle = frac * 2 * Math.PI;
  const x = 9 + r * Math.sin(angle);
  const y = 9 - r * Math.cos(angle);
  const large = frac > 0.5 ? 1 : 0;
  return (
    <svg class={cls} viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill="none" stroke={color} stroke-width="1.5" />
      {frac >= 1 ? (
        <circle cx="9" cy="9" r={r - 0.5} fill={color} />
      ) : frac > 0 ? (
        <path d={`M9 9 L9 ${9 - r} A${r} ${r} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`} fill={color} />
      ) : null}
    </svg>
  );
}
