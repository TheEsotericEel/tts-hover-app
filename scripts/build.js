import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, cpSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
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
  mkdirSync(resolve(outDir, 'offscreen'), { recursive: true });
  mkdirSync(resolve(outDir, 'wasm'), { recursive: true });
  mkdirSync(resolve(outDir, 'icons'), { recursive: true });

  // 1. Bundle Content Script (IIFE - self-contained)
  await esbuild.build({
    entryPoints: [resolve(root, 'extension/content/index.ts')],
    outfile: resolve(outDir, 'content/index.js'),
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    sourcemap: false,
    minify: false,
  });

  // 2. Bundle Background Worker (ESM)
  await esbuild.build({
    entryPoints: [resolve(root, 'extension/background.ts')],
    outfile: resolve(outDir, 'background.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    sourcemap: false,
    minify: false,
  });

  // 3. Bundle Popup Script (ESM)
  await esbuild.build({
    entryPoints: [resolve(root, 'extension/popup/popup.ts')],
    outfile: resolve(outDir, 'popup/popup.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    sourcemap: false,
    minify: false,
  });

  // 4. Bundle Offscreen Neural Engine (ESM)
  await esbuild.build({
    entryPoints: [resolve(root, 'extension/offscreen/offscreen.ts')],
    outfile: resolve(outDir, 'offscreen/offscreen.js'),
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    sourcemap: false,
    minify: false,
  });

  // 5. Copy static assets
  copyFileSync(resolve(root, 'extension/manifest.json'), resolve(outDir, 'manifest.json'));
  copyFileSync(resolve(root, 'extension/popup/popup.html'), resolve(outDir, 'popup/popup.html'));
  copyFileSync(resolve(root, 'extension/popup/popup.css'), resolve(outDir, 'popup/popup.css'));
  copyFileSync(resolve(root, 'extension/content/overlay.css'), resolve(outDir, 'content/overlay.css'));
  copyFileSync(resolve(root, 'extension/offscreen/offscreen.html'), resolve(outDir, 'offscreen/offscreen.html'));

  // Copy WASM and MJS loader binaries from onnxruntime-web
  const onnxWasmDir = resolve(root, 'node_modules/onnxruntime-web/dist');
  if (existsSync(onnxWasmDir)) {
    const runtimeFiles = readdirSync(onnxWasmDir).filter(
      (f) => f.endsWith('.wasm') || f.endsWith('.mjs')
    );
    for (const runtimeFile of runtimeFiles) {
      copyFileSync(resolve(onnxWasmDir, runtimeFile), resolve(outDir, 'wasm', runtimeFile));
    }
  }

  if (existsSync(resolve(root, 'extension/icons'))) {
    cpSync(resolve(root, 'extension/icons'), resolve(outDir, 'icons'), { recursive: true });
  }

  // 6. Post-Build Validation
  validateBuildArtifacts();

  console.log('✅ Extension build verified successfully in /dist');
}

function validateBuildArtifacts() {
  console.log('🔍 Validating build artifacts...');

  const manifestPath = resolve(outDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Missing manifest.json in dist');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (manifest.background?.service_worker) {
    const swPath = resolve(outDir, manifest.background.service_worker);
    if (!existsSync(swPath)) {
      throw new Error(`Manifest service_worker not found: ${manifest.background.service_worker}`);
    }
  }

  if (manifest.action?.default_popup) {
    const popupPath = resolve(outDir, manifest.action.default_popup);
    if (!existsSync(popupPath)) {
      throw new Error(`Manifest default_popup not found: ${manifest.action.default_popup}`);
    }
  }

  if (!existsSync(resolve(outDir, 'offscreen/offscreen.html'))) {
    throw new Error('Missing dist/offscreen/offscreen.html');
  }
  if (!existsSync(resolve(outDir, 'offscreen/offscreen.js'))) {
    throw new Error('Missing dist/offscreen/offscreen.js');
  }

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

  if (manifest.icons) {
    for (const [size, iconPath] of Object.entries(manifest.icons)) {
      if (!existsSync(resolve(outDir, String(iconPath)))) {
        throw new Error(`Manifest icon (${size}) not found: ${iconPath}`);
      }
    }
  }

  // Check HTML files
  ['popup/popup.html', 'offscreen/offscreen.html'].forEach((htmlRel) => {
    const htmlPath = resolve(outDir, htmlRel);
    if (existsSync(htmlPath)) {
      const htmlDir = dirname(htmlPath);
      const htmlContent = readFileSync(htmlPath, 'utf8');

      const scriptMatches = [...htmlContent.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)];
      for (const match of scriptMatches) {
        const src = match[1];
        const targetPath = resolve(htmlDir, src);
        if (!existsSync(targetPath)) {
          throw new Error(`${htmlRel} references missing script: ${src} -> ${targetPath}`);
        }
      }
    }
  });
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
