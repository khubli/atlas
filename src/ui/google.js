// Optional exact names from Google, using the person's own browser key.
// The Maps JavaScript API's Place class looks up the place IDs that the
// Timeline export already contains (Places API (New), Place Details).

// A lookup is billed at the highest tier among the fields it asks for. These are all
// Place Details Essentials or Pro (5,000 free a month); rating, review count and
// website are Enterprise (1,000 free a month), so Atlas doesn't ask for them.
const FIELDS = ["displayName", "types", "primaryType", "formattedAddress", "googleMapsURI"];
const PAUSE_MS = 120;
const BATCH = 20;

let loading = null;

function loadMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  loading ??= new Promise((resolve, reject) => {
    window.__atlasMapsReady = () => resolve(window.google.maps);
    window.gm_authFailure = () => reject(new Error("Google rejected the key. Check that Places API (New) is enabled and this site is allowed for the key."));
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__atlasMapsReady`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Google Maps. Check your connection and key."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

const isMissing = (e) => /NOT_FOUND|not found|INVALID_REQUEST|invalid/i.test(String(e?.message || e));

/**
 * Look up place IDs in order. Results go to onBatch({ id: details | null }, calls)
 * in groups so progress is saved as it goes; null records "Google doesn't know
 * this place any more" so it isn't asked again.
 */
export async function enrichWithGoogle({ key, ids, onBatch, onProgress, signal }) {
  const maps = await loadMaps(key);
  const { Place } = await maps.importLibrary("places");
  let batch = {};
  let calls = 0;
  let done = 0;
  const flush = async () => {
    if (!Object.keys(batch).length && !calls) return;
    await onBatch(batch, calls);
    batch = {};
    calls = 0;
  };
  try {
    for (const id of ids) {
      if (signal?.aborted) break;
      try {
        const place = new Place({ id });
        await place.fetchFields({ fields: FIELDS });
        batch[id] = {
          name: place.displayName ?? null,
          types: place.types ?? [],
          primaryType: place.primaryType ?? null,
          address: place.formattedAddress ?? null,
          uri: place.googleMapsURI ?? null,
        };
      } catch (e) {
        if (!isMissing(e)) throw e;
        batch[id] = null;
      }
      calls++;
      done++;
      onProgress?.(done, ids.length);
      if (Object.keys(batch).length >= BATCH) await flush();
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  } finally {
    await flush();
  }
  return done;
}
