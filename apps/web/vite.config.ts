import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The buyer surface is a separate HTML entry served on its own origin (ADR-020). In development the same Vite
// server answers http://proposals.localhost:5273/p and serves buyer.html there.
const toBuyerPage = (req: { url?: string }, _res: unknown, next: () => void) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/p' || path === '/f') req.url = '/buyer.html';
  next();
};
const buyerEntry = (): Plugin => ({
  name: 'buyer-entry',
  configureServer(server) {
    server.middlewares.use(toBuyerPage);
  },
  // `vite preview` serves the production build (used by scripts/tunnel.ps1); same buyer routing.
  configurePreviewServer(server) {
    server.middlewares.use(toBuyerPage);
  },
});

const api = 'http://localhost:3000';
export default defineConfig({
  plugins: [react(), tailwindcss(), buyerEntry()],
  build: { rollupOptions: { input: { index: 'index.html', buyer: 'buyer.html' } } },
  server: {
    port: 5273,
    strictPort: true,
    proxy: { '/api': api, '/auth': api, '/public': api, '/dev': api },
  },
  // Production build behind a Cloudflare quick tunnel (scripts/tunnel.ps1). /dev is not forwarded here.
  preview: {
    port: 4173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/api': api, '/auth': api, '/public': api },
  },
});
