#!/usr/bin/env python3
import sys
import os
import argparse

# Add tts-server root to python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server import run_server

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Point & Read TTS Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port number (default: 8000)")
    args = parser.parse_args()

    run_server(host=args.host, port=args.port)
