import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'dist');

const isWatch = process.argv.includes('--watch');

async function build() {
  console.log('⚡ Building Point & Read Chrome Extension...');

  // Clean outDir
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(resolve(outDir, 'content'), { recursive: true });
  mkdirSync(resolve(outDir, 'popup'), { recursive: true });
  mkdirSync(resolve(outDir, 'icons'), { recursive: true });

  // 1. Bundle Content Script (IIFE - completely self-contained for Chrome content script injection)
  await esbuild.build({
    entryPoints: [resolve(root, 'extension/content/index.ts')],
    outfile: resolve(outDir, 'content/index.js'),
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    sourcemap: false,
    minify: false,
  });

  // 2. Bundle Background Worker (ESM for MV3 service worker)
  await esbuild.build({
    entryPoints: [resolve(root, 'extension/background.ts')],
    outfile: resolve(outDir, 'background.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    sourcemap: false,
    minify: false,
  });

  // 3. Bundle Popup Script (ESM for popup.html)
  await esbuild.build({
    entryPoints: [resolve(root, 'extension/popup/popup.ts')],
    outfile: resolve(outDir, 'popup/popup.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    sourcemap: false,
    minify: false,
  });

  // 4. Copy static assets
  copyFileSync(resolve(root, 'extension/manifest.json'), resolve(outDir, 'manifest.json'));
  copyFileSync(resolve(root, 'extension/popup/popup.html'), resolve(outDir, 'popup/popup.html'));
  copyFileSync(resolve(root, 'extension/popup/popup.css'), resolve(outDir, 'popup/popup.css'));
  copyFileSync(resolve(root, 'extension/content/overlay.css'), resolve(outDir, 'content/overlay.css'));

  if (existsSync(resolve(root, 'extension/icons'))) {
    cpSync(resolve(root, 'extension/icons'), resolve(outDir, 'icons'), { recursive: true });
  }

  console.log('✅ Extension build complete in /dist');
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
