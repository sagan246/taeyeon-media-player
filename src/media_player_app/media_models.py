from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Track:
    """Audio track record returned by the library scan."""

    id: int
    path: str
    filename: str
    format: str
    title: str
    artist: str
    album: str
    albumartist: str
    date: str
    tracknumber: str
    genre: str
    has_artwork: bool
    artwork_url: str
    audio_url: str
    size_mb: float
    folder: str
    has_lyrics: bool
    lyrics_url: str
    lyrics_format: str
    missing_fields: list[str]
    review_flags: list[str]


@dataclass
class Video:
    """Video file or video-folder record returned by the library scan."""

    id: int
    path: str
    filename: str
    title: str
    folder: str
    category: str
    format: str
    size_mb: float
    video_url: str
    thumbnail_url: str
    has_thumbnail: bool
    folder_cover_url: str
    has_folder_cover: bool
    browser_friendly: bool


@dataclass
class Interview:
    """Plain-text archive record returned by the library scan."""

    id: int
    path: str
    filename: str
    title: str
    year: str
    source: str
    content: str
