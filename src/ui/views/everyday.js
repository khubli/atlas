// Everyday life: commutes, routine places and where the hours go.

import { dataVersion, query } from "../../data/client.js";
import { chartWithTable, columnChart, tableView } from "../charts.js";
import { $, bindTips, esc, fmtInt, fmtMinutes, kindMeta, modeMeta, plural, themeIcon } from "../util.js";

const METRICS = {
  hours: { label: "Hours", unit: "hours" },
  km: { label: "Distance", unit: "km" },
  days: { label: "Days", unit: "days" },
};
// Fixed order and colors: each category keeps its color everywhere.
const SPLIT = [
  ["home_h", "Home", "var(--c1)"],
  ["work_h", "Work", "var(--c2)"],
  ["everyday_h", "Everyday places", "var(--c3)"],
  ["explored_h", "Exploring", "var(--c4)"],
];

let state = null;

export async function show(el) {
  if (state?.el === el && state.version === dataVersion()) return;
  const data = await query("everyday");
  state = { el, data, version: dataVersion(), metric: state?.metric ?? "hours" };
  render();
}

const hhmm = (h) => (h == null ? "–" : `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`);

function render() {
  const { el, data } = state;
  const c = data.commute;
  // No work, or work but no trips between it and home: commute stats would all be zero.
  const noWork = !data.has_work || !c.legs;

  el.innerHTML = `<div class="page stack">
    <div class="page-head"><div><h1>Everyday</h1>
      <p>Commutes, regular places and where your hours go. Trips are on the <a href="#/trips">Trips</a> page.</p></div></div>
    ${noWork ? `<section class="card empty-state">
      <h2>${data.has_work ? "No commutes found yet" : "Commutes need a workplace"}</h2>
      <p class="muted">${data.has_work
        ? "Atlas looks for trips between your home and work on the same day. None matched, which usually means home or work is set to the wrong place."
        : "Atlas finds work from long weekday days at one place, and didn't find one. If you commute (to an office, college or anywhere regular), mark it as Work."}</p>
      <div class="row" style="margin-top:10px"><a class="btn small primary" href="#/setup">Check home and work</a>
        <a class="btn small outline" href="#/places">Mark a place on Places</a></div>
    </section>` : ""}
    ${noWork ? "" : `<div class="kpis">
      ${kpi("Commute days", fmtInt(c.days), plural(c.legs, "journey"))}
      ${kpi("Typical commute", fmtMinutes(c.avg_minutes), `${c.avg_km} km each way`)}
      ${kpi("Usual departure", hhmm(c.avg_depart_hour), "leaving for work")}
      ${kpi("Time commuting", `${fmtInt(c.hours)}<small> h</small>`, `${fmtInt(c.km)} km in all`, true)}
    </div>
    <section class="card" id="commute-card">
      <div class="card-head"><h2>Commuting by month</h2><button type="button" class="link-btn" data-table-toggle>Table</button></div>
      <div class="seg seg-fill" style="margin-bottom:12px">${Object.entries(METRICS).map(([k, m]) =>
        `<button type="button" data-metric="${k}" class="${k === state.metric ? "active" : ""}">${m.label}</button>`).join("")}</div>
      <div class="chart" data-chart></div>
      <div class="legend" style="margin-top:10px">${modeLegend(data.months)}</div>
    </section>`}
    ${data.months.length ? `<section class="card">
      <div class="card-head"><h2>Where your hours go</h2><span class="sub">time at places, by year</span></div>
      <div class="legend" style="margin-bottom:10px">${SPLIT.map(([, label, color]) => `<span><i class="sw" style="background:${color}"></i>${label}</span>`).join("")}</div>
      ${timeSplit(data.months)}
    </section>` : ""}
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Your regular places</h2><span class="sub">by weeks visited</span></div>
        ${data.regular.length ? `<div class="dest-list">${data.regular.map((p, i) => `<a class="dest" href="#/places/${encodeURIComponent(p.place_id)}">
          <span class="rank">${i + 1}</span>
          <span><span class="name${p.named ? "" : " unnamed"}">${themeIcon(p.theme)} ${esc(p.name)}</span><div class="sub">${esc(p.city ?? "")}</div></span>
          <span class="num">${plural(p.weeks, "week")}</span></a>`).join("")}</div>` : '<p class="muted">No regular places yet.</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>${kindMeta("work").icon} Work</h2></div>
        ${data.work.length ? data.work.map((w) => `<a class="dest" href="#/places/${encodeURIComponent(w.place_id)}"><span class="rank">•</span>
          <span><span class="name">${esc(w.name)}</span><div class="sub">${esc(w.city ?? "")}</div></span><span class="num">${plural(w.visits, "visit")}</span></a>`).join("")
          : '<p class="muted">None marked.</p>'}
        <p class="muted small" style="margin-top:10px">Commutes are counted between home and work, allowing short stops on the way.
          Whether work counts as home base for trips is set in <a href="#/settings">Settings</a>.</p>
      </section>
    </div>
  </div>`;
  bindTips(el);
  if (!noWork) wireChart();
}

function kpi(label, value, note, raw = false) {
  return `<div class="kpi"><div class="label">${label}</div><div class="value">${raw ? value : esc(value)}</div><div class="note">${esc(note)}</div></div>`;
}

function modeLegend(months) {
  const totals = {};
  for (const m of months) for (const [mode, km] of Object.entries(m.modes)) totals[mode] = (totals[mode] || 0) + km;
  const sum = Object.values(totals).reduce((s, x) => s + x, 0) || 1;
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([mode, km]) => `<span>${modeMeta(mode).icon} ${esc(modeMeta(mode).label)}<strong>${Math.round((km / sum) * 100)}%</strong></span>`).join("");
}

function wireChart() {
  const card = $("#commute-card");
  const months = state.data.months.filter((m) => m.legs > 0).slice(-24);
  const value = (m) => (state.metric === "hours" ? m.hours : state.metric === "km" ? m.km : m.days);
  const label = (m) => {
    const [y, mo] = m.month.split("-");
    return mo === "01" || m === months[0] ? `${new Date(Date.UTC(+y, +mo - 1)).toLocaleString(undefined, { month: "short", timeZone: "UTC" })} ’${y.slice(2)}`
      : new Date(Date.UTC(+y, +mo - 1)).toLocaleString(undefined, { month: "narrow", timeZone: "UTC" });
  };
  const redraw = chartWithTable(
    card,
    (target) => columnChart(target, months.map((m) => ({
      label: label(m), value: value(m), major: m === months[0] || m.month.endsWith("-01"),
      tip: [`${fmtInt(value(m))} ${METRICS[state.metric].unit}`, `${m.month} · ${plural(m.days, "day")} · ${fmtInt(m.km)} km`],
    })), { height: 200 }),
    () => tableView(months, [
      { key: "month", label: "Month" },
      { key: "days", label: "Days", num: true, format: fmtInt },
      { key: "hours", label: "Hours", num: true },
      { key: "km", label: "Km", num: true, format: fmtInt },
    ]),
  );
  card.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => {
    state.metric = b.dataset.metric;
    card.querySelectorAll("[data-metric]").forEach((x) => x.classList.toggle("active", x === b));
    redraw();
  }));
}

function timeSplit(months) {
  const years = new Map();
  for (const m of months) {
    const y = m.month.slice(0, 4);
    const row = years.get(y) ?? { year: y, home_h: 0, work_h: 0, everyday_h: 0, explored_h: 0 };
    for (const [k] of SPLIT) row[k] += m[k];
    years.set(y, row);
  }
  const rows = [...years.values()].sort((a, b) => b.year.localeCompare(a.year));
  if (!rows.length) return '<p class="muted">No data yet.</p>';
  return `<div class="split-rows">${rows.map((r) => {
    const total = SPLIT.reduce((s, [k]) => s + r[k], 0) || 1;
    const parts = SPLIT.filter(([k]) => r[k] > 0).map(([k, label, color]) =>
      `<span style="flex:${r[k] / total};background:${color}" data-tip="${esc(`${fmtInt(r[k])} hours|${label} · ${Math.round((r[k] / total) * 100)}% of ${r.year}`)}"></span>`).join("");
    return `<div class="split-row"><span class="yr">${r.year}</span><div class="stacked" role="img" aria-label="${esc(SPLIT.map(([k, label]) => `${label} ${fmtInt(r[k])} hours`).join(", "))}">${parts}</div></div>`;
  }).join("")}</div>`;
}
