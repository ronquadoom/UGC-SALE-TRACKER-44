export function fmt(n: number | null | undefined, opts?: { sign?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = opts?.sign && n > 0 ? "+" : "";
  return `${sign}${Math.round(n).toLocaleString("en-US")}`;
}

export function fmtRobux(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `R$ ${Math.round(n).toLocaleString("en-US")}`;
}

export function timeAgo(at: number | null | undefined): string {
  if (!at) return "never";
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}


