/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import os from 'node:os';

// Some hardened containers block the netlink socket behind
// os.networkInterfaces(), which fails with EPERM/"Unknown system error 13".
// Vite calls it only to PRINT the "Network:" line, but it does so inside the
// 'listening' handler, so the throw is unhandled and kills a server that has
// already bound successfully. Degrade to "no extra addresses to advertise"
// instead of dying over a cosmetic log line.
const realNetworkInterfaces = os.networkInterfaces.bind(os);
os.networkInterfaces = (() => {
  try {
    return realNetworkInterfaces();
  } catch {
    return {};
  }
}) as typeof os.networkInterfaces;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    // Bound to every interface because the browser is not on this machine —
    // the preview is proxied from outside the sandbox.
    host: '0.0.0.0',
    port: 5173,
    // The proxy host is generated per sandbox, so an exact allowlist would
    // break on every restart. Vite still rejects unknown hosts in preview
    // builds; this only relaxes the dev server.
    allowedHosts: true,

    hmr: {
      // The browser can only reach the GATEWAY port (3000) — Vite's own port
      // is private behind it. clientPort: 0 makes Vite's client fall back to
      // the PAGE'S OWN origin (its protocol, host and port), so the HMR
      // socket rides the same connection as the page: through the gateway in
      // the single-port preview, straight to Vite when 5173 is opened
      // directly. Any other setting dials a port the browser cannot reach.
      clientPort: 0,
    },

    proxy: {
      // The single reason this exists: the browser must never be told to call
      // localhost:3000. It calls its own origin, and Vite forwards. This also
      // makes the refresh cookie same-origin, which is what lets it stay
      // httpOnly without a CORS credentials dance.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
