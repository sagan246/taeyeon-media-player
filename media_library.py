from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from metadata_browser import AUDIO_EXTENSIONS, Artwork, read_artwork, read_metadata
from metadata_editor_models import Interview, Track, Video


SCRIPT_DIR = Path(__file__).resolve().parent
SCAN_CACHE_PATH = SCRIPT_DIR / "taeyeon_media_player_scan_cache.json"
CACHE_DIR = SCRIPT_DIR / "taeyeon_media_player_cache"
ARTWORK_CACHE_DIR = CACHE_DIR / "artwork"
SCAN_CACHE_VERSION = 1
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".m2ts", ".mts", ".ts"}
VIDEO_THUMBNAIL_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


@dataclass
class LibrarySnapshot:
    tracks: list[Track]
    paths: list[Path]
    artwork: dict[int, Artwork]
    videos: list[Video]
    video_paths: list[Path]
    video_thumbnails: dict[int, Path]
    video_folder_covers: dict[str, Path]
    interviews: list[Interview]


class Library:
    """In-memory snapshot of the current media folders.

    The HTTP server reads from this object while scans happen under a lock.
    """

    def __init__(self, media_dir: Path) -> None:
        self.media_dir = media_dir
        self.music_dir = media_dir / "Music" if (media_dir / "Music").is_dir() else media_dir
        self.video_dir = media_dir / "Video"
        self.interviews_dir = media_dir / "(2021-2014) Interviews (txt)"
        self.tracks: list[Track] = []
        self.paths: list[Path] = []
        self.artwork: dict[int, Artwork] = {}
        self.videos: list[Video] = []
        self.video_paths: list[Path] = []
        self.video_thumbnails: dict[int, Path] = {}
        self.video_folder_covers: dict[str, Path] = {}
        self.interviews: list[Interview] = []
        self.lock = threading.Lock()
        self.refresh()

    def refresh(self) -> None:
        # Build fresh snapshots outside the lock, then swap them in quickly so
        # browser requests do not wait on a full media scan.
        snapshot = build_library_snapshot(self.music_dir, self.video_dir, self.interviews_dir)

        with self.lock:
            self.tracks = snapshot.tracks
            self.paths = snapshot.paths
            self.artwork = snapshot.artwork
            self.videos = snapshot.videos
            self.video_paths = snapshot.video_paths
            self.video_thumbnails = snapshot.video_thumbnails
            self.video_folder_covers = snapshot.video_folder_covers
            self.interviews = snapshot.interviews

    def path_for_id(self, track_id: int) -> Path | None:
        with self.lock:
            if 0 <= track_id < len(self.paths):
                return self.paths[track_id]
        return None

    def video_path_for_id(self, video_id: int) -> Path | None:
        with self.lock:
            if 0 <= video_id < len(self.video_paths):
                return self.video_paths[video_id]
        return None

    def album_paths_for_track(self, track_id: int) -> list[Path]:
        with self.lock:
            if not (0 <= track_id < len(self.tracks)):
                return []
            album = self.tracks[track_id].album
            if not album:
                return [self.paths[track_id]]
            return [
                path
                for track, path in zip(self.tracks, self.paths)
                if track.album == album
            ]

    def video_thumbnail_for_id(self, video_id: int) -> Path | None:
        with self.lock:
            return self.video_thumbnails.get(video_id)

    def video_folder_cover_for_folder(self, folder: str) -> Path | None:
        with self.lock:
            return self.video_folder_covers.get(folder)


def build_library_snapshot(music_dir: Path, video_dir: Path, interviews_dir: Path) -> LibrarySnapshot:
    """Scan each media source independently, then return one swappable snapshot."""
    # Music uses a metadata/artwork cache because tag reads are the expensive
    # part. Video and interview scans are lightweight path/text scans.
    cache = load_scan_cache()
    tracks, paths, artwork, next_cache = scan_music(music_dir, cache)
    videos, video_paths, video_thumbnails, video_folder_covers = scan_videos(video_dir)
    interviews = scan_interviews(interviews_dir)
    save_scan_cache(next_cache)
    return LibrarySnapshot(
        tracks=tracks,
        paths=paths,
        artwork=artwork,
        videos=videos,
        video_paths=video_paths,
        video_thumbnails=video_thumbnails,
        video_folder_covers=video_folder_covers,
        interviews=interviews,
    )


def load_scan_cache() -> dict[str, dict[str, object]]:
    if not SCAN_CACHE_PATH.exists():
        return {}
    try:
        data = json.loads(SCAN_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if data.get("version") != SCAN_CACHE_VERSION or not isinstance(data.get("files"), dict):
        return {}
    return data["files"]


def save_scan_cache(files: dict[str, dict[str, object]]) -> None:
    SCAN_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCAN_CACHE_PATH.write_text(
        json.dumps({"version": SCAN_CACHE_VERSION, "files": files}, ensure_ascii=False),
        encoding="utf-8",
    )


def scan_music(
    music_dir: Path,
    cache: dict[str, dict[str, object]],
) -> tuple[list[Track], list[Path], dict[int, Artwork], dict[str, dict[str, object]]]:
    # Metadata/artwork reads are the slow part. The scan cache lets playback and
    # refreshes stay quick unless a file's size or modified time actually changed.
    tracks: list[Track] = []
    paths: list[Path] = []
    artwork: dict[int, Artwork] = {}
    next_cache: dict[str, dict[str, object]] = {}
    audio_paths = audio_files(music_dir)

    for track_id, path in enumerate(audio_paths):
        stat = path.stat()
        relative_path = path.relative_to(music_dir).as_posix()
        file_cache = cached_audio_entry(cache.get(relative_path), stat)
        if file_cache is None:
            metadata = read_metadata(path)
            art = read_artwork(path)
            file_cache = {
                "size": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
                "metadata": metadata,
                "artwork_mime": art.mime if art else "",
                "artwork_file": cache_artwork_data(relative_path, art.data) if art else "",
            }
        else:
            file_cache = normalize_audio_cache(relative_path, file_cache)
        metadata = dict(file_cache.get("metadata", {}))
        art = artwork_from_cache(file_cache)
        next_cache[relative_path] = file_cache

        title = str(metadata.get("title", "") or path.stem)
        artist = str(metadata.get("artist", ""))
        album = str(metadata.get("album", ""))
        albumartist = str(metadata.get("albumartist", ""))
        date = str(metadata.get("date", ""))
        tracknumber = str(metadata.get("tracknumber", ""))
        genre = str(metadata.get("genre", ""))
        folder = str(Path(relative_path).parent).replace("\\", "/")
        if folder == ".":
            folder = "(root)"
        missing_fields = track_missing_fields(title, artist, album, date, tracknumber, genre, art is not None)
        review_flags = track_review_flags(title, artist, album, albumartist)
        if art:
            artwork[track_id] = art
        paths.append(path)
        tracks.append(
            Track(
                id=track_id,
                path=relative_path,
                filename=path.name,
                format=path.suffix.lower().lstrip("."),
                title=title,
                artist=artist,
                album=album,
                albumartist=albumartist,
                date=date,
                tracknumber=tracknumber,
                genre=genre,
                has_artwork=art is not None,
                artwork_url=f"/art/{track_id}?v={stat.st_mtime_ns}" if art else "",
                audio_url=f"/audio/{track_id}",
                size_mb=round(stat.st_size / 1024 / 1024, 2),
                folder=folder,
                missing_fields=missing_fields,
                review_flags=review_flags,
            )
        )
    return tracks, paths, artwork, next_cache


def audio_files(music_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in music_dir.rglob("*")
        if path.is_file()
        and path.suffix.lower() in AUDIO_EXTENSIONS
        and ".bak" not in path.name.lower()
    )


def cached_audio_entry(entry: dict[str, object] | None, stat) -> dict[str, object] | None:
    if not isinstance(entry, dict):
        return None
    if entry.get("size") != stat.st_size or entry.get("mtime_ns") != stat.st_mtime_ns:
        return None
    if not isinstance(entry.get("metadata"), dict):
        return None
    return entry


def normalize_audio_cache(relative_path: str, entry: dict[str, object]) -> dict[str, object]:
    # Older cache files stored artwork as base64 JSON. Move that data to a side
    # file once so the main cache stays small and fast to load.
    if entry.get("artwork_file") or not entry.get("artwork_data"):
        entry.pop("artwork_data", None)
        return entry
    data_text = str(entry.get("artwork_data", ""))
    try:
        data = base64.b64decode(data_text)
    except ValueError:
        data = b""
    entry.pop("artwork_data", None)
    entry["artwork_file"] = cache_artwork_data(relative_path, data) if data else ""
    return entry


def cache_artwork_data(relative_path: str, data: bytes) -> str:
    ARTWORK_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(relative_path.encode("utf-8")).hexdigest()
    cache_path = ARTWORK_CACHE_DIR / f"{digest}.bin"
    if not cache_path.exists() or cache_path.stat().st_size != len(data):
        cache_path.write_bytes(data)
    return cache_path.name


def artwork_from_cache(entry: dict[str, object]) -> Artwork | None:
    mime = str(entry.get("artwork_mime", ""))
    artwork_file = str(entry.get("artwork_file", ""))
    if not mime or not artwork_file:
        return None
    path = ARTWORK_CACHE_DIR / artwork_file
    if not path.is_file():
        return None
    data = path.read_bytes()
    if not data:
        return None
    return Artwork(mime=mime, data=data)


def scan_videos(video_dir: Path) -> tuple[list[Video], list[Path], dict[int, Path], dict[str, Path]]:
    # Video thumbnails are simple sidecar files next to videos/folders. We avoid
    # generating thumbnails here so scans stay predictable.
    video_paths = video_files(video_dir)
    videos: list[Video] = []
    video_thumbnails: dict[int, Path] = {}
    video_folder_covers: dict[str, Path] = {}
    for video_id, path in enumerate(video_paths):
        relative_path = path.relative_to(video_dir).as_posix()
        folder = str(Path(relative_path).parent).replace("\\", "/")
        if folder == ".":
            folder = "(root)"
        category = relative_path.split("/", 1)[0] if "/" in relative_path else "(root)"
        suffix = path.suffix.lower()
        thumbnail = find_video_thumbnail(path)
        folder_cover = find_video_folder_cover(path.parent)
        if folder_cover is not None:
            video_folder_covers[folder] = folder_cover
        if thumbnail is not None:
            video_thumbnails[video_id] = thumbnail
        videos.append(
            Video(
                id=video_id,
                path=relative_path,
                filename=path.name,
                title=path.stem,
                folder=folder,
                category=category,
                format=suffix.lstrip("."),
                size_mb=round(path.stat().st_size / 1024 / 1024, 2),
                video_url=f"/video/{video_id}",
                thumbnail_url=f"/video-thumb/{video_id}" if thumbnail is not None else "",
                has_thumbnail=thumbnail is not None,
                folder_cover_url=f"/video-folder-cover/{quote(folder, safe='/')}" if folder_cover is not None else "",
                has_folder_cover=folder_cover is not None,
                browser_friendly=suffix in {".mp4", ".m4v", ".mov", ".webm"},
            )
        )
    return videos, video_paths, video_thumbnails, video_folder_covers


def video_files(video_dir: Path) -> list[Path]:
    if not video_dir.is_dir():
        return []
    return sorted(
        path
        for path in video_dir.rglob("*")
        if path.is_file()
        and path.suffix.lower() in VIDEO_EXTENSIONS
        and ".bak" not in path.name.lower()
    )


def scan_interviews(interviews_dir: Path) -> list[Interview]:
    # Interviews are just local text files. The UI groups them by filename/year
    # instead of needing a separate database.
    interview_paths = interview_files(interviews_dir)
    interviews: list[Interview] = []
    for interview_id, path in enumerate(interview_paths):
        relative_path = path.relative_to(interviews_dir).as_posix()
        title_base = path.stem.replace("_", " ").strip()
        year_match = re.search(r"(19|20)\d{2}", title_base)
        year = year_match.group(0) if year_match else ""
        source = re.sub(r"^(19|20)\d{2}\s*", "", title_base).strip(" -_") or title_base
        try:
            content = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            content = path.read_text(encoding="cp949", errors="replace")
        interviews.append(
            Interview(
                id=interview_id,
                path=relative_path,
                filename=path.name,
                title=title_base,
                year=year,
                source=source,
                content=content,
            )
        )
    return interviews


def interview_files(interviews_dir: Path) -> list[Path]:
    if not interviews_dir.is_dir():
        return []
    return sorted(path for path in interviews_dir.rglob("*.txt") if path.is_file())


def track_missing_fields(
    title: str,
    artist: str,
    album: str,
    date: str,
    tracknumber: str,
    genre: str,
    has_artwork: bool,
) -> list[str]:
    # These drive the Health/Edit warnings. Listen Mode hides them so the player
    # stays focused on browsing and playback.
    missing = []
    for field, value in (
        ("title", title),
        ("artist", artist),
        ("album", album),
        ("date", date),
        ("tracknumber", tracknumber),
        ("genre", genre),
    ):
        if not value:
            missing.append(field)
    if not has_artwork:
        missing.append("artwork")
    return missing


def contains_cjk(value: str) -> bool:
    return any(
        "\u3040" <= char <= "\u30ff"
        or "\u3400" <= char <= "\u4dbf"
        or "\u4e00" <= char <= "\u9fff"
        or "\uac00" <= char <= "\ud7af"
        for char in value
    )


def track_review_flags(title: str, artist: str, album: str, albumartist: str) -> list[str]:
    flags = []
    artist_lower = artist.strip().lower()
    albumartist_lower = albumartist.strip().lower()
    if contains_cjk(title):
        flags.append("non-English title")
    if contains_cjk(album):
        flags.append("non-English album")
    if album.strip().lower() in {"tae", "unknown", "none"}:
        flags.append("suspicious album")
    if artist and "taeyeon" not in artist_lower and "generation" not in artist_lower:
        flags.append("artist review")
    if albumartist and "taeyeon" not in albumartist_lower and "generation" not in albumartist_lower:
        flags.append("album artist review")
    return flags


def find_video_thumbnail(path: Path) -> Path | None:
    # Individual video thumbnails are optional sidecars named like the video:
    # Example.mp4 can use Example.jpg, Example.png, or Example.webp.
    for extension in VIDEO_THUMBNAIL_EXTENSIONS:
        candidate = path.with_suffix(extension)
        if candidate.is_file():
            return candidate
    return None


def find_video_folder_cover(folder: Path) -> Path | None:
    # Folder covers are optional sidecars named cover.jpg/png/webp.
    for extension in VIDEO_THUMBNAIL_EXTENSIONS:
        candidate = folder / f"cover{extension}"
        if candidate.is_file():
            return candidate
    return None
