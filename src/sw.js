// Service worker: the whole app works offline; map tiles are cached as you
// browse; files shared from Android's share sheet are handed to the importer.

import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

registerRoute(
  ({ url }) => url.hostname.endsWith("tile.openstreetmap.org"),
  new CacheFirst({
    cacheName: "atlas-tiles",
    plugins: [new ExpirationPlugin({ maxEntries: 1500, maxAgeSeconds: 60 * 24 * 3600, purgeOnQuotaError: true })],
  }),
);
registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.includes("/demo/"), new StaleWhileRevalidate({ cacheName: "atlas-demo" }));

// Android share sheet -> POST ./share-target (see share_target in the manifest).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || !url.pathname.endsWith("/share-target")) return;
  event.respondWith((async () => {
    const form = await event.request.formData();
    const cache = await caches.open("atlas-share");
    let i = 0;
    for (const file of form.getAll("file")) {
      if (!(file instanceof File)) continue;
      await cache.put(`shared-${Date.now()}-${i++}`, new Response(file, {
        headers: { "X-File-Name": encodeURIComponent(file.name || "Timeline.json") },
      }));
    }
    return Response.redirect(new URL("./#/import?shared=1", self.registration.scope).href, 303);
  })());
});

// The page asks to switch to a new version when the person taps "Reload".
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
