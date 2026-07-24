# Security

This is a local-first personal media server, not a hardened public service.

## Boundaries

- The server binds to `127.0.0.1` by default.
- Media files are always read-only.
- Browser responses use opaque library IDs instead of filesystem paths.
- Media requests are validated against the configured library root.
- Python validates playlist data before persistence.

Playlists are application state, not media metadata. They may remain mutable in
Cloudflare sharing when `playlist_editable` is enabled. Cloudflare tunnels the
same player used locally; it is not a separate permission boundary.

## Recommendations

- Treat tunnel URLs like private links and stop them after use.
- Disable `playlist_editable` when shared users should not change playlists.
- Prefer LAN or a private network such as Tailscale for regular remote use.

Report security issues through the repository's GitHub issue tracker.
