import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const developmentServiceWorker = `
importScripts('/push-notifications.js');

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
      self.clients.claim(),
    ]),
  );
});
`;

function resetProductionWorkerDuringDevelopment(): Plugin {
  return {
    name: 'reset-production-service-worker-during-development',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.originalUrl?.split('?')[0] !== '/sw.js') {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        response.setHeader('Service-Worker-Allowed', '/');
        response.end(developmentServiceWorker);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    resetProductionWorkerDuringDevelopment(),
    VitePWA({
      // Registration is managed in appUpdates.ts without interrupting open forms.
      injectRegister: false,
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        importScripts: ['push-notifications.js'],
      },
      manifest: {
        name: 'Gym Logger',
        short_name: 'Gym Logger',
        description: 'Private workout tracking, progress, and video logging',
        theme_color: '#121516',
        background_color: '#121516',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  server: {
    allowedHosts: ['mainpc.tail494810.ts.net'],
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
