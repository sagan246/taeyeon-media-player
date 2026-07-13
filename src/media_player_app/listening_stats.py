#!/usr/bin/env python3
"""Summary listening statistics for Local Media Player.

The player stores small daily/lifetime aggregates instead of raw play events.
That keeps the database private, compact, and useful for "Wrapped"-style views.
"""

from __future__ import annotations

import hashlib
import sqlite3
import threading
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


VALID_PERIODS = {"day", "week", "month", "year", "all", "custom"}
MAX_CUSTOM_RANGE_DAYS = 366


class ListeningStats:
    """! @brief SQLite-backed summary stats for local music playback."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.lock = threading.Lock()
        self.init_db()

    def connect(self) -> sqlite3.Connection:
        """! @brief Open a SQLite connection with row dictionaries enabled."""
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def init_db(self) -> None:
        """! @brief Create compact summary tables if they do not exist."""
        with self.lock, closing(self.connect()) as db:
            with db:
                db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS track_stats (
                        track_key TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        artist TEXT NOT NULL,
                        album TEXT NOT NULL,
                        duration INTEGER NOT NULL DEFAULT 0,
                        format TEXT NOT NULL DEFAULT '',
                        play_count INTEGER NOT NULL DEFAULT 0,
                        total_seconds REAL NOT NULL DEFAULT 0,
                        last_played TEXT
                    )
                    """
                )
                db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS daily_track_stats (
                        day TEXT NOT NULL,
                        track_key TEXT NOT NULL,
                        title TEXT NOT NULL,
                        artist TEXT NOT NULL,
                        album TEXT NOT NULL,
                        play_count INTEGER NOT NULL DEFAULT 0,
                        seconds REAL NOT NULL DEFAULT 0,
                        PRIMARY KEY(day, track_key)
                    )
                    """
                )
                db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS hourly_track_stats (
                        day TEXT NOT NULL,
                        hour INTEGER NOT NULL,
                        track_key TEXT NOT NULL,
                        title TEXT NOT NULL,
                        artist TEXT NOT NULL,
                        album TEXT NOT NULL,
                        play_count INTEGER NOT NULL DEFAULT 0,
                        seconds REAL NOT NULL DEFAULT 0,
                        PRIMARY KEY(day, hour, track_key)
                    )
                    """
                )

    def track_key(self, track: dict[str, Any]) -> str:
        """! @brief Build a stable-ish key that survives file moves."""
        title = str(track.get("title") or "").strip().lower()
        artist = str(track.get("artist") or "").strip().lower()
        album = str(track.get("album") or "").strip().lower()
        try:
            duration = int(round(float(track.get("duration") or 0)))
        except (TypeError, ValueError):
            duration = 0
        identity = f"{artist}|{album}|{title}|{duration}"
        return hashlib.sha1(identity.encode("utf-8", errors="replace")).hexdigest()[:24]

    def clean_track(self, payload: dict[str, Any]) -> dict[str, Any]:
        """! @brief Normalize browser-provided track metadata for storage."""
        track = payload.get("track") if isinstance(payload.get("track"), dict) else payload
        try:
            duration = int(round(float(track.get("duration") or 0)))
        except (TypeError, ValueError):
            duration = 0
        return {
            "title": str(track.get("title") or "Unknown title")[:240],
            "artist": str(track.get("artist") or "Unknown artist")[:200],
            "album": str(track.get("album") or "No album")[:240],
            "format": str(track.get("format") or "").upper()[:24],
            "duration": duration,
        }

    def record(self, payload: dict[str, Any]) -> dict[str, Any]:
        """! @brief Add listened seconds and optional play count to summaries."""
        track = self.clean_track(payload)
        track_key = self.track_key(track)
        try:
            seconds = max(0.0, min(float(payload.get("seconds") or 0), 60.0))
        except (TypeError, ValueError):
            seconds = 0.0
        play_increment = 1 if payload.get("count_play") else 0
        if seconds <= 0 and play_increment <= 0:
            return {"ok": True, "ignored": True}

        now_value = datetime.now().replace(microsecond=0)
        now = now_value.isoformat(sep=" ")
        last_played = now if play_increment else None
        day = now_value.date().isoformat()
        hour = now_value.hour
        with self.lock, closing(self.connect()) as db:
            with db:
                db.execute(
                    """
                    INSERT INTO track_stats
                        (track_key, title, artist, album, duration, format, play_count, total_seconds, last_played)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(track_key) DO UPDATE SET
                        title=excluded.title,
                        artist=excluded.artist,
                        album=excluded.album,
                        duration=excluded.duration,
                        format=excluded.format,
                        play_count=play_count + excluded.play_count,
                        total_seconds=total_seconds + excluded.total_seconds,
                        last_played=COALESCE(excluded.last_played, last_played)
                    """,
                    (
                        track_key,
                        track["title"],
                        track["artist"],
                        track["album"],
                        track["duration"],
                        track["format"],
                        play_increment,
                        seconds,
                        last_played,
                    ),
                )
                db.execute(
                    """
                    INSERT INTO daily_track_stats
                        (day, track_key, title, artist, album, play_count, seconds)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(day, track_key) DO UPDATE SET
                        title=excluded.title,
                        artist=excluded.artist,
                        album=excluded.album,
                        play_count=play_count + excluded.play_count,
                        seconds=seconds + excluded.seconds
                    """,
                    (day, track_key, track["title"], track["artist"], track["album"], play_increment, seconds),
                )
                db.execute(
                    """
                    INSERT INTO hourly_track_stats
                        (day, hour, track_key, title, artist, album, play_count, seconds)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(day, hour, track_key) DO UPDATE SET
                        title=excluded.title,
                        artist=excluded.artist,
                        album=excluded.album,
                        play_count=play_count + excluded.play_count,
                        seconds=seconds + excluded.seconds
                    """,
                    (day, hour, track_key, track["title"], track["artist"], track["album"], play_increment, seconds),
                )
        return {"ok": True, "track_key": track_key}

    def period_start(self, period: str) -> str | None:
        """! @brief Return the first date included in a named stats range."""
        today = date.today()
        if period == "week":
            return self.week_start(today).isoformat()
        if period == "day":
            return today.isoformat()
        if period == "month":
            return today.replace(day=1).isoformat()
        if period == "year":
            return today.replace(month=1, day=1).isoformat()
        return None

    def week_start(self, day: date) -> date:
        """! @brief Return Sunday for the calendar week containing day."""
        # Python's weekday is Monday=0, so add one day modulo 7 for Sunday=0.
        return day - timedelta(days=(day.weekday() + 1) % 7)

    def week_end(self, day: date) -> str:
        """! @brief Return Saturday for the calendar week containing day."""
        return (self.week_start(day) + timedelta(days=6)).isoformat()

    def month_end(self, day: date) -> str:
        """! @brief Return the last calendar day for the month containing day."""
        if day.month == 12:
            next_month = day.replace(year=day.year + 1, month=1, day=1)
        else:
            next_month = day.replace(month=day.month + 1, day=1)
        return (next_month - timedelta(days=1)).isoformat()

    def year_end(self, day: date) -> str:
        """! @brief Return the last calendar day for the year containing day."""
        return day.replace(month=12, day=31).isoformat()

    def empty_day(self, day_text: str) -> dict[str, Any]:
        """! @brief Build the zero-value daily row used by charts."""
        return {"day": day_text, "seconds": 0.0}

    def chart_days(
        self, period: str, daily: dict[str, dict[str, Any]], start_text: str | None = None, end_text: str | None = None
    ) -> list[dict[str, Any]]:
        """! @brief Return chronological daily totals, including quiet days for charts."""
        if start_text is None or end_text is None:
            start_text = self.period_start(period)
            end_text = date.today().isoformat() if start_text else None
        if start_text is None or end_text is None:
            return sorted(daily.values(), key=lambda item: item["day"])

        start = date.fromisoformat(start_text)
        end = date.fromisoformat(end_text)
        day_count = max(0, (end - start).days) + 1
        chart: list[dict[str, Any]] = []
        for offset in range(day_count):
            day_text = (start + timedelta(days=offset)).isoformat()
            chart.append(daily.get(day_text, self.empty_day(day_text)))
        return chart

    def chart_hours(self, rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
        """! @brief Return hourly totals for a single-day chart."""
        hourly = {hour: {"hour": hour, "label": f"{hour:02d}:00", "seconds": 0.0} for hour in range(24)}
        for row in rows:
            hour = int(row["hour"] or 0)
            if hour not in hourly:
                continue
            hourly[hour]["seconds"] += float(row["seconds"] or 0)
        return list(hourly.values())

    def custom_range(self, start_text: str | None, end_text: str | None) -> tuple[str | None, str | None]:
        """! @brief Validate and clamp a custom stats date range."""
        start = self.parse_date(start_text)
        end = self.parse_date(end_text)
        if start is None or end is None:
            return None, None
        if end < start:
            start, end = end, start
        # Keep accidental giant ranges from making the chart unpleasant.
        if (end - start).days > MAX_CUSTOM_RANGE_DAYS:
            start = end - timedelta(days=MAX_CUSTOM_RANGE_DAYS)
        return start.isoformat(), end.isoformat()

    def parse_date(self, value: str | None) -> date | None:
        """! @brief Parse an ISO date from the browser, returning None for bad input."""
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None

    def selected_range(
        self, period: str, start_text: str | None, end_text: str | None
    ) -> tuple[str, str | None, str | None]:
        """! @brief Normalize a period plus optional dates into a queryable range."""
        period = period if period in VALID_PERIODS else "week"
        if period == "day":
            day_text = start_text or date.today().isoformat()
            start, end = self.custom_range(day_text, end_text or day_text)
            return period, start, end
        if period == "week" and not start_text and not end_text:
            today = date.today()
            return period, self.week_start(today).isoformat(), self.week_end(today)
        if period == "month" and not start_text and not end_text:
            today = date.today()
            return period, today.replace(day=1).isoformat(), self.month_end(today)
        if period == "year" and not start_text and not end_text:
            today = date.today()
            return period, today.replace(month=1, day=1).isoformat(), self.year_end(today)
        if period in {"week", "month", "year"} and start_text and end_text:
            start, end = self.custom_range(start_text, end_text)
            if start is not None and end is not None:
                return period, start, end
        if period == "custom":
            start, end = self.custom_range(start_text, end_text)
            if start is not None and end is not None:
                return period, start, end
            period = "week"
        return period, self.period_start(period), None

    def summary(self, period: str = "week", start_text: str | None = None, end_text: str | None = None) -> dict[str, Any]:
        """! @brief Build a simple stats-page payload for the requested period."""
        period, start, end = self.selected_range(period, start_text, end_text)
        with self.lock, closing(self.connect()) as db:
            if start and end:
                rows = db.execute(
                    "SELECT * FROM daily_track_stats WHERE day >= ? AND day <= ? ORDER BY day DESC, seconds DESC",
                    (start, end),
                ).fetchall()
            elif start:
                rows = db.execute(
                    "SELECT * FROM daily_track_stats WHERE day >= ? ORDER BY day DESC, seconds DESC",
                    (start,),
                ).fetchall()
            else:
                rows = db.execute("SELECT * FROM daily_track_stats ORDER BY day DESC, seconds DESC").fetchall()
            lifetime = db.execute(
                "SELECT COALESCE(SUM(total_seconds),0) seconds FROM track_stats"
            ).fetchone()
            all_time = db.execute(
                """
                SELECT
                    COALESCE(SUM(play_count),0) play_count,
                    COUNT(DISTINCT track_key) unique_tracks,
                    COUNT(DISTINCT day) listening_days,
                    MIN(day) first_day
                FROM daily_track_stats
                """
            ).fetchone()
            hourly_rows = []
            if start and end and start == end:
                hourly_rows = db.execute(
                    "SELECT * FROM hourly_track_stats WHERE day = ? ORDER BY hour ASC, seconds DESC",
                    (start,),
                ).fetchall()

        daily: dict[str, dict[str, Any]] = {}
        songs: dict[str, dict[str, Any]] = {}
        for row in rows:
            day = row["day"]
            daily.setdefault(day, self.empty_day(day))
            daily[day]["seconds"] += float(row["seconds"] or 0)

            song = songs.setdefault(
                row["track_key"],
                {
                    "track_key": row["track_key"],
                    "title": row["title"],
                    "artist": row["artist"],
                    "album": row["album"],
                    "seconds": 0.0,
                },
            )
            song["seconds"] += float(row["seconds"] or 0)

        return {
            "period": period,
            "summary": {
                "seconds": sum(item["seconds"] for item in daily.values()),
                "lifetime_seconds": float(lifetime["seconds"] or 0),
                "total_play_count": int(all_time["play_count"] or 0),
                "unique_tracks": int(all_time["unique_tracks"] or 0),
                "listening_days": int(all_time["listening_days"] or 0),
                "first_day": all_time["first_day"] or "",
            },
            "chart_unit": "hour" if start and end and start == end else "day",
            "chart_daily": self.chart_hours(hourly_rows) if start and end and start == end else self.chart_days(period, daily, start, end),
            "top_songs": sorted(songs.values(), key=lambda item: item["seconds"], reverse=True)[:10],
        }
