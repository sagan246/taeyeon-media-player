#!/usr/bin/env python3
"""Local media player and optional metadata editor.

This app is intentionally local-only. It can edit common text metadata fields and
embedded artwork for MP3/FLAC files.
"""

from __future__ import annotations

import argparse
import gzip
import json
import mimetypes
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, unquote, urlparse


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
VENDOR_DIR = APP_ROOT / "vendor"
if VENDOR_DIR.exists():
    sys.path.insert(0, str(VENDOR_DIR))

JsonObject = dict[str, object]
RouteHandler = Callable[[], None]


from .media_library import Library, LibraryConfig  # noqa: E402
from .listening_stats import ListeningStats  # noqa: E402
from .metadata_tag_tools import (  # noqa: E402
    decode_image_payload,
    save_artwork_for_paths,
    save_metadata,
    validate_metadata_payload,
)
from .playlist_store import PlaylistError, PlaylistStore  # noqa: E402
try:  # noqa: E402
    from PIL import Image
except ImportError:  # noqa: E402
    Image = None


@dataclass(frozen=True)
class PlayerConfig:
    """! @brief User-facing config with safe defaults for this library."""

    app_name: str = "Local Media Player"
    music_dir: str = "Music"
    video_dir: str = "Video"
    text_dir: str = "Interviews"
    text_tab_label: str = "Interviews"
    preferred_categories: list[str] = field(default_factory=lambda: ["Albums", "Soundtracks", "Live", "Covers", "Features"])
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
        return LibraryConfig(
            music_dir=self.music_dir,
            video_dir=self.video_dir,
            text_dir=self.text_dir,
        )


def content_type_for(path: Path) -> str:
    """! @brief Return the browser-facing MIME type for a local media file."""
    if path.suffix.lower() == ".flac":
        return "audio/flac"
    if path.suffix.lower() == ".m4a":
        return "audio/mp4"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def config_string_list(data: dict[str, object], key: str, fallback: list[str]) -> list[str]:
    """! @brief Read a config list while ignoring blank/non-list values."""
    raw_value = data.get(key, fallback)
    if not isinstance(raw_value, list):
        return fallback
    values = [str(item).strip() for item in raw_value if str(item).strip()]
    return values or fallback


def parse_range_header(range_header: str | None, file_size: int) -> tuple[HTTPStatus, int, int]:
    """Return the response status and byte span requested by a browser.

    Browsers usually request audio/video in byte ranges so they can begin
    playback quickly and seek without downloading the full file.
    """
    if file_size <= 0:
        raise ValueError("Cannot serve a byte range from an empty file")
    start = 0
    end = file_size - 1
    status = HTTPStatus.OK
    if range_header:
        if not range_header.startswith("bytes="):
            raise ValueError("Unsupported Range unit")
        status = HTTPStatus.PARTIAL_CONTENT
        range_value = range_header.split("=", 1)[1].split(",", 1)[0].strip()
        if not range_value or "-" not in range_value:
            raise ValueError("Invalid byte range")
        raw_start, _, raw_end = range_value.partition("-")
        if raw_start:
            start = int(raw_start)
            end = int(raw_end) if raw_end else file_size - 1
        elif raw_end:
            suffix_length = int(raw_end)
            if suffix_length <= 0:
                raise ValueError("Invalid suffix byte range")
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
        else:
            raise ValueError("Invalid byte range")

        if start >= file_size or end < start:
            raise ValueError("Requested byte range is outside the file")

    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    return status, start, end


class Handler(BaseHTTPRequestHandler):
    """! @brief HTTP handler for the local player UI, streaming, and JSON APIs."""

    library: Library
    listening_stats: ListeningStats
    playlist_store: PlaylistStore
    player_config = PlayerConfig()
    editable = True
    playlist_editable = True
    web_share = False
    log_lock = threading.Lock()

    def log_message(self, format: str, *args: object) -> None:
        message = format % args
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{timestamp}] {self.client_address[0]} {message}\n"
        with self.log_lock:
            with AUDIO_DEBUG_LOG.open("a", encoding="utf-8") as log:
                log.write(line)

    def send_bytes(self, body: bytes, content_type: str, status: int = 200, cache_control: str = "no-store") -> None:
        """! @brief Send a complete byte payload with explicit HTTP headers."""
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, payload: object, status: int = 200) -> None:
        """! @brief Send a JSON response using the shared response helper."""
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if len(body) > 1024 and "gzip" in self.headers.get("Accept-Encoding", ""):
            compressed = gzip.compress(body, compresslevel=5)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
            self.send_header("Content-Length", str(len(compressed)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(compressed)
            return
        self.send_bytes(body, "application/json; charset=utf-8", status)

    def send_ok(self, **payload: object) -> None:
        self.send_json({"ok": True, **payload})

    def send_error_json(self, error: str, status: HTTPStatus | int = HTTPStatus.BAD_REQUEST) -> None:
        self.send_json({"ok": False, "error": error}, status=status)

    def read_json_body(self) -> object:
        """! @brief Decode the request body as JSON for POST endpoints."""
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def read_json_object(self) -> JsonObject | None:
        """! @brief Decode a POST body and require a JSON object payload."""
        try:
            payload = self.read_json_body()
        except json.JSONDecodeError:
            self.send_error_json("Invalid JSON payload.", status=HTTPStatus.BAD_REQUEST)
            return None
        if not isinstance(payload, dict):
            self.send_error_json("JSON payload must be an object.", status=HTTPStatus.BAD_REQUEST)
            return None
        return payload

    def parse_last_int(self, path_text: str) -> int | None:
        try:
            return int(path_text.rsplit("/", 1)[-1])
        except ValueError:
            return None

    def parse_track_id_from_api_path(self, path_text: str) -> int | None:
        try:
            return int(path_text.split("/")[3])
        except (IndexError, ValueError):
            return None

    def resolve_track_path(self, track_id: int | None) -> Path | None:
        """! @brief Resolve a track ID to a readable local file path."""
        if track_id is None:
            return None
        path = self.library.path_for_id(track_id)
        if path is None or not path.is_file():
            return None
        return path

    def require_edit_access(self) -> bool:
        # Every write route goes through this one gate. Listen/read-only mode can
        # still stream media, but metadata writes stop here.
        if not self.editable:
            self.send_error_json("This library is running in read-only mode.", status=HTTPStatus.FORBIDDEN)
            return False
        return True

    def require_playlist_access(self) -> bool:
        """Allow playlist changes independently from media metadata editing."""
        if not self.playlist_editable:
            self.send_error_json("Playlist changes are disabled for this server.", status=HTTPStatus.FORBIDDEN)
            return False
        return True

    def send_file(self, path: Path, cache_control: str = "no-store") -> None:
        """! @brief Send a small static file or cached image.

        Large media files use stream_file() instead so playback can begin before
        the whole file is read.
        """
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_bytes(path.read_bytes(), content_type_for(path), cache_control=cache_control)

    def handle_tracks_api(self) -> None:
        with self.library.lock:
            tracks = [self.public_track(track) for track in self.library.tracks]
        self.send_json(
            {
                "tracks": tracks,
                "total": len(tracks),
                "with_artwork": sum(1 for track in tracks if track["has_artwork"]),
                "missing_artwork": sum(1 for track in tracks if not track["has_artwork"]),
            }
        )

    def handle_videos_api(self) -> None:
        with self.library.lock:
            videos = [self.public_video(video) for video in self.library.videos]
        self.send_json(
            {
                "videos": videos,
                "total": len(videos),
                "browser_friendly": sum(1 for video in videos if video["browser_friendly"]),
            }
        )

    def handle_interviews_api(self) -> None:
        with self.library.lock:
            interviews = [self.public_interview(interview) for interview in self.library.interviews]
        self.send_json({"interviews": interviews, "total": len(interviews)})

    def handle_playlists_api(self) -> None:
        """! @brief Return playlists resolved against the current music scan."""
        playlists = self.playlist_store.list_for_library(self.library)
        self.send_json({"playlists": playlists, "total": len(playlists)})

    def handle_listening_stats_api(self, query_text: str) -> None:
        """! @brief Return summary-only listening stats for the Stats tab."""
        query = parse_qs(query_text)
        period = query.get("period", ["week"])[0]
        start = query.get("start", [None])[0]
        end = query.get("end", [None])[0]
        self.send_json(self.listening_stats.summary(period, start, end))

    def handle_config_api(self) -> None:
        """! @brief Return UI config and serving mode flags."""
        self.send_json(
            {
                "editable": self.editable,
                "playlistEditable": self.playlist_editable,
                "webShare": self.web_share,
                "appName": self.player_config.app_name,
                "textTabLabel": self.player_config.text_tab_label,
                "textDir": self.player_config.text_dir,
                "preferredCategories": self.player_config.preferred_categories,
                "preferredVideoCategories": self.player_config.preferred_video_categories,
            }
        )

    def handle_refresh_api(self) -> None:
        """! @brief Rescan the library cache after manual refresh."""
        self.library.refresh()
        self.send_ok()

    def public_track(self, track: object) -> dict[str, object]:
        """! @brief Return a track record safe for the active serving mode."""
        data = asdict(track)
        thumb_url = self.art_thumbnail_url(str(data.get("artwork_url", "")))
        data["artwork_thumb_url"] = thumb_url
        data["artwork_thumb_small_url"] = self.add_query_param(thumb_url, "s", str(ART_THUMB_ICON_SIZE))
        if self.web_share:
            data["path"] = ""
            data["filename"] = ""
            data["missing_fields"] = []
            data["review_flags"] = []
        return data

    def art_thumbnail_url(self, artwork_url: str) -> str:
        """! @brief Convert a full artwork URL into the cached thumbnail endpoint."""
        return artwork_url.replace("/art/", "/art-thumb/", 1) if artwork_url else ""

    def add_query_param(self, url: str, key: str, value: str) -> str:
        """! @brief Append one query parameter to a local URL without caring if it already has a query."""
        if not url:
            return ""
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}{key}={value}"

    def public_video(self, video: object) -> dict[str, object]:
        """! @brief Return a video record without local path details in web-share mode."""
        data = asdict(video)
        if self.web_share:
            data["path"] = ""
            data["filename"] = ""
        return data

    def public_interview(self, interview: object) -> dict[str, object]:
        """! @brief Return an interview record without source file names in web-share mode."""
        data = asdict(interview)
        if self.web_share:
            data["path"] = ""
            data["filename"] = ""
        return data

    def get_exact_routes(self, query_text: str) -> dict[str, RouteHandler]:
        """! @brief Routes that match one full request path."""
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
        """! @brief Routes that use an ID or relative path after a prefix."""
        return (
            ("/assets/", lambda: self.handle_asset(path_text)),
            ("/art/", lambda: self.handle_art(path_text)),
            ("/art-thumb/", lambda: self.handle_art_thumbnail(path_text, query_text)),
            ("/audio/", lambda: self.handle_audio(path_text)),
            ("/lyrics/", lambda: self.handle_lyrics(path_text)),
            ("/video/", lambda: self.handle_video(path_text)),
            ("/video-thumb/", lambda: self.handle_video_thumbnail(path_text)),
            ("/video-folder-cover/", lambda: self.handle_video_folder_cover(path_text)),
        )

    def get_post_routes(self) -> dict[str, RouteHandler]:
        """! @brief Editable JSON routes that do not need a track ID in the URL."""
        return {
            "/api/bulk/metadata": self.handle_bulk_metadata,
        }

    def do_GET(self) -> None:  # noqa: N802
        """! @brief Dispatch read-only routes: UI shell, APIs, artwork, and media streams."""
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
        try:
            path = (ASSET_DIR / relative).resolve()
            path.relative_to(ASSET_DIR.resolve())
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_file(path, cache_control="no-cache")

    def do_POST(self) -> None:  # noqa: N802
        """! @brief Dispatch write routes; playback and static APIs never need POST."""
        parsed = urlparse(self.path)
        if parsed.path == "/api/listening-stats":
            self.handle_listening_stats_record()
            return
        # Resume position is playback state, not metadata editing. Keeping this
        # route available in read-only mode lets a phone and desktop stay in sync.
        if parsed.path.startswith("/api/playlists/") and parsed.path.endswith("/resume"):
            self.handle_playlist_resume(parsed.path)
            return
        # Playlists are player state, so listen/read-only mode may manage them
        # without gaining access to metadata or embedded-artwork writes.
        if parsed.path == "/api/playlists":
            if self.require_playlist_access():
                self.handle_playlist_create()
            return
        if not self.require_edit_access():
            return

        if handler := self.get_post_routes().get(parsed.path):
            handler()
            return

        if parsed.path.startswith("/api/track/") and parsed.path.endswith("/artwork"):
            self.handle_artwork_update(parsed.path)
            return
        if parsed.path.startswith("/api/track/") and parsed.path.endswith("/metadata"):
            self.handle_track_metadata(parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:  # noqa: N802
        """! @brief Update a playlist when the server allows writes."""
        parsed = urlparse(self.path)
        if not self.require_playlist_access():
            return
        if parsed.path.startswith("/api/playlists/"):
            self.handle_playlist_update(parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:  # noqa: N802
        """! @brief Delete a playlist definition when the server allows writes."""
        parsed = urlparse(self.path)
        if not self.require_playlist_access():
            return
        if parsed.path.startswith("/api/playlists/"):
            self.handle_playlist_delete(parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_playlist_create(self) -> None:
        payload = self.read_json_object()
        if payload is None:
            return
        try:
            record = self.playlist_store.create(payload.get("name"), payload.get("track_ids"), self.library)
            self.send_ok(id=record["id"], name=record["name"])
        except PlaylistError as exc:
            self.send_error_json(str(exc))

    def handle_playlist_update(self, path_text: str) -> None:
        payload = self.read_json_object()
        if payload is None:
            return
        try:
            playlist_id = unquote(path_text.rsplit("/", 1)[-1])
            if "track_ids" in payload:
                record = self.playlist_store.replace_tracks(playlist_id, payload.get("track_ids"), self.library)
            elif "name" in payload:
                record = self.playlist_store.rename(playlist_id, payload.get("name"))
            else:
                raise PlaylistError("No playlist changes were provided.")
            self.send_ok(id=record["id"], name=record["name"])
        except PlaylistError as exc:
            self.send_error_json(str(exc))

    def handle_playlist_resume(self, path_text: str) -> None:
        payload = self.read_json_object()
        if payload is None:
            return
        try:
            playlist_id = unquote(path_text.removesuffix("/resume").rsplit("/", 1)[-1])
            self.playlist_store.set_resume(playlist_id, payload.get("track_id"), self.library)
            self.send_ok()
        except PlaylistError as exc:
            self.send_error_json(str(exc))

    def handle_playlist_delete(self, path_text: str) -> None:
        try:
            self.playlist_store.delete(unquote(path_text.rsplit("/", 1)[-1]))
            self.send_ok()
        except PlaylistError as exc:
            self.send_error_json(str(exc), status=HTTPStatus.NOT_FOUND)

    def handle_listening_stats_record(self) -> None:
        """! @brief Record compact playback stats without requiring Edit Mode."""
        try:
            payload = self.read_json_object()
            if payload is None:
                return
            result = self.listening_stats.record(payload)
            self.send_json(result)
        except Exception as exc:  # noqa: BLE001 - stats should fail visibly in dev logs.
            self.send_error_json(str(exc), status=500)

    def handle_track_metadata(self, path_text: str) -> None:
        """! @brief Update metadata tags for one track, then refresh the library."""
        track_id = self.parse_track_id_from_api_path(path_text)
        if track_id is None:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        path = self.resolve_track_path(track_id)
        if path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            payload = self.read_json_object()
            if payload is None:
                return
            # Single-track edits write tags to disk, then refresh the scan cache
            # so the UI immediately reflects what is embedded in the file.
            result = save_metadata(path, validate_metadata_payload(payload))
            self.library.refresh()
            self.send_ok(**result)
        except ValueError as exc:
            self.send_error_json(str(exc), status=HTTPStatus.BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001 - surface editor errors to UI.
            self.send_error_json(str(exc), status=500)

    def artwork_scope_paths(self, track_id: int, path: Path, payload: object) -> tuple[list[Path], str | None]:
        """! @brief Resolve an artwork write request into filesystem targets.

        @return Tuple of editable paths and an optional validation error.
        """
        if not isinstance(payload, dict):
            return [], "Invalid artwork request."
        scope = str(payload.get("scope", "song")).strip().lower()
        # Scope decides how far the chosen image spreads: one song, every track
        # in that album, or the currently selected rows in Edit Mode.
        if scope == "song":
            paths = [path]
        elif scope == "album":
            paths = list(self.library.album_paths_for_track(track_id))
        elif scope == "selected":
            ids = [int(item) for item in payload.get("ids", [])]
            paths = [
                selected_path
                for selected_id in ids
                if (selected_path := self.library.path_for_id(selected_id)) is not None
            ]
        else:
            return [], "Scope must be song, album, or selected"
        editable_paths = [candidate for candidate in paths if candidate.suffix.lower() in {".mp3", ".flac"}]
        return editable_paths, None

    def handle_artwork_update(self, path_text: str) -> None:
        """! @brief Replace embedded artwork for one song, album, or selection."""
        track_id = self.parse_track_id_from_api_path(path_text)
        if track_id is None:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        path = self.resolve_track_path(track_id)
        if path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            payload = self.read_json_object()
            if payload is None:
                return
            image_data, mime = decode_image_payload(payload)
            paths, error = self.artwork_scope_paths(track_id, path, payload)
            if error:
                self.send_error_json(error, status=400)
                return
            if not paths:
                self.send_error_json("No MP3/FLAC files found for artwork update", status=400)
                return
            # Artwork writes can touch many files, so this is intentionally
            # isolated from normal metadata edits and refreshes after success.
            result = save_artwork_for_paths(paths, image_data, mime)
            self.library.refresh()
            self.send_ok(**result)
        except Exception as exc:  # noqa: BLE001 - surface artwork errors to UI.
            self.send_error_json(str(exc), status=500)

    def handle_bulk_metadata(self) -> None:
        """! @brief Apply non-empty metadata fields to selected tracks."""
        try:
            payload = self.read_json_object()
            if payload is None:
                return
            ids = [int(track_id) for track_id in payload.get("ids", [])]
            # Empty bulk fields are ignored, so accidentally blank text boxes do
            # not erase tags across many files.
            values = validate_metadata_payload(payload.get("values"), allow_empty_values=False)
            if not ids:
                self.send_error_json("No tracks selected", status=400)
                return
            results = []
            for track_id in ids:
                path = self.library.path_for_id(track_id)
                if path is None:
                    results.append({"id": track_id, "ok": False, "error": "Track not found"})
                    continue
                try:
                    result = save_metadata(path, values)
                    results.append({"id": track_id, "ok": True, **result})
                except Exception as exc:  # noqa: BLE001 - continue other selected tracks.
                    results.append({"id": track_id, "ok": False, "error": str(exc)})
            self.library.refresh()
            self.send_ok(results=results)
        except ValueError as exc:
            self.send_error_json(str(exc), status=HTTPStatus.BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001
            self.send_error_json(str(exc), status=500)

    def handle_art(self, path_text: str) -> None:
        track_id = self.parse_last_int(path_text)
        if track_id is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        with self.library.lock:
            artwork = self.library.artwork.get(track_id)
        if artwork is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_bytes(artwork.data, artwork.mime, cache_control="public, max-age=86400")

    def handle_art_thumbnail(self, path_text: str, query_text: str) -> None:
        """! @brief Serve a small cached JPEG thumbnail for album/list artwork."""
        track_id = self.parse_last_int(path_text)
        if track_id is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        with self.library.lock:
            artwork = self.library.artwork.get(track_id)
        if artwork is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if Image is None:
            self.send_bytes(artwork.data, artwork.mime, cache_control="public, max-age=86400")
            return

        query = parse_qs(query_text)
        version = "".join(ch for ch in query.get("v", ["0"])[0] if ch.isalnum())[:32] or "0"
        size = self.thumbnail_size(query)
        cache_path = ART_THUMB_CACHE_DIR / f"{track_id}-{version}-{size}.jpg"
        if cache_path.is_file():
            self.send_file(cache_path, cache_control="public, max-age=604800")
            return

        try:
            ART_THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            with Image.open(BytesIO(artwork.data)) as image:
                image = image.convert("RGB")
                image.thumbnail((size, size), Image.Resampling.LANCZOS)
                output = BytesIO()
                image.save(output, format="JPEG", quality=82, optimize=True, progressive=True)
            cache_path.write_bytes(output.getvalue())
            self.send_bytes(output.getvalue(), "image/jpeg", cache_control="public, max-age=604800")
        except Exception:
            # If Pillow cannot decode a rare embedded image, fall back to original art.
            self.send_bytes(artwork.data, artwork.mime, cache_control="public, max-age=86400")

    def thumbnail_size(self, query: dict[str, list[str]]) -> int:
        """! @brief Clamp requested artwork thumbnails to the sizes useful for this UI."""
        try:
            requested_size = int(query.get("s", [str(ART_THUMB_DISPLAY_SIZE)])[0])
        except ValueError:
            requested_size = ART_THUMB_DISPLAY_SIZE
        return max(64, min(requested_size, ART_THUMB_DISPLAY_SIZE))

    def handle_audio(self, path_text: str) -> None:
        """! @brief Stream audio by track ID without reading tags during playback."""
        track_id = self.parse_last_int(path_text)
        path = self.resolve_track_path(track_id)
        if path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.stream_file(path, label=f"audio track {track_id}", debug=True)

    def handle_lyrics(self, path_text: str) -> None:
        """! @brief Return local lyrics text for one track when a sidecar exists."""
        track_id = self.parse_last_int(path_text)
        if track_id is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        with self.library.lock:
            lyrics = self.library.lyrics.get(track_id, "")
            lyrics_format = self.library.lyrics_formats.get(track_id, "text")
        if not lyrics:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_json({"lyrics": lyrics, "format": lyrics_format})

    def handle_video(self, path_text: str) -> None:
        """! @brief Stream video by ID using the shared range-aware pipeline."""
        video_id = self.parse_last_int(path_text)
        if video_id is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        path = self.library.video_path_for_id(video_id)
        if path is None or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.stream_file(path, label=f"video {video_id}", debug=False)

    def send_stream_headers(self, path: Path, status: HTTPStatus, start: int, end: int, file_size: int) -> None:
        """! @brief Send HTTP headers for full or partial media responses."""
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", content_type_for(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "public, max-age=86400")
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

    def write_file_range(self, path: Path, start: int, length: int, label: str, request_started: float, debug: bool) -> None:
        """! @brief Copy a byte range from disk to the response stream."""
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            first_write = True
            try:
                while remaining > 0:
                    chunk = handle.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    if first_write:
                        first_write = False
                        if debug:
                            elapsed_ms = (time.perf_counter() - request_started) * 1000
                            self.log_message("%s first bytes sent in %.1fms (%s bytes)", label, elapsed_ms, len(chunk))
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                # Browsers often close range requests once they have enough buffered data.
                return

    def stream_file(self, path: Path, label: str, debug: bool = False) -> None:
        """! @brief Stream audio/video with HTTP Range support for fast playback."""
        # Stream directly from disk with Range support. This is what keeps large
        # FLAC files seekable and lets browsers start before the whole file loads.
        request_started = time.perf_counter()
        file_size = path.stat().st_size
        range_header = self.headers.get("Range")
        try:
            status, start, end = parse_range_header(range_header, file_size)
        except ValueError:
            self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            return
        length = end - start + 1
        if debug:
            self.log_message(
                "%s request received path=%s range=%s start=%s end=%s size=%s",
                label,
                path.name,
                range_header or "none",
                start,
                end,
                file_size,
            )
            self.log_message("%s starting response status=%s content_length=%s", label, int(status), length)
        self.send_stream_headers(path, status, start, end, file_size)
        self.write_file_range(path, start, length, label, request_started, debug)

    def handle_video_thumbnail(self, path_text: str) -> None:
        video_id = self.parse_last_int(path_text)
        if video_id is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        path = self.library.video_thumbnail_for_id(video_id)
        if path is None or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_bytes(path.read_bytes(), content_type_for(path), cache_control="public, max-age=86400")

    def handle_video_folder_cover(self, path_text: str) -> None:
        folder = unquote(path_text.removeprefix("/video-folder-cover/"))
        path = self.library.video_folder_cover_for_folder(folder)
        if path is None or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_bytes(path.read_bytes(), content_type_for(path), cache_control="public, max-age=86400")


HTML_PATH = APP_ROOT / "assets" / "index.html"
ASSET_DIR = APP_ROOT / "assets"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local media player.")
    parser.add_argument("--media-dir", default=DEFAULT_MEDIA_DIR, type=Path)
    parser.add_argument("--config", default=DEFAULT_CONFIG, type=Path, help="Optional JSON config file.")
    parser.add_argument("--read-only", action="store_true", help="Run the library as a player without metadata editing.")
    parser.add_argument(
        "--web-share",
        action="store_true",
        help="Run an internet-shareable mode that hides local paths and disables media-file edits.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8766, type=int)
    return parser


def resolve_media_dir(value: Path) -> Path:
    media_dir = value.expanduser().resolve()
    allowed_root = DEFAULT_MEDIA_DIR.resolve()
    if not (media_dir == allowed_root or allowed_root in media_dir.parents):
        raise SystemExit(f"Refusing to scan outside media folder: {allowed_root}")
    return media_dir


def load_config(path: Path) -> dict[str, object]:
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


def main() -> int:
    args = build_parser().parse_args()
    media_dir = resolve_media_dir(args.media_dir)
    if not media_dir.is_dir():
        raise SystemExit(f"Media folder not found: {media_dir}")
    config = load_config(args.config)
    player_config = PlayerConfig.from_mapping(config)
    web_share = bool(config.get("web_share", False)) or args.web_share
    Handler.player_config = player_config
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


if __name__ == "__main__":
    raise SystemExit(main())

