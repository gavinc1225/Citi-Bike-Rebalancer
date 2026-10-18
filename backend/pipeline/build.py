"""Offline pipeline: trip CSV -> artifacts/ (run with `python -m pipeline.build` from backend/)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.ensemble import HistGradientBoostingRegressor

from app.constants import (
    ARTIFACTS,
    DATA_CSV,
    GBM_TRAIN_START,
    KMEANS_N_INIT,
    KMEANS_SEED,
    MONTH_END_EXCL,
    MONTH_START,
    N_ROLES,
    RESEARCH,
    SYSTEM_PREFIXES,
    TEST_END,
    TEST_START,
    TRAIN_END,
    TRAIN_START,
    is_offday,
)

LAG_FEATURES = [f"{col}_lag{lag}" for lag in (24, 168) for col in ("dep", "arr", "net")]
GBM_FEATURES = [
    "station_code", "hour", "dow", "offday", "lat", "lng",
    "hm_dep", "hm_arr", "hm_net", *LAG_FEATURES,
]


def load_trips(csv: Path = DATA_CSV) -> pd.DataFrame:
    trips = pd.read_csv(
        csv,
        parse_dates=["started_at", "ended_at"],
        dtype={"start_station_id": str, "end_station_id": str},
        low_memory=False,
    )
    return trips[trips["started_at"] >= MONTH_START].reset_index(drop=True)


def build_stations(trips: pd.DataFrame) -> pd.DataFrame:
    ids = trips["start_station_id"]
    if not ids.str.startswith(SYSTEM_PREFIXES).all():
        raise ValueError("found a start station outside JC/HB; the spec assumes none")
    grouped = trips.groupby("start_station_id")
    stations = pd.DataFrame({
        "name": grouped["start_station_name"].agg(lambda s: s.mode().iat[0]),
        "lat": grouped["start_lat"].median(),
        "lng": grouped["start_lng"].median(),
        "total_departures": grouped.size(),
    })
    stations.index.name = "id"
    return stations.sort_index().reset_index()


def build_panel(trips: pd.DataFrame, station_ids: list[str]) -> pd.DataFrame:
    hours = pd.date_range(MONTH_START, MONTH_END_EXCL, freq="h", inclusive="left")
    index = pd.MultiIndex.from_product([station_ids, hours], names=["station_id", "ts"])

    dep = trips.groupby([trips["start_station_id"], trips["started_at"].dt.floor("h")]).size()
    # Arrivals only count trips that end at one of our stations (drops no-end and Manhattan trips).
    arriving = trips[trips["end_station_id"].isin(station_ids)]
    arr = arriving.groupby([arriving["end_station_id"], arriving["ended_at"].dt.floor("h")]).size()
    dep.index.names = arr.index.names = ["station_id", "ts"]

    panel = pd.DataFrame({
        "dep": dep.reindex(index, fill_value=0),
        "arr": arr.reindex(index, fill_value=0),
    }).reset_index()
    panel["net"] = panel["arr"] - panel["dep"]
    panel["date"] = panel["ts"].dt.date
    panel["hour"] = panel["ts"].dt.hour
    panel["dow"] = panel["ts"].dt.dayofweek
    panel["offday"] = panel["date"].map(is_offday).astype(int)
    return panel


def in_dates(panel: pd.DataFrame, start, end) -> pd.Series:
    return (panel["date"] >= start) & (panel["date"] <= end)


def build_hist_mean(panel: pd.DataFrame) -> pd.DataFrame:
    train = panel[in_dates(panel, TRAIN_START, TRAIN_END)]
    return (
        train.groupby(["station_id", "hour", "offday"])[["dep", "arr", "net"]]
        .mean()
        .reset_index()
    )


def build_gbm_forecast(panel: pd.DataFrame, hist: pd.DataFrame, stations: pd.DataFrame) -> pd.DataFrame:
    df = panel.sort_values(["station_id", "ts"]).copy()
    by_station = df.groupby("station_id")
    for lag in (24, 168):
        for col in ("dep", "arr", "net"):
            df[f"{col}_lag{lag}"] = by_station[col].shift(lag)
    hm = hist.rename(columns={"dep": "hm_dep", "arr": "hm_arr", "net": "hm_net"})
    df = df.merge(hm, on=["station_id", "hour", "offday"], how="left")
    df = df.merge(stations[["id", "lat", "lng"]], left_on="station_id", right_on="id").drop(columns="id")
    codes = {sid: i for i, sid in enumerate(stations["id"])}
    df["station_code"] = df["station_id"].map(codes)

    train = df[in_dates(df, GBM_TRAIN_START, TRAIN_END) & df["dep_lag168"].notna()]
    test = df[in_dates(df, TEST_START, TEST_END)].copy()

    for target in ("dep", "arr"):
        model = HistGradientBoostingRegressor(
            loss="poisson",
            max_iter=300,
            learning_rate=0.05,
            categorical_features=[0],  # station_code is first in GBM_FEATURES
            random_state=0,
        )
        model.fit(train[GBM_FEATURES], train[target])
        test[f"{target}_gbm"] = model.predict(test[GBM_FEATURES])
    test["net_gbm"] = test["arr_gbm"] - test["dep_gbm"]
    return test[["station_id", "ts", "dep_gbm", "arr_gbm", "net_gbm"]].reset_index(drop=True)


def build_roles(hist: pd.DataFrame, stations: pd.DataFrame) -> dict[str, str]:
    weekday = hist[hist["offday"] == 0]
    profiles = weekday.pivot(index="station_id", columns="hour", values="net").reindex(stations["id"]).fillna(0.0)
    norms = profiles.abs().sum(axis=1).replace(0, 1.0)
    normalized = profiles.div(norms, axis=0)

    labels = KMeans(n_clusters=N_ROLES, n_init=KMEANS_N_INIT, random_state=KMEANS_SEED).fit_predict(normalized)
    morning_net = profiles[[7, 8, 9]].sum(axis=1)
    cluster_morning = morning_net.groupby(labels).mean().sort_values()
    names = {
        cluster_morning.index[-1]: "Commuter hub",
        cluster_morning.index[0]: "Residential source",
        cluster_morning.index[1]: "Mixed",
    }
    return {sid: names[label] for sid, label in zip(profiles.index, labels)}


def build_system_series(trips: pd.DataFrame, panel: pd.DataFrame, gbm: pd.DataFrame) -> tuple[list, dict]:
    daily_counts = trips.groupby(trips["started_at"].dt.date).size()
    gbm_daily = gbm.groupby(gbm["ts"].dt.date)["dep_gbm"].sum()
    daily = []
    for d, n in daily_counts.items():
        daily.append({
            "date": d.isoformat(),
            "trips": int(n),
            "dow": d.weekday(),
            "offday": bool(is_offday(d)),
            "gbm_trips": round(float(gbm_daily[d]), 1) if d in gbm_daily.index else None,
        })

    system = panel.groupby(["date", "hour", "offday"])["dep"].sum().reset_index()
    hourly_mean = system.groupby(["offday", "hour"])["dep"].mean()
    hourly = {
        "hours": list(range(24)),
        "weekday": [round(float(hourly_mean[(0, h)]), 1) for h in range(24)],
        "offday": [round(float(hourly_mean[(1, h)]), 1) for h in range(24)],
    }
    return daily, hourly


def build_evidence() -> dict:
    results = RESEARCH / "results.json"
    script = RESEARCH / "experiments.py"
    if not results.exists() and script.exists():
        print("results.json missing; running research/experiments.py once ...")
        subprocess.run([sys.executable, script.name], cwd=RESEARCH, check=True)
    if not results.exists():
        print("WARNING: research/results.json not found; evidence.json will be a placeholder")
        return {"status": "missing", "note": "Add research/experiments.py and re-run `make data`."}
    return json.loads(results.read_text())


def write_json(name: str, obj) -> None:
    (ARTIFACTS / name).write_text(json.dumps(obj, indent=1))


def main() -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    trips = load_trips()
    stations = build_stations(trips)
    ids = stations["id"].tolist()
    print(f"{len(trips):,} trips, {len(ids)} stations")

    panel = build_panel(trips, ids)
    hist = build_hist_mean(panel)
    gbm = build_gbm_forecast(panel, hist, stations)
    roles = build_roles(hist, stations)
    stations["role"] = stations["id"].map(roles)
    daily, hourly = build_system_series(trips, panel, gbm)

    panel.drop(columns="date").to_parquet(ARTIFACTS / "panel.parquet", index=False)
    hist.to_parquet(ARTIFACTS / "hist_mean.parquet", index=False)
    gbm.to_parquet(ARTIFACTS / "gbm_forecast.parquet", index=False)
    write_json("stations.json", stations[["id", "name", "lat", "lng", "role", "total_departures"]].to_dict("records"))
    write_json("roles.json", roles)
    write_json("system_daily.json", daily)
    write_json("system_hourly.json", hourly)
    write_json("evidence.json", build_evidence())
    print("roles:", stations["role"].value_counts().to_dict())
    print(f"artifacts written to {ARTIFACTS}")


if __name__ == "__main__":
    main()
