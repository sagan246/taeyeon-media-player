from pathlib import Path

import pytest

from media_player_app import media_player
from media_player_app.server_config import PlayerConfig


def test_resolve_media_dir_allows_configured_root_and_descendants(tmp_path, monkeypatch):
    root = tmp_path / "media"
    child = root / "collection"
    child.mkdir(parents=True)
    monkeypatch.setattr(media_player, "DEFAULT_MEDIA_DIR", root)

    assert media_player.resolve_media_dir(root) == root.resolve()
    assert media_player.resolve_media_dir(child) == child.resolve()


def test_resolve_media_dir_rejects_paths_outside_configured_root(tmp_path, monkeypatch):
    root = tmp_path / "media"
    outside = tmp_path / "elsewhere"
    root.mkdir()
    outside.mkdir()
    monkeypatch.setattr(media_player, "DEFAULT_MEDIA_DIR", root)

    with pytest.raises(SystemExit, match="Refusing to scan outside"):
        media_player.resolve_media_dir(outside)


def test_game_directory_resolves_relative_to_app_root():
    config = PlayerConfig.from_mapping({"game_dir": "game"})

    assert config.game_path() is not None
    assert config.game_path().name == "game"


def test_bundled_game_is_the_default():
    assert PlayerConfig().game_path() == (Path(__file__).parents[1] / "game").resolve()
