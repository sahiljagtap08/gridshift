export const mw = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `${v.toFixed(digits)} MW`;

export const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${v.toFixed(digits)}%`;

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : "—";

export const dateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";

export const minutes = (m: number | null | undefined) => {
  if (m == null) return "not specified";
  if (m % 60 === 0) return `${m / 60} h`;
  return `${m} min`;
};

export const title = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const humanClass = (s: string) => s.replace(/_/g, " ");
