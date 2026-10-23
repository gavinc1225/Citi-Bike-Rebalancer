"""Exports everything the API needs at runtime into one small gzipped JSON file.

The API (app/) reads only this bundle, with the standard library, so it can run without pandas,
numpy or scikit-learn (e.g. as a Vercel function). Floats are written with full precision so the
runtime arithmetic matches the pipeline exactly.
"""

from __future__ import annotations

import gzip
import json
from datetime import timedelta

import pandas as pd

from app.constants import TEST_END, TEST_START
from app.data import BUNDLE_PATH

HOURS = pd.date_range("2026-09-01", "2026-10-01", freq="h", inclusive="left")


def build_bundle(
    stations: pd.DataFrame,
    panel: pd.DataFrame,
    hist: pd.DataFrame,
    gbm: pd.DataFrame,
    daily: list,
    hourly: dict,
    evidence: dict | None,
) -> dict:
    ids = stations["id"].tolist()
    p = panel.set_index(["station_id", "ts"]).sort_index()
    h = hist.set_index(["station_id", "offday", "hour"]).sort_index()
    test_hours = pd.date_range(str(TEST_START), str(TEST_END + timedelta(days=1)), freq="h", inclusive="left")
    g = gbm.set_index(["station_id", "ts"]).sort_index()

    def triple(row) -> list[float]:
        return [float(row[0]), float(row[1]), float(row[2])]

    return {
        "version": 1,
        "start": HOURS[0].isoformat(),
        "hours": len(HOURS),
        "test_start": test_hours[0].isoformat(),
        "test_hours": len(test_hours),
        "stations": stations[["id", "name", "lat", "lng", "role", "total_departures"]].to_dict("records"),
        "hist": {
            sid: [
                [triple(h.loc[(sid, off, hr), ["dep", "arr", "net"]].to_numpy()) for hr in range(24)]
                for off in (0, 1)
            ]
            for sid in ids
        },
        "gbm": {
            sid: [triple(r) for r in g.loc[sid].reindex(test_hours)[["dep_gbm", "arr_gbm", "net_gbm"]].to_numpy()]
            for sid in ids
        },
        "dep": {sid: p.loc[sid]["dep"].reindex(HOURS).astype(int).tolist() for sid in ids},
        "arr": {sid: p.loc[sid]["arr"].reindex(HOURS).astype(int).tolist() for sid in ids},
        "daily": daily,
        "hourly": hourly,
        "evidence": evidence or {"status": "missing"},
    }


def write_bundle(bundle: dict) -> None:
    BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(bundle, separators=(",", ":")).encode()
    # mtime=0 keeps the file byte-identical across rebuilds, so git only sees real changes.
    with open(BUNDLE_PATH, "wb") as f, gzip.GzipFile(fileobj=f, mode="wb", mtime=0) as gz:
        gz.write(raw)
    print(f"runtime bundle: {BUNDLE_PATH} ({BUNDLE_PATH.stat().st_size / 1024:.0f} KB)")
