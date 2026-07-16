"""Shared HTTP request and response helpers."""

from __future__ import annotations

import gzip
import json
import mimetypes
from http import HTTPStatus
from pathlib import Path


JsonObject = dict[str, object]
MAX_JSON_BODY_BYTES = 30 * 1024 * 1024


def content_type_for(path: Path) -> str:
    """Return the browser-facing MIME type for a local media file."""
    if path.suffix.lower() == ".flac":
        return "audio/flac"
    if path.suffix.lower() == ".m4a":
        return "audio/mp4"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


class HttpHelpersMixin:
    """Small, reusable helpers expected by all route mixins."""

    def send_bytes(self, body: bytes, content_type: str, status: int = 200, cache_control: str = "no-store") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(body)

    def send_compressible_bytes(
        self,
        body: bytes,
        content_type: str,
        status: int = 200,
        cache_control: str = "no-store",
    ) -> None:
        """Gzip larger text responses when the browser supports it."""
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "").lower()
        if len(body) <= 1024 or not accepts_gzip:
            self.send_bytes(body, content_type, status, cache_control)
            return

        compressed = gzip.compress(body, compresslevel=5)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(compressed)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(compressed)

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_compressible_bytes(body, "application/json; charset=utf-8", status)

    def send_ok(self, **payload: object) -> None:
        self.send_json({"ok": True, **payload})

    def send_error_json(self, error: str, status: HTTPStatus | int = HTTPStatus.BAD_REQUEST) -> None:
        self.send_json({"ok": False, "error": error}, status=status)

    def read_json_body(self) -> object:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_JSON_BODY_BYTES:
            raise ValueError("JSON request body size is invalid")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def read_json_object(self) -> JsonObject | None:
        try:
            payload = self.read_json_body()
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            self.send_error_json("Invalid JSON payload.", status=HTTPStatus.BAD_REQUEST)
            return None
        if not isinstance(payload, dict):
            self.send_error_json("JSON payload must be an object.", status=HTTPStatus.BAD_REQUEST)
            return None
        return payload

    @staticmethod
    def parse_last_int(path_text: str) -> int | None:
        try:
            return int(path_text.rsplit("/", 1)[-1])
        except ValueError:
            return None

    @staticmethod
    def parse_track_id_from_api_path(path_text: str) -> int | None:
        try:
            return int(path_text.split("/")[3])
        except (IndexError, ValueError):
            return None

    def resolve_track_path(self, track_id: int | None) -> Path | None:
        if track_id is None:
            return None
        path = self.library.path_for_id(track_id)
        if path is None or not path.is_file():
            return None
        return path

    def send_file(self, path: Path, cache_control: str = "no-store") -> None:
        """Send a small static file; large media uses the streaming pipeline."""
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_bytes(path.read_bytes(), content_type_for(path), cache_control=cache_control)
