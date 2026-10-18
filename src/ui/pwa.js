// Install prompt handling, shared by the top bar and the welcome screen.

let deferredPrompt = null;
const listeners = new Set();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((fn) => fn(true));
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  listeners.forEach((fn) => fn(false));
});

export const canInstall = () => Boolean(deferredPrompt);
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);

export function onInstallable(fn) {
  listeners.add(fn);
  fn(canInstall());
  return () => listeners.delete(fn);
}

/** Show the browser's install prompt. Returns true if installed. */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  return choice?.outcome === "accepted";
}
