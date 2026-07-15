from pathlib import Path

import pytest

from media_player_app import media_player


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

