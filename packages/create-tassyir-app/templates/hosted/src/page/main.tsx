import { createAppBridge } from '@tassyir/app-bridge';
import { AppBridgeProvider } from '@tassyir/app-bridge/react';
// Importing @tassyir/ui defines its elements (<tsy-table>, <tsy-card>, …)
// and adopts the dashboard's tokens and type into this document.
import '@tassyir/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, NotEmbedded } from './App.tsx';

// The page's own layout: the space between the cards and around them. Every
// other style comes from @tassyir/ui. A constructable stylesheet, like the
// elements' own, so the page keeps its strict Content-Security-Policy
// (style-src 'self': no inline style).
const layout = new CSSStyleSheet();
layout.replaceSync(
  'body{margin:0}' +
    '#app{display:grid;gap:var(--tsy-space-section);padding:var(--tsy-space-grid)}' +
    'p{margin:0;color:var(--tsy-color-ink-secondary)}',
);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, layout];

// Create the bridge once, as the page loads, before React renders: its first
// message is what tells the dashboard the page is up.
const bridge = createAppBridge();

const root = document.querySelector('#app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      {bridge.embedded ? (
        <AppBridgeProvider bridge={bridge}>
          <App />
        </AppBridgeProvider>
      ) : (
        <NotEmbedded />
      )}
    </StrictMode>,
  );
}
