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
      signal: options.signal, // Ephemeral preparation signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`TTS server error (${response.status}): ${errorText || response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    return {
      providerId: this.id,
      data: {
        type: 'audio',
        buffer: audioBuffer,
        audioContext: ctx,
        speed: options.speed,
      },
    };
  }

  public async play(prepared: PreparedSpeech, playbackSignal?: AbortSignal): Promise<void> {
    if (prepared.data.type !== 'audio' || !prepared.data.buffer) {
      throw new Error('Invalid prepared speech data for RemoteServerTTSProvider');
    }

    this.stop();

    if (playbackSignal?.aborted) {
      return;
    }

    const ctx = prepared.data.audioContext || this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = prepared.data.buffer;
    source.connect(ctx.destination);
    this.currentSource = source;

    return new Promise<void>((resolve) => {
      let isEnded = false;

      const finish = () => {
        if (!isEnded) {
          isEnded = true;
          cleanup();
          this.currentSource = null;
          resolve();
        }
      };

      source.onended = () => finish();

      const onAbort = () => {
        this.stop();
        finish();
      };

      const cleanup = () => {
        playbackSignal?.removeEventListener('abort', onAbort);
      };

      playbackSignal?.addEventListener('abort', onAbort);

      source.start(0);
    });
  }

  public stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Already stopped
      }
      this.currentSource = null;
    }
  }
}
