#!/usr/bin/env python3
"""Local read-only web UI for browsing audio metadata and embedded artwork."""

from __future__ import annotations

import argparse
import html
import json
import sys
import threading
import webbrowser
from dataclasses import asdict, dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


APP_ROOT = Path(__file__).resolve().parents[2]
REPO_DIR = APP_ROOT.parents[1]
DEFAULT_MEDIA_DIR = REPO_DIR / "media"
VENDOR_DIR = APP_ROOT / "vendor"
if VENDOR_DIR.exists():
    sys.path.insert(0, str(VENDOR_DIR))

from mutagen import File  # type: ignore  # noqa: E402
from mutagen.flac import FLAC  # type: ignore  # noqa: E402
from mutagen.id3 import ID3, APIC  # type: ignore  # noqa: E402
from mutagen.mp4 import MP4, MP4Cover  # type: ignore  # noqa: E402


AUDIO_EXTENSIONS = {".flac", ".mp3", ".m4a", ".mp4"}


@dataclass
class Track:
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
    size_mb: float


@dataclass
class Artwork:
    data: bytes
    mime: str


class Library:
    def __init__(self, media_dir: Path) -> None:
        self.media_dir = media_dir
        self.tracks: list[Track] = []
        self.artwork: dict[int, Artwork] = {}
        self.lock = threading.Lock()
        self.refresh()

    def refresh(self) -> None:
        tracks: list[Track] = []
        artwork: dict[int, Artwork] = {}
        audio_paths = sorted(
            path
            for path in self.media_dir.rglob("*")
            if path.is_file()
            and path.suffix.lower() in AUDIO_EXTENSIONS
            and ".bak" not in path.name.lower()
        )

        for track_id, path in enumerate(audio_paths):
            metadata = read_metadata(path)
            art = read_artwork(path)
            if art:
                artwork[track_id] = art
            tracks.append(
                Track(
                    id=track_id,
                    path=path.relative_to(self.media_dir).as_posix(),
                    filename=path.name,
                    format=path.suffix.lower().lstrip("."),
                    title=metadata.get("title", "") or path.stem,
                    artist=metadata.get("artist", ""),
                    album=metadata.get("album", ""),
                    albumartist=metadata.get("albumartist", ""),
                    date=metadata.get("date", ""),
                    tracknumber=metadata.get("tracknumber", ""),
                    genre=metadata.get("genre", ""),
                    has_artwork=art is not None,
                    artwork_url=f"/art/{track_id}" if art else "",
                    size_mb=round(path.stat().st_size / 1024 / 1024, 2),
                )
            )

        with self.lock:
            self.tracks = tracks
            self.artwork = artwork


def first_value(audio: object, keys: list[str]) -> str:
    for key in keys:
        try:
            values = audio.get(key, [])  # type: ignore[attr-defined]
        except Exception:
            values = []
        if values:
            return str(values[0]).strip()
    return ""


def read_metadata(path: Path) -> dict[str, str]:
    audio = File(path, easy=True)
    if audio is None:
        return {}
    return {
        "title": first_value(audio, ["title"]),
        "artist": first_value(audio, ["artist"]),
        "album": first_value(audio, ["album"]),
        "albumartist": first_value(audio, ["albumartist", "album_artist"]),
        "date": first_value(audio, ["date", "originaldate", "year"]),
        "tracknumber": first_value(audio, ["tracknumber", "track"]),
        "genre": first_value(audio, ["genre"]),
    }


def read_artwork(path: Path) -> Artwork | None:
    suffix = path.suffix.lower()
    try:
        if suffix == ".flac":
            audio = FLAC(path)
            if audio.pictures:
                picture = audio.pictures[0]
                return Artwork(data=picture.data, mime=picture.mime or "image/jpeg")

        if suffix == ".mp3":
            tags = ID3(path)
            for frame in tags.values():
                if isinstance(frame, APIC):
                    return Artwork(data=frame.data, mime=frame.mime or "image/jpeg")

        if suffix in {".m4a", ".mp4"}:
            audio = MP4(path)
            covers = audio.tags.get("covr", []) if audio.tags else []
            if covers:
                cover = covers[0]
                image_format = getattr(cover, "imageformat", None)
                mime = "image/png" if image_format == MP4Cover.FORMAT_PNG else "image/jpeg"
                return Artwork(data=bytes(cover), mime=mime)
    except Exception:
        return None
    return None


def page_html() -> bytes:
    return HTML.encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    library: Library

    def log_message(self, format: str, *args: object) -> None:
        return

    def send_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_bytes(page_html(), "text/html; charset=utf-8")
            return

        if parsed.path == "/api/tracks":
            with self.library.lock:
                tracks = [asdict(track) for track in self.library.tracks]
            body = json.dumps(
                {
                    "tracks": tracks,
                    "total": len(tracks),
                    "with_artwork": sum(1 for track in tracks if track["has_artwork"]),
                    "missing_artwork": sum(1 for track in tracks if not track["has_artwork"]),
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_bytes(body, "application/json; charset=utf-8")
            return

        if parsed.path == "/api/refresh":
            self.library.refresh()
            self.send_bytes(b'{"ok":true}', "application/json; charset=utf-8")
            return

        if parsed.path.startswith("/art/"):
            try:
                track_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            with self.library.lock:
                artwork = self.library.artwork.get(track_id)
            if artwork is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self.send_bytes(artwork.data, artwork.mime)
            return

        self.send_error(HTTPStatus.NOT_FOUND)


HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Metadata Browser</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --text: #22211f;
      --muted: #6f6a63;
      --line: #dedbd2;
      --accent: #2f6f6d;
      --missing: #b13f3f;
      --ok: #2f704a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 3;
      background: rgba(247, 247, 244, 0.96);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(10px);
    }
    .bar {
      display: grid;
      grid-template-columns: minmax(240px, 1fr) auto auto auto;
      gap: 12px;
      align-items: center;
      padding: 14px 18px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }
    input, select, button {
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel);
      color: var(--text);
      padding: 0 10px;
      font: inherit;
    }
    input { width: min(420px, 42vw); }
    button {
      cursor: pointer;
      background: var(--accent);
      color: white;
      border-color: var(--accent);
      font-weight: 650;
    }
    .stats {
      display: flex;
      gap: 16px;
      padding: 0 18px 14px;
      color: var(--muted);
      flex-wrap: wrap;
    }
    .stat strong { color: var(--text); }
    main {
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 18px;
      padding: 18px;
      align-items: start;
    }
    .tableWrap {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 9px 10px;
      text-align: left;
      vertical-align: middle;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #efeee8;
      color: #45423d;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    tr { cursor: pointer; }
    tr:hover, tr.selected { background: #f2f7f6; }
    .coverThumb {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      object-fit: cover;
      background: #e8e4dc;
      display: block;
    }
    .noArt {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      display: grid;
      place-items: center;
      background: #eee8de;
      color: var(--missing);
      font-weight: 800;
    }
    .titleCell {
      font-weight: 650;
      max-width: 330px;
    }
    .pathCell {
      color: var(--muted);
      font-size: 12px;
      max-width: 380px;
      word-break: break-word;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      height: 23px;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: #e9f4ee;
      color: var(--ok);
    }
    .pill.missing {
      background: #f8e6e3;
      color: var(--missing);
    }
    aside {
      position: sticky;
      top: 119px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-height: 360px;
    }
    .bigCover {
      width: 100%;
      aspect-ratio: 1 / 1;
      border-radius: 8px;
      object-fit: cover;
      background: #eee8de;
      margin-bottom: 14px;
    }
    .emptyCover {
      display: grid;
      place-items: center;
      color: var(--missing);
      font-weight: 800;
      font-size: 18px;
    }
    .detailTitle {
      font-size: 20px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .metaGrid {
      display: grid;
      gap: 8px;
    }
    .metaRow {
      display: grid;
      grid-template-columns: 92px 1fr;
      gap: 10px;
      border-top: 1px solid var(--line);
      padding-top: 8px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .value { word-break: break-word; }
    .hidden { display: none !important; }
    @media (max-width: 980px) {
      .bar { grid-template-columns: 1fr; }
      input { width: 100%; }
      main { grid-template-columns: 1fr; }
      aside { position: static; }
      th { top: 0; }
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <h1>Metadata Browser</h1>
      <input id="search" placeholder="Search title, artist, album, path">
      <select id="artFilter">
        <option value="all">All artwork</option>
        <option value="with">With artwork</option>
        <option value="missing">Missing artwork</option>
      </select>
      <button id="refresh">Refresh</button>
    </div>
    <div class="stats" id="stats"></div>
  </header>
  <main>
    <section class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Art</th>
            <th>Title</th>
            <th>Artist</th>
            <th>Album</th>
            <th>Date</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
    <aside id="detail">
      <div class="bigCover emptyCover">Select a song</div>
    </aside>
  </main>
  <script>
    let tracks = [];
    let selectedId = null;
    const rowsEl = document.getElementById("rows");
    const statsEl = document.getElementById("stats");
    const detailEl = document.getElementById("detail");
    const searchEl = document.getElementById("search");
    const artFilterEl = document.getElementById("artFilter");

    function esc(value) {
      return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[c]));
    }

    function filteredTracks() {
      const q = searchEl.value.trim().toLowerCase();
      const art = artFilterEl.value;
      return tracks.filter(track => {
        if (art === "with" && !track.has_artwork) return false;
        if (art === "missing" && track.has_artwork) return false;
        if (!q) return true;
        return [track.title, track.artist, track.album, track.date, track.path]
          .join(" ").toLowerCase().includes(q);
      });
    }

    function renderStats(list) {
      const total = tracks.length;
      const withArt = tracks.filter(t => t.has_artwork).length;
      const missing = total - withArt;
      statsEl.innerHTML = `
        <span class="stat"><strong>${total}</strong> tracks</span>
        <span class="stat"><strong>${withArt}</strong> with artwork</span>
        <span class="stat"><strong>${missing}</strong> missing artwork</span>
        <span class="stat"><strong>${list.length}</strong> shown</span>
      `;
    }

    function renderRows() {
      const list = filteredTracks();
      renderStats(list);
      rowsEl.innerHTML = list.map(track => `
        <tr data-id="${track.id}" class="${track.id === selectedId ? "selected" : ""}">
          <td>${track.has_artwork
            ? `<img class="coverThumb" src="${track.artwork_url}" alt="">`
            : `<span class="noArt">?</span>`}</td>
          <td class="titleCell">${esc(track.title)}<br><span class="pill ${track.has_artwork ? "" : "missing"}">${track.has_artwork ? "Art" : "No art"}</span></td>
          <td>${esc(track.artist)}</td>
          <td>${esc(track.album)}</td>
          <td>${esc(track.date)}</td>
          <td class="pathCell">${esc(track.path)}</td>
        </tr>
      `).join("");
      for (const row of rowsEl.querySelectorAll("tr")) {
        row.addEventListener("click", () => selectTrack(Number(row.dataset.id)));
      }
    }

    function selectTrack(id) {
      selectedId = id;
      const track = tracks.find(t => t.id === id);
      if (!track) return;
      detailEl.innerHTML = `
        ${track.has_artwork
          ? `<img class="bigCover" src="${track.artwork_url}" alt="">`
          : `<div class="bigCover emptyCover">No Artwork</div>`}
        <div class="detailTitle">${esc(track.title)}</div>
        <div class="metaGrid">
          ${detailRow("Artist", track.artist)}
          ${detailRow("Album", track.album)}
          ${detailRow("Album Artist", track.albumartist)}
          ${detailRow("Date", track.date)}
          ${detailRow("Track", track.tracknumber)}
          ${detailRow("Genre", track.genre)}
          ${detailRow("Format", track.format.toUpperCase())}
          ${detailRow("Size", `${track.size_mb} MB`)}
          ${detailRow("Path", track.path)}
        </div>
      `;
      renderRows();
    }

    function detailRow(label, value) {
      return `<div class="metaRow"><div class="label">${esc(label)}</div><div class="value">${esc(value || "—")}</div></div>`;
    }

    async function loadTracks(refresh = false) {
      if (refresh) {
        await fetch("/api/refresh");
      }
      const response = await fetch("/api/tracks");
      const data = await response.json();
      tracks = data.tracks;
      renderRows();
      if (selectedId !== null && tracks.some(t => t.id === selectedId)) {
        selectTrack(selectedId);
      }
    }

    searchEl.addEventListener("input", renderRows);
    artFilterEl.addEventListener("change", renderRows);
    document.getElementById("refresh").addEventListener("click", () => loadTracks(true));
    loadTracks();
  </script>
</body>
</html>
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a local metadata browser UI.")
    parser.add_argument("--media-dir", default=DEFAULT_MEDIA_DIR, type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--open", action="store_true", help="Open in the default browser.")
    return parser


def resolve_media_dir(value: Path) -> Path:
    media_dir = value.expanduser().resolve()
    allowed_root = DEFAULT_MEDIA_DIR.resolve()
    if not (media_dir == allowed_root or allowed_root in media_dir.parents):
        raise SystemExit(f"Refusing to scan outside media folder: {allowed_root}")
    return media_dir


def main() -> int:
    args = build_parser().parse_args()
    media_dir = resolve_media_dir(args.media_dir)
    if not media_dir.is_dir():
        raise SystemExit(f"Media folder not found: {media_dir}")

    Handler.library = Library(media_dir)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Metadata browser running at {url}")
    print("Press Ctrl+C to stop.")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
