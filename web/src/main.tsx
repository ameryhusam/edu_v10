/**
 * Entry point.
 *
 * Mounts the provider stack and the router, and nothing else. Any logic that
 * appears here is logic that cannot be tested without booting the whole app.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app/providers';
import { AppRouter } from './app/router';
import { registerServiceWorker } from './shared/platform/pwa';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element.');
}

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
);

registerServiceWorker();
