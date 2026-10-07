import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Mode « apercu » : une seule page HTML autonome, sans service worker, pour la montrer dans un visualiseur (voir scripts/inline.mjs).
export default defineConfig(({ mode }) => {
  const apercu = mode === 'apercu';
  return {
  base: './',
  resolve: apercu ? { alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/pwa-stub.ts', import.meta.url)) } } : {},
  plugins: [
    react(),
    ...(apercu ? [] : [VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Digitalab – gestion d’élevage',
        short_name: 'Digitalab',
        description: 'Suivi simple de votre élevage, même sans connexion.',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f6f4ef',
        theme_color: '#1f6f4a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
    })]),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
