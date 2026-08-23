import { TTSProvider, Voice, SpeechOptions, PreparedSpeech } from '../types';

export class RemoteServerTTSProvider implements TTSProvider {
  public readonly id: string;
  public readonly name: string;
  private serverUrl: string;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;

  constructor(id: string, name: string, serverUrl = 'http://127.0.0.1:8000') {
    this.id = id;
    this.name = name;
    this.serverUrl = serverUrl.replace(/\/+$/, '');
  }

  public setServerUrl(url: string): void {
    this.serverUrl = url.replace(/\/+$/, '');
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  public async listVoices(): Promise<Voice[]> {
    try {
      const res = await fetch(`${this.serverUrl}/voices?provider=${encodeURIComponent(this.id)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch voices: HTTP ${res.status}`);
      }
      const data = await res.json();
      return (data.voices || []).map((v: { id: string; name: string; lang?: string }) => ({
        id: v.id,
        name: v.name,
        lang: v.lang || 'en',
        provider: this.id,
      }));
    } catch (err) {
      console.warn(`[RemoteServerTTSProvider:${this.id}] Voice lookup failed:`, err);
      // Fallback voice placeholder
      return [{ id: 'default', name: `${this.name} Default`, lang: 'en', provider: this.id }];
    }
  }

  public async prepare(text: string, options: SpeechOptions): Promise<PreparedSpeech> {
    const ctx = this.getAudioContext();

    const response = await fetch(`${this.serverUrl}/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        provider: this.id,
        voice: options.voice || 'default',
        speed: options.speed || 1.0,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`TTS server error (${response.status}): ${errorText || response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    return {
      type: 'audio',
      buffer: audioBuffer,
      audioContext: ctx,
      options,
    };
  }

  public async play(prepared: PreparedSpeech): Promise<void> {
    if (prepared.type !== 'audio' || !prepared.buffer) {
      throw new Error('Invalid prepared speech object for RemoteServerTTSProvider');
    }

    this.stop();

    const ctx = prepared.audioContext || this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = prepared.buffer;
    source.connect(ctx.destination);
    this.currentSource = source;

    return new Promise((resolve) => {
      let isEnded = false;

      source.onended = () => {
        if (!isEnded) {
          isEnded = true;
          this.currentSource = null;
          resolve();
        }
      };

      if (prepared.options.signal?.aborted) {
        this.stop();
        resolve();
        return;
      }

      prepared.options.signal?.addEventListener('abort', () => {
        this.stop();
        if (!isEnded) {
          isEnded = true;
          resolve();
        }
      });

      source.start(0);
    });
  }

  public stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Source may have already ended
      }
      this.currentSource = null;
    }
  }
}
