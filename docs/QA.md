# QA Checklist

## Startup

- Start the player on port `8766`.
- Start a Cloudflare tunnel and confirm it reaches that same server.
- Confirm desktop and mobile pages load.
- Confirm browser API responses identify media with library IDs.
- Refresh the library twice quickly and confirm only one scan runs.
- Confirm `/api/refresh` reports scan timings and current item counts.

## Music

- Switch newest, oldest, sections, and year views.
- Play an album and an individual track.
- Verify Next, Previous, repeat, queue reorder, and queue resume.
- Create, update, rename, open, and delete a playlist.
- Refresh and confirm current track and queue resume.
- Check artwork, lyrics, visualizer, volume, and lock-screen controls.

## Video

- Open a video folder and play a video.
- Switch tabs and confirm the paused video returns.
- Reorder and resume the video queue.
- Test a browser-friendly MP4 on mobile.

## Other Tabs

- Open, shuffle, and restore an interview.
- Check Day, Week, Month, Year, and All Time stats.
- Switch light/dark and accent themes.
- Open the Game and verify normal, paused, and cat modes.

## Regression Checks

- Audio and video seeking returns HTTP `206` for Range requests.
- Full playback returns `200`, `Accept-Ranges`, and the correct content length.
- HEAD and invalid Range requests return headers without streaming a body.
- Canceling playback does not print a server traceback.
- Playing media does not trigger tag or artwork parsing.
- Artwork loads from the scan cache without retaining every cover in memory.
- Missing optional folders produce usable empty states.
- Invalid playlist IDs and track IDs return JSON errors without server traces.

## Automated Checks

```powershell
python -m compileall -q src tests
python -m pytest
node --test
git diff --check
```
