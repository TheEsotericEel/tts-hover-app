import { TTSClient } from '../speech/client';
import { InteractionController } from './interaction';

// Initialize Point & Read content script
(function initPointReader() {
  // Avoid duplicate injection
  if ((window as unknown as { __POINT_READER_INITIALIZED__?: boolean }).__POINT_READER_INITIALIZED__) {
    return;
  }
  (window as unknown as { __POINT_READER_INITIALIZED__?: boolean }).__POINT_READER_INITIALIZED__ = true;

  const ttsClient = new TTSClient();
  const controller = new InteractionController(ttsClient);

  // Expose controller for debug or testing
  (window as unknown as { __POINT_READER_CONTROLLER__?: InteractionController }).__POINT_READER_CONTROLLER__ = controller;

  console.log('[Point & Read TTS] Extension active. Hover over text blocks and click to speak.');
})();
