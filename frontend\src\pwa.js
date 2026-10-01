// PWA install support: register the service worker (production only) and capture
// the browser's install prompt so the app can offer an "Install Desktop App" button.

export function setupPWA() {
  const isProd = process.env.NODE_ENV === "production";

  if ("serviceWorker" in navigator) {
    if (isProd) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js").catch(() => {});
      });
    } else {
      // Development: never let a stale service worker serve cached old content.
      // This self-heals machines that previously registered the SW.
      navigator.serviceWorker.getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      if (window.caches) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
    }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__promethiusInstallPrompt = e;
    window.dispatchEvent(new Event("pwa-installable"));
  });

  window.addEventListener("appinstalled", () => {
    window.__promethiusInstallPrompt = null;
    window.dispatchEvent(new Event("pwa-installed"));
  });
}
