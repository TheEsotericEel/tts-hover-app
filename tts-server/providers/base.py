from abc import ABC, abstractmethod
from typing import List, Dict, Any

class BaseTTSProvider(ABC):
    """
    Abstract Base Class for all TTS engine providers.
    All providers return raw WAV audio bytes from synthesize().
    """

    @property
    @abstractmethod
    def id(self) -> str:
        """Unique machine identifier (e.g. 'kokoro', 'melo', 'mock')."""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider display name."""
        pass

    @abstractmethod
    def list_voices(self) -> List[Dict[str, Any]]:
        """
        Returns list of voices available for this provider.
        Format: [{'id': 'af_heart', 'name': 'Heart (American Female)', 'lang': 'en-US'}]
        """
        pass

    @abstractmethod
    def synthesize(self, text: str, voice: str = "default", speed: float = 1.0) -> bytes:
        """
        Synthesizes text into WAV audio bytes.
        """
        pass
