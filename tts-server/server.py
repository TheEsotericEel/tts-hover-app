import io
import json
import logging
from typing import Dict, Any, Optional
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from providers.base import BaseTTSProvider
from providers.mock_neural import MockNeuralProvider
from providers.kokoro import KokoroProvider
from providers.melo import MeloProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("TTSServer")

# Registry of active providers
PROVIDERS: Dict[str, BaseTTSProvider] = {
    "mock": MockNeuralProvider(),
    "kokoro": KokoroProvider(),
    "melo": MeloProvider(),
}

def get_provider(provider_id: Optional[str]) -> BaseTTSProvider:
    if not provider_id or provider_id not in PROVIDERS:
        return PROVIDERS["mock"]
    return PROVIDERS[provider_id]

# ---------------------------------------------------------------------------
# FastAPI Application (Standard production ASGI mode)
# ---------------------------------------------------------------------------
try:
    from fastapi import FastAPI, HTTPException, Query, Response
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel

    class SpeakRequest(BaseModel):
        text: str
        provider: Optional[str] = "mock"
        voice: Optional[str] = "default"
        speed: Optional[float] = 1.0

    app = FastAPI(title="Point & Read TTS Server", version="0.1.0")

    # Allow all extension origins and localhost
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "available_providers": [p.id for p in PROVIDERS.values()],
        }

    @app.get("/providers")
    async def list_providers():
        return {
            "providers": [{"id": p.id, "name": p.name} for p in PROVIDERS.values()]
        }

    @app.get("/voices")
    async def list_voices(provider: Optional[str] = Query(None)):
        target = get_provider(provider)
        return {
            "provider": target.id,
            "provider_name": target.name,
            "voices": target.list_voices(),
        }

    @app.post("/speak")
    async def speak(req: SpeakRequest):
        if not req.text or not req.text.strip():
            raise HTTPException(status_code=400, detail="Empty text provided")

        provider = get_provider(req.provider)
        try:
            audio_bytes = provider.synthesize(
                text=req.text,
                voice=req.voice or "default",
                speed=req.speed or 1.0,
            )
            return Response(content=audio_bytes, media_type="audio/wav")
        except Exception as e:
            logger.error(f"Synthesis failed with provider '{provider.id}': {e}")
            raise HTTPException(status_code=500, detail=str(e))

    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False
    app = None


# ---------------------------------------------------------------------------
# Zero-Dependency Fallback HTTP Server (stdlib)
# ---------------------------------------------------------------------------
class FallbackHTTPHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            resp = {"status": "ok", "available_providers": [p.id for p in PROVIDERS.values()]}
            self.wfile.write(json.dumps(resp).encode("utf-8"))

        elif path == "/providers":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            resp = {"providers": [{"id": p.id, "name": p.name} for p in PROVIDERS.values()]}
            self.wfile.write(json.dumps(resp).encode("utf-8"))

        elif path == "/voices":
            prov_id = query.get("provider", [None])[0]
            target = get_provider(prov_id)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            resp = {
                "provider": target.id,
                "provider_name": target.name,
                "voices": target.list_voices(),
            }
            self.wfile.write(json.dumps(resp).encode("utf-8"))

        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/speak":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")

            try:
                data = json.loads(body)
                text = data.get("text", "")
                provider_id = data.get("provider", "mock")
                voice = data.get("voice", "default")
                speed = float(data.get("speed", 1.0))

                provider = get_provider(provider_id)
                audio_bytes = provider.synthesize(text=text, voice=voice, speed=speed)

                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(audio_bytes)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(audio_bytes)
            except Exception as e:
                logger.error(f"Fallback synthesis error: {e}")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()

    def log_message(self, format, *args):
        logger.info("%s - - [%s] %s" % (self.client_address[0], self.log_date_time_string(), format % args))


def run_server(host: str = "127.0.0.1", port: int = 8000):
    if HAS_FASTAPI:
        import uvicorn
        logger.info(f"Starting FastAPI TTS server on http://{host}:{port}")
        uvicorn.run(app, host=host, port=port, log_level="info")
    else:
        logger.info(f"FastAPI not detected. Starting Zero-Dependency Standard HTTP server on http://{host}:{port}")
        server = HTTPServer((host, port), FallbackHTTPHandler)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            logger.info("Server stopped.")
            server.server_close()
