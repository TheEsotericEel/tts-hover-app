import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

// Pinned exact model identifier
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

// Configure Transformers.js for browser extension execution
env.allowLocalModels = false;
env.useBrowserCache = true;

// Configure WASM paths pointing to extension-relative assets
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  const wasmBackend = (env.backends as any)?.onnx?.wasm;
  if (wasmBackend) {
    wasmBackend.wasmPaths = chrome.runtime.getURL('wasm/');
  }
}

type ModelStatus = 'not_loaded' | 'loading' | 'ready' | 'error';

interface ModelInfo {
  status: ModelStatus;
  device: 'webgpu' | 'wasm';
  dtype: 'fp32' | 'q8';
  progress?: number;
  error?: string;
}

class OffscreenNeuralEngine {
  private tts: any = null;
  private modelInfo: ModelInfo = {
    status: 'not_loaded',
    device: 'wasm',
    dtype: 'q8',
  };
  private capabilitiesPromise: Promise<void>;
  private loadPromise: Promise<ModelInfo> | null = null;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentPlayResolve: (() => void) | null = null;
  private audioCache = new Map<string, AudioBuffer>();
  private readonly maxCacheSize = 50;

  // Track in-flight preparation requests for cancellation
  private activeGenerations = new Set<string>();

  constructor() {
    this.capabilitiesPromise = this.detectCapabilities();
    this.initMessageListener();
  }

  private async detectCapabilities(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          this.modelInfo.device = 'webgpu';
          this.modelInfo.dtype = 'fp32'; // WebGPU recommended dtype for Kokoro
          return;
        }
      }
    } catch (e) {
      console.warn('[Offscreen] WebGPU detection failed, falling back to WASM:', e);
    }

    this.modelInfo.device = 'wasm';
    this.modelInfo.dtype = 'q8'; // WASM recommended dtype for Kokoro
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 24000 });
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  public async loadModel(): Promise<ModelInfo> {
    // Ensure WebGPU capability detection has completed before starting load
    await this.capabilitiesPromise;

    if (this.modelInfo.status === 'ready' && this.tts) {
      return this.modelInfo;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.modelInfo.status = 'loading';
    this.modelInfo.error = undefined;

    this.loadPromise = (async () => {
      try {
        console.log(`[Offscreen] Loading ${MODEL_ID} on ${this.modelInfo.device} (${this.modelInfo.dtype})...`);

        try {
          this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
            dtype: this.modelInfo.dtype,
            device: this.modelInfo.device,
          });
        } catch (webGpuError) {
          // If WebGPU initialization fails at runtime, fallback to WASM (q8)
          if (this.modelInfo.device === 'webgpu') {
            console.warn('[Offscreen] WebGPU failed, retrying on WASM (q8):', webGpuError);
            this.modelInfo.device = 'wasm';
            this.modelInfo.dtype = 'q8';
            this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
              dtype: 'q8',
              device: 'wasm',
            });
          } else {
            throw webGpuError;
          }
        }

        this.modelInfo.status = 'ready';
        console.log('[Offscreen] Kokoro-82M model loaded and ready.');
        return this.modelInfo;
      } catch (err: any) {
        this.modelInfo.status = 'error';
        this.modelInfo.error = err?.message || String(err);
        console.error('[Offscreen] Failed to load Kokoro model:', err);
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  public async prepareSpeech(text: string, voice: string, speed: number, cacheKey: string, requestId?: string): Promise<string> {
    if (this.audioCache.has(cacheKey)) {
      return cacheKey;
    }

    if (requestId) {
      this.activeGenerations.add(requestId);
    }

    if (this.modelInfo.status !== 'ready' || !this.tts) {
      await this.loadModel();
    }

    // Check if cancelled while waiting for model load
    if (requestId && !this.activeGenerations.has(requestId)) {
      throw new Error('Preparation cancelled before generation');
    }

    const cleanVoice = voice && voice !== 'default' ? voice : 'af_heart';
    const cleanSpeed = speed || 1.0;

    // Generate audio using KokoroTTS
    const result = await this.tts.generate(text, {
      voice: cleanVoice,
      speed: cleanSpeed,
    });

    // Check if cancelled during generation
    if (requestId && !this.activeGenerations.has(requestId)) {
      throw new Error('Preparation cancelled');
    }

    const ctx = this.getAudioContext();
    const rawAudio: Float32Array = result.audio;
    const sampleRate = result.sampling_rate || 24000;

    // Construct AudioBuffer in offscreen context
    const audioBuffer = ctx.createBuffer(1, rawAudio.length, sampleRate);
    audioBuffer.getChannelData(0).set(rawAudio);

    // Store in LRU cache
    if (this.audioCache.size >= this.maxCacheSize) {
      const oldestKey = this.audioCache.keys().next().value;
      if (oldestKey) {
        this.audioCache.delete(oldestKey);
      }
    }
    this.audioCache.set(cacheKey, audioBuffer);

    if (requestId) {
      this.activeGenerations.delete(requestId);
    }

    return cacheKey;
  }

  public abortPrepare(requestId: string): void {
    if (requestId) {
      this.activeGenerations.delete(requestId);
    }
  }

  public async playSpeech(cacheKey: string): Promise<void> {
    this.stopPlayback();

    const audioBuffer = this.audioCache.get(cacheKey);
    if (!audioBuffer) {
      throw new Error(`Audio for cacheKey '${cacheKey}' not found in offscreen cache.`);
    }

    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    this.currentSource = source;

    return new Promise<void>((resolve) => {
      let isEnded = false;

      const finish = () => {
        if (!isEnded) {
          isEnded = true;
          this.currentSource = null;
          this.currentPlayResolve = null;
          resolve();
        }
      };

      this.currentPlayResolve = finish;
      source.onended = () => finish();
      source.start(0);
    });
  }

  public stopPlayback(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Already ended
      }
      this.currentSource = null;
    }
    if (this.currentPlayResolve) {
      this.currentPlayResolve();
      this.currentPlayResolve = null;
    }
  }

  private initMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Strictly handle only messages explicitly targeted to the kokoro-offscreen engine
      if (message?.target !== 'kokoro-offscreen') {
        return false;
      }

      const { action } = message;

      if (action === 'KOKORO_GET_STATUS') {
        this.capabilitiesPromise.then(() => {
          sendResponse(this.modelInfo);
        });
        return true;
      }

      if (action === 'KOKORO_LOAD_MODEL') {
        this.loadModel()
          .then((info) => sendResponse({ ok: true, info }))
          .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true; // Keep channel open for async response
      }

      if (action === 'KOKORO_PREPARE') {
        const { text, voice, speed, cacheKey, requestId } = message;
        this.prepareSpeech(text, voice, speed, cacheKey, requestId)
          .then((key) => sendResponse({ ok: true, cacheKey: key }))
          .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true;
      }

      if (action === 'KOKORO_ABORT_PREPARE') {
        const { requestId } = message;
        this.abortPrepare(requestId);
        sendResponse({ ok: true });
        return false;
      }

      if (action === 'KOKORO_PLAY') {
        const { cacheKey } = message;
        this.playSpeech(cacheKey)
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true;
      }

      if (action === 'KOKORO_STOP') {
        this.stopPlayback();
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });
  }
}

// Instantiate offscreen engine
new OffscreenNeuralEngine();
