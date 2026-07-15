import json
import threading
from types import SimpleNamespace

import pytest

from media_player_app.playlist_store import PlaylistError, PlaylistStore


def library_fixture(tmp_path):
    music_dir = tmp_path / "Music"
    paths = [music_dir / "Album" / "01 - One.flac", music_dir / "Album" / "02 - Two.mp3"]
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    return SimpleNamespace(
        music_dir=music_dir,
        paths=paths,
        tracks=[SimpleNamespace(id=0), SimpleNamespace(id=1)],
        lock=threading.Lock(),
    )


def test_playlist_persists_relative_paths_and_deduplicates_tracks(tmp_path):
    library = library_fixture(tmp_path)
    store_path = tmp_path / "runtime" / "playlists.json"
    store = PlaylistStore(store_path)

    created = store.create("  Road   Trip  ", [1, 0, 1], library)
    loaded = PlaylistStore(store_path).list_for_library(library)

    assert created["name"] == "Road Trip"
    assert loaded[0]["track_ids"] == [1, 0]
    raw = json.loads(store_path.read_text(encoding="utf-8"))
    assert raw["playlists"][0]["tracks"] == ["Album/02 - Two.mp3", "Album/01 - One.flac"]


def test_playlist_validation_rejects_bad_names_and_track_ids(tmp_path):
    library = library_fixture(tmp_path)
    store = PlaylistStore(tmp_path / "playlists.json")

    with pytest.raises(PlaylistError, match="name"):
        store.create("   ", [0], library)
    with pytest.raises(PlaylistError, match="empty"):
        store.create("Empty", [], library)
    with pytest.raises(PlaylistError, match="no longer available"):
        store.create("Missing", [99], library)


def test_playlist_rename_resume_and_delete_round_trip(tmp_path):
    library = library_fixture(tmp_path)
    store = PlaylistStore(tmp_path / "playlists.json")
    created = store.create("First", [0, 1], library)

    store.rename(created["id"], "Renamed")
    store.set_resume(created["id"], 1, library)
    listed = store.list_for_library(library)
    assert listed[0]["name"] == "Renamed"
    assert listed[0]["resume_track_id"] == 1

    store.delete(created["id"])
    assert store.list_for_library(library) == []

