# Taeyeon Media Player

This is the clean copy of the media player app.

## Start

Use:

```text
G:\cod\start_taeyeon_media_player.cmd
```

## Source Files

```text
taeyeon_media_player.py      Server, API routes, streaming, edit routes
media_library.py             Music/video/interview scanning and artwork cache
metadata_editor_models.py    Track, Video, and Interview data models
metadata_tag_tools.py        MP3/FLAC metadata and artwork writing
metadata_browser.py          Audio metadata and artwork reading
assets\index.html            Browser app shell
assets\app.js                UI, playback, queues, mobile behavior
assets\styles.css            Visual design and responsive layout
vendor\                      Bundled Python dependencies
```

## Generated When Running

These may appear after launch and are safe to regenerate:

```text
taeyeon_media_player_cache\
taeyeon_media_player_scan_cache.json
taeyeon_media_player_audio_debug.log
__pycache__\
```

## Notes

The old `G:\cod\programs\codex` folder is the workbench/archive with helper scripts, reports, and older versions. This folder is the clean app copy.

