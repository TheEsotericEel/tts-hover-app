# Point & Read TTS Chrome Extension

A modular, robust point-to-read text-to-speech Chrome Extension with in-browser neural AI voices and swappable provider backends.

```text
DOM text
   ↓
TextNormalizer
   ↓
TTSClient.prepare(text) / play(prepared)
   ↓
┌───────────────────── TTS Providers ─────────────────────┐
│                                                         │
│  ├── BrowserKokoroTTSProvider (In-Browser Neural AI)    │
│  │     └── Offscreen Document (Kokoro-82M ONNX WebGPU)  │
│  │                                                      │
│  ├── SystemTTSProvider (window.speechSynthesis)         │
│  │                                                      │
│  └── RemoteServerTTSProvider (http://127.0.0.1:PORT)   │
│           └── Local Python Server (Melo AU / Kokoro)    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Features

- **In-Browser Neural AI (Kokoro-82M)**: High-quality neural text-to-speech running completely in Chrome using WebGPU / WASM in an Offscreen Document. Zero server setup required.
- **Smart DOM Block Segmentation**: Seamlessly highlights coherent paragraphs, headers, list items, and quiz buttons/choices as you hover.
- **Click-to-Speak**: Click any highlighted block to listen.
- **Decoupled Cancellation & LRU Audio Caching**: Hovering pre-buffers synthesis; moving blocks cancels preparation without interrupting active playback.
- **Zero-Setup System Fallback**: Browser `SpeechSynthesis` voices always available instantly.
- **Optional Localhost Python Server**: Companion FastAPI server for advanced or heavy backends (like MeloTTS Australian English `EN-AU`).

---

## Quick Start

### 1. Build Extension

```bash
npm install
npm run build
```

This compiles TypeScript, bundles the extension, and stages local WASM binaries into `dist/`.

### 2. Load into Chrome

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Open the extension popup:
   - Select **Kokoro-82M (In-Browser AI)**.
   - Click **Load Model** to initialize the in-browser neural engine.
5. Open any webpage (e.g. Wikipedia or an online quiz).
6. Hover over any text block or answer button to see the outline.
7. Click the highlighted block to speak with Kokoro AI. Press `Esc` at any time to stop.

---

## Testing & Quality Assurance

```bash
npm run typecheck   # Strict TypeScript typechecking
npm test            # 14 automated unit tests
npm run build       # Verified production packaging
```
