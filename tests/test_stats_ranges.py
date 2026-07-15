from datetime import date, timedelta

from media_player_app.listening_stats import ListeningStats, MAX_CUSTOM_RANGE_DAYS


def test_calendar_ranges(tmp_path):
    stats = ListeningStats(tmp_path / "stats.sqlite3")
    today = date.today()

    period, start, end = stats.selected_range("week", None, None)
    assert period == "week"
    assert date.fromisoformat(start).weekday() == 6
    assert (date.fromisoformat(end) - date.fromisoformat(start)).days == 6

    _, month_start, month_end = stats.selected_range("month", None, None)
    assert date.fromisoformat(month_start).day == 1
    assert date.fromisoformat(month_end).month == today.month

    _, year_start, year_end = stats.selected_range("year", None, None)
    assert year_start == f"{today.year}-01-01"
    assert year_end == f"{today.year}-12-31"


def test_custom_range_swaps_and_clamps_large_ranges(tmp_path):
    stats = ListeningStats(tmp_path / "stats.sqlite3")
    start, end = stats.custom_range("2026-02-10", "2026-02-01")
    assert (start, end) == ("2026-02-01", "2026-02-10")

    start, end = stats.custom_range("2020-01-01", "2026-01-01")
    assert date.fromisoformat(end) - date.fromisoformat(start) == timedelta(days=MAX_CUSTOM_RANGE_DAYS)


def test_invalid_custom_range_falls_back_to_week(tmp_path):
    stats = ListeningStats(tmp_path / "stats.sqlite3")
    period, start, end = stats.selected_range("custom", "not-a-date", "2026-01-01")
    assert period == "week"
    assert start is not None
    assert end is None

