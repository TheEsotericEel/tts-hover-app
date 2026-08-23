// Point & Read Background Service Worker (Manifest V3)
import { DEFAULT_SETTINGS } from './speech/types';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('ttsSettings');
  if (!stored.ttsSettings) {
    await chrome.storage.local.set({ ttsSettings: DEFAULT_SETTINGS });
  }
  console.log('[Point & Read] Background service worker initialized.');
});
