import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
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
