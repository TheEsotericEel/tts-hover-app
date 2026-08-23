import io
import wave
import math
import struct
from typing import List, Dict, Any
from .base import BaseTTSProvider

class MockNeuralProvider(BaseTTSProvider):
    """
    Zero-dependency mock neural TTS provider for testing M1.5 HTTP streaming.
    Generates a clean synthetic audio tone/pattern in WAV format.
    """

    @property
    def id(self) -> str:
        return "mock"

    @property
    def name(self) -> str:
        return "Mock Neural Engine (Zero-setup)"

    def list_voices(self) -> List[Dict[str, Any]]:
        return [
            {"id": "synth_lead", "name": "Synthetic Tone Alpha", "lang": "en-US"},
            {"id": "synth_warm", "name": "Synthetic Tone Beta", "lang": "en-AU"},
        ]

    def synthesize(self, text: str, voice: str = "synth_lead", speed: float = 1.0) -> bytes:
        sample_rate = 24000
        # Duration proportional to word count
        words = max(1, len(text.split()))
        duration_sec = max(0.4, (words * 0.25) / max(0.1, speed))
        total_samples = int(sample_rate * duration_sec)

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)  # Mono
            wav.setsampwidth(2)  # 16-bit
            wav.setframerate(sample_rate)

            # Generate pleasant melodic soft chime sequence
            base_freq = 440.0 if voice == "synth_lead" else 330.0
            frames = bytearray()

            for i in range(total_samples):
                t = float(i) / sample_rate
                # Frequency modulation to simulate syllable pulses
                freq = base_freq + 40.0 * math.sin(2.0 * math.pi * 4.0 * t)
                # Envelope decay to avoid clicking
                envelope = math.exp(-2.0 * (t % 0.3))
                val = int(16000.0 * envelope * math.sin(2.0 * math.pi * freq * t))
                val = max(-32767, min(32767, val))
                frames.extend(struct.pack("<h", val))

            wav.writeframes(frames)

        return buffer.getvalue()
