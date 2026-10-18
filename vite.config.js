import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Relative base: the same build works at a domain root or under a sub-path
// (GitHub Pages serves project sites at /<repo>/).
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: true },
  worker: { format: "es" },
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "prompt",
      injectRegister: false,
      includeManifestIcons: false, // already matched by globPatterns
      // Send cookies with the manifest request, so installing still works if the site
      // is put behind a login such as Cloudflare Access.
      useCredentials: true,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg}", "geo/*.json"],
        globIgnores: ["demo/**"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        id: "./",
        name: "Atlas",
        short_name: "Atlas",
        description: "Your travel history, rebuilt from your own Google Timeline, on your device",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f4f6f8",
        theme_color: "#13202e",
        lang: "en",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Android: Files -> Share -> Atlas opens the import with the file.
        share_target: {
          action: "./share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: { files: [{ name: "file", accept: ["application/json", ".json", "application/zip", ".zip"] }] },
        },
        // Desktop: "Open with Atlas" for exports.
        file_handlers: [{ action: "./", accept: { "application/json": [".json"], "application/zip": [".zip"] } }],
        launch_handler: { client_mode: "focus-existing" },
        shortcuts: [
          { name: "Trips", url: "./#/trips" },
          { name: "Map", url: "./#/map" },
          { name: "Import", url: "./#/import" },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js"],
  },
});
