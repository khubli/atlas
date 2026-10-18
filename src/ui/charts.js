// Small hand-rolled SVG/HTML charts that follow the dashboard's chart rules:
// thin marks, 4px rounded data ends on a shared baseline, hairline grid,
// selective labels, hover + focus tooltips, and a table view for every chart.

import { esc, fmtCompact, fmtInt, fmtMonthName, todayIso } from "./util.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function niceStep(max, targetTicks = 4) {
  if (max <= 0) return 1;
  const raw = max / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function roundedTop(x, y, w, h, r) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Column chart. rows: [{ label, value, tip: [strong, ...lines] }].
 * Value labels sit on the caps (there are only a handful of columns).
 */
export function columnChart(el, rows, { height = 210, format = fmtInt } = {}) {
  const width = Math.max(280, el.clientWidth || 600);
  const m = { top: 20, right: 6, bottom: 26, left: 36 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const max = Math.max(0, ...rows.map((r) => r.value));
  const step = niceStep(max);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const y = (v) => m.top + plotH - (v / top) * plotH;
  const band = plotW / Math.max(rows.length, 1);
  const barW = Math.min(24, band * 0.6);
  // Narrow screens: drop value labels and keep only spaced-out axis labels
  // (major ones first); every value is still in the tooltip and the table.
  const showValues = band >= 26;
  const crowded = band < 22;
  const hasMajor = rows.some((r) => r.major);
  let lastLabelX = -Infinity;

  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);

  let svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" role="img">`;
  svg += `<g class="grid">${ticks.slice(1).map((v) => `<line x1="${m.left}" x2="${width - m.right}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g>`;
  svg += ticks.map((v) => `<text class="tick" x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end">${fmtCompact(v)}</text>`).join("");
  svg += `<line class="baseline" x1="${m.left}" x2="${width - m.right}" y1="${y(0)}" y2="${y(0)}"/>`;
  rows.forEach((r, i) => {
    const cx = m.left + band * i + band / 2;
    const bx = cx - barW / 2;
    const by = y(r.value);
    const tip = esc((r.tip || [format(r.value), r.label]).join("|"));
    svg += `<rect class="hit" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${plotH}" tabindex="0" data-tip="${tip}" data-i="${i}" aria-label="${esc(r.label)}: ${esc(format(r.value))}"/>`;
    svg += `<path class="bar" d="${roundedTop(bx, by, barW, y(0) - by, 4)}"/>`;
    if (r.value > 0 && showValues) svg += `<text class="val" x="${cx}" y="${by - 6}" text-anchor="middle">${esc(fmtCompact(r.value))}</text>`;
    const wanted = !crowded || (hasMajor ? r.major : i % Math.ceil(30 / band) === 0);
    if (wanted && cx - lastLabelX >= (crowded ? 46 : 0)) {
      svg += `<text class="tick" x="${cx}" y="${height - 6}" text-anchor="middle">${esc(r.label)}</text>`;
      lastLabelX = cx;
    }
  });
  svg += "</svg>";
  el.innerHTML = svg;
}

/** Horizontal bars as HTML rows. rows: [{ name, icon?, value, display?, sub?, color?, action? }] */
export function hbars(rows, { max } = {}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="hbars">${rows.map((r) => {
    const tag = r.action ? "button" : "div";
    const attrs = r.action ? ` type="button" data-action="${esc(r.action)}"` : "";
    return `<${tag} class="hbar"${attrs}>
      <span class="name">${r.icon ? `<span class="ico" aria-hidden="true">${r.icon}</span>` : ""}${esc(r.name)}</span>
      <span class="track"><span class="fill" style="width:${Math.max(1.5, (r.value / top) * 100)}%;${r.color ? `background:${r.color}` : ""}"></span></span>
      <span class="num">${esc(r.display ?? fmtInt(r.value))}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span>
    </${tag}>`;
  }).join("")}</div>`;
}

/** Part-to-whole strip with a 2px surface gap between segments, plus its legend. */
export function stackedBar(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const strip = parts.map((p) =>
    `<span style="flex:${p.value / total};background:${p.color}" data-tip="${esc(`${p.display}|${p.label} · ${Math.round((p.value / total) * 100)}%`)}"></span>`).join("");
  const legend = parts.map((p) =>
    `<span><i class="sw" style="background:${p.color}"></i>${esc(p.label)}<strong>${esc(p.display)}</strong></span>`).join("");
  return `<div class="stacked" role="img" aria-label="${esc(parts.map((p) => `${p.label} ${p.display}`).join(", "))}">${strip}</div><div class="legend">${legend}</div>`;
}

/**
 * A year of travel as twelve month grids (Mon-first). `days` maps
 * YYYY-MM-DD -> { kind: 'd' | 'n', title, id }.
 */
export function calendarYear(year, days) {
  const today = todayIso();
  let html = '<div class="cal-months">';
  for (let mo = 0; mo < 12; mo++) {
    const first = new Date(Date.UTC(year, mo, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, mo + 1, 0)).getUTCDate();
    let cells = "";
    for (let i = 0; i < lead; i++) cells += '<span class="pad"></span>';
    for (let d = 1; d <= count; d++) {
      const iso = `${year}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const hit = days.get(iso);
      const cls = [hit ? hit.kind : "", iso === today ? "today" : ""].filter(Boolean).join(" ");
      if (hit) {
        const tip = esc(`${hit.title}|${iso}${hit.kind === "d" ? " · day trip" : ""}`);
        cells += `<span class="${cls}" data-tip="${tip}" data-journey="${hit.id}"></span>`;
      } else {
        cells += `<span${cls ? ` class="${cls}"` : ""}></span>`;
      }
    }
    html += `<div class="cal-month"><h3>${fmtMonthName(mo)}</h3><div class="cal-grid">${cells}</div></div>`;
  }
  return html + "</div>";
}

/** Plain table twin for a chart. columns: [{ key, label, num? , format? }] */
export function tableView(rows, columns) {
  const head = columns.map((c) => `<th${c.num ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("");
  const body = rows.map((r) => `<tr>${columns.map((c) => {
    const v = c.format ? c.format(r[c.key], r) : r[c.key];
    return `<td${c.num ? ' class="num"' : ""}>${esc(v ?? "")}</td>`;
  }).join("")}</tr>`).join("");
  return `<table class="table-view"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Add a Chart/Table switch to a card. `renderChart(target)` draws the chart;
 * `renderTable()` returns the table HTML.
 */
export function chartWithTable(card, renderChart, renderTable) {
  const target = card.querySelector("[data-chart]");
  const btn = card.querySelector("[data-table-toggle]");
  let asTable = false;
  const draw = () => {
    if (asTable) target.innerHTML = renderTable();
    else renderChart(target);
    btn.textContent = asTable ? "Chart" : "Table";
  };
  btn.addEventListener("click", () => {
    asTable = !asTable;
    draw();
  });
  draw();
  return draw;
}
