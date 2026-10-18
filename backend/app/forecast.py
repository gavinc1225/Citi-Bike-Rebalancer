"""Window forecasts from the precomputed artifacts (historical mean default, GBM optional)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Literal

import numpy as np
import pandas as pd

from app.constants import ARTIFACTS, LABEL_THRESHOLD, TEST_END, TEST_START, is_offday

Model = Literal["hist", "gbm"]


@dataclass(frozen=True)
class Artifacts:
    stations: pd.DataFrame  # indexed by id
    panel: pd.DataFrame  # indexed by (station_id, ts)
    hist: pd.DataFrame  # indexed by (station_id, hour, offday)
    gbm: pd.DataFrame  # indexed by (station_id, ts)


@lru_cache(maxsize=1)
def load() -> Artifacts:
    missing = [n for n in ("stations.json", "panel.parquet", "hist_mean.parquet", "gbm_forecast.parquet")
               if not (ARTIFACTS / n).exists()]
    if missing:
        raise RuntimeError(f"missing artifacts {missing}; run `make data` first")
    stations = pd.DataFrame(json.loads((ARTIFACTS / "stations.json").read_text())).set_index("id")
    panel = pd.read_parquet(ARTIFACTS / "panel.parquet").set_index(["station_id", "ts"]).sort_index()
    hist = pd.read_parquet(ARTIFACTS / "hist_mean.parquet").set_index(["station_id", "hour", "offday"]).sort_index()
    gbm = pd.read_parquet(ARTIFACTS / "gbm_forecast.parquet").set_index(["station_id", "ts"]).sort_index()
    return Artifacts(stations, panel, hist, gbm)


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
class WindowForecast:
    hours: list[datetime]
    model_used: Model
    table: pd.DataFrame  # index station id; columns dep, arr, net, need, label, actual_net
    has_actual: bool

    def need(self) -> dict[str, int]:
        return self.table["need"].astype(int).to_dict()


def hist_window(stations: pd.Index, hours: list[datetime]) -> pd.DataFrame:
    a = load()
    total = pd.DataFrame(0.0, index=stations, columns=["dep", "arr", "net"])
    for h in hours:
        key = pd.MultiIndex.from_product([stations, [h.hour], [int(is_offday(h.date()))]])
        total += a.hist.reindex(key)[["dep", "arr", "net"]].fillna(0.0).to_numpy()
    return total


def gbm_window(stations: pd.Index, hours: list[datetime]) -> pd.DataFrame:
    a = load()
    key = pd.MultiIndex.from_product([stations, pd.to_datetime(hours)])
    rows = a.gbm.reindex(key)[["dep_gbm", "arr_gbm", "net_gbm"]].fillna(0.0)
    out = rows.groupby(level=0).sum().reindex(stations)
    out.columns = ["dep", "arr", "net"]
    return out


def actual_window(stations: pd.Index, hours: list[datetime]) -> pd.Series | None:
    a = load()
    key = pd.MultiIndex.from_product([stations, pd.to_datetime(hours)])
    rows = a.panel.reindex(key)["net"]
    if rows.isna().any():  # window leaves the month we have data for
        return None
    return rows.groupby(level=0).sum().reindex(stations)


def forecast_window(at: datetime, window: int, model: Model = "hist") -> WindowForecast:
    a = load()
    stations = a.stations.index
    hours = window_hours(at, window)
    model_used: Model = "gbm" if model == "gbm" and gbm_available(hours) else "hist"
    table = gbm_window(stations, hours) if model_used == "gbm" else hist_window(stations, hours)
    table["need"] = np.round(table["net"]).astype(int)
    table["label"] = table["net"].map(label_for)
    actual = actual_window(stations, hours)
    table["actual_net"] = actual if actual is not None else np.nan
    return WindowForecast(hours, model_used, table, actual is not None)
