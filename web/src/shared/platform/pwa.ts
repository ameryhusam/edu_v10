/** Android/PWA installation support. */

/**
 * Registers the production service worker when the browser supports it.
 *
 * Kept in shared/platform because `navigator` is a browser boundary. The app
 * shell still works without a service worker; this only adds offline recovery
 * for the static shell so an Android WebView/PWA does not show a blank page
 * when the connection drops.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const run = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installation support is progressive enhancement, not a boot blocker.
    });
  };

  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}
