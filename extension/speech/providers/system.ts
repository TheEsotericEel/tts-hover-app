import { TTSProvider, Voice, SpeechOptions, PreparedSpeech } from '../types';

export class SystemTTSProvider implements TTSProvider {
  public readonly id = 'system';
  public readonly name = 'System / Browser TTS';

  public async listVoices(): Promise<Voice[]> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return [{ id: 'default', name: 'Default System Voice', lang: 'en', provider: this.id }];
    }

    let synthVoices = window.speechSynthesis.getVoices();
    if (synthVoices.length === 0) {
      await new Promise<void>((resolve) => {
        const handler = () => {
          window.speechSynthesis.removeEventListener('voiceschanged', handler);
          resolve();
        };
        window.speechSynthesis.addEventListener('voiceschanged', handler);
        setTimeout(resolve, 300);
      });
      synthVoices = window.speechSynthesis.getVoices();
    }

    if (synthVoices.length === 0) {
      return [{ id: 'default', name: 'Default System Voice', lang: 'en', provider: this.id }];
    }

    return synthVoices.map((v) => ({
      id: v.voiceURI || v.name,
      name: `${v.name} (${v.lang})`,
      lang: v.lang,
      provider: this.id,
    }));
  }

  public async prepare(text: string, options: SpeechOptions): Promise<PreparedSpeech> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      throw new Error('SpeechSynthesis API is not supported in this browser context.');
    }

    // Return pure stable prepared speech data without storing ephemeral AbortSignals
    return {
      providerId: this.id,
      data: {
        type: 'system',
        text,
        voice: options.voice,
        speed: options.speed,
      },
    };
  }

  public async play(prepared: PreparedSpeech, playbackSignal?: AbortSignal): Promise<void> {
    if (prepared.data.type !== 'system') {
      throw new Error('Invalid prepared speech data for SystemTTSProvider');
    }

    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }

    // Cancel any previous speech playback
    window.speechSynthesis.cancel();

    if (playbackSignal?.aborted) {
      return;
    }

    const { text, voice: voiceId, speed } = prepared.data;
    const utterance = new SpeechSynthesisUtterance(text);

    if (speed) {
      utterance.rate = Math.max(0.1, Math.min(2.0, speed));
    }

    if (voiceId && voiceId !== 'default') {
      const voices = window.speechSynthesis.getVoices();
      const matched = voices.find((v) => v.voiceURI === voiceId || v.name === voiceId);
      if (matched) {
        utterance.voice = matched;
      }
    }

    return new Promise<void>((resolve, reject) => {
      let isResolved = false;

      const finish = () => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          resolve();
        }
      };

      utterance.onend = () => finish();

      utterance.onerror = (e) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          if (e.error === 'canceled' || e.error === 'interrupted') {
            resolve();
          } else {
            reject(new Error(`SpeechSynthesis error: ${e.error}`));
          }
        }
      };

      const onAbort = () => {
        window.speechSynthesis.cancel();
        finish();
      };

      const cleanup = () => {
        playbackSignal?.removeEventListener('abort', onAbort);
      };

      playbackSignal?.addEventListener('abort', onAbort);

      window.speechSynthesis.speak(utterance);
    });
  }

  public stop(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
}
