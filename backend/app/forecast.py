"""Window forecasts from the runtime bundle (historical mean default, GBM optional). Standard library only."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from app.constants import LABEL_THRESHOLD, TEST_END, TEST_START, is_offday
from app.data import load

Model = Literal["hist", "gbm"]


def window_hours(at: datetime, window: int) -> list[datetime]:
    start = at.replace(minute=0, second=0, microsecond=0)
    return [start + timedelta(hours=i) for i in range(window)]


def gbm_available(hours: list[datetime]) -> bool:
    return all(TEST_START <= h.date() <= TEST_END for h in hours)


def label_for(net: float) -> str:
    if net >= LABEL_THRESHOLD:
        return "surplus"
    if net <= -LABEL_THRESHOLD:
        return "deficit"
    return "balanced"


@dataclass
class StationForecast:
    dep: float
    arr: float
    net: float
    need: int  # round(net): positive = surplus to pick up, negative = deficit to fill
    label: str
    actual_net: int | None


@dataclass
class WindowForecast:
    hours: list[datetime]
    model_used: Model
    rows: dict[str, StationForecast]
    has_actual: bool

    def need(self) -> dict[str, int]:
        return {sid: r.need for sid, r in self.rows.items()}

    def actual(self) -> dict[str, int]:
        return {sid: r.actual_net or 0 for sid, r in self.rows.items()}

    def counts(self) -> dict[str, int]:
        out = {"surplus": 0, "deficit": 0, "balanced": 0}
        for r in self.rows.values():
            out[r.label] += 1
        return out


def _hist_window(sid: str, hours: list[datetime]) -> list[float]:
    b = load()
    total = [0.0, 0.0, 0.0]
    for h in hours:
        dep, arr, net = b.hist[sid][int(is_offday(h.date()))][h.hour]
        total = [total[0] + dep, total[1] + arr, total[2] + net]
    return total


def _gbm_window(sid: str, hours: list[datetime]) -> list[float]:
    b = load()
    total = [0.0, 0.0, 0.0]
    for h in hours:
        i = b.gbm_index(h)
        if i is not None:
            dep, arr, net = b.gbm[sid][i]
            total = [total[0] + dep, total[1] + arr, total[2] + net]
    return total


def _actual_window(sid: str, hours: list[datetime]) -> int | None:
    b = load()
    idx = [b.hour_index(h) for h in hours]
    if any(i is None for i in idx):  # window leaves the month we have data for
        return None
    return sum(b.arr[sid][i] - b.dep[sid][i] for i in idx)  # type: ignore[index]


def forecast_window(at: datetime, window: int, model: Model = "hist") -> WindowForecast:
    hours = window_hours(at, window)
    model_used: Model = "gbm" if model == "gbm" and gbm_available(hours) else "hist"
    window_fn = _gbm_window if model_used == "gbm" else _hist_window
    rows: dict[str, StationForecast] = {}
    has_actual = True
    for sid in load().ids:
        dep, arr, net = window_fn(sid, hours)
        actual = _actual_window(sid, hours)
        has_actual = has_actual and actual is not None
        # round() is round-half-to-even, the same as the numpy rounding the A2 experiments used.
        rows[sid] = StationForecast(dep, arr, net, int(round(net)), label_for(net), actual)
    return WindowForecast(hours, model_used, rows, has_actual)
