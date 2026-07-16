# Built-in Game

A small dependency-free touch game embedded in the media player. The game is
served from `/game/` and receives current album artwork from the parent player.

The piece selector cycles through three modes:

- Preset photos
- Plain green pieces
- Current album artwork

The preset-photo mode optionally uses these local files:

```text
game/assets/photo-grid.png
game/assets/hazard.png
```

They are intentionally ignored by Git. When either photo is absent, the game
continues normally with its plain CSS shapes. `preset-icon.png` is application
UI and is included in the repository.
