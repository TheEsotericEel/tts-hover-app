// Point & Read Background Service Worker (Manifest V3)
import { DEFAULT_SETTINGS } from './speech/types';

let creatingOffscreenPromise: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');
  if ('getContexts' in chrome.runtime) {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    return contexts.length > 0;
  }
  if ('hasDocument' in chrome.offscreen) {
    return await (chrome.offscreen as any).hasDocument();
  }
  return false;
}

async function ensureOffscreenDocument(): Promise<void> {
  resetIdleTimer();

  if (await hasOffscreenDocument()) {
    return;
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

async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    try {
      await chrome.offscreen.closeDocument();
      console.log('[Background] Offscreen document closed after 10 min idle.');
    } catch (err) {
      console.debug('[Background] Error closing offscreen:', err);
    }
  }
}

function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    closeOffscreenDocument();
  }, IDLE_TIMEOUT_MS);
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('ttsSettings');
  if (!stored.ttsSettings) {
    await chrome.storage.local.set({ ttsSettings: DEFAULT_SETTINGS });
  }
  console.log('[Point & Read] Background service worker initialized.');
});

// Stage 1 Lifecycle: Background worker handles only ENSURE_KOKORO_OFFSCREEN
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'kokoro-offscreen') {
    resetIdleTimer();
    return false;
  }

  if (message?.action === 'ENSURE_KOKORO_OFFSCREEN') {
    ensureOffscreenDocument()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((err) => {
        console.error('[Background] Failed to ensure offscreen document:', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }

  return false;
});
