"""Server paths and user-facing configuration.

Keeping configuration separate lets the HTTP server focus on coordinating
requests instead of also owning filesystem defaults and config parsing.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
REPO_DIR = APP_ROOT.parents[1]
RUNTIME_DIR = APP_ROOT / "runtime"
DEFAULT_MEDIA_DIR = REPO_DIR / "media"
DEFAULT_CONFIG = APP_ROOT / "media_player_config.json"
AUDIO_DEBUG_LOG = RUNTIME_DIR / "media_player_audio_debug.log"
STATS_DB = RUNTIME_DIR / "media_player_stats.sqlite3"
ART_THUMB_CACHE_DIR = RUNTIME_DIR / "media_player_cache" / "art_thumbs"
ART_THUMB_DISPLAY_SIZE = 512
ART_THUMB_ICON_SIZE = 96
HTML_PATH = APP_ROOT / "assets" / "index.html"
ASSET_DIR = APP_ROOT / "assets"
VENDOR_DIR = APP_ROOT / "vendor"

# A bundled dependency directory is optional. Normal installations use the
# dependencies declared in pyproject.toml instead.
if VENDOR_DIR.exists() and str(VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(VENDOR_DIR))

from .media_library import LibraryConfig  # noqa: E402


def config_string_list(data: dict[str, object], key: str, fallback: list[str]) -> list[str]:
    """Read a config list while ignoring blank and non-list values."""
    raw_value = data.get(key, fallback)
    if not isinstance(raw_value, list):
        return fallback
    values = [str(item).strip() for item in raw_value if str(item).strip()]
    return values or fallback


@dataclass(frozen=True)
class PlayerConfig:
    """User-facing configuration with conservative defaults."""

    app_name: str = "Local Media Player"
    music_dir: str = "Music"
    video_dir: str = "Video"
    text_dir: str = "Interviews"
    text_tab_label: str = "Interviews"
    preferred_categories: list[str] = field(
        default_factory=lambda: ["Albums", "Soundtracks", "Live", "Covers", "Features"]
    )
    preferred_video_categories: list[str] = field(default_factory=lambda: ["Concerts"])

    @classmethod
    def from_mapping(cls, data: dict[str, object]) -> "PlayerConfig":
        defaults = cls()

        def text_value(key: str, fallback: str) -> str:
            value = data.get(key, fallback)
            return str(value).strip() or fallback

        return cls(
            app_name=text_value("app_name", defaults.app_name),
            music_dir=text_value("music_dir", defaults.music_dir),
            video_dir=text_value("video_dir", defaults.video_dir),
            text_dir=text_value("text_dir", defaults.text_dir),
            text_tab_label=text_value("text_tab_label", defaults.text_tab_label),
            preferred_categories=config_string_list(data, "preferred_categories", defaults.preferred_categories),
            preferred_video_categories=config_string_list(
                data, "preferred_video_categories", defaults.preferred_video_categories
            ),
        )

    def library_config(self) -> LibraryConfig:
        """Translate player configuration into scanner configuration."""
        return LibraryConfig(music_dir=self.music_dir, video_dir=self.video_dir, text_dir=self.text_dir)


def load_config(path: Path) -> dict[str, object]:
    """Load an optional JSON config file and require an object at its root."""
    config_path = path.expanduser().resolve()
    if not config_path.exists():
        return {}
    try:
        with config_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Config file is not valid JSON: {config_path}\n{exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"Config file must contain a JSON object: {config_path}")
    return data
