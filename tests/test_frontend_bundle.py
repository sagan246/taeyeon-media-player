from media_player_app.server_config import ASSET_DIR, FRONTEND_SCRIPT_FILES, FRONTEND_STYLE_FILES


def test_frontend_bundle_sources_are_complete_and_ordered() -> None:
    assert len(FRONTEND_SCRIPT_FILES) == len(set(FRONTEND_SCRIPT_FILES))
    assert FRONTEND_SCRIPT_FILES[-2:] == ("app.js", "app-bootstrap.js")
    assert all((ASSET_DIR / filename).is_file() for filename in FRONTEND_SCRIPT_FILES)


def test_frontend_style_bundle_sources_are_complete_and_ordered() -> None:
    assert len(FRONTEND_STYLE_FILES) == len(set(FRONTEND_STYLE_FILES))
    assert FRONTEND_STYLE_FILES[0] == "styles/themes.css"
    assert FRONTEND_STYLE_FILES[-1] == "styles/responsive.css"
    assert all((ASSET_DIR / filename).is_file() for filename in FRONTEND_STYLE_FILES)
