/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const brandColor = '#012B42';
const canvasColor = '#012B42';

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        id: '/',
        name: 'Agla Kadam',
        short_name: 'Agla Kadam',
        description:
          'Offline-first mentoring for Cluster Resource Persons and primary teachers working towards NIPUN Bharat goals.',
        lang: 'en-IN',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: brandColor,
        background_color: canvasColor,
        categories: ['education', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest,json}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Runtime-neutral modules shared with the Edge Functions (sign-in identifiers, password rules).
      '@shared': fileURLToPath(new URL('../../supabase/functions/_shared', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // Source maps are produced for debugging but not referenced by the shipped files.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // Third-party code changes far less often than application code. Keeping it in separate,
        // long-lived chunks means a release only re-downloads what actually changed, which matters
        // on prepaid mobile data. Only modules on the initial load path are grouped, so libraries
        // used by lazily loaded screens stay out of the first download.
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              tags: ['$initial'],
              priority: 30,
            },
            {
              name: 'vendor-tanstack',
              test: /[\\/]node_modules[\\/]@tanstack[\\/]/,
              tags: ['$initial'],
              priority: 20,
            },
            {
              name: 'vendor',
              test: /[\\/]node_modules[\\/]/,
              tags: ['$initial'],
              priority: 10,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Screen tests drive many taps through user-event; with every file running in parallel on a
    // slower machine, one of them can take longer than the default five seconds.
    testTimeout: 15_000,
    // Clearly local values: unit tests never reach a real project.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit_test_only',
    },
  },
});
