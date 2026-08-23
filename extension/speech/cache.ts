import { PreparedSpeech } from './types';

export class SpeechCache {
  private cache = new Map<string, PreparedSpeech>();
  private readonly maxEntries: number;

  constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
  }

  public static generateKey(provider: string, voice: string, speed: number, text: string): string {
    return `${provider}:${voice || 'default'}:${speed.toFixed(2)}:${text}`;
  }

  public get(key: string): PreparedSpeech | undefined {
    const item = this.cache.get(key);
    if (item) {
      // Refresh LRU order
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  public set(key: string, value: PreparedSpeech): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }
}
