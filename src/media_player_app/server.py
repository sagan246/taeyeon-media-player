"""HTTP server composition and command-line startup.

The handler is intentionally a coordinator. Route behavior lives in focused
mixins for APIs, metadata editing, streaming, and shared HTTP mechanics.
"""

from __future__ import annotations

import argparse
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import unquote, urlparse

from .api_routes import ApiRoutesMixin
from .edit_routes import EditRoutesMixin
from .http_helpers import HttpHelpersMixin
from .listening_stats import ListeningStats
from .media_library import Library
from .playlist_store import PlaylistStore
from .server_config import (
    ASSET_DIR,
    AUDIO_DEBUG_LOG,
    DEFAULT_CONFIG,
    DEFAULT_MEDIA_DIR,
    FRONTEND_SCRIPT_FILES,
    FRONTEND_STYLE_FILES,
    HTML_PATH,
    RUNTIME_DIR,
    STATS_DB,
    PlayerConfig,
    load_config,
)
from .streaming import StreamingRoutesMixin


RouteHandler = Callable[[], None]


class Handler(EditRoutesMixin, ApiRoutesMixin, StreamingRoutesMixin, HttpHelpersMixin, BaseHTTPRequestHandler):
    """Compose the application route layers into one request handler."""

    library: Library
    listening_stats: ListeningStats
    playlist_store: PlaylistStore
    player_config = PlayerConfig()
    game_dir: Path | None = None
    editable = True
    playlist_editable = True
    web_share = False
    log_lock = threading.Lock()
    frontend_bundle: bytes | None = None
    frontend_style_bundle: bytes | None = None
    frontend_bundle_lock = threading.Lock()

    def log_message(self, format: str, *args: object) -> None:
        message = format % args
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{timestamp}] {self.client_address[0]} {message}\n"
        with self.log_lock:
            with AUDIO_DEBUG_LOG.open("a", encoding="utf-8") as log:
                log.write(line)

    def get_exact_routes(self, query_text: str) -> dict[str, RouteHandler]:
        return {
            "/": lambda: self.send_file(HTML_PATH),
            "/api/tracks": self.handle_tracks_api,
            "/api/config": self.handle_config_api,
            "/api/videos": self.handle_videos_api,
            "/api/interviews": self.handle_interviews_api,
            "/api/playlists": self.handle_playlists_api,
            "/api/listening-stats": lambda: self.handle_listening_stats_api(query_text),
            "/api/refresh": self.handle_refresh_api,
        }

    def get_prefix_routes(self, path_text: str, query_text: str) -> tuple[tuple[str, RouteHandler], ...]:
        return (
            ("/assets/", lambda: self.handle_asset(path_text)),
            ("/game/", lambda: self.handle_game_asset(path_text)),
            ("/art/", lambda: self.handle_art(path_text)),
            ("/art-thumb/", lambda: self.handle_art_thumbnail(path_text, query_text)),
            ("/audio/", lambda: self.handle_audio(path_text)),
            ("/lyrics/", lambda: self.handle_lyrics(path_text)),
            ("/video/", lambda: self.handle_video(path_text)),
            ("/video-thumb/", lambda: self.handle_video_thumbnail(path_text)),
            ("/video-folder-cover/", lambda: self.handle_video_folder_cover(path_text)),
        )

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if handler := self.get_exact_routes(parsed.query).get(parsed.path):
            handler()
            return
        for prefix, handler in self.get_prefix_routes(parsed.path, parsed.query):
            if parsed.path.startswith(prefix):
                handler()
                return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_asset(self, path_text: str) -> None:
        relative = unquote(path_text.removeprefix("/assets/"))
        if relative == "app-bundle.js":
            self.handle_frontend_bundle()
            return
        if relative == "styles-bundle.css":
            self.handle_frontend_style_bundle()
            return
        try:
            path = (ASSET_DIR / relative).resolve()
            path.relative_to(ASSET_DIR.resolve())
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_file(path, cache_control="no-cache")

    def handle_game_asset(self, path_text: str) -> None:
        """Serve an optional standalone game without exposing other local files."""
        if self.game_dir is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        relative = unquote(path_text.removeprefix("/game/")) or "index.html"
        try:
            game_root = self.game_dir.resolve()
            path = (game_root / relative).resolve()
            path.relative_to(game_root)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if path.is_dir():
            path /= "index.html"
        self.send_file(path, cache_control="no-cache")

    def handle_frontend_bundle(self) -> None:
        """Serve split frontend sources in one request for faster remote startup."""
        with self.frontend_bundle_lock:
            if self.frontend_bundle is None:
                chunks = []
                for filename in FRONTEND_SCRIPT_FILES:
                    source = (ASSET_DIR / filename).read_text(encoding="utf-8")
                    chunks.append(f"\n/* {filename} */\n{source}\n")
                type(self).frontend_bundle = "".join(chunks).encode("utf-8")
        self.send_compressible_bytes(
            self.frontend_bundle,
            "text/javascript; charset=utf-8",
            cache_control="no-cache",
        )

    def handle_frontend_style_bundle(self) -> None:
        """Serve split stylesheets in one compressed request."""
        with self.frontend_bundle_lock:
            if self.frontend_style_bundle is None:
                chunks = []
                for filename in FRONTEND_STYLE_FILES:
                    source = (ASSET_DIR / filename).read_text(encoding="utf-8")
                    chunks.append(f"\n/* {filename} */\n{source}\n")
                type(self).frontend_style_bundle = "".join(chunks).encode("utf-8")
        self.send_compressible_bytes(
            self.frontend_style_bundle,
            "text/css; charset=utf-8",
            cache_control="no-cache",
        )

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/listening-stats":
            self.handle_listening_stats_record()
            return
        if parsed.path.startswith("/api/playlists/") and parsed.path.endswith("/resume"):
            self.handle_playlist_resume(parsed.path)
            return
        if parsed.path == "/api/playlists":
            if self.require_playlist_access():
                self.handle_playlist_create()
            return
        if not self.require_edit_access():
            return
        if parsed.path == "/api/bulk/metadata":
            self.handle_bulk_metadata()
            return
        if parsed.path.startswith("/api/track/") and parsed.path.endswith("/artwork"):
            self.handle_artwork_update(parsed.path)
            return
        if parsed.path.startswith("/api/track/") and parsed.path.endswith("/metadata"):
            self.handle_track_metadata(parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not self.require_playlist_access():
            return
        if parsed.path.startswith("/api/playlists/"):
            self.handle_playlist_update(parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not self.require_playlist_access():
            return
        if parsed.path.startswith("/api/playlists/"):
            self.handle_playlist_delete(parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local media player.")
    parser.add_argument("--media-dir", default=DEFAULT_MEDIA_DIR, type=Path)
    parser.add_argument("--config", default=DEFAULT_CONFIG, type=Path, help="Optional JSON config file.")
    parser.add_argument("--read-only", action="store_true", help="Run without metadata editing.")
    parser.add_argument(
        "--web-share",
        action="store_true",
        help="Hide local paths and disable media-file edits for temporary sharing.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8766, type=int)
    return parser


def resolve_media_dir(value: Path, allowed_root: Path = DEFAULT_MEDIA_DIR) -> Path:
    """Resolve a media path and keep it inside the configured media root."""
    media_dir = value.expanduser().resolve()
    root = allowed_root.expanduser().resolve()
    if not (media_dir == root or root in media_dir.parents):
        raise SystemExit(f"Refusing to scan outside media folder: {root}")
    return media_dir


def main() -> int:
    args = build_parser().parse_args()
    media_dir = resolve_media_dir(args.media_dir)
    if not media_dir.is_dir():
        raise SystemExit(f"Media folder not found: {media_dir}")
    config = load_config(args.config)
    player_config = PlayerConfig.from_mapping(config)
    web_share = bool(config.get("web_share", False)) or args.web_share

    Handler.player_config = player_config
    configured_game_dir = player_config.game_path()
    Handler.game_dir = (
        configured_game_dir
        if configured_game_dir is not None and (configured_game_dir / "index.html").is_file()
        else None
    )
    Handler.web_share = web_share
    Handler.editable = bool(config.get("editable", True)) and not args.read_only and not web_share
    Handler.playlist_editable = bool(config.get("playlist_editable", True))
    Handler.library = Library(media_dir, player_config.library_config())
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    Handler.listening_stats = ListeningStats(STATS_DB)
    Handler.playlist_store = PlaylistStore(RUNTIME_DIR / "playlists.json")
    AUDIO_DEBUG_LOG.write_text(f"Audio debug log started {time.strftime('%Y-%m-%d %H:%M:%S')}\n", encoding="utf-8")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"{player_config.app_name} running at http://{args.host}:{args.port}/")
    print(f"Mode: {'web-share read-only' if Handler.web_share else 'editable' if Handler.editable else 'read-only'}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0
