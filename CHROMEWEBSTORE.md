# Chrome Web Store Listing: Point & Read TTS

## Metadata
- **Name**: Point & Read TTS
- **Version**: 0.1.0
- **Summary**: Hover over any text block on a webpage to select it, and click to speak using swappable voice engines.
- **Category**: Accessibility / Productivity
- **Language**: English

## Description
Point & Read TTS brings effortless, localized text-to-speech to your browsing experience.

### Key Features
- **Smart DOM Block Segmentation**: Seamlessly outlines coherent paragraphs, headers, and list items as you move your cursor.
- **Click-to-Speak**: Simply click on any highlighted block to listen.
- **Swappable Speech Engines**: Built from the ground up to support native browser voices and local neural models (Kokoro, MeloTTS).
- **Keyboard Shortcuts**: Press `Esc` at any point to stop speech instantly.
- **Privacy-First**: Operates completely on your device with local speech engines and zero third-party telemetry.

## Permissions Justification
- `storage`: Required to save user preferences such as active provider, chosen voice, and speech speed across browser sessions.
- `host_permissions` (`http://127.0.0.1:*/*`, `http://localhost:*/*`): Required to communicate with the optional local TTS neural server running on your computer.

## Privacy & Data Use
- **Data Collection**: No personal data, browsing history, or user data is collected or transmitted to external servers.
- **Network Access**: Limited strictly to localhost communication for optional local neural speech synthesis.
