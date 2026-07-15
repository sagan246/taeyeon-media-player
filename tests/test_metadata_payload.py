import pytest

from media_player_app.metadata_tag_tools import validate_metadata_payload


def test_metadata_payload_keeps_supported_fields_and_normalizes_values():
    payload = validate_metadata_payload({"title": "  Song  ", "tracknumber": 3, "ignored": "value"})
    assert payload == {"title": "Song", "tracknumber": "3"}


@pytest.mark.parametrize("payload", [None, [], "title"])
def test_metadata_payload_requires_an_object(payload):
    with pytest.raises(ValueError, match="JSON object"):
        validate_metadata_payload(payload)


def test_metadata_payload_rejects_nested_values_and_empty_edits():
    with pytest.raises(ValueError, match="text value"):
        validate_metadata_payload({"title": {"value": "Song"}})
    with pytest.raises(ValueError, match="editable metadata"):
        validate_metadata_payload({"unknown": "value"})

