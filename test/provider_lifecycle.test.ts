import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TTSClient } from '../extension/speech/client.ts';
import { BrowserKokoroTTSProvider } from '../extension/speech/providers/browser_kokoro.ts';

describe('TTSClient Lifecycle & In-Browser Kokoro', () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (msg: any) => {
          if (msg.action === 'KOKORO_PREPARE') {
            return { ok: true, cacheKey: msg.cacheKey };
          }
          if (msg.action === 'KOKORO_PLAY') {
            return { ok: true };
          }
          if (msg.action === 'KOKORO_STOP') {
            return { ok: true };
          }
          if (msg.action === 'KOKORO_GET_STATUS') {
            return { status: 'ready', device: 'wasm', dtype: 'q8' };
          }
          return { ok: true };
        },
      },
    };
  });

  test('decouples preparation cancellation from playback', async () => {
    const client = new TTSClient();

    class MockUtterance {
      text: string;
      voice: any = null;
      rate: number = 1.0;
      onend: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    (globalThis as any).SpeechSynthesisUtterance = MockUtterance;
    (globalThis as any).window = {
      speechSynthesis: {
        getVoices: () => [{ voiceURI: 'default', name: 'Default', lang: 'en' }],
        speak: (utterance: any) => {
          setTimeout(() => {
            if (utterance.onend) utterance.onend();
          }, 10);
        },
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    };

    await client.updateSettings({ provider: 'system' });

    // Prepare speech for block 1
    const prepared1 = await client.prepare('Question text for first block');
    assert.notStrictEqual(prepared1, null);
    assert.strictEqual(prepared1!.providerId, 'system');
    assert.strictEqual(prepared1!.data.type, 'system');

    // Simulate moving cursor to block 2 before playing block 1 (aborts prepare controller for block 1)
    const prepared2 = await client.prepare('Answer A option text');
    assert.notStrictEqual(prepared2, null);

    // Play prepared1 (should succeed and NOT be self-aborted)
    let playError = null;
    try {
      await client.play(prepared1!);
    } catch (err) {
      playError = err;
    }

    assert.strictEqual(playError, null);
  });

  test('handles offscreen audio cacheKeys in BrowserKokoroTTSProvider', async () => {
    let playActionReceived = false;

    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (msg: any) => {
          if (msg.action === 'KOKORO_PREPARE') {
            return { ok: true, cacheKey: msg.cacheKey };
          }
          if (msg.action === 'KOKORO_PLAY') {
            playActionReceived = true;
            return { ok: true };
          }
          if (msg.action === 'KOKORO_STOP') {
            return { ok: true };
          }
          if (msg.action === 'KOKORO_GET_STATUS') {
            return { status: 'ready', device: 'wasm', dtype: 'q8' };
          }
          return { ok: true };
        },
      },
    };

    const provider = new BrowserKokoroTTSProvider();
    const voices = await provider.listVoices();
    assert.strictEqual(voices.length >= 5, true);
    assert.strictEqual(voices[0].id, 'af_heart');

    const prepared = await provider.prepare('Synthesize in-browser speech', { voice: 'af_heart', speed: 1.0 });
    assert.strictEqual(prepared.providerId, 'kokoro-browser');
    assert.strictEqual(prepared.data.type, 'offscreen');

    await provider.play(prepared);
    assert.strictEqual(playActionReceived, true);
  });

  test('routes fallback preparation to the provider that prepared it', async () => {
    const client = new TTSClient();

    let systemPlayed = false;
    let remotePlayed = false;

    // Manually register mock providers
    (client as any).providers.set('kokoro', {
      id: 'kokoro',
      name: 'Kokoro-82M',
      listVoices: async () => [],
      prepare: async () => {
        throw new Error('Kokoro server offline');
      },
      play: async () => {
        remotePlayed = true;
      },
      stop: () => {},
    });

    (client as any).providers.set('system', {
      id: 'system',
      name: 'System',
      listVoices: async () => [],
      prepare: async (text: string, opts: any) => ({
        providerId: 'system',
        data: { type: 'system', text, voice: opts.voice, speed: opts.speed },
      }),
      play: async () => {
        systemPlayed = true;
      },
      stop: () => {},
    });

    // Set active provider to kokoro
    await client.updateSettings({ provider: 'kokoro' });

    // Prepare text with failing kokoro -> should fall back to system
    const prepared = await client.prepare('Quiz question content');
    assert.notStrictEqual(prepared, null);
    assert.strictEqual(prepared!.providerId, 'system');

    // Play prepared fallback -> must dispatch to System provider, NOT Kokoro
    await client.play(prepared!);

    assert.strictEqual(systemPlayed, true, 'System provider should have played fallback speech');
    assert.strictEqual(remotePlayed, false, 'Failed provider should not receive playback call');
  });
});
