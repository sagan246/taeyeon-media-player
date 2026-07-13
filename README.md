# Media Player

A local-first web media player for a personal music, video, lyrics, and text
archive.

It runs on your computer, streams local files to a browser, and can optionally
be shared on a home network, private remote network, or temporary read-only web
link.

## Features

- Browse music by album, category, year, and section
- Browse folder-based video collections with optional cover artwork
- Read local text archives
- Display plain text and timed `.lrc` lyrics
- Music and video queues with resume support
- Now Playing screen with artwork, lyrics, controls, and visualizers
- Listening stats by day, week, month, year, and all time
- Optional MP3/FLAC metadata and artwork editing
- Desktop and mobile browser UI

Media files are **not included** in this repository.

## Getting Started

Use the included launcher:

Windows:

```text
windows_commands/start_launcher.cmd
```

macOS:

```text
mac_commands/start_launcher.command
```

If macOS blocks the launcher, run once:

```bash
chmod +x mac_commands/start_launcher.command mac_commands/start_player.command
```

Editable mode uses port `8766`. Read-only web-share mode uses port `8767`.

For a simple local editable start without the launcher, use:

```text
windows_commands/start_player.cmd
mac_commands/start_player.command
```

## Command Line

Editable local mode:

```powershell
python media_player.py --media-dir <media-folder> --host 127.0.0.1 --port 8766
```

```text
http://127.0.0.1:8766/
```

Home network mode:

```powershell
python media_player.py --media-dir <media-folder> --host 0.0.0.0 --port 8766
```

```text
http://<lan-address>:8766/
```

## Edit Mode

Edit Mode allows supported audio metadata and embedded artwork to be updated
from the browser.

Supported edits include:

- Title
- Artist
- Album
- Album Artist
- Track Number
- Date
- Genre
- Embedded Artwork

Edit Mode writes directly to MP3 and FLAC files. Use a copy or backup of your
media if you are experimenting.

## Configuration

Start from the example config:

```powershell
copy media_player_config.example.json media_player_config.json
```

More detail:

- [Usage](docs/USAGE.md)
- [Design Notes](docs/DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
