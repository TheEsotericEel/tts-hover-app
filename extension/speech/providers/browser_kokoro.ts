import { TTSProvider, Voice, SpeechOptions, PreparedSpeech } from '../types';
import { SpeechCache } from '../cache';

export class BrowserKokoroTTSProvider implements TTSProvider {
  public readonly id = 'kokoro-browser';
  public readonly name = 'Kokoro-82M (In-Browser AI)';

  public async listVoices(): Promise<Voice[]> {
    return [
      { id: 'af_heart', name: 'Heart (US Female - Warm)', lang: 'en-US', provider: this.id },
      { id: 'af_bella', name: 'Bella (US Female)', lang: 'en-US', provider: this.id },
      { id: 'af_sarah', name: 'Sarah (US Female)', lang: 'en-US', provider: this.id },
      { id: 'af_nicole', name: 'Nicole (US Female - Whisper)', lang: 'en-US', provider: this.id },
      { id: 'am_adam', name: 'Adam (US Male - Deep)', lang: 'en-US', provider: this.id },
      { id: 'am_michael', name: 'Michael (US Male)', lang: 'en-US', provider: this.id },
      { id: 'bf_emma', name: 'Emma (British Female)', lang: 'en-GB', provider: this.id },
      { id: 'bf_isabella', name: 'Isabella (British Female)', lang: 'en-GB', provider: this.id },
      { id: 'bm_george', name: 'George (British Male)', lang: 'en-GB', provider: this.id },
      { id: 'bm_lewis', name: 'Lewis (British Male)', lang: 'en-GB', provider: this.id },
    ];
  }

  /**
   * Two-stage messaging helper:
   * 1. Ensure background worker has created the offscreen document
   * 2. Send targeted command directly to the offscreen neural engine
   */
  private async sendToOffscreen(message: any): Promise<any> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('Chrome runtime messaging is unavailable.');
    }

    // Stage 1: Ensure offscreen document exists via background
    const ensureRes = await chrome.runtime.sendMessage({
      action: 'ENSURE_KOKORO_OFFSCREEN',
    });
    if (ensureRes && ensureRes.ok === false) {
      throw new Error(ensureRes.error || 'Failed to ensure offscreen document.');
    }

    // Stage 2: Send neural command strictly to offscreen target
    return await chrome.runtime.sendMessage({
      ...message,
      target: 'kokoro-offscreen',
    });
  }

  public async getStatus(): Promise<{ status: string; device?: string; dtype?: string; error?: string }> {
    try {
      const res = await this.sendToOffscreen({ action: 'KOKORO_GET_STATUS' });
      return res || { status: 'not_loaded' };
    } catch {
      return { status: 'not_loaded' };
    }
  }

  public async loadModel(): Promise<void> {
    const res = await this.sendToOffscreen({ action: 'KOKORO_LOAD_MODEL' });
    if (!res || !res.ok) {
      throw new Error(res?.error || 'Failed to initialize in-browser Kokoro model.');
    }
  }

  public async prepare(text: string, options: SpeechOptions): Promise<PreparedSpeech> {
    const voice = options.voice || 'af_heart';
    const speed = options.speed || 1.0;
    const cacheKey = SpeechCache.generateKey(this.id, voice, speed, text);
    const requestId = `req_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;

    if (options.signal?.aborted) {
      throw new Error('Synthesis aborted before start');
    }

    const abortHandler = () => {
      chrome.runtime.sendMessage({
        target: 'kokoro-offscreen',
        action: 'KOKORO_ABORT_PREPARE',
        requestId,
      }).catch(() => {});
    };

    options.signal?.addEventListener('abort', abortHandler, { once: true });

    try {
      const res = await this.sendToOffscreen({
        action: 'KOKORO_PREPARE',
        text,
        voice,
        speed,
        cacheKey,
        requestId,
      });

      if (options.signal?.aborted) {
        throw new Error('Synthesis aborted');
      }

      if (!res || !res.ok) {
        throw new Error(res?.error || 'Offscreen Kokoro synthesis failed.');
      }

      return {
        providerId: this.id,
        data: {
          type: 'offscreen',
          cacheKey: res.cacheKey || cacheKey,
          text,
          voice,
          speed,
        },
      };
    } finally {
      options.signal?.removeEventListener('abort', abortHandler);
    }
  }

  public async play(prepared: PreparedSpeech, playbackSignal?: AbortSignal): Promise<void> {
    if (prepared.data.type !== 'offscreen' || !prepared.data.cacheKey) {
      throw new Error('Invalid prepared speech data for BrowserKokoroTTSProvider');
    }

    if (playbackSignal?.aborted) {
      return;
    }

    const { cacheKey } = prepared.data;

    const onAbort = () => {
      this.stop();
    };

    playbackSignal?.addEventListener('abort', onAbort);

    try {
      const res = await this.sendToOffscreen({
        action: 'KOKORO_PLAY',
        cacheKey,
      });

      if (!res || !res.ok) {
        throw new Error(res?.error || 'Offscreen audio playback failed.');
      }
    } finally {
      playbackSignal?.removeEventListener('abort', onAbort);
    }
  }

  public stop(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        target: 'kokoro-offscreen',
        action: 'KOKORO_STOP',
      }).catch(() => {});
    }
  }
}
