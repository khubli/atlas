// Reads an export file (Blob/File) of any supported shape into a sink.
// Small files are parsed whole; large ones are streamed so a phone never holds
// the whole document (Android exports can carry hundreds of MB of rawSignals).

import { JSONParser } from "@streamparser/json";
import { strFromU8, unzipSync } from "fflate";
import { isSavedPlaces, readSavedPlaces } from "./saved.js";
import { readProfile, readSegment, readTakeoutObject } from "./segments.js";

const STREAM_ABOVE_BYTES = 24 * 1024 * 1024;

export class UnsupportedFile extends Error {}

export const FORMAT_LABELS = {
  android: "Android Timeline export",
  ios: "iPhone Timeline export",
  takeout: "Google Takeout (Semantic Location History)",
  saved: "Google Maps saved places",
};

function dispatchRoot(root, sink, offset) {
  if (Array.isArray(root)) {
    for (const seg of root) readSegment(seg, sink, offset);
    return "ios";
  }
  if (root && Array.isArray(root.semanticSegments)) {
    for (const seg of root.semanticSegments) readSegment(seg, sink, offset);
    if (root.userLocationProfile) readProfile(root.userLocationProfile, sink);
    return "android";
  }
  if (root && Array.isArray(root.timelineObjects)) {
    for (const obj of root.timelineObjects) readTakeoutObject(obj, sink, offset);
    return "takeout";
  }
  if (isSavedPlaces(root)) return readSavedPlaces(root, sink);
  if (root && Array.isArray(root.locations)) {
    throw new UnsupportedFile(
      "This is Records.json (raw GPS points). Atlas needs the Timeline export from your phone, " +
        "or the Semantic Location History folder from an old Takeout.",
    );
  }
  throw new UnsupportedFile("This doesn't look like a Google Timeline export or saved places file.");
}

async function streamJson(blob, isArray, sink, offset, onProgress) {
  const parser = new JSONParser({
    paths: isArray ? ["$.*"] : ["$.semanticSegments.*", "$.timelineObjects.*", "$.userLocationProfile"],
    keepStack: false,
  });
  let format = isArray ? "ios" : null;
  parser.onValue = ({ value, key, stack }) => {
    if (isArray) return readSegment(value, sink, offset);
    const parent = stack.length > 1 ? stack[stack.length - 1].key : key;
    if (parent === "semanticSegments") {
      format = "android";
      readSegment(value, sink, offset);
    } else if (parent === "timelineObjects") {
      format = "takeout";
      readTakeoutObject(value, sink, offset);
    } else if (key === "userLocationProfile") {
      readProfile(value, sink);
    }
  };
  const reader = blob.stream().getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.write(value);
    read += value.byteLength;
    onProgress?.(read / blob.size);
  }
  if (!parser.isEnded) parser.end();
  if (!format) throw new UnsupportedFile("This doesn't look like a Google Timeline export.");
  return format;
}

async function readJsonBlob(blob, sink, offset, onProgress, streamAbove) {
  const head = (await blob.slice(0, 4096).text()).trimStart();
  if (/^\{\s*"locations"\s*:/.test(head)) return dispatchRoot({ locations: [] }, sink, offset);
  if (head[0] !== "[" && head[0] !== "{") throw new UnsupportedFile("This file is not JSON.");
  if (blob.size > streamAbove) return streamJson(blob, head[0] === "[", sink, offset, onProgress);
  let root;
  try {
    root = JSON.parse(await blob.text());
  } catch {
    throw new UnsupportedFile("This file is not valid JSON. Was the export complete?");
  }
  onProgress?.(1);
  return dispatchRoot(root, sink, offset);
}

// Takeout archives hold many other products; only location history and your
// saved/labelled places are read.
const ZIP_WANTED = /\.json$/i;
const ZIP_SKIP = /(Records|Settings|Timeline Edits|Encrypted Backups)\.json$/i;

/**
 * Read one file into the sink. Returns the detected format
 * ("android" | "ios" | "takeout").
 * `offset` is the UTC offset (minutes) used when a timestamp carries none.
 */
export async function readExport(blob, sink, { offset = 0, onProgress, streamAboveBytes = STREAM_ABOVE_BYTES } = {}) {
  const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isZip = magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04;
  if (!isZip) return readJsonBlob(blob, sink, offset, onProgress, streamAboveBytes);

  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
    filter: (f) => ZIP_WANTED.test(f.name) && !ZIP_SKIP.test(f.name),
  });
  const names = Object.keys(files).sort();
  if (!names.length) throw new UnsupportedFile("No Timeline data found in this zip.");
  const formats = new Set();
  let done = 0;
  for (const name of names) {
    const text = strFromU8(files[name]);
    try {
      formats.add(dispatchRoot(JSON.parse(text), sink, offset));
    } catch (e) {
      if (!(e instanceof UnsupportedFile) && !(e instanceof SyntaxError)) throw e;
    }
    onProgress?.(++done / names.length);
  }
  if (!formats.size) throw new UnsupportedFile("No Timeline data found in this zip.");
  return [...formats][0];
}
