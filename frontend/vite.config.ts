import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        importScripts: ['push-notifications.js'],
      },
      manifest: {
        name: 'Gym Video Logger',
        short_name: 'Gym Logger',
        description: 'Private gym-set video upload and processing',
        theme_color: '#0d1b2a',
        background_color: '#f7f9fc',
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
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
});
