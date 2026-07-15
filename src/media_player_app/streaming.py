"""Range-aware media streaming and cached artwork delivery."""

from __future__ import annotations

import time
from http import HTTPStatus
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, unquote

from .http_helpers import content_type_for
from .server_config import ART_THUMB_CACHE_DIR, ART_THUMB_DISPLAY_SIZE

try:
    from PIL import Image
except ImportError:
    Image = None


def parse_range_header(range_header: str | None, file_size: int) -> tuple[HTTPStatus, int, int]:
    """Return response status and byte span requested by a browser."""
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


class StreamingRoutesMixin:
    """Artwork, lyrics, thumbnail, audio, and video delivery routes."""

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
            body = output.getvalue()
            cache_path.write_bytes(body)
            self.send_bytes(body, "image/jpeg", cache_control="public, max-age=604800")
        except Exception:
            # Rare embedded image formats should not make artwork disappear.
            self.send_bytes(artwork.data, artwork.mime, cache_control="public, max-age=86400")

    @staticmethod
    def thumbnail_size(query: dict[str, list[str]]) -> int:
        try:
            requested_size = int(query.get("s", [str(ART_THUMB_DISPLAY_SIZE)])[0])
        except ValueError:
            requested_size = ART_THUMB_DISPLAY_SIZE
        return max(64, min(requested_size, ART_THUMB_DISPLAY_SIZE))

    def handle_audio(self, path_text: str) -> None:
        track_id = self.parse_last_int(path_text)
        path = self.resolve_track_path(track_id)
        if path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.stream_file(path, label=f"audio track {track_id}", debug=True)

    def handle_lyrics(self, path_text: str) -> None:
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
        """Copy one byte range directly from disk to the response stream."""
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
                # Browsers routinely cancel a Range request after buffering enough.
                return

    def stream_file(self, path: Path, label: str, debug: bool = False) -> None:
        """Stream media from disk with Range support; never load it all in memory."""
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
