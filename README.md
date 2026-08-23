# Point & Read TTS Chrome Extension

A modular, robust point-to-read text-to-speech Chrome Extension with swappable TTS provider backends.

```text
DOM text
   ↓
TextNormalizer
   ↓
TTSClient.prepare(text) / play(prepared)
   ↓
┌───────────────────── TTS Providers ─────────────────────┐
│                                                         │
│  ├── SystemTTSProvider (window.speechSynthesis)         │
│  └── RemoteServerTTSProvider (http://127.0.0.1:PORT)   │
│           │                                             │
│           ▼                                             │
│     FastAPI / HTTP TTS Server                           │
│           ├── MockNeuralProvider                        │
│           ├── KokoroProvider (Kokoro-82M)               │
│           └── MeloProvider (MeloTTS, EN-AU)             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Build Extension (Milestone 1)

```bash
npm install
npm run build
```

This compiles TypeScript and bundles the self-contained extension into the `dist/` directory.

### 2. Load into Chrome

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right).
3. Click **Load unpacked** and select the `dist/` folder in this repository.
4. Open any webpage (e.g. Wikipedia or a news article).
5. Hover over paragraphs, headers, and list items to see the thin indigo outline.
6. Click any highlighted text block to listen via **System TTS**.
7. Press `Esc` at any time to stop playback.

---

## Running the Local TTS Server (Milestones 1.5 - M2)

The companion server provides HTTP audio synthesis for neural models.

### Start the Server

```bash
python3 tts-server/run.py --port 8000
```

The server starts immediately on `http://127.0.0.1:8000`. If FastAPI is installed, it runs via uvicorn; otherwise, it automatically uses the standard library zero-dependency HTTP server.

### Adding Neural Models

- **Kokoro-82M (M2)**:
  ```bash
  pip install kokoro soundfile numpy
  ```
- **MeloTTS (M2.1 - Australian English)**:
  ```bash
  pip install melotts
  ```

---

## Build Gates & Architecture

- **M1**: DOM block segmentation, hover outline, click-to-read, `Esc` to stop, System TTS adapter, swappable `prepare`/`play` provider abstraction.
- **M1.5**: Local Python server, zero-dependency `MockNeuralProvider`, HTTP communication, and popup server status indicator.
- **M2**: Kokoro-82M end-to-end integration and compound LRU caching (`${provider}:${voice}:${speed}:${text}`).
- **M2.1**: MeloTTS adapter with `EN-AU` Australian English voice.

---

## Extension Structure

```text
tts-hover-app/
├── extension/
│   ├── manifest.json              # Manifest V3 configuration
│   ├── icons/                     # 16, 48, 128 pixel icons
│   ├── content/
│   │   ├── detector.ts            # DOM text block segmentation
│   │   ├── overlay.ts             # Lightweight outline renderer
│   │   ├── overlay.css            # Selected & speaking styles
│   │   ├── interaction.ts         # Pointermove, click, and Esc handlers
│   │   └── index.ts               # Content script entrypoint
│   ├── speech/
│   │   ├── types.ts               # TTSProvider, Voice, SpeechOptions contracts
│   │   ├── normalizer.ts          # Conservative speech text normalizer
│   │   ├── cache.ts               # Compound-key LRU speech cache
│   │   ├── client.ts              # Unified TTSClient manager
│   │   └── providers/
│   │       ├── system.ts          # Browser speechSynthesis adapter
│   │       └── remote.ts          # HTTP Web Audio API adapter
│   ├── popup/
│   │   ├── popup.html             # Clean settings UI
│   │   ├── popup.css              # Minimal dark styling
│   │   └── popup.ts               # Provider/voice switcher & server ping
│   └── background.ts              # Background service worker
│
├── tts-server/
│   ├── server.py                  # FastAPI + stdlib fallback server
│   ├── run.py                     # Server CLI runner
│   ├── requirements.txt           # Python dependencies
│   └── providers/
│       ├── base.py                # Abstract BaseTTSProvider
│       ├── mock_neural.py         # Instant synthetic audio generator
│       ├── kokoro.py              # Kokoro-82M adapter
│       └── melo.py                # MeloTTS adapter (EN-AU)
│
└── dist/                          # Built, unpacked Chrome extension
```
