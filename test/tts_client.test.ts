import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TextNormalizer } from '../extension/speech/normalizer.ts';
import { SpeechCache } from '../extension/speech/cache.ts';

describe('TextNormalizer', () => {
  test('normalizes excessive whitespace and newlines', () => {
    const raw = '  This is   a \n\n sentence\twith weird    spacing.  ';
    assert.strictEqual(TextNormalizer.normalize(raw), 'This is a sentence with weird spacing.');
  });

  test('preserves code brackets and citations cleanly', () => {
    const raw = 'Array element arr[0] and citation [1] in text.';
    assert.strictEqual(TextNormalizer.normalize(raw), 'Array element arr[0] and citation [1] in text.');
  });

  test('removes Wikipedia-style edit links', () => {
    const raw = 'Early History [edit] in the 1990s.';
    assert.strictEqual(TextNormalizer.normalize(raw), 'Early History in the 1990s.');
  });

  test('simplifies URLs', () => {
    const raw = 'Visit https://example.com/some/long/path for details.';
    assert.strictEqual(TextNormalizer.normalize(raw), 'Visit link to example.com for details.');
  });

  test('expands common abbreviations', () => {
    const raw = 'Components (e.g. Buttons, etc.) vs. Native controls.';
    assert.strictEqual(TextNormalizer.normalize(raw), 'Components (for example Buttons, etcetera) versus Native controls.');
  });
});

describe('SpeechCache', () => {
  let cache;

  beforeEach(() => {
    cache = new SpeechCache(3);
  });

  test('generates compound key including provider, voice, speed, and text', () => {
    const key = SpeechCache.generateKey('kokoro', 'af_heart', 1.25, 'Hello world');
    assert.strictEqual(key, 'kokoro:af_heart:1.25:Hello world');
  });

  test('stores and retrieves prepared speech without signal leakage', () => {
    const key = SpeechCache.generateKey('system', 'default', 1.0, 'Test phrase');
    const prepared = {
      providerId: 'system',
      data: {
        type: 'system',
        text: 'Test phrase',
        voice: 'default',
        speed: 1.0,
      },
    };

    cache.set(key, prepared);
    const retrieved = cache.get(key);
    assert.deepStrictEqual(retrieved, prepared);
    assert.strictEqual(retrieved.providerId, 'system');
  });

  test('evicts least recently used items when budget is exceeded', () => {
    cache.set('key1', { providerId: 'p1', data: { type: 'system', text: '1' } });
    cache.set('key2', { providerId: 'p1', data: { type: 'system', text: '2' } });
    cache.set('key3', { providerId: 'p1', data: { type: 'system', text: '3' } });

    // Access key1 to refresh LRU
    cache.get('key1');

    // Add key4 -> should evict key2
    cache.set('key4', { providerId: 'p1', data: { type: 'system', text: '4' } });

    assert.strictEqual(cache.size, 3);
    assert.notStrictEqual(cache.get('key1'), undefined);
    assert.strictEqual(cache.get('key2'), undefined);
    assert.notStrictEqual(cache.get('key3'), undefined);
    assert.notStrictEqual(cache.get('key4'), undefined);
  });
});
