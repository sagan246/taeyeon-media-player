# Architecture

The app is a Python web server with a plain HTML/CSS/JavaScript frontend.

```text
Browser UI
  -> media_player.py
  -> src/media_player_app/media_player.py
  -> src/media_player_app/media_library.py
  -> src/media_player_app/media_models.py

Metadata writes:
Browser UI -> media_player.py -> src/media_player_app/metadata_tag_tools.py -> MP3/FLAC files

Stats:
Browser UI -> media_player.py -> src/media_player_app/listening_stats.py -> SQLite

Playlists:
Browser UI -> media_player.py -> src/media_player_app/playlist_store.py -> runtime/playlists.json
```

## Repository Layout

- `media_player.py` - command-line entry point.
- `launcher_gui.py` - GUI launcher entry point.
- `src/media_player_app/` - Python application package.
- `assets/` - browser UI, JavaScript, and CSS.
- `docs/` - project documentation.
- `windows_commands/` and `mac_commands/` - one-click launchers.
- `runtime/` - ignored local caches, logs, and SQLite state.

## Backend

- `src/media_player_app/media_player.py` - server, routes, APIs, streaming, edit/read-only gates.
- `src/media_player_app/media_library.py` - scans music, videos, lyrics, artwork, and text files.
- `src/media_player_app/media_models.py` - shared data records.
- `src/media_player_app/metadata_tag_tools.py` - MP3/FLAC metadata and artwork writes.
- `src/media_player_app/metadata_browser.py` - audio metadata/artwork reading helpers.
- `src/media_player_app/listening_stats.py` - playback stats stored in SQLite.
- `src/media_player_app/playlist_store.py` - named playlists and shared resume tracks stored as relative track references.
- `src/media_player_app/launcher_gui.py` - optional launcher for access modes.

## Frontend

`assets/app.js` coordinates shared state and rendering. Domain modules keep
music/video persistence, stats date math, playlists, metadata payloads, and app
startup independently testable and easier to change without cross-tab drift.

- `assets/index.html` - app shell.
- `assets/app.js` - stateful coordinator, rendering, and event wiring.
- `assets/*-domain.js` - music/video state, stats ranges, playlists, edit payloads,
  and startup boundaries.
- `assets/components.js` - shared UI helpers.
- `assets/music-components.js` - music rendering.
- `assets/playlist-components.js` - playlist cards and detail views.
- `assets/video-components.js` - video rendering.
- `assets/queue-components.js` - music/video queues.
- `assets/now-playing-components.js` - Now Playing screen.
- `assets/stats-components.js` - stats screen.
- `assets/lyrics.js` - text and LRC lyric handling.
- `assets/theme-data.js` / `assets/theme-engine.js` - themes.

## Styles

`assets/styles.css` imports focused files from `assets/styles/`:

- `themes.css`
- `base.css`
- `album-focus.css`
- `shared-panels.css`
- `music.css`
- `player-queue-now-playing.css`
- `video.css`
- `health-stats-interviews.css`
- `responsive.css`

## Key APIs

- `GET /api/config`
- `GET /api/tracks`
- `GET /api/videos`
- `GET /api/interviews`
- `GET /api/listening-stats`
- `GET /api/playlists`
- `GET /audio/<track-id>`
- `GET /video/<video-id>`
- `GET /lyrics/<track-id>`
- `POST /api/listening-stats`
- `POST /api/playlists`
- `POST /api/playlists/<playlist-id>/resume`
- `PATCH /api/playlists/<playlist-id>`
- `DELETE /api/playlists/<playlist-id>`
- `POST /api/track/<track-id>/metadata`
- `POST /api/track/<track-id>/artwork`
- `POST /api/bulk/metadata`

Metadata write APIs are disabled in read-only and web-share modes. Playlist
management and resume updates remain available because they are player state;
`playlist_editable` can disable playlist changes independently when needed.

## Streaming

Audio and video use HTTP Range requests.

This lets large files start quickly, seek correctly, and stream from disk without
loading the full file into memory.

Playback routes should not parse metadata or artwork. That work belongs in the
library scan cache.

## Checks

```powershell
python -m compileall -q media_player.py launcher_gui.py src tests
python -m pytest
Get-ChildItem assets -Filter *.js | ForEach-Object { node --check $_.FullName }
```
