import { test, describe } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = resolve(__dirname, '../dist');

describe('Build Artifacts & Manifest Integrity', () => {
  test('manifest.json exists and is valid Manifest V3', () => {
    const manifestPath = resolve(distDir, 'manifest.json');
    assert.strictEqual(existsSync(manifestPath), true, 'dist/manifest.json must exist');

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.manifest_version, 3);
    assert.strictEqual(typeof manifest.name, 'string');
    assert.strictEqual(typeof manifest.version, 'string');
    assert.strictEqual(manifest.action?.default_popup, 'popup/popup.html');
    assert.strictEqual(manifest.background?.service_worker, 'background.js');
    assert.strictEqual(manifest.content_scripts?.[0]?.all_frames, true);
  });

  test('popup.html references popup.js and NOT popup.ts', () => {
    const popupHtmlPath = resolve(distDir, 'popup/popup.html');
    assert.strictEqual(existsSync(popupHtmlPath), true, 'dist/popup/popup.html must exist');

    const content = readFileSync(popupHtmlPath, 'utf8');
    assert.match(content, /src=["']popup\.js["']/, 'popup.html must link to popup.js');
    assert.doesNotMatch(content, /src=["']popup\.ts["']/, 'popup.html must not link to popup.ts');
  });

  test('all bundle files exist on disk', () => {
    assert.strictEqual(existsSync(resolve(distDir, 'background.js')), true);
    assert.strictEqual(existsSync(resolve(distDir, 'content/index.js')), true);
    assert.strictEqual(existsSync(resolve(distDir, 'content/overlay.css')), true);
    assert.strictEqual(existsSync(resolve(distDir, 'popup/popup.js')), true);
    assert.strictEqual(existsSync(resolve(distDir, 'popup/popup.css')), true);
    assert.strictEqual(existsSync(resolve(distDir, 'icons/icon-16.png')), true);
    assert.strictEqual(existsSync(resolve(distDir, 'icons/icon-48.png')), true);
    assert.strictEqual(existsSync(resolve(distDir, 'icons/icon-128.png')), true);
  });
});
