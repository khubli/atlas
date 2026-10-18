// Shared helpers: DOM, formatting, metadata.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return value == null
    ? ""
    : String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const isMobile = () => window.matchMedia("(max-width: 899px)").matches;

// ---- numbers ---------------------------------------------------------------

const intFmt = new Intl.NumberFormat();
const compactFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export const fmtInt = (n) => intFmt.format(Math.round(Number(n) || 0));
export const fmtCompact = (n) => compactFmt.format(Number(n) || 0);
export const fmtKm = (n) => `${fmtInt(n)} km`;
export const plural = (n, one, many = one + "s") => `${fmtInt(n)} ${Number(n) === 1 ? one : many}`;

export function fmtMinutes(min) {
  const m = Math.round(Number(min) || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    // Past a couple of days the hours are noise: "1,812 days", not "1812d 4h".
    return d >= 3 ? `${d.toLocaleString("en-US")} days` : `${d}d ${h % 24}h`;
  }
  return r ? `${h}h ${r}m` : `${h}h`;
}

// ---- dates -------------------------------------------------------------------
// Timeline timestamps carry the local offset of where they happened
// ("2019-12-20T10:58:25+05:30"). Show that local wall time, not the viewer's.

function utcDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const dfmt = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...opts });
const fDay = dfmt({ day: "numeric", month: "short" });
const fDayYear = dfmt({ day: "numeric", month: "short", year: "numeric" });
const fWeekday = dfmt({ weekday: "short", day: "numeric", month: "short" });
const fMonth = dfmt({ month: "short" });
const fMonthYear = dfmt({ month: "long", year: "numeric" });

export const fmtDate = (iso) => (iso ? fDayYear.format(utcDate(iso)) : "");
export const fmtDay = (iso) => (iso ? fDay.format(utcDate(iso)) : "");
export const fmtWeekday = (iso) => (iso ? fWeekday.format(utcDate(iso)) : "");
export const fmtMonthName = (monthIndex) => fMonth.format(new Date(Date.UTC(2000, monthIndex, 1)));
export const fmtMonthYear = (iso) => (iso ? fMonthYear.format(utcDate(iso)) : "");
export const localTime = (iso) => (iso ? String(iso).slice(11, 16) : "");
export const localDate = (iso) => (iso ? String(iso).slice(0, 10) : "");

export function fmtRange(start, end) {
  if (!start) return "";
  if (!end || start === end) return fmtDate(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${sameYear ? fmtDay(start) : fmtDate(start)} – ${fmtDate(end)}`;
}

export function addDays(iso, n) {
  const d = utcDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// ---- metadata ------------------------------------------------------------------

export const THEMES = {
  landmark: { label: "Landmarks", icon: "\u{1F3DB}️" },
  nature: { label: "Nature", icon: "⛰️" },
  worship: { label: "Temples & worship", icon: "\u{1F6D5}" },
  culture: { label: "Museums & culture", icon: "\u{1F3A8}" },
  fun: { label: "Fun & events", icon: "\u{1F3A1}" },
  food: { label: "Food & drink", icon: "\u{1F37D}️" },
  stay: { label: "Stays", icon: "\u{1F3E8}" },
  transit: { label: "Transit", icon: "\u{1F689}" },
  shopping: { label: "Shopping", icon: "\u{1F6CD}️" },
  other: { label: "Other", icon: "\u{1F4CD}" },
};
export const themeIcon = (t) => (THEMES[t] || THEMES.other).icon;
export const themeLabel = (t) => (THEMES[t] || THEMES.other).label;

// Each mode owns one categorical slot, so a mode keeps its color everywhere.
export const MODES = {
  flight: { label: "Flight", icon: "✈️", color: "var(--c1)" },
  car: { label: "Car", icon: "\u{1F697}", color: "var(--c2)" },
  train: { label: "Train", icon: "\u{1F686}", color: "var(--c3)" },
  bus: { label: "Bus", icon: "\u{1F68C}", color: "var(--c4)" },
  boat: { label: "Boat", icon: "⛴️", color: "var(--c5)" },
  walk: { label: "Walking", icon: "\u{1F6B6}", color: "var(--c6)" },
  cycle: { label: "Cycling", icon: "\u{1F6B2}", color: "var(--c7)" },
  motorbike: { label: "Motorbike", icon: "\u{1F3CD}️", color: "var(--c8)" },
  other: { label: "Other", icon: "•", color: "var(--c0)" },
};
export const modeMeta = (m) => MODES[m] || MODES.other;

// What a place is to you. Order is the order filters show them in.
export const KINDS = {
  explored: { label: "Explored", icon: "\u{1F9ED}", hint: "Visited on a trip or only now and then" },
  everyday: { label: "Everyday", icon: "\u{1F501}", hint: "Part of your routine near home" },
  family: { label: "Family home", icon: "\u{1F3E1}", hint: "Somewhere you often stay the night" },
  work: { label: "Work", icon: "\u{1F4BC}", hint: "Where you work" },
  home: { label: "Home", icon: "\u{1F3E0}", hint: "Where you live (or lived)" },
};
export const kindMeta = (k) => KINDS[k] || KINDS.explored;

// Where a label came from.
export const SOURCES = {
  you: "You",
  saved: "Your Google Maps saved places",
  google: "Google",
  timeline: "Google Timeline",
  osm: "OpenStreetMap (approximate)",
  pattern: "Your visit pattern",
};

/** The mode that covered most distance; drives a trip's icon. */
export function mainMode(transport) {
  const entries = Object.entries(transport || {}).filter(([m]) => m !== "walk" && m !== "other");
  if (!entries.length) return "car";
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// One-hue ordinal ramp (steps 250-600) for itineraries longer than the 8 categorical slots.
const DAY_RAMP = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95"];

/** Day colors for route maps: categorical up to 8 days, then an ordered ramp. */
export function dayColor(index, total) {
  if (total <= 8) return `var(--c${index + 1})`;
  return DAY_RAMP[Math.round((index / Math.max(1, total - 1)) * (DAY_RAMP.length - 1))];
}

/**
 * A Google Maps link. With the place ID from your export it opens that exact place
 * (name, photos, reviews) in Google Maps: free, and fine under Google's terms.
 */
export function mapsLink(lat, lng, name, placeId) {
  const pid = placeId && !/^(ChIJdemo_|demo)/.test(placeId) ? `&query_place_id=${encodeURIComponent(placeId)}` : "";
  if (lat != null && lng != null) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${pid}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name || "")}`;
}

// ---- toast & tooltip -----------------------------------------------------------------

let toastTimer = null;
/** Brief message; `opts.action` adds a button (e.g. "Reload"), `opts.sticky` keeps it up. */
export function toast(message, kind = "", opts = {}) {
  const t = $("#toast");
  t.replaceChildren(document.createTextNode(message));
  if (opts.action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = opts.action;
    b.addEventListener("click", () => {
      t.classList.remove("show");
      opts.onAction?.();
    });
    t.appendChild(b);
  }
  t.className = kind;
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
  if (!opts.sticky) toastTimer = setTimeout(() => t.classList.remove("show"), opts.action ? 6000 : 2800);
}

/** Show the shared tooltip next to a point. `lines` are [strong, ...secondary] plain strings. */
export function showTip(x, y, lines) {
  const tip = $("#tooltip");
  tip.replaceChildren();
  lines.forEach((line, i) => {
    const el = document.createElement(i === 0 ? "strong" : "div");
    if (i > 0) el.className = "tt-sub";
    el.textContent = line;
    tip.appendChild(el);
  });
  tip.classList.add("show");
  const pad = 12;
  const r = tip.getBoundingClientRect();
  let left = x + pad;
  let top = y - r.height - pad;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
  if (top < 8) top = y + pad;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
}
export function hideTip() {
  $("#tooltip").classList.remove("show");
}

/** Wire hover + keyboard focus tooltips on elements with data-tip="line1|line2". */
export function bindTips(root) {
  root.addEventListener("pointermove", (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el || !root.contains(el)) return hideTip();
    showTip(e.clientX, e.clientY, el.dataset.tip.split("|"));
  });
  root.addEventListener("pointerleave", hideTip);
  root.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    showTip(r.left + r.width / 2, r.top, el.dataset.tip.split("|"));
  });
  root.addEventListener("focusout", hideTip);
}
