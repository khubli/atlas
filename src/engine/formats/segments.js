// Normalizers for every Google location-history export shape Atlas reads.
// Each turns one source record into calls on a sink:
//   sink.visit({ placeId, start, end, offset, lat, lng, semantic, level, probability, name, address })
//   sink.move({ start, end, offset, from, to, km, type })
//   sink.point(ms, lat, lng)
//   sink.frequentPlace(placeId, label)

import { parseLatLng } from "../geo.js";
import { parseTime } from "../time.js";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** "Inferred Home", "INFERRED_HOME", "TYPE_HOME" -> "INFERRED_HOME" / "HOME". */
export function normSemantic(value) {
  if (!value) return "UNKNOWN";
  return String(value).trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/^TYPE_/, "");
}

/**
 * One element of `semanticSegments` (Android) or of the bare top-level array
 * (iPhone). The two differ in spelling, not meaning:
 *   placeId vs placeID; placeLocation.latLng "12.9°, 77.5°" vs placeLocation "geo:12.9,77.5";
 *   numbers vs numeric strings; breadcrumb `time` vs `durationMinutesOffsetFromStartTime`.
 */
export function readSegment(seg, sink, fallbackOffset = 0) {
  if (!seg || typeof seg !== "object") return;
  const start = parseTime(seg.startTime, num(seg.startTimeTimezoneUtcOffsetMinutes) ?? fallbackOffset);
  const end = parseTime(seg.endTime, num(seg.endTimeTimezoneUtcOffsetMinutes) ?? start?.offset ?? fallbackOffset);

  if (seg.visit && start && end) {
    const v = seg.visit;
    const top = v.topCandidate || {};
    const placeId = top.placeId ?? top.placeID ?? top.place_id;
    const loc = parseLatLng(top.placeLocation?.latLng ?? top.placeLocation);
    if (placeId) {
      sink.visit({
        placeId: String(placeId),
        start: start.ms,
        end: end.ms,
        offset: start.offset,
        lat: loc?.[0] ?? null,
        lng: loc?.[1] ?? null,
        semantic: normSemantic(top.semanticType),
        level: num(v.hierarchyLevel) ?? 0,
        probability: num(v.probability ?? top.probability),
        // Not in Android exports; some iPhone exports are reported to carry names.
        name: top.name ?? top.placeName ?? v.name ?? null,
        address: top.address ?? null,
      });
    }
  }

  if (seg.activity && start && end) {
    const a = seg.activity;
    sink.move({
      start: start.ms,
      end: end.ms,
      offset: start.offset,
      from: parseLatLng(a.start?.latLng ?? a.start),
      to: parseLatLng(a.end?.latLng ?? a.end),
      km: (num(a.distanceMeters) ?? 0) / 1000,
      type: a.topCandidate?.type ?? null,
    });
  }

  if (Array.isArray(seg.timelinePath) && start) {
    for (const p of seg.timelinePath) {
      const loc = parseLatLng(p.point);
      if (!loc) continue;
      let t = null;
      if (p.time) t = parseTime(p.time, start.offset)?.ms ?? null;
      else if (p.durationMinutesOffsetFromStartTime != null) {
        t = start.ms + Number(p.durationMinutesOffsetFromStartTime) * 60000;
      }
      if (t != null && Number.isFinite(t)) sink.point(t, loc[0], loc[1]);
    }
  }
}

/** Android `userLocationProfile`: Google's own HOME/WORK labels for frequent places. */
export function readProfile(profile, sink) {
  for (const fp of profile?.frequentPlaces || []) {
    if (fp.placeId && fp.label) sink.frequentPlace(String(fp.placeId), normSemantic(fp.label));
  }
}

// ---- Legacy Takeout: Semantic Location History (monthly files) -------------------

function takeoutTime(duration, key, fallbackOffset) {
  const iso = duration?.[`${key}Timestamp`];
  if (iso) {
    const t = parseTime(iso, fallbackOffset);
    // Takeout stamps are UTC; show them at the viewer's offset (the best guess available).
    return t ? { ms: t.ms, offset: fallbackOffset } : null;
  }
  const ms = num(duration?.[`${key}TimestampMs`]);
  return ms == null ? null : { ms, offset: fallbackOffset };
}

function takeoutVisit(pv, sink, level, fallbackOffset) {
  const loc = pv.location || {};
  const start = takeoutTime(pv.duration, "start", fallbackOffset);
  const end = takeoutTime(pv.duration, "end", fallbackOffset);
  const ll = parseLatLng(loc) || parseLatLng({ latitudeE7: pv.centerLatE7, longitudeE7: pv.centerLngE7 });
  if (loc.placeId && start && end) {
    sink.visit({
      placeId: String(loc.placeId),
      start: start.ms,
      end: end.ms,
      offset: start.offset,
      lat: ll?.[0] ?? null,
      lng: ll?.[1] ?? null,
      semantic: normSemantic(loc.semanticType),
      level,
      probability: num(pv.visitConfidence) != null ? num(pv.visitConfidence) / 100 : null,
      name: loc.name ?? null,
      address: loc.address ?? null,
    });
  }
  for (const child of pv.childVisits || []) takeoutVisit(child, sink, level + 1, fallbackOffset);
}

/** One element of `timelineObjects`. */
export function readTakeoutObject(obj, sink, fallbackOffset = 0) {
  if (obj?.placeVisit) takeoutVisit(obj.placeVisit, sink, 0, fallbackOffset);
  const a = obj?.activitySegment;
  if (a) {
    const start = takeoutTime(a.duration, "start", fallbackOffset);
    const end = takeoutTime(a.duration, "end", fallbackOffset);
    if (start && end) {
      sink.move({
        start: start.ms,
        end: end.ms,
        offset: start.offset,
        from: parseLatLng(a.startLocation),
        to: parseLatLng(a.endLocation),
        km: (num(a.distance) ?? num(a.waypointPath?.distanceMeters) ?? num(a.simplifiedRawPath?.distanceMeters) ?? 0) / 1000,
        type: a.activityType ?? a.activities?.[0]?.activityType ?? null,
      });
    }
    for (const p of a.simplifiedRawPath?.points || []) {
      const ll = parseLatLng(p);
      const t = p.timestamp ? parseTime(p.timestamp)?.ms : num(p.timestampMs);
      if (ll && t != null) sink.point(t, ll[0], ll[1]);
    }
  }
}
