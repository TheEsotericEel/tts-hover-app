export interface Voice {
  id: string;
  name: string;
  lang: string;
  provider: string;
}

export interface SpeechOptions {
  voice?: string;
  speed?: number;
  signal?: AbortSignal;
}

export type PreparedSpeech =
  | {
      type: 'system';
      text: string;
      utterance?: SpeechSynthesisUtterance;
      options: SpeechOptions;
    }
  | {
      type: 'audio';
      buffer: AudioBuffer;
      audioContext: AudioContext;
      options: SpeechOptions;
    };

export interface TTSProvider {
  id: string;
  name: string;
  listVoices(): Promise<Voice[]>;
  prepare(text: string, options: SpeechOptions): Promise<PreparedSpeech>;
  play(prepared: PreparedSpeech): Promise<void>;
  stop(): void;
}

export interface UserSettings {
  enabled: boolean;
  provider: string; // 'system' | 'kokoro' | 'melo' | 'mock'
  voice: string;
  speed: number;
  serverUrl: string; // e.g. 'http://127.0.0.1:8000'
}

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  provider: 'system',
  voice: 'default',
  speed: 1.0,
  serverUrl: 'http://127.0.0.1:8000',
};
