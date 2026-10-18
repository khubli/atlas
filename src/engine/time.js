// Timestamps are kept as epoch milliseconds plus the UTC offset (minutes) of
// where they happened, so "local time" means the traveller's wall clock, not
// the viewer's.

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;

/** Parse an ISO timestamp. Returns { ms, offset } or null. */
export function parseTime(text, fallbackOffset = 0) {
  if (text == null || text === "") return null;
  const s = String(text).trim();
  const m = OFFSET_RE.exec(s);
  if (m) {
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) return null;
    let offset = 0;
    if (m[1] !== "Z") {
      const sign = m[1][0] === "-" ? -1 : 1;
      const digits = m[1].slice(1).replace(":", "");
      offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    }
    return { ms, offset };
  }
  // No offset in the string: read it as wall time at the fallback offset.
  const ms = Date.parse(`${s}Z`);
  if (Number.isNaN(ms)) return null;
  return { ms: ms - fallbackOffset * 60000, offset: fallbackOffset };
}

const pad = (n) => String(n).padStart(2, "0");

function shifted(ms, offset) {
  return new Date(ms + offset * 60000);
}

/** "2019-12-20T10:58:25+05:30", the wall time where it happened. */
export function localIso(ms, offset) {
  const d = shifted(ms, offset);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${d.toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function localDate(ms, offset) {
  return shifted(ms, offset).toISOString().slice(0, 10);
}

/** Local hour of day (0-23.99). */
export function localHour(ms, offset) {
  const d = shifted(ms, offset);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** Local departure minute as a number, used as a stable trip id. */
export function localMinuteId(ms, offset) {
  const d = shifted(ms, offset);
  return Number(
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`,
  );
}

/** Days between two YYYY-MM-DD strings. */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** ISO week key "2023-W07" for a local date, used to count distinct weeks. */
export function weekKey(ms, offset) {
  const d = shifted(ms, offset);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${pad(week)}`;
}

export const HOUR = 3600000;
export const DAY = 86400000;
