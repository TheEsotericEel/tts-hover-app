import { TTSProvider, Voice, SpeechOptions, PreparedSpeech, UserSettings, DEFAULT_SETTINGS } from './types';
import { TextNormalizer } from './normalizer';
import { SpeechCache } from './cache';
import { SystemTTSProvider } from './providers/system';
import { RemoteServerTTSProvider } from './providers/remote';

export class TTSClient {
  private providers = new Map<string, TTSProvider>();
  private settings: UserSettings = { ...DEFAULT_SETTINGS };
  private cache = new SpeechCache(50);
  private currentAbortController: AbortController | null = null;
  private activePrepared: PreparedSpeech | null = null;
  private isSpeaking = false;
  private prepareGeneration = 0;

  constructor() {
    this.registerDefaultProviders();
    this.loadSettings();
  }

  private registerDefaultProviders(): void {
    const systemProvider = new SystemTTSProvider();
    const mockProvider = new RemoteServerTTSProvider('mock', 'Mock Neural Engine', this.settings.serverUrl);
    const kokoroProvider = new RemoteServerTTSProvider('kokoro', 'Kokoro-82M (Local)', this.settings.serverUrl);
    const meloProvider = new RemoteServerTTSProvider('melo', 'MeloTTS (Local)', this.settings.serverUrl);

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

  public getActiveProvider(): TTSProvider {
    const provider = this.providers.get(this.settings.provider);
    if (!provider) {
      return this.providers.get('system')!;
    }
    return provider;
  }

  public async listVoices(providerId?: string): Promise<Voice[]> {
    const targetProvider = providerId ? this.providers.get(providerId) : this.getActiveProvider();
    if (!targetProvider) return [];
    return targetProvider.listVoices();
  }

  /**
   * Prepares speech for given text (normalizes, checks cache, prepares via provider).
   * Automatically aborts any obsolete prior prepare operations.
   */
  public async prepare(text: string, options?: SpeechOptions): Promise<PreparedSpeech | null> {
    const normalizedText = TextNormalizer.normalize(text);
    if (!normalizedText) return null;

    const provider = this.getActiveProvider();
    const voice = options?.voice ?? this.settings.voice;
    const speed = options?.speed ?? this.settings.speed;

    const cacheKey = SpeechCache.generateKey(provider.id, voice, speed, normalizedText);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Cancel prior pending prepare request
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    this.currentAbortController = new AbortController();
    const signal = options?.signal || this.currentAbortController.signal;

    const currentGen = ++this.prepareGeneration;

    try {
      const prepared = await provider.prepare(normalizedText, {
        voice,
        speed,
        signal,
      });

      // Guard against race condition: only cache if generation is still current and not aborted
      if (currentGen === this.prepareGeneration && !signal.aborted) {
        this.cache.set(cacheKey, prepared);
        return prepared;
      }
      return null;
    } catch (err: unknown) {
      if (signal.aborted || (err as { name?: string }).name === 'AbortError') {
        return null; // Normal cancellation
      }
      console.warn(`[TTSClient] Prepare failed with provider ${provider.id}:`, err);
      // Fallback to system provider if neural provider fails
      if (provider.id !== 'system') {
        const sysProvider = this.providers.get('system')!;
        return sysProvider.prepare(normalizedText, { voice: 'default', speed, signal });
      }
      throw err;
    }
  }

  public async play(prepared: PreparedSpeech): Promise<void> {
    this.stop();
    this.isSpeaking = true;
    this.activePrepared = prepared;

    const provider = this.getActiveProvider();

    try {
      await provider.play(prepared);
    } finally {
      if (this.activePrepared === prepared) {
        this.isSpeaking = false;
        this.activePrepared = null;
      }
    }
  }

  public async speak(text: string, options?: SpeechOptions): Promise<void> {
    const prepared = await this.prepare(text, options);
    if (prepared) {
      await this.play(prepared);
    }
  }

  public stop(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    for (const provider of this.providers.values()) {
      provider.stop();
    }

    this.isSpeaking = false;
    this.activePrepared = null;
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
