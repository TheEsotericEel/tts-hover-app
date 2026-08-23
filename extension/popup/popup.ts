import { TTSClient } from '../speech/client';
import { UserSettings } from '../speech/types';

document.addEventListener('DOMContentLoaded', async () => {
  const ttsClient = new TTSClient();
  const settings = await ttsClient.loadSettings();

  const toggleEnabled = document.getElementById('toggle-enabled') as HTMLInputElement;
  const selectProvider = document.getElementById('select-provider') as HTMLSelectElement;
  const selectVoice = document.getElementById('select-voice') as HTMLSelectElement;
  const sliderSpeed = document.getElementById('slider-speed') as HTMLInputElement;
  const speedValue = document.getElementById('speed-value') as HTMLSpanElement;
  const btnTestVoice = document.getElementById('btn-test-voice') as HTMLButtonElement;
  const serverDot = document.getElementById('server-dot') as HTMLSpanElement;
  const serverStatusText = document.getElementById('server-status-text') as HTMLSpanElement;

  // Initialize UI state from saved settings
  toggleEnabled.checked = settings.enabled;
  selectProvider.value = settings.provider || 'system';
  sliderSpeed.value = String(settings.speed || 1.0);
  speedValue.textContent = `${Number(sliderSpeed.value).toFixed(2)}x`;

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

  // Load initial voices
  await populateVoices(selectProvider.value, settings.voice);
  await checkServerStatus();

  // 1. Toggle Reader Mode
  toggleEnabled.addEventListener('change', async () => {
    await ttsClient.updateSettings({ enabled: toggleEnabled.checked });
  });

  // 2. Change Provider
  selectProvider.addEventListener('change', async () => {
    const newProvider = selectProvider.value;
    await populateVoices(newProvider);
    await ttsClient.updateSettings({
      provider: newProvider,
      voice: selectVoice.value,
    });
  });

  // 3. Change Voice
  selectVoice.addEventListener('change', async () => {
    await ttsClient.updateSettings({ voice: selectVoice.value });
  });

  // 4. Change Speed
  sliderSpeed.addEventListener('input', () => {
    const speed = parseFloat(sliderSpeed.value);
    speedValue.textContent = `${speed.toFixed(2)}x`;
  });

  sliderSpeed.addEventListener('change', async () => {
    const speed = parseFloat(sliderSpeed.value);
    await ttsClient.updateSettings({ speed });
  });

  // 5. Test Voice Button
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
