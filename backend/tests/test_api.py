"""Phase 2 API checks."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_stations(client):
    body = client.get("/api/stations").json()
    assert len(body) == 108
    assert {"id", "name", "lat", "lng", "role", "total_departures"} <= set(body[0])


def test_state_hist_has_actual_and_labels(client):
    body = client.get("/api/state", params={"at": "2026-09-29T07:00", "window": 3}).json()
    assert body["model_used"] == "hist" and body["has_actual"]
    grove = next(s for s in body["stations"] if s["id"] == "JC115")
    assert grove["label"] == "surplus" and grove["actual_net"] is not None
    assert sum(body["counts"].values()) == 108


def test_state_gbm_falls_back_outside_test_week(client):
    inside = client.get("/api/state", params={"at": "2026-09-29T07:00", "model": "gbm"}).json()
    outside = client.get("/api/state", params={"at": "2026-09-15T07:00", "model": "gbm"}).json()
    assert inside["model_used"] == "gbm"
    assert outside["model_used"] == "hist" and not outside["gbm_available"]


def test_state_rejects_out_of_range(client):
    assert client.get("/api/state", params={"at": "2026-10-02T07:00"}).status_code == 422


def test_profile(client):
    body = client.get("/api/station/JC115/profile").json()
    assert len(body["weekday"]) == 24 and len(body["offday"]) == 24
    assert len(body["daily_departures"]) == 30
    assert body["role"] == "Commuter hub"
    assert client.get("/api/station/XX000/profile").status_code == 404


def test_plan_rider_from_grove(client):
    body = client.post("/api/plan", json={"lat": 40.7196, "lng": -74.0431}).json()
    assert body["totals"]["moves"] == 10
    assert [s["kind"] for s in body["steps"][:2]] == ["walk", "ride"]
    assert body["comparison"]["name"] == "nearest-first"
    assert "useful_on_actual" in body["totals"]
    assert body["explanation"] and all(isinstance(x, str) for x in body["explanation"])


def test_plan_empty_state_far_away(client):
    body = client.post("/api/plan", json={"lat": 40.80, "lng": -74.15, "max_walk_km": 0.5}).json()
    assert body["steps"] == [] and "No surplus stations within 0.5 km" in body["empty_reason"]


def test_plan_van(client):
    body = client.post("/api/plan", json={"lat": 40.7196, "lng": -74.0431, "mode": "van"}).json()
    assert body["steps"] and all(s["kind"] == "drive" for s in body["steps"])
    assert any("untested" in x for x in body["explanation"])


@pytest.mark.parametrize(
    "query,expected",
    [
        ("grove street", "JC115"),
        ("hoboken train station", "HB107"),
        ("hoboken terminal", "HB107"),
        ("hoboken ferry", "HB202"),
        ("14th street ferry", "HB202"),
        ("newport mall", "JC066"),
        ("liberty state park", "JC052"),
        ("stevens", "HB602"),
        ("journal square", "JC103"),
        ("hamilton park", "JC009"),
    ],
)
def test_geocode(client, query, expected):
    results = client.get("/api/geocode", params={"q": query}).json()
    assert results[0]["id"] == expected and len(results) <= 3


def test_system_and_evidence(client):
    body = client.get("/api/system").json()
    assert len(body["daily"]) == 30 and len(body["hourly"]["weekday"]) == 24
    assert client.get("/api/evidence").status_code == 200


def test_day_playback(client):
    body = client.get("/api/day", params={"date": "2026-09-29"}).json()
    assert len(body["net"]) == 108 and all(len(v) == 24 for v in body["net"].values())


def test_explain_stub(client):
    assert client.post("/api/explain").status_code == 501
