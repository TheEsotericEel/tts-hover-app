import { TTSProvider, Voice, SpeechOptions, PreparedSpeech, UserSettings, DEFAULT_SETTINGS } from './types';
import { TextNormalizer } from './normalizer';
import { SpeechCache } from './cache';
import { SystemTTSProvider } from './providers/system';
import { BrowserKokoroTTSProvider } from './providers/browser_kokoro';
import { RemoteServerTTSProvider } from './providers/remote';

export class TTSClient {
  private providers = new Map<string, TTSProvider>();
  private settings: UserSettings = { ...DEFAULT_SETTINGS };
  private cache = new SpeechCache(50);

  // Single-flight deduplication map: prevents duplicate synthesis for hover + click
  private inFlightPrepares = new Map<string, Promise<PreparedSpeech | null>>();

  // Decoupled preparation vs playback abort controllers
  private prepareAbortController: AbortController | null = null;
  private playbackAbortController: AbortController | null = null;

  private isSpeaking = false;
  private prepareGeneration = 0;

  constructor() {
    this.registerDefaultProviders();
    this.loadSettings();
  }

  private registerDefaultProviders(): void {
    const browserKokoro = new BrowserKokoroTTSProvider();
    const systemProvider = new SystemTTSProvider();
    const mockProvider = new RemoteServerTTSProvider('mock', 'Mock Neural Engine', this.settings.serverUrl);
    const kokoroProvider = new RemoteServerTTSProvider('kokoro', 'Kokoro-82M (Local Server)', this.settings.serverUrl);
    const meloProvider = new RemoteServerTTSProvider('melo', 'MeloTTS (Local Server)', this.settings.serverUrl);

    this.providers.set(browserKokoro.id, browserKokoro);
    this.providers.set(systemProvider.id, systemProvider);
    this.providers.set(mockProvider.id, mockProvider);
    this.providers.set(kokoroProvider.id, kokoroProvider);
    this.providers.set(meloProvider.id, meloProvider);
  }

  public async loadSettings(): Promise<UserSettings> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get('ttsSettings');
      if (stored.ttsSettings) {
        this.settings = { ...DEFAULT_SETTINGS, ...stored.ttsSettings };
      }
    }
    this.syncServerUrls();
    return this.settings;
  }

  public async updateSettings(newSettings: Partial<UserSettings>): Promise<UserSettings> {
    this.settings = { ...this.settings, ...newSettings };
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ ttsSettings: this.settings });
    }
    this.syncServerUrls();
    return this.settings;
  }

  public getSettings(): UserSettings {
    return { ...this.settings };
  }

  private syncServerUrls(): void {
    for (const provider of this.providers.values()) {
      if (provider instanceof RemoteServerTTSProvider) {
        provider.setServerUrl(this.settings.serverUrl);
      }
    }
  }

  public getProvider(id: string): TTSProvider | undefined {
    return this.providers.get(id);
  }

  public getActiveProvider(): TTSProvider {
    const provider = this.providers.get(this.settings.provider);
    if (!provider) {
      return this.providers.get('kokoro-browser') || this.providers.get('system')!;
    }
    return provider;
  }

  public async listVoices(providerId?: string): Promise<Voice[]> {
    const targetProvider = providerId ? this.providers.get(providerId) : this.getActiveProvider();
    if (!targetProvider) return [];
    return targetProvider.listVoices();
  }

  /**
   * Prepares speech for given text (normalizes, checks cache, single-flight in-flight deduplication).
   * If a preparation is already underway (e.g. from hover), reuse its Promise directly.
   */
  public async prepare(text: string, options?: SpeechOptions): Promise<PreparedSpeech | null> {
    const normalizedText = TextNormalizer.normalize(text);
    if (!normalizedText) return null;

    const provider = this.getActiveProvider();
    const voice = options?.voice ?? this.settings.voice;
    const speed = options?.speed ?? this.settings.speed;
    const engineMode = options?.engineMode ?? this.settings.engineMode;

    const cacheKey = SpeechCache.generateKey(provider.id, voice, speed, normalizedText);

    // 1. Check completed cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Single-flight deduplication: reuse in-flight preparation promise if active
    if (this.inFlightPrepares.has(cacheKey)) {
      return this.inFlightPrepares.get(cacheKey)!;
    }

    // Cancel prior pending preparation if moving to a completely different text
    if (this.prepareAbortController) {
      this.prepareAbortController.abort();
    }
    this.prepareAbortController = new AbortController();
    const signal = options?.signal || this.prepareAbortController.signal;

    const currentGen = ++this.prepareGeneration;

    const preparePromise = (async (): Promise<PreparedSpeech | null> => {
      try {
        const prepared = await provider.prepare(normalizedText, {
          voice,
          speed,
          engineMode,
          signal,
        });

        if (currentGen === this.prepareGeneration && !signal.aborted) {
          this.cache.set(cacheKey, prepared);
          return prepared;
        }
        return null;
      } catch (err: unknown) {
        if (signal.aborted || (err as { name?: string }).name === 'AbortError') {
          return null;
        }
        console.warn(`[TTSClient] Prepare failed with provider ${provider.id}:`, err);
        // Fallback to system provider if in-browser neural or server provider fails
        if (provider.id !== 'system') {
          const sysProvider = this.providers.get('system')!;
          const fallbackPrepared = await sysProvider.prepare(normalizedText, { voice: 'default', speed, signal });
          if (currentGen === this.prepareGeneration && !signal.aborted) {
            this.cache.set(cacheKey, fallbackPrepared);
            return fallbackPrepared;
          }
        }
        return null;
      } finally {
        this.inFlightPrepares.delete(cacheKey);
      }
    })();

    this.inFlightPrepares.set(cacheKey, preparePromise);
    return preparePromise;
  }

  /**
   * Plays prepared speech. Routes to the specific provider that prepared it.
   */
  public async play(prepared: PreparedSpeech): Promise<void> {
    // Stop any active playback before starting a new one
    this.stopPlayback();

    // Create a new playback abort controller
    this.playbackAbortController = new AbortController();
    const playbackSignal = this.playbackAbortController.signal;

    this.isSpeaking = true;

    // Route playback to the provider that prepared the object (handles fallback smoothly)
    const provider = this.providers.get(prepared.providerId) || this.getActiveProvider();

    try {
      await provider.play(prepared, playbackSignal);
    } finally {
      if (!playbackSignal.aborted) {
        this.isSpeaking = false;
      }
    }
  }

  public async speak(text: string, options?: SpeechOptions): Promise<void> {
    const prepared = await this.prepare(text, options);
    if (prepared) {
      await this.play(prepared);
    }
  }

  public stopPlayback(): void {
    if (this.playbackAbortController) {
      this.playbackAbortController.abort();
      this.playbackAbortController = null;
    }

    for (const provider of this.providers.values()) {
      provider.stop();
    }

    this.isSpeaking = false;
  }

  public stop(): void {
    // Abort pending preparation
    if (this.prepareAbortController) {
      this.prepareAbortController.abort();
      this.prepareAbortController = null;
    }

    this.inFlightPrepares.clear();

    // Abort active playback
    this.stopPlayback();
  }

  public get speaking(): boolean {
    return this.isSpeaking;
  }

  public async pingServer(url?: string): Promise<boolean> {
    const target = (url || this.settings.serverUrl).replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${target}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }
}
