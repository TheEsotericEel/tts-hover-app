export interface Voice {
  id: string;
  name: string;
  lang: string;
  provider: string;
}

export type EngineMode = 'auto' | 'wasm' | 'webgpu';

export interface SpeechOptions {
  voice?: string;
  speed?: number;
  engineMode?: EngineMode;
  signal?: AbortSignal; // Preparation abort signal only
}

export interface SpeechMetrics {
  backend: string;
  textChars: number;
  synthesisMs: number;
  audioDurationSec: number;
  rtf: number;
  cacheHit: boolean;
}

export type PreparedSpeechData =
  | {
      type: 'system';
      text: string;
      voice?: string;
      speed?: number;
    }
  | {
      type: 'audio';
      buffer: AudioBuffer;
      audioContext?: AudioContext;
      speed?: number;
    }
  | {
      type: 'offscreen';
      cacheKey: string;
      text: string;
      voice?: string;
      speed?: number;
      metrics?: SpeechMetrics;
    };

export interface PreparedSpeech {
  providerId: string;
  data: PreparedSpeechData;
}

export interface TTSProvider {
  id: string;
  name: string;
  listVoices(): Promise<Voice[]>;
  prepare(text: string, options: SpeechOptions): Promise<PreparedSpeech>;
  play(prepared: PreparedSpeech, playbackSignal?: AbortSignal): Promise<void>;
  stop(): void;
}

export interface UserSettings {
  enabled: boolean;
  provider: string; // 'system' | 'kokoro-browser' | 'kokoro' | 'melo' | 'mock'
  voice: string;
  speed: number;
  engineMode: EngineMode; // 'wasm' (q8 92MB) | 'webgpu' (fp32 326MB) | 'auto'
  serverUrl: string; // e.g. 'http://127.0.0.1:8000'
  idleTimeoutMinutes: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  provider: 'kokoro-browser',
  voice: 'af_heart',
  speed: 1.0,
  engineMode: 'wasm', // Default to lightweight 92.4 MB quantized WASM model
  serverUrl: 'http://127.0.0.1:8000',
  idleTimeoutMinutes: 10,
};
