import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { EngineMode, SpeechMetrics } from '../speech/types';

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
  engineMode: EngineMode;
  progress?: number;
  error?: string;
}

interface CacheEntry {
  buffer: AudioBuffer;
  bytes: number;
}

interface GenerationJob {
  text: string;
  voice: string;
  speed: number;
  cacheKey: string;
  requestId?: string;
  resolve: (res: { cacheKey: string; metrics: SpeechMetrics }) => void;
  reject: (err: any) => void;
}

class OffscreenNeuralEngine {
  private tts: any = null;
  private currentEngineMode: EngineMode = 'wasm';
  private modelInfo: ModelInfo = {
    status: 'not_loaded',
    device: 'wasm',
    dtype: 'q8',
    engineMode: 'wasm',
  };
  private capabilitiesPromise: Promise<void>;
  private loadPromise: Promise<ModelInfo> | null = null;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentPlayResolve: (() => void) | null = null;

  // Byte-budget Audio Cache (~20 MB maximum)
  private audioCache = new Map<string, CacheEntry>();
  private currentCacheBytes = 0;
  private readonly maxAudioCacheBytes = 20 * 1024 * 1024; // 20 MB

  // Single-concurrency neural queue (latest pending wins)
  private isGenerating = false;
  private pendingJob: GenerationJob | null = null;
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
          this.modelInfo.dtype = 'fp32';
          return;
        }
      }
    } catch (e) {
      console.warn('[Offscreen] WebGPU detection notice:', e);
    }

    this.modelInfo.device = 'wasm';
    this.modelInfo.dtype = 'q8';
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

  public async loadModel(mode: EngineMode = 'wasm'): Promise<ModelInfo> {
    await this.capabilitiesPromise;

    // If already loaded with the requested engine mode
    if (this.modelInfo.status === 'ready' && this.tts && this.currentEngineMode === mode) {
      return this.modelInfo;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.currentEngineMode = mode;
    this.modelInfo.engineMode = mode;
    this.modelInfo.status = 'loading';
    this.modelInfo.error = undefined;
    this.modelInfo.progress = 0;

    // Determine device & dtype based on requested engineMode
    if (mode === 'wasm') {
      this.modelInfo.device = 'wasm';
      this.modelInfo.dtype = 'q8'; // 92.4 MB lightweight quantized model
    } else if (mode === 'webgpu') {
      this.modelInfo.device = 'webgpu';
      this.modelInfo.dtype = 'fp32'; // 326 MB full-precision GPU model
    } else {
      // Auto: prefer WebGPU if available, else WASM
      if (this.modelInfo.device === 'webgpu') {
        this.modelInfo.dtype = 'fp32';
      } else {
        this.modelInfo.dtype = 'q8';
      }
    }

    this.loadPromise = (async () => {
      try {
        console.log(`[Offscreen] Loading ${MODEL_ID} [Mode: ${mode}] on ${this.modelInfo.device} (${this.modelInfo.dtype})...`);

        const progressCb = (progress: any) => {
          if (progress?.status === 'progress' && typeof progress.progress === 'number') {
            this.modelInfo.progress = Math.round(progress.progress);
          }
        };

        try {
          this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
            dtype: this.modelInfo.dtype,
            device: this.modelInfo.device,
            progress_callback: progressCb,
          });
        } catch (initialErr) {
          // If WebGPU failed or wasn't supported, fallback to WASM (q8)
          if (this.modelInfo.device === 'webgpu' && mode !== 'webgpu') {
            console.warn('[Offscreen] WebGPU failed, retrying with WASM (q8):', initialErr);
            this.modelInfo.device = 'wasm';
            this.modelInfo.dtype = 'q8';
            this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
              dtype: 'q8',
              device: 'wasm',
              progress_callback: progressCb,
            });
          } else {
            throw initialErr;
          }
        }

        this.modelInfo.status = 'ready';
        this.modelInfo.progress = 100;
        console.log(`[Offscreen] Kokoro-82M loaded on ${this.modelInfo.device} (${this.modelInfo.dtype}). Prewarming...`);

        // Prewarm once with a tiny utterance to compile shaders/WASM
        try {
          await this.tts.generate('Ready.', { voice: 'af_heart', speed: 1.0 });
          console.log('[Offscreen] Kokoro-82M prewarmed and ready.');
        } catch (prewarmErr) {
          console.debug('[Offscreen] Prewarm notice:', prewarmErr);
        }

        return this.modelInfo;
      } catch (err: any) {
        this.modelInfo.status = 'error';
        const msg = err?.message || String(err);
        const cause = err?.cause?.message ? ` (${err.cause.message})` : '';
        this.modelInfo.error = `${msg}${cause}`;
        console.error('[Offscreen] Failed to load Kokoro model:', err);
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Enqueues or starts speech preparation with single-concurrency queue.
   */
  public async prepareSpeech(
    text: string,
    voice: string,
    speed: number,
    cacheKey: string,
    engineMode: EngineMode = 'wasm',
    requestId?: string
  ): Promise<{ cacheKey: string; metrics: SpeechMetrics }> {
    // 1. Check audio cache
    if (this.audioCache.has(cacheKey)) {
      const entry = this.audioCache.get(cacheKey)!;
      return {
        cacheKey,
        metrics: {
          backend: `${this.modelInfo.device} ${this.modelInfo.dtype}`,
          textChars: text.length,
          synthesisMs: 0,
          audioDurationSec: Number(entry.buffer.duration.toFixed(2)),
          rtf: 0,
          cacheHit: true,
        },
      };
    }

    if (requestId) {
      this.activeGenerations.add(requestId);
    }

    return new Promise<{ cacheKey: string; metrics: SpeechMetrics }>((resolve, reject) => {
      const job: GenerationJob = {
        text,
        voice,
        speed,
        cacheKey,
        requestId,
        resolve,
        reject,
      };

      if (this.isGenerating) {
        // Discard any previously pending job (latest hover wins)
        if (this.pendingJob) {
          this.pendingJob.reject(new Error('Obsolete pending hover job discarded'));
        }
        this.pendingJob = job;
      } else {
        this.processJob(job, engineMode);
      }
    });
  }

  private async processJob(job: GenerationJob, engineMode: EngineMode): Promise<void> {
    this.isGenerating = true;
    const startTime = performance.now();

    try {
      if (job.requestId && !this.activeGenerations.has(job.requestId)) {
        throw new Error('Preparation cancelled before start');
      }

      if (this.modelInfo.status !== 'ready' || !this.tts || this.currentEngineMode !== engineMode) {
        await this.loadModel(engineMode);
      }

      if (job.requestId && !this.activeGenerations.has(job.requestId)) {
        throw new Error('Preparation cancelled while loading');
      }

      const cleanVoice = job.voice && job.voice !== 'default' ? job.voice : 'af_heart';
      const cleanSpeed = job.speed || 1.0;

      // Execute synthesis
      const result = await this.tts.generate(job.text, {
        voice: cleanVoice,
        speed: cleanSpeed,
      });

      if (job.requestId && !this.activeGenerations.has(job.requestId)) {
        throw new Error('Preparation cancelled');
      }

      const ctx = this.getAudioContext();
      const rawAudio: Float32Array = result.audio;
      const sampleRate = result.sampling_rate || 24000;

      const audioBuffer = ctx.createBuffer(1, rawAudio.length, sampleRate);
      audioBuffer.getChannelData(0).set(rawAudio);

      const bufferBytes = rawAudio.length * 4; // Float32 bytes
      this.storeInCache(job.cacheKey, audioBuffer, bufferBytes);

      const synthesisMs = Math.round(performance.now() - startTime);
      const audioDurationSec = Number(audioBuffer.duration.toFixed(2));
      const rtf = audioDurationSec > 0 ? Number((synthesisMs / (audioDurationSec * 1000)).toFixed(3)) : 0;

      const metrics: SpeechMetrics = {
        backend: `${this.modelInfo.device} ${this.modelInfo.dtype}`,
        textChars: job.text.length,
        synthesisMs,
        audioDurationSec,
        rtf,
        cacheHit: false,
      };

      console.log(
        `[Kokoro Metrics] Backend: ${metrics.backend} | Chars: ${metrics.textChars} | ` +
        `Synthesis: ${metrics.synthesisMs}ms | Audio: ${metrics.audioDurationSec}s | RTF: ${metrics.rtf}x`
      );

      job.resolve({ cacheKey: job.cacheKey, metrics });
    } catch (err: any) {
      job.reject(err);
    } finally {
      if (job.requestId) {
        this.activeGenerations.delete(job.requestId);
      }
      this.isGenerating = false;

      // Process next pending job if one arrived
      if (this.pendingJob) {
        const next = this.pendingJob;
        this.pendingJob = null;
        this.processJob(next, engineMode);
      }
    }
  }

  private storeInCache(key: string, buffer: AudioBuffer, bytes: number): void {
    // Evict oldest entries until within 20 MB budget
    while (this.currentCacheBytes + bytes > this.maxAudioCacheBytes && this.audioCache.size > 0) {
      const oldestKey = this.audioCache.keys().next().value;
      if (!oldestKey) break;
      const entry = this.audioCache.get(oldestKey);
      if (entry) {
        this.currentCacheBytes -= entry.bytes;
        this.audioCache.delete(oldestKey);
      }
    }

    this.audioCache.set(key, { buffer, bytes });
    this.currentCacheBytes += bytes;
  }

  public abortPrepare(requestId: string): void {
    if (requestId) {
      this.activeGenerations.delete(requestId);
      if (this.pendingJob?.requestId === requestId) {
        this.pendingJob.reject(new Error('Pending preparation cancelled'));
        this.pendingJob = null;
      }
    }
  }

  public async playSpeech(cacheKey: string): Promise<void> {
    this.stopPlayback();

    const entry = this.audioCache.get(cacheKey);
    if (!entry) {
      throw new Error(`Audio for cacheKey '${cacheKey}' not found in offscreen cache.`);
    }

    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = entry.buffer;
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
        this.loadModel(message.engineMode || 'wasm')
          .then((info) => sendResponse({ ok: true, info }))
          .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true;
      }

      if (action === 'KOKORO_PREPARE') {
        const { text, voice, speed, cacheKey, engineMode, requestId } = message;
        this.prepareSpeech(text, voice, speed, cacheKey, engineMode, requestId)
          .then((res) => sendResponse({ ok: true, cacheKey: res.cacheKey, metrics: res.metrics }))
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
