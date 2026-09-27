import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-600.css';
import '@fontsource/instrument-sans/latin-700.css';
import '@fontsource/work-sans/latin-400.css';
import '@fontsource/work-sans/latin-500.css';
import '@fontsource/work-sans/latin-600.css';
import '@fontsource/noto-sans-tamil/tamil-400.css';
import '@fontsource/noto-sans-tamil/tamil-600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { RouteErrorBoundary } from './app/RouteErrorBoundary';
import './styles/app.css';
import './styles/experience.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouteErrorBoundary><App /></RouteErrorBoundary>
  </StrictMode>,
);

// Offline-capable PWA shell (production builds only, so dev reloads are never stale).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
