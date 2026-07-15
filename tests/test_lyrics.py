from media_player_app.media_library import lyrics_for_track


def test_english_timed_lyrics_have_highest_priority(tmp_path):
    track = tmp_path / "Song.flac"
    track.touch()
    track.with_suffix(".lrc").write_text("[00:01.00]Raw\n[00:02.00]Words", encoding="utf-8")
    track.with_suffix(".en.lrc").write_text("[00:01.00]English\n[00:02.00]Lyrics", encoding="utf-8")
    track.with_suffix(".en.txt").write_text("Plain English", encoding="utf-8")

    assert lyrics_for_track(track) == ("[00:01.00]English\n[00:02.00]Lyrics", "lrc")


def test_mismatched_english_lrc_uses_english_text(tmp_path):
    track = tmp_path / "Song.mp3"
    track.touch()
    track.with_suffix(".lrc").write_text("[00:01.00]Raw", encoding="utf-8")
    track.with_suffix(".en.lrc").write_text("[00:05.00]Wrong timing", encoding="utf-8")
    track.with_suffix(".en.txt").write_text("Readable translation", encoding="utf-8")

    assert lyrics_for_track(track) == ("Readable translation", "text")


def test_raw_lrc_is_used_when_no_english_sidecar_exists(tmp_path):
    track = tmp_path / "Song.flac"
    track.touch()
    track.with_suffix(".lrc").write_text("[00:01.00]Original", encoding="utf-8")

    assert lyrics_for_track(track) == ("[00:01.00]Original", "lrc")

