from media_player_app import media_library


def test_refresh_reports_counts_and_scan_timings(tmp_path, monkeypatch):
    monkeypatch.setattr(media_library, "SCAN_CACHE_PATH", tmp_path / "scan-cache.json")
    library = media_library.Library(tmp_path)

    result = library.last_refresh_result

    assert result is not None
    assert result.status == "complete"
    assert result.tracks == 0
    assert result.videos == 0
    assert result.interviews == 0
    assert result.total_ms >= 0
    assert result.music_ms >= 0
    assert result.video_ms >= 0
    assert result.text_ms >= 0
    assert result.cache_write_ms >= 0


def test_refresh_does_not_start_a_second_overlapping_scan(tmp_path, monkeypatch):
    monkeypatch.setattr(media_library, "SCAN_CACHE_PATH", tmp_path / "scan-cache.json")
    library = media_library.Library(tmp_path)
    library.refresh_lock.acquire()
    try:
        result = library.refresh(wait=False)
    finally:
        library.refresh_lock.release()

    assert result.status == "in_progress"


def test_artwork_cache_uses_a_stable_digest(tmp_path, monkeypatch):
    monkeypatch.setattr(media_library, "ARTWORK_CACHE_DIR", tmp_path / "artwork")

    first = media_library.cache_artwork_data("Artist/Album/Song.flac", b"artwork")
    second = media_library.cache_artwork_data("Artist/Album/Song.flac", b"artwork")

    assert first == second
    assert (tmp_path / "artwork" / first).read_bytes() == b"artwork"


def test_cached_artwork_keeps_a_disk_reference(tmp_path, monkeypatch):
    cache_dir = tmp_path / "artwork"
    cache_dir.mkdir()
    cache_path = cache_dir / "cover.bin"
    cache_path.write_bytes(b"artwork")
    monkeypatch.setattr(media_library, "ARTWORK_CACHE_DIR", cache_dir)

    artwork = media_library.artwork_from_cache(
        {"artwork_mime": "image/jpeg", "artwork_file": cache_path.name}
    )

    assert artwork == media_library.CachedArtwork(mime="image/jpeg", path=cache_path)
