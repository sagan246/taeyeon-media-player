from __future__ import annotations

import base64
import re
from pathlib import Path

from mutagen import File  # type: ignore
from mutagen.easyid3 import EasyID3  # type: ignore
from mutagen.flac import FLAC, Picture  # type: ignore
from mutagen.id3 import APIC, ID3, ID3NoHeaderError  # type: ignore
from mutagen.mp4 import MP4  # type: ignore


EDITABLE_FIELDS = (
    "title",
    "artist",
    "album",
    "albumartist",
    "date",
    "tracknumber",
    "genre",
)


def load_editable_tags(path: Path):
    """! @brief Load a mutagen tag object suitable for writing common fields.

    MP3 files may not have an ID3 header yet, so this creates one before
    returning EasyID3. The caller is responsible for saving after changes.
    """
    suffix = path.suffix.lower()
    if suffix == ".mp3":
        try:
            return EasyID3(path)
        except ID3NoHeaderError:
            tags = EasyID3()
            tags.save(path)
            return EasyID3(path)
    if suffix == ".flac":
        return FLAC(path)
    if suffix in {".m4a", ".mp4"}:
        return MP4(path)
    audio = File(path, easy=True)
    if audio is None:
        raise ValueError(f"Unsupported file: {path}")
    return audio


def current_value(tags, field: str) -> str:
    """! @brief Return the first value for an editable tag field."""
    values = tags.get(field, [])
    return str(values[0]).strip() if values else ""


def save_metadata(path: Path, values: dict[str, str]) -> dict[str, object]:
    """! @brief Write common text metadata fields to one audio file.

    Empty values delete existing fields. Unsupported fields are ignored by
    design so UI payloads can include only the known EDITABLE_FIELDS.
    """
    clean_values = {
        field: str(values.get(field, "")).strip()
        for field in EDITABLE_FIELDS
        if field in values
    }
    tags = load_editable_tags(path)
    changed: list[str] = []
    for field, value in clean_values.items():
        before = current_value(tags, field)
        if value:
            if before != value:
                tags[field] = [value]
                changed.append(field)
        elif before:
            try:
                del tags[field]
                changed.append(field)
            except KeyError:
                pass

    if changed:
        tags.save()
    return {"changed": changed}


def decode_image_payload(payload: dict[str, object]) -> tuple[bytes, str]:
    """! @brief Decode and validate an artwork data URL from the browser."""
    image_data = str(payload.get("image_data", ""))
    match = re.match(r"^data:(image/[A-Za-z0-9.+-]+);base64,(.+)$", image_data, re.DOTALL)
    if not match:
        raise ValueError("Expected a base64 image data URL")
    mime = match.group(1).lower()
    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("Artwork must be JPG, PNG, or WEBP")
    try:
        data = base64.b64decode(match.group(2), validate=True)
    except ValueError as exc:
        raise ValueError("Artwork image could not be decoded") from exc
    if not data:
        raise ValueError("Artwork image is empty")
    return data, mime


def save_artwork(path: Path, image_data: bytes, mime: str) -> dict[str, object]:
    """! @brief Replace embedded cover art for a single MP3 or FLAC file."""
    suffix = path.suffix.lower()
    if suffix not in {".mp3", ".flac"}:
        return {"path": str(path), "ok": False, "error": "Only MP3 and FLAC artwork edits are supported"}

    if suffix == ".mp3":
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
        tags.delall("APIC")
        tags.add(
            APIC(
                encoding=3,
                mime=mime,
                type=3,
                desc="Cover",
                data=image_data,
            )
        )
        tags.save(path)
        return {"path": str(path), "ok": True}

    audio = FLAC(path)
    picture = Picture()
    picture.type = 3
    picture.mime = mime
    picture.desc = "Cover"
    picture.data = image_data
    audio.clear_pictures()
    audio.add_picture(picture)
    audio.save()
    return {"path": str(path), "ok": True}


def save_artwork_for_paths(paths: list[Path], image_data: bytes, mime: str) -> dict[str, object]:
    """! @brief Replace artwork for many files and return per-file results."""
    results = [save_artwork(path, image_data, mime) for path in paths]
    ok_count = sum(1 for result in results if result.get("ok"))
    return {"changed": ok_count, "results": results}
