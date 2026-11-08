from backend.src.openapi import OPENAPI


def test_openapi_contract_covers_tracked_export_lifecycle():
    assert OPENAPI["openapi"] == "3.1.0"
    paths = OPENAPI["paths"]
    assert "/runs/text-to-video" in paths
    assert "/runs/{run_id}" in paths
    assert "/runs/{run_id}/events" in paths
    assert paths["/generate-sse"]["post"]["deprecated"] is True

