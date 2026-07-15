"""Metadata and embedded-artwork write routes.

All risky media-file writes live here and remain behind one edit-access gate.
"""

from __future__ import annotations

from http import HTTPStatus
from pathlib import Path

from .metadata_tag_tools import decode_image_payload, save_artwork_for_paths, save_metadata, validate_metadata_payload


class EditRoutesMixin:
    """Routes that modify MP3/FLAC files on disk."""

    def require_edit_access(self) -> bool:
        if not self.editable:
            self.send_error_json("This library is running in read-only mode.", status=HTTPStatus.FORBIDDEN)
            return False
        return True

    def handle_track_metadata(self, path_text: str) -> None:
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
            result = save_metadata(path, validate_metadata_payload(payload))
            self.library.refresh()
            self.send_ok(**result)
        except ValueError as exc:
            self.send_error_json(str(exc), status=HTTPStatus.BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001 - surface editor errors to the UI.
            self.send_error_json(str(exc), status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def artwork_scope_paths(self, track_id: int, path: Path, payload: object) -> tuple[list[Path], str | None]:
        if not isinstance(payload, dict):
            return [], "Invalid artwork request."
        scope = str(payload.get("scope", "song")).strip().lower()
        if scope == "song":
            paths = [path]
        elif scope == "album":
            paths = list(self.library.album_paths_for_track(track_id))
        elif scope == "selected":
            try:
                ids = [int(item) for item in payload.get("ids", [])]
            except (TypeError, ValueError):
                return [], "Selected track IDs must be integers."
            paths = [
                selected_path
                for selected_id in ids
                if (selected_path := self.library.path_for_id(selected_id)) is not None
            ]
        else:
            return [], "Scope must be song, album, or selected"
        return [candidate for candidate in paths if candidate.suffix.lower() in {".mp3", ".flac"}], None

    def handle_artwork_update(self, path_text: str) -> None:
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
                self.send_error_json(error)
                return
            if not paths:
                self.send_error_json("No MP3/FLAC files found for artwork update")
                return
            result = save_artwork_for_paths(paths, image_data, mime)
            self.library.refresh()
            self.send_ok(**result)
        except Exception as exc:  # noqa: BLE001 - surface artwork errors to the UI.
            self.send_error_json(str(exc), status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_bulk_metadata(self) -> None:
        try:
            payload = self.read_json_object()
            if payload is None:
                return
            ids = [int(track_id) for track_id in payload.get("ids", [])]
            values = validate_metadata_payload(payload.get("values"), allow_empty_values=False)
            if not ids:
                self.send_error_json("No tracks selected")
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
                except Exception as exc:  # noqa: BLE001 - continue with other selected tracks.
                    results.append({"id": track_id, "ok": False, "error": str(exc)})
            self.library.refresh()
            self.send_ok(results=results)
        except (TypeError, ValueError) as exc:
            self.send_error_json(str(exc), status=HTTPStatus.BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001
            self.send_error_json(str(exc), status=HTTPStatus.INTERNAL_SERVER_ERROR)
