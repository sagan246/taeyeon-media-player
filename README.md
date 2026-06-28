# Taeyeon Media Player

A local-first web media player for a Taeyeon-focused music/video archive.

It scans local folders, reads audio metadata and embedded artwork, plays music and
videos from your own machine, and optionally edits MP3/FLAC metadata.

Media files are **not included**.

## Features

- Music library with album/category browsing
- Video library with folder-style "video albums"
- Interview/text-file reader
- Queue support for music and video
- Mobile-friendly listening UI
- Now Playing screen with visualizer
- HTTP Range streaming for fast FLAC/video playback and seeking
- Optional edit mode for MP3/FLAC metadata and embedded artwork
- Library health view for missing artwork, dates, and review flags

## Expected Folder Layout

Point the app at a media folder. The app works best with this shape:

```text
media/
  Music/
    Taeyeon Official/
    Taeyeon OST/
    Girls' Generation/
  Video/
    Taeyeon Concert/
    ...
  (2021-2014) Interviews (txt)/
    2021 Interview Name.txt
```

Video folder covers can be added by placing one of these files inside a video
folder:

```text
cover.jpg
cover.png
cover.webp
```

## Start

Run the server with Python:

```powershell
python taeyeon_media_player.py --media-dir G:\cod\media --host 127.0.0.1 --port 8766
```

Then open:

```text
http://127.0.0.1:8766/
```

To allow another device on your home network, bind to all interfaces:

```powershell
python taeyeon_media_player.py --media-dir G:\cod\media --host 0.0.0.0 --port 8766
```

Then open the computer's LAN IP from the other device.

## Edit Mode

Edit mode can write directly to MP3 and FLAC files.

Supported edits:

- title
- artist
- album
- album artist
- date
- track number
- genre
- embedded artwork

Use a copy or backup of your media if you are experimenting.

## Configuration

Copy the example config if you want to customize edit behavior:

```powershell
copy taeyeon_media_player_config.example.json taeyeon_media_player_config.json
```

The local config file is ignored by git.

## Generated Files

These files/folders are created while running and are safe to regenerate:

```text
taeyeon_media_player_cache/
taeyeon_media_player_scan_cache.json
taeyeon_media_player_audio_debug.log
__pycache__/
```

## Source Map

```text
taeyeon_media_player.py      Server, API routes, streaming, edit routes
media_library.py             Music/video/interview scanning and artwork cache
metadata_editor_models.py    Track, Video, and Interview data models
metadata_tag_tools.py        MP3/FLAC metadata and artwork writing
metadata_browser.py          Audio metadata and artwork reading
assets/index.html            Browser app shell
assets/app.js                UI, playback, queues, mobile behavior
assets/styles.css            Visual design and responsive layout
```

## Developer Docs

The source includes Doxygen-style comments and a `Doxyfile`.

To generate local HTML docs, install Doxygen and run:

```powershell
doxygen Doxyfile
```

Generated docs go to:

```text
docs/doxygen/html/
```

## Notes

This app is designed for personal/local media libraries. It does not upload your
media anywhere. If you expose it outside your home network, add your own access
controls and be careful with edit mode.
