#!/usr/bin/env python3
"""Command-line entry point for the local media player."""

from __future__ import annotations

import sys
from pathlib import Path


SRC_DIR = Path(__file__).resolve().parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from media_player_app.media_player import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())

