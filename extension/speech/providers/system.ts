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
      // Sometimes getVoices() is asynchronous on initial load
      await new Promise<void>((resolve) => {
        const handler = () => {
          window.speechSynthesis.removeEventListener('voiceschanged', handler);
          resolve();
        };
        window.speechSynthesis.addEventListener('voiceschanged', handler);
        setTimeout(resolve, 300); // Safety timeout
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

    const utterance = new SpeechSynthesisUtterance(text);
    if (options.speed) {
      utterance.rate = Math.max(0.1, Math.min(2.0, options.speed));
    }

    if (options.voice && options.voice !== 'default') {
      const voices = window.speechSynthesis.getVoices();
      const matched = voices.find((v) => v.voiceURI === options.voice || v.name === options.voice);
      if (matched) {
        utterance.voice = matched;
      }
    }

    return {
      type: 'system',
      text,
      utterance,
      options,
    };
  }

  public async play(prepared: PreparedSpeech): Promise<void> {
    if (prepared.type !== 'system' || !prepared.utterance) {
      throw new Error('Invalid prepared speech object for SystemTTSProvider');
    }

    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }

    // Cancel any previous speech
    window.speechSynthesis.cancel();

    const utterance = prepared.utterance;

    return new Promise((resolve, reject) => {
      let isResolved = false;

      utterance.onend = () => {
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      };

      utterance.onerror = (e) => {
        if (!isResolved) {
          isResolved = true;
          if (e.error === 'canceled' || e.error === 'interrupted') {
            resolve();
          } else {
            reject(new Error(`SpeechSynthesis error: ${e.error}`));
          }
        }
      };

      // Check abort signal
      if (prepared.options.signal?.aborted) {
        resolve();
        return;
      }

      prepared.options.signal?.addEventListener('abort', () => {
        window.speechSynthesis.cancel();
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      });

      window.speechSynthesis.speak(utterance);
    });
  }

  public stop(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
}
