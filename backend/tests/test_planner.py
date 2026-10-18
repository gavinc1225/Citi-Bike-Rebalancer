"""Phase 2 acceptance: the planners reproduce the A2 replay (272 vs 208 useful moves of 300)."""

from __future__ import annotations

from datetime import datetime

import pytest

from app import forecast
from app.planner import count_useful, plan_nearest_first, plan_value_per_minute, plan_van, van_steps

USER_POINTS = [
    (40.7196, -74.0431), (40.7359, -74.0303), (40.7270, -74.0700),
    (40.7480, -74.0280), (40.7157, -74.0370), (40.7440, -74.0420),
]
TEST_WEEKDAYS = [24, 25, 28, 29, 30]


@pytest.fixture(scope="module")
def coords():
    st = forecast.load().stations
    return {sid: (row.lat, row.lng) for sid, row in st.iterrows()}


@pytest.fixture(scope="module")
def replay(coords):
    totals = {"vpm": 0, "nearest": 0, "moves": 0}
    for day in TEST_WEEKDAYS:
        fc = forecast.forecast_window(datetime(2026, 9, day, 7), 3, "hist")
        need = fc.need()
        actual = fc.table["actual_net"].astype(int).to_dict()
        for pt in USER_POINTS:
            vpm = plan_value_per_minute(pt, need, coords, moves=10, max_walk_km=1.0)
            near = plan_nearest_first(pt, need, coords, moves=10)
            totals["vpm"] += count_useful(vpm, actual)
            totals["nearest"] += count_useful(near, actual)
            totals["moves"] += 10
    return totals


def test_replay_value_per_minute(replay):
    assert replay["moves"] == 300
    assert 270 <= replay["vpm"] <= 275, replay


def test_replay_nearest_first(replay):
    assert 205 <= replay["nearest"] <= 211, replay


def test_value_per_minute_respects_walk_limit(coords):
    need = forecast.forecast_window(datetime(2026, 9, 29, 7), 3).need()
    start = USER_POINTS[0]
    plan = plan_value_per_minute(start, need, coords, moves=10, max_walk_km=1.0)
    assert plan and plan[0].walk_km <= 1.0
    assert all(m.walk_km <= 1.0 for m in plan)


def test_van_load_stays_within_capacity(coords):
    need = forecast.forecast_window(datetime(2026, 9, 29, 7), 3).need()
    stops = plan_van(USER_POINTS[0], need, coords, max_stops=10, capacity=20)
    assert 0 < len(stops) <= 10
    load = 0
    for s in stops:
        load += s.bikes
        assert 0 <= load <= 20
    steps = van_steps(need, stops, USER_POINTS[0], coords)
    assert all(st.kind == "drive" for st in steps)
