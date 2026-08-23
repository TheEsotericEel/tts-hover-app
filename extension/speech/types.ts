export interface Voice {
  id: string;
  name: string;
  lang: string;
  provider: string;
}

export interface SpeechOptions {
  voice?: string;
  speed?: number;
  signal?: AbortSignal; // Preparation abort signal only
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
  serverUrl: string; // e.g. 'http://127.0.0.1:8000'
}

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  provider: 'kokoro-browser',
  voice: 'af_heart',
  speed: 1.0,
  serverUrl: 'http://127.0.0.1:8000',
};
