import io
import logging
from typing import List, Dict, Any
from .base import BaseTTSProvider

logger = logging.getLogger(__name__)

class MeloProvider(BaseTTSProvider):
    """
    MeloTTS provider adapter (M2.1 milestone), featuring Australian English.
    Gracefully falls back with actionable instructions if packages are missing.
    """

    def __init__(self):
        self._models = {}

    @property
    def id(self) -> str:
        return "melo"

    @property
    def name(self) -> str:
        return "MeloTTS (Local)"

    def list_voices(self) -> List[Dict[str, Any]]:
        return [
            {"id": "EN-AU", "name": "English (Australian)", "lang": "en-AU"},
            {"id": "EN-US", "name": "English (American)", "lang": "en-US"},
            {"id": "EN-BR", "name": "English (British)", "lang": "en-GB"},
            {"id": "EN-Default", "name": "English (Default)", "lang": "en-US"},
        ]

    def _ensure_model(self, speaker_id: str):
        if speaker_id not in self._models:
            try:
                from melo.api import TTS
                model = TTS(language='EN', device='auto')
                self._models[speaker_id] = model
            except ImportError:
                raise RuntimeError(
                    "MeloTTS dependencies not installed. Run: pip install melotts"
                )
            except Exception as e:
                raise RuntimeError(f"Failed to initialize MeloTTS model: {e}")
        return self._models[speaker_id]

    def synthesize(self, text: str, voice: str = "EN-AU", speed: float = 1.0) -> bytes:
        speaker_key = voice if voice in ["EN-AU", "EN-US", "EN-BR", "EN-Default"] else "EN-AU"
        model = self._ensure_model(speaker_key)
        import soundfile as sf

        speaker_ids = model.hps.data.spk2id
        spk_id = speaker_ids.get(speaker_key, 0)

        buf = io.BytesIO()
        model.tts_to_file(text, spk_id, buf, speed=speed, format='wav')
        return buf.getvalue()
