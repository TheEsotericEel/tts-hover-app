import io
import logging
from typing import List, Dict, Any
from .base import BaseTTSProvider

logger = logging.getLogger(__name__)

class KokoroProvider(BaseTTSProvider):
    """
    Kokoro-82M neural TTS provider adapter (M2 milestone).
    Gracefully falls back with actionable instructions if packages are missing.
    """

    def __init__(self):
        self._pipeline = None
        self._is_loaded = False

    @property
    def id(self) -> str:
        return "kokoro"

    @property
    def name(self) -> str:
        return "Kokoro-82M (Local)"

    def list_voices(self) -> List[Dict[str, Any]]:
        return [
            {"id": "af_heart", "name": "Heart (US Female)", "lang": "en-US"},
            {"id": "af_bella", "name": "Bella (US Female)", "lang": "en-US"},
            {"id": "af_sarah", "name": "Sarah (US Female)", "lang": "en-US"},
            {"id": "am_adam", "name": "Adam (US Male)", "lang": "en-US"},
            {"id": "am_michael", "name": "Michael (US Male)", "lang": "en-US"},
            {"id": "bf_emma", "name": "Emma (British Female)", "lang": "en-GB"},
            {"id": "bm_george", "name": "George (British Male)", "lang": "en-GB"},
        ]

    def _ensure_model(self):
        if not self._is_loaded:
            try:
                from kokoro import KPipeline
                self._pipeline = KPipeline(lang_code='a')
                self._is_loaded = True
            except ImportError:
                raise RuntimeError(
                    "Kokoro engine dependencies not installed. Run: pip install kokoro soundfile"
                )
            except Exception as e:
                raise RuntimeError(f"Failed to initialize Kokoro model pipeline: {e}")

    def synthesize(self, text: str, voice: str = "af_heart", speed: float = 1.0) -> bytes:
        self._ensure_model()
        import soundfile as sf

        generator = self._pipeline(text, voice=voice, speed=speed, split_pattern=r'\n+')
        audio_segments = []

        for _, _, audio in generator:
            audio_segments.append(audio)

        if not audio_segments:
            raise RuntimeError("Kokoro generated empty audio output.")

        import numpy as np
        combined = np.concatenate(audio_segments)

        buf = io.BytesIO()
        sf.write(buf, combined, 24000, format='WAV')
        return buf.getvalue()
