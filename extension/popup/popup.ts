import { TTSClient } from '../speech/client';
import { BrowserKokoroTTSProvider } from '../speech/providers/browser_kokoro';
import { EngineMode } from '../speech/types';

document.addEventListener('DOMContentLoaded', async () => {
  const ttsClient = new TTSClient();
  const settings = await ttsClient.loadSettings();

  const toggleEnabled = document.getElementById('toggle-enabled') as HTMLInputElement;
  const selectProvider = document.getElementById('select-provider') as HTMLSelectElement;
  const selectVoice = document.getElementById('select-voice') as HTMLSelectElement;
  const sliderSpeed = document.getElementById('slider-speed') as HTMLInputElement;
  const speedValue = document.getElementById('speed-value') as HTMLSpanElement;
  const btnTestVoice = document.getElementById('btn-test-voice') as HTMLButtonElement;

  const serverStatusContainer = document.getElementById('server-status-container') as HTMLDivElement;
  const serverDot = document.getElementById('server-dot') as HTMLSpanElement;
  const serverStatusText = document.getElementById('server-status-text') as HTMLSpanElement;

  // In-Browser Model Card Elements
  const kokoroModelCard = document.getElementById('kokoro-model-card') as HTMLDivElement;
  const selectEngineMode = document.getElementById('select-engine-mode') as HTMLSelectElement;
  const modelDot = document.getElementById('model-dot') as HTMLSpanElement;
  const modelStatusText = document.getElementById('model-status-text') as HTMLSpanElement;
  const modelDeviceBadge = document.getElementById('model-device-badge') as HTMLSpanElement;
  const modelErrorMsg = document.getElementById('model-error-msg') as HTMLDivElement;
  const btnLoadModel = document.getElementById('btn-load-model') as HTMLButtonElement;

  // Initialize UI state
  toggleEnabled.checked = settings.enabled;
  selectProvider.value = settings.provider || 'kokoro-browser';
  selectEngineMode.value = settings.engineMode || 'wasm';
  sliderSpeed.value = String(settings.speed || 1.0);
  speedValue.textContent = `${Number(sliderSpeed.value).toFixed(2)}x`;

  function updateProviderViews(providerId: string) {
    // 1. Model card visibility
    if (providerId === 'kokoro-browser') {
      kokoroModelCard.style.display = 'flex';
      checkKokoroModelStatus();
    } else {
      kokoroModelCard.style.display = 'none';
    }

    // 2. Server status footer visibility (only relevant for local server backends)
    if (providerId === 'kokoro' || providerId === 'melo') {
      serverStatusContainer.style.display = 'flex';
      checkServerStatus();
    } else {
      serverStatusContainer.style.display = 'none';
    }
  }

  async function checkKokoroModelStatus() {
    const browserKokoro = ttsClient.getProvider('kokoro-browser') as BrowserKokoroTTSProvider;
    if (!browserKokoro) return;

    try {
      const info = await browserKokoro.getStatus();
      const currentMode = selectEngineMode.value;
      if (currentMode === 'wasm') {
        modelDeviceBadge.textContent = 'WASM (92M)';
      } else if (currentMode === 'webgpu') {
        modelDeviceBadge.textContent = 'WEBGPU (326M)';
      } else {
        modelDeviceBadge.textContent = info.device ? info.device.toUpperCase() : 'AUTO';
      }

      if (info.status === 'ready') {
        modelDot.className = 'model-dot ready';
        modelStatusText.textContent = 'Kokoro AI: Ready';
        modelErrorMsg.style.display = 'none';
        btnLoadModel.textContent = 'Model Ready';
        btnLoadModel.disabled = true;
      } else if (info.status === 'loading') {
        modelDot.className = 'model-dot loading';
        modelStatusText.textContent = info.progress ? `Kokoro AI: ${info.progress}%` : 'Kokoro AI: Loading...';
        modelErrorMsg.style.display = 'none';
        btnLoadModel.textContent = 'Loading...';
        btnLoadModel.disabled = true;
      } else if (info.status === 'error') {
        modelDot.className = 'model-dot error';
        modelStatusText.textContent = 'Kokoro AI: Failed';
        if (info.error) {
          modelErrorMsg.textContent = info.error;
          modelErrorMsg.style.display = 'block';
        }
        btnLoadModel.textContent = 'Retry Loading';
        btnLoadModel.disabled = false;
      } else {
        modelDot.className = 'model-dot not-loaded';
        modelStatusText.textContent = 'Kokoro AI: Not loaded';
        modelErrorMsg.style.display = 'none';
        btnLoadModel.textContent = 'Load Model';
        btnLoadModel.disabled = false;
      }
    } catch (err: any) {
      modelDot.className = 'model-dot error';
      modelStatusText.textContent = 'Kokoro AI: Error';
      modelErrorMsg.textContent = err?.message || String(err);
      modelErrorMsg.style.display = 'block';
      btnLoadModel.textContent = 'Retry Loading';
      btnLoadModel.disabled = false;
    }
  }

  async function populateVoices(providerId: string, selectedVoiceId?: string) {
    selectVoice.innerHTML = '<option value="default">Loading voices...</option>';
    try {
      const voices = await ttsClient.listVoices(providerId);
      selectVoice.innerHTML = '';

      if (voices.length === 0) {
        const opt = document.createElement('option');
        opt.value = 'default';
        opt.textContent = 'Default Voice';
        selectVoice.appendChild(opt);
        return;
      }

      voices.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        if (selectedVoiceId && (v.id === selectedVoiceId || v.name === selectedVoiceId)) {
          opt.selected = true;
        }
        selectVoice.appendChild(opt);
      });
    } catch (err) {
      console.warn('Failed to populate voices:', err);
      selectVoice.innerHTML = '<option value="default">Default Voice</option>';
    }
  }

  async function checkServerStatus() {
    const isConnected = await ttsClient.pingServer();
    if (isConnected) {
      serverDot.className = 'status-dot connected';
      serverStatusText.textContent = 'Server Connected';
    } else {
      serverDot.className = 'status-dot offline';
      serverStatusText.textContent = 'Server Offline';
    }
  }

  // Load initial view states and voices
  updateProviderViews(selectProvider.value);
  await populateVoices(selectProvider.value, settings.voice);

  // 1. Toggle Reader Mode
  toggleEnabled.addEventListener('change', async () => {
    await ttsClient.updateSettings({ enabled: toggleEnabled.checked });
  });

  // 2. Change Provider
  selectProvider.addEventListener('change', async () => {
    const newProvider = selectProvider.value;
    updateProviderViews(newProvider);
    await populateVoices(newProvider);
    await ttsClient.updateSettings({
      provider: newProvider,
      voice: selectVoice.value,
    });
  });

  // 3. Change Engine Mode (WASM vs WebGPU vs Auto)
  selectEngineMode.addEventListener('change', async () => {
    const engineMode = selectEngineMode.value as EngineMode;
    await ttsClient.updateSettings({ engineMode });
    btnLoadModel.disabled = false;
    btnLoadModel.textContent = 'Load Model';
    await checkKokoroModelStatus();
  });

  // 4. Load Model Button
  btnLoadModel.addEventListener('click', async () => {
    const browserKokoro = ttsClient.getProvider('kokoro-browser') as BrowserKokoroTTSProvider;
    if (!browserKokoro) return;

    const engineMode = selectEngineMode.value as EngineMode;
    modelDot.className = 'model-dot loading';
    modelStatusText.textContent = 'Kokoro AI: Loading...';
    modelErrorMsg.style.display = 'none';
    btnLoadModel.textContent = 'Loading...';
    btnLoadModel.disabled = true;

    try {
      await browserKokoro.loadModel(engineMode);
      await checkKokoroModelStatus();
    } catch (err: any) {
      console.error('Failed to load in-browser Kokoro model:', err);
      modelDot.className = 'model-dot error';
      modelStatusText.textContent = 'Kokoro AI: Load Failed';
      modelErrorMsg.textContent = err?.message || String(err);
      modelErrorMsg.style.display = 'block';
      btnLoadModel.textContent = 'Retry Loading';
      btnLoadModel.disabled = false;
      await checkKokoroModelStatus();
    }
  });

  // 5. Change Voice
  selectVoice.addEventListener('change', async () => {
    await ttsClient.updateSettings({ voice: selectVoice.value });
  });

  // 6. Change Speed
  sliderSpeed.addEventListener('input', () => {
    const speed = parseFloat(sliderSpeed.value);
    speedValue.textContent = `${speed.toFixed(2)}x`;
  });

  sliderSpeed.addEventListener('change', async () => {
    const speed = parseFloat(sliderSpeed.value);
    await ttsClient.updateSettings({ speed });
  });

  // 7. Test Voice Button
  let isTesting = false;
  btnTestVoice.addEventListener('click', async () => {
    if (isTesting) {
      ttsClient.stop();
      isTesting = false;
      btnTestVoice.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Test Voice
      `;
      return;
    }

    isTesting = true;
    btnTestVoice.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      </svg>
      Stop Test
    `;

    try {
      const sampleText = 'Point and read is ready. Hover over any text block to speak.';
      await ttsClient.speak(sampleText, {
        voice: selectVoice.value,
        speed: parseFloat(sliderSpeed.value),
        engineMode: selectEngineMode.value as EngineMode,
      });
    } catch (err) {
      console.error('Test voice error:', err);
    } finally {
      isTesting = false;
      btnTestVoice.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Test Voice
      `;
    }
  });
});
