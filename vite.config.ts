import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, cpSync, readFileSync, writeFileSync, rmSync } from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'extension/popup/popup.html'),
        content: resolve(__dirname, 'extension/content/index.ts'),
        background: resolve(__dirname, 'extension/background.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content') return 'content/index.js';
          if (chunkInfo.name === 'background') return 'background.js';
          if (chunkInfo.name === 'popup') return 'popup/popup.js';
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'popup/popup.css';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
  plugins: [
    {
      name: 'post-build-chrome-extension',
      closeBundle() {
        // Move popup.html if Vite put it under dist/extension/popup/popup.html
        if (existsSync('dist/extension/popup/popup.html')) {
          mkdirSync('dist/popup', { recursive: true });
          copyFileSync('dist/extension/popup/popup.html', 'dist/popup/popup.html');
          rmSync('dist/extension', { recursive: true, force: true });
        }

        // Copy manifest.json
        if (existsSync('extension/manifest.json')) {
          copyFileSync('extension/manifest.json', 'dist/manifest.json');
        }

        // Copy icons
        if (existsSync('extension/icons')) {
          mkdirSync('dist/icons', { recursive: true });
          cpSync('extension/icons', 'dist/icons', { recursive: true });
        }

        // Copy overlay.css
        if (existsSync('extension/content/overlay.css')) {
          mkdirSync('dist/content', { recursive: true });
          copyFileSync('extension/content/overlay.css', 'dist/content/overlay.css');
        }
      },
    },
  ],
});
