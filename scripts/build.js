import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, cpSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'dist');

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

  // 1. Bundle Content Script (IIFE - self-contained for content script injection)
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

  // 5. Post-Build Validation: Assert all manifest and HTML asset references exist
  validateBuildArtifacts();

  console.log('✅ Extension build verified successfully in /dist');
}

function validateBuildArtifacts() {
  console.log('🔍 Validating build artifacts...');

  // A. Check manifest.json
  const manifestPath = resolve(outDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Missing manifest.json in dist');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // Check background
  if (manifest.background?.service_worker) {
    const swPath = resolve(outDir, manifest.background.service_worker);
    if (!existsSync(swPath)) {
      throw new Error(`Manifest service_worker not found: ${manifest.background.service_worker}`);
    }
  }

  // Check popup
  if (manifest.action?.default_popup) {
    const popupPath = resolve(outDir, manifest.action.default_popup);
    if (!existsSync(popupPath)) {
      throw new Error(`Manifest default_popup not found: ${manifest.action.default_popup}`);
    }
  }

  // Check content scripts
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      if (Array.isArray(cs.js)) {
        for (const jsFile of cs.js) {
          if (!existsSync(resolve(outDir, jsFile))) {
            throw new Error(`Content script JS not found: ${jsFile}`);
          }
        }
      }
      if (Array.isArray(cs.css)) {
        for (const cssFile of cs.css) {
          if (!existsSync(resolve(outDir, cssFile))) {
            throw new Error(`Content script CSS not found: ${cssFile}`);
          }
        }
      }
    }
  }

  // Check icons
  if (manifest.icons) {
    for (const [size, iconPath] of Object.entries(manifest.icons)) {
      if (!existsSync(resolve(outDir, String(iconPath)))) {
        throw new Error(`Manifest icon (${size}) not found: ${iconPath}`);
      }
    }
  }

  // B. Check popup.html script/link references
  const popupHtmlPath = resolve(outDir, 'popup/popup.html');
  if (existsSync(popupHtmlPath)) {
    const htmlContent = readFileSync(popupHtmlPath, 'utf8');

    // Match <script src="...">
    const scriptMatches = [...htmlContent.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)];
    for (const match of scriptMatches) {
      const src = match[1];
      const targetPath = resolve(outDir, 'popup', src);
      if (!existsSync(targetPath)) {
        throw new Error(`popup.html references missing script: ${src} -> ${targetPath}`);
      }
    }

    // Match <link rel="stylesheet" href="...">
    const linkMatches = [...htmlContent.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)];
    for (const match of linkMatches) {
      const href = match[1];
      const targetPath = resolve(outDir, 'popup', href);
      if (!existsSync(targetPath)) {
        throw new Error(`popup.html references missing stylesheet: ${href} -> ${targetPath}`);
      }
    }
  }
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
