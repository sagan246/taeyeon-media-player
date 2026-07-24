# Design

The player is a personal, local-first media library built around quick browsing
and reliable playback on desktop and mobile.

## Principles

- Keep playback controls familiar and immediately reachable.
- Let artwork, titles, lyrics, and media take visual priority.
- Keep media files read-only.
- Use one shared visual language across music, video, text, queues, and detail
  screens.
- Keep mobile layouts touch-friendly without duplicating application behavior.
- Preserve fast startup and Range-aware streaming for large local files.

## Access

- One player server handles local, LAN, Tailscale, and Cloudflare access.
- Browsers use library IDs rather than filesystem paths.
- Cloudflare tunnels the running server; it does not launch another app.

Themes change presentation only. Access and media behavior must not depend on a
theme.
