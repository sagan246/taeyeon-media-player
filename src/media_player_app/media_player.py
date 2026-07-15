"""Backward-compatible public entry point for the media player server.

Backend implementation is split into focused modules. Re-exports here preserve
existing launcher commands and third-party imports.
"""

from __future__ import annotations

from pathlib import Path

from .server import Handler, build_parser, main
from .server import resolve_media_dir as _resolve_media_dir
from .server_config import DEFAULT_CONFIG, DEFAULT_MEDIA_DIR, PlayerConfig, load_config
from .streaming import parse_range_header


def resolve_media_dir(value: Path) -> Path:
    """Compatibility wrapper that honors a patched module-level default root."""
    return _resolve_media_dir(value, DEFAULT_MEDIA_DIR)


__all__ = [
    "DEFAULT_CONFIG",
    "DEFAULT_MEDIA_DIR",
    "Handler",
    "PlayerConfig",
    "build_parser",
    "load_config",
    "main",
    "parse_range_header",
    "resolve_media_dir",
]


if __name__ == "__main__":
    raise SystemExit(main())
