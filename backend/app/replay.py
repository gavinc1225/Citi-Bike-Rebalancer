"""The A2 planner replay: fixed user points x test weekdays, 7-10am, hist-mean forecast, 10 moves."""

from __future__ import annotations

from datetime import datetime

from app import forecast
from app.constants import DEFAULT_MAX_WALK_KM
from app.planner import Move, count_useful, plan_nearest_first, plan_value_per_minute

USER_POINTS = [
    (40.7196, -74.0431), (40.7359, -74.0303), (40.7270, -74.0700),
    (40.7480, -74.0280), (40.7157, -74.0370), (40.7440, -74.0420),
]
TEST_WEEKDAYS = [24, 25, 28, 29, 30]
MOVES = 10


def _totals(plans: list[list[Move]]) -> dict:
    moves = [m for p in plans for m in p]
    return {
        "minutes": round(sum(m.minutes for m in moves), 1),
        "km": round(sum(m.walk_km + m.ride_km for m in moves), 1),
    }


def run_replay() -> dict:
    st = forecast.load().stations
    coords = {sid: (row.lat, row.lng) for sid, row in st.iterrows()}
    useful = {"value_per_minute": 0, "nearest_first": 0}
    plans: dict[str, list[list[Move]]] = {"value_per_minute": [], "nearest_first": []}
    total = 0
    for day in TEST_WEEKDAYS:
        fc = forecast.forecast_window(datetime(2026, 9, day, 7), 3, "hist")
        need = fc.need()
        actual = fc.table["actual_net"].astype(int).to_dict()
        for pt in USER_POINTS:
            vpm = plan_value_per_minute(pt, need, coords, MOVES, DEFAULT_MAX_WALK_KM)
            near = plan_nearest_first(pt, need, coords, MOVES)
            useful["value_per_minute"] += count_useful(vpm, actual)
            useful["nearest_first"] += count_useful(near, actual)
            plans["value_per_minute"].append(vpm)
            plans["nearest_first"].append(near)
            total += MOVES
    return {
        "moves": total,
        "useful": useful,
        "totals": {k: _totals(v) for k, v in plans.items()},
    }
