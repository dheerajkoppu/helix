/** Deterministic formatters: the same string on server and client, in every locale. */

const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-10-03 16:40 UTC". Returns null for a missing or unparseable timestamp. */
export function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // A date without a time stays a date: no midnight is invented.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** "2026-10-03" */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** "5 min 12 s", "48 s", "2 h 03 min" */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.floor(total / 60)} min ${pad(total % 60)} s`;
  return `${Math.floor(total / 3600)} h ${pad(Math.floor((total % 3600) / 60))} min`;
}

/** Thousands separators without locale variance: 14250 -> "14,250" */
export function formatCount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
