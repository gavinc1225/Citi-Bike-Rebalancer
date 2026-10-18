"""Phase 1 acceptance: the artifacts match the facts from our A2 dossier."""

from __future__ import annotations

from collections import Counter
from datetime import date

import pytest

from app.constants import SYSTEM_PREFIXES, TEST_END, TEST_START
from pipeline.build import load_trips


@pytest.fixture(scope="module")
def trips():
    return load_trips()


def test_trip_count(trips):
    assert len(trips) == 106_617


def test_station_count(trips, stations):
    assert trips["start_station_id"].nunique() == 108
    assert len(stations) == 108
    assert all(s["id"].startswith(SYSTEM_PREFIXES) for s in stations)


def test_missing_and_manhattan_ends(trips):
    assert trips["end_station_id"].isna().sum() == 331
    ends = trips["end_station_id"].dropna()
    assert (~ends.str.startswith(SYSTEM_PREFIXES)).sum() == 274


def test_panel_counts_departures_but_drops_outside_arrivals(trips, panel):
    assert len(panel) == 108 * 30 * 24
    assert panel["dep"].sum() == len(trips)
    assert panel["arr"].sum() == len(trips) - 331 - 274


def test_grove_st_morning_hub(hist_mean):
    weekday_morning = hist_mean[(hist_mean["offday"] == 0) & hist_mean["hour"].between(7, 9)]
    grove = weekday_morning[weekday_morning["station_id"] == "JC115"]["net"].sum()
    assert 70 <= grove <= 80


def test_role_sizes(stations):
    counts = Counter(s["role"] for s in stations)
    for role, expected in {"Commuter hub": 20, "Residential source": 74, "Mixed": 14}.items():
        assert abs(counts[role] - expected) <= 2, counts


def test_labor_day_is_offday(panel):
    assert panel.loc[panel["date"] == date(2026, 9, 7), "offday"].eq(1).all()
    assert panel.loc[panel["date"] == date(2026, 9, 8), "offday"].eq(0).all()


def test_forecast_mae_matches_a2(panel, hist_mean, gbm):
    """7-10am window net-flow MAE over Sept 24-30: zero 4.81, hist mean 2.39, GBM 2.32."""
    test = panel[(panel["date"] >= TEST_START) & (panel["date"] <= TEST_END) & panel["hour"].between(7, 9)]
    test = test.merge(hist_mean, on=["station_id", "hour", "offday"], suffixes=("", "_hm"))
    test = test.merge(gbm, on=["station_id", "ts"])
    window = test.groupby(["station_id", "date"])[["net", "net_hm", "net_gbm"]].sum()
    assert round(window["net"].abs().mean(), 2) == 4.81
    assert round((window["net"] - window["net_hm"]).abs().mean(), 2) == 2.39
    assert round((window["net"] - window["net_gbm"]).abs().mean(), 2) == pytest.approx(2.32, abs=0.02)
