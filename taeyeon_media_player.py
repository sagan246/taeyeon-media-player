#!/usr/bin/env python3
"""Local Taeyeon media player and optional metadata editor.

This app is intentionally local-only. It can edit common text metadata fields and
embedded artwork for MP3/FLAC files.
"""

from __future__ import annotations

import argparse
import hmac
import json
import mimetypes
import secrets
import sys
import threading
import time
from dataclasses import asdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parents[1]
DEFAULT_MEDIA_DIR = REPO_DIR / "media"
DEFAULT_CONFIG = SCRIPT_DIR / "taeyeon_media_player_config.json"
AUDIO_DEBUG_LOG = SCRIPT_DIR / "taeyeon_media_player_audio_debug.log"
VENDOR_DIR = SCRIPT_DIR / "vendor"
if VENDOR_DIR.exists():
    sys.path.insert(0, str(VENDOR_DIR))


from media_library import Library  # noqa: E402
from metadata_tag_tools import EDITABLE_FIELDS, decode_image_payload, save_artwork_for_paths, save_metadata  # noqa: E402


def content_type_for(path: Path) -> str:
    if path.suffix.lower() == ".flac":
        return "audio/flac"
    if path.suffix.lower() == ".m4a":
        return "audio/mp4"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def parse_range_header(range_header: str | None, file_size: int) -> tuple[HTTPStatus, int, int]:
    """Return the response status and byte span requested by a browser.

    Browsers usually request audio/video in byte ranges so they can begin
    playback quickly and seek without downloading the full file.
    """
    start = 0
    end = file_size - 1
    status = HTTPStatus.OK
    if range_header and range_header.startswith("bytes="):
        status = HTTPStatus.PARTIAL_CONTENT
        range_value = range_header.split("=", 1)[1].split(",", 1)[0].strip()
        raw_start, _, raw_end = range_value.partition("-")
        if raw_start:
            start = int(raw_start)
            end = int(raw_end) if raw_end else file_size - 1
        elif raw_end:
            suffix_length = int(raw_end)
            start = max(file_size - suffix_length, 0)
            end = file_size - 1

    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    return status, start, end


class Handler(BaseHTTPRequestHandler):
    library: Library
    editable = True
    edit_password = ""
    edit_tokens: set[str] = set()
    edit_auth_lock = threading.Lock()
    log_lock = threading.Lock()

    def log_message(self, format: str, *args: object) -> None:
        message = format % args
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{timestamp}] {self.client_address[0]} {message}\n"
        with self.log_lock:
            with AUDIO_DEBUG_LOG.open("a", encoding="utf-8") as log:
                log.write(line)

    def send_bytes(self, body: bytes, content_type: str, status: int = 200, cache_control: str = "no-store") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, payload: object, status: int = 200) -> None:
        self.send_bytes(json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", status)

    def send_ok(self, **payload: object) -> None:
        self.send_json({"ok": True, **payload})

    def send_error_json(self, error: str, status: HTTPStatus | int = HTTPStatus.BAD_REQUEST) -> None:
        self.send_json({"ok": False, "error": error}, status=status)

    def read_json_body(self) -> object:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8"))

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

    def edit_is_unlocked(self) -> bool:
        if not self.edit_password:
            return True
        token = self.headers.get("X-Edit-Token", "")
        with self.edit_auth_lock:
            return token in self.edit_tokens

    def require_edit_access(self) -> bool:
        # Every write route goes through this one gate. Listen/read-only mode can
        # still stream media, but metadata writes stop here.
        if not self.editable:
            self.send_error_json("This library is running in read-only mode.", status=HTTPStatus.FORBIDDEN)
            return False
        if not self.edit_is_unlocked():
            self.send_error_json("Edit mode is locked.", status=HTTPStatus.UNAUTHORIZED)
            return False
        return True

    def send_file(self, path: Path, cache_control: str = "no-store") -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_bytes(path.read_bytes(), content_type_for(path), cache_control=cache_control)

    def handle_tracks_api(self) -> None:
        with self.library.lock:
            tracks = [asdict(track) for track in self.library.tracks]
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
            videos = [asdict(video) for video in self.library.videos]
        self.send_json(
            {
                "videos": videos,
                "total": len(videos),
                "browser_friendly": sum(1 for video in videos if video["browser_friendly"]),
            }
        )

    def handle_interviews_api(self) -> None:
        with self.library.lock:
            interviews = [asdict(interview) for interview in self.library.interviews]
        self.send_json({"interviews": interviews, "total": len(interviews)})

    def do_GET(self) -> None:  # noqa: N802
        # Read routes: app shell, cached library data, artwork, and media streams.
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_file(HTML_PATH)
            return
        if parsed.path.startswith("/assets/"):
            self.handle_asset(parsed.path)
            return
        if parsed.path == "/api/tracks":
            self.handle_tracks_api()
            return
        if parsed.path == "/api/config":
            self.send_json({"editable": self.editable, "editRequiresPassword": bool(self.edit_password)})
            return
        if parsed.path == "/api/edit-status":
            self.send_ok(unlocked=self.edit_is_unlocked())
            return
        if parsed.path == "/api/videos":
            self.handle_videos_api()
            return
        if parsed.path == "/api/interviews":
            self.handle_interviews_api()
            return
        if parsed.path == "/api/refresh":
            self.library.refresh()
            self.send_ok()
            return
        if parsed.path.startswith("/art/"):
            self.handle_art(parsed.path)
            return
        if parsed.path.startswith("/audio/"):
            self.handle_audio(parsed.path)
            return
        if parsed.path.startswith("/video/"):
            self.handle_video(parsed.path)
            return
        if parsed.path.startswith("/video-thumb/"):
            self.handle_video_thumbnail(parsed.path)
            return
        if parsed.path.startswith("/video-folder-cover/"):
            self.handle_video_folder_cover(parsed.path)
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
        # Write routes: login first, then metadata/artwork changes behind the
        # edit gate above. Playback never needs POST.
        parsed = urlparse(self.path)
        if parsed.path == "/api/edit-login":
            self.handle_edit_login()
            return
        if parsed.path == "/api/edit-logout":
            self.handle_edit_logout()
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

    def handle_edit_login(self) -> None:
        # Edit tokens are kept in memory only. Restarting the server locks edit
        # mode again, which is a nice low-fuss safety reset.
        if not self.editable:
            self.send_error_json("This library is running in read-only mode.", status=HTTPStatus.FORBIDDEN)
            return
        if not self.edit_password:
            self.send_ok(token="")
            return
        try:
            payload = self.read_json_body()
            password = str(payload.get("password", "")) if isinstance(payload, dict) else ""
        except Exception:
            self.send_error_json("Invalid login request.", status=HTTPStatus.BAD_REQUEST)
            return
        if not hmac.compare_digest(password, self.edit_password):
            self.send_error_json("Wrong edit password.", status=HTTPStatus.UNAUTHORIZED)
            return
        token = secrets.token_urlsafe(32)
        with self.edit_auth_lock:
            self.edit_tokens.add(token)
        self.send_ok(token=token)

    def handle_edit_logout(self) -> None:
        token = self.headers.get("X-Edit-Token", "")
        if token:
            with self.edit_auth_lock:
                self.edit_tokens.discard(token)
        self.send_ok()

    def handle_track_metadata(self, path_text: str) -> None:
        track_id = self.parse_track_id_from_api_path(path_text)
        if track_id is None:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        path = self.library.path_for_id(track_id)
        if path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            payload = self.read_json_body()
            # Single-track edits write tags to disk, then refresh the scan cache
            # so the UI immediately reflects what is embedded in the file.
            result = save_metadata(path, payload)
            self.library.refresh()
            self.send_ok(**result)
        except Exception as exc:  # noqa: BLE001 - surface editor errors to UI.
            self.send_error_json(str(exc), status=500)

    def artwork_scope_paths(self, track_id: int, path: Path, payload: object) -> tuple[list[Path], str | None]:
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
        track_id = self.parse_track_id_from_api_path(path_text)
        if track_id is None:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        path = self.library.path_for_id(track_id)
        if path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            payload = self.read_json_body()
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
        try:
            payload = self.read_json_body()
            ids = [int(track_id) for track_id in payload.get("ids", [])]
            # Empty bulk fields are ignored, so accidentally blank text boxes do
            # not erase tags across many files.
            values = {
                field: str(payload.get("values", {}).get(field, "")).strip()
                for field in EDITABLE_FIELDS
                if str(payload.get("values", {}).get(field, "")).strip()
            }
            if not ids:
                self.send_error_json("No tracks selected", status=400)
                return
            if not values:
                self.send_error_json("No bulk fields provided", status=400)
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

    def handle_audio(self, path_text: str) -> None:
        track_id = self.parse_last_int(path_text)
        if track_id is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        path = self.library.path_for_id(track_id)
        if path is None or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.stream_file(path, label=f"audio track {track_id}", debug=True)

    def handle_video(self, path_text: str) -> None:
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


HTML_PATH = SCRIPT_DIR / "assets" / "index.html"
ASSET_DIR = SCRIPT_DIR / "assets"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local Taeyeon Media Player.")
    parser.add_argument("--media-dir", default=DEFAULT_MEDIA_DIR, type=Path)
    parser.add_argument("--config", default=DEFAULT_CONFIG, type=Path, help="Optional JSON config file.")
    parser.add_argument("--read-only", action="store_true", help="Run the library as a player without metadata editing.")
    parser.add_argument("--edit-password", default="", help="Require this password before Edit Mode can write metadata.")
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
    Handler.editable = bool(config.get("editable", True)) and not args.read_only
    Handler.edit_password = args.edit_password or str(config.get("edit_password", "") or "")
    Handler.edit_tokens = set()
    Handler.library = Library(media_dir)
    AUDIO_DEBUG_LOG.write_text(f"Audio debug log started {time.strftime('%Y-%m-%d %H:%M:%S')}\n", encoding="utf-8")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Taeyeon Media Player running at http://{args.host}:{args.port}/")
    print(f"Mode: {'editable' if Handler.editable else 'read-only'}")
    if Handler.editable and Handler.edit_password:
        print("Edit Mode: password protected")
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

