// Point & Read Background Service Worker (Manifest V3)
import { DEFAULT_SETTINGS } from './speech/types';

let creatingOffscreenPromise: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');

  // Check existing contexts if available
  if ('getContexts' in chrome.runtime) {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    if (contexts.length > 0) {
      return;
    }
  } else if ('hasDocument' in chrome.offscreen) {
    if (await (chrome.offscreen as any).hasDocument()) {
      return;
    }
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['WORKERS' as any],
    justification: 'Local in-browser Kokoro neural speech synthesis',
  });

  try {
    await creatingOffscreenPromise;
  } finally {
    creatingOffscreenPromise = null;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('ttsSettings');
  if (!stored.ttsSettings) {
    await chrome.storage.local.set({ ttsSettings: DEFAULT_SETTINGS });
  }
  console.log('[Point & Read] Background service worker initialized.');
});

// Forward or ensure offscreen is awake on Kokoro messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && typeof message.action === 'string' && message.action.startsWith('KOKORO_')) {
    ensureOffscreenDocument()
      .then(() => {
        // Return false to let the offscreen document itself handle and respond to the message
        sendResponse({ ok: true, forwarded: true });
      })
      .catch((err) => {
        console.error('[Background] Failed to ensure offscreen document:', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
});
