from http import HTTPStatus

import pytest

from media_player_app.media_player import parse_range_header


@pytest.mark.parametrize(
    ("header", "size", "expected"),
    [
        (None, 100, (HTTPStatus.OK, 0, 99)),
        ("bytes=10-19", 100, (HTTPStatus.PARTIAL_CONTENT, 10, 19)),
        ("bytes=90-", 100, (HTTPStatus.PARTIAL_CONTENT, 90, 99)),
        ("bytes=-12", 100, (HTTPStatus.PARTIAL_CONTENT, 88, 99)),
        ("bytes=10-999", 100, (HTTPStatus.PARTIAL_CONTENT, 10, 99)),
    ],
)
def test_parse_range_header(header, size, expected):
    assert parse_range_header(header, size) == expected


@pytest.mark.parametrize("header", ["items=0-1", "bytes=", "bytes=a-b", "bytes=100-101", "bytes=-0"])
def test_parse_range_header_rejects_invalid_ranges(header):
    with pytest.raises(ValueError):
        parse_range_header(header, 100)


def test_parse_range_header_rejects_empty_files():
    with pytest.raises(ValueError):
        parse_range_header(None, 0)

