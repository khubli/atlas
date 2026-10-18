// Coordinates and path geometry.

const FLOAT_RE = /-?\d+(?:\.\d+)?/g;

/**
 * Read a coordinate pair from any Timeline spelling:
 *   "12.9716°, 77.5946°"  (Android; often with a double-encoded degree sign)
 *   "geo:12.9716,77.5946" (iPhone)
 *   { latitudeE7, longitudeE7 } or { latE7, lngE7 } (legacy Takeout)
 */
export function parseLatLng(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    const lat = value.latitudeE7 ?? value.latE7 ?? value.centerLatE7;
    const lng = value.longitudeE7 ?? value.lngE7 ?? value.centerLngE7;
    if (lat == null || lng == null) return parseLatLng(value.latLng ?? value.LatLng ?? null);
    return validPair(unwrapE7(Number(lat), 900000000) / 1e7, unwrapE7(Number(lng), 1800000000) / 1e7);
  }
  const nums = String(value).match(FLOAT_RE);
  if (!nums || nums.length < 2) return null;
  return validPair(Number(nums[0]), Number(nums[1]));
}

// Old Takeout files sometimes stored negative E7 values as unsigned 32-bit ints.
function unwrapE7(v, limit) {
  return v > limit ? v - 4294967296 : v;
}

function validPair(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function perpendicular([y, x], [y1, x1], [y2, x2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Ramer-Douglas-Peucker, iterative so long tracks can't overflow the stack. */
function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let best = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicular(points[i], points[start], points[end]);
      if (d > best) {
        best = d;
        index = i;
      }
    }
    if (index >= 0 && best > epsilon) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

export function simplifyPath(points, epsilon = 0.0005) {
  const pts = points.map(([lat, lng]) => [round5(lat), round5(lng)]);
  const deduped = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  return rdp(deduped, epsilon);
}

/**
 * Cut a timed track [[ms, lat, lng]] wherever recording stopped or jumped,
 * so a flight or a phone switched off never draws a straight "road".
 */
export function splitTrack(points, maxGapMinutes = 20, maxJumpKm = 30) {
  const segments = [];
  let current = [];
  let prev = null;
  for (const [t, lat, lng] of points) {
    if (prev) {
      const gap = (t - prev[0]) / 60000;
      const jump = haversineKm(prev[1], prev[2], lat, lng) || 0;
      if (gap > maxGapMinutes || jump > maxJumpKm) {
        segments.push(current);
        current = [];
      }
    }
    current.push([lat, lng]);
    prev = [t, lat, lng];
  }
  if (current.length) segments.push(current);
  return segments.filter((s) => s.length >= 2);
}

function span(seg) {
  let km = 0;
  for (let i = 1; i < seg.length; i++) km += haversineKm(seg[i - 1][0], seg[i - 1][1], seg[i][0], seg[i][1]) || 0;
  return km;
}

/** Simplify segments with one shared epsilon until the total fits; keeps order. */
export function simplifySegments(segments, maxPoints, epsilon = 0.0005) {
  let indexed = segments.map((seg, i) => [i, seg]).filter(([, seg]) => seg.length >= 2);
  indexed.sort((a, b) => span(b[1]) - span(a[1]));
  indexed = indexed.slice(0, Math.max(1, Math.floor(maxPoints / 2)));
  let out;
  for (;;) {
    out = indexed.map(([i, seg]) => [i, simplifyPath(seg, epsilon)]).filter(([, seg]) => seg.length >= 2);
    if (out.reduce((s, [, seg]) => s + seg.length, 0) <= maxPoints || epsilon > 1) break;
    epsilon *= 2;
  }
  while (out.length && out.reduce((s, [, seg]) => s + seg.length, 0) > maxPoints) out.pop();
  return out.sort((a, b) => a[0] - b[0]).map(([, seg]) => seg);
}
