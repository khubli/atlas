// End-to-end tests against the production build (`vite preview`), service worker included.
//   npm run test:e2e
// PW_CHROMIUM points at a local Chromium when Playwright's own download isn't available;
// HTTPS_PROXY (if set) is passed to the browser, with the local server bypassing it.

import { defineConfig, devices } from "@playwright/test";

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const launchOptions = {
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: proxy ? [`--proxy-server=${proxy}`, "--proxy-bypass-list=<loopback>;127.0.0.1;localhost"] : [],
};
const PORT = 4173;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.js",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    timezoneId: "Asia/Kolkata",
    locale: "en-US",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    launchOptions,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /smoke\.spec/ },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
