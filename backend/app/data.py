"""Runtime data: one gzipped JSON bundle written by the pipeline (pipeline/runtime_bundle.py).

Standard library only, so the API can be deployed without pandas / numpy / scikit-learn.
"""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

BUNDLE_PATH = Path(__file__).with_name("runtime_data") / "runtime.json.gz"

Triple = list[float]  # [dep, arr, net]


@dataclass(frozen=True)
class Bundle:
    start: datetime
    hours: int
    test_start: datetime
    test_hours: int
    stations: list[dict]
    by_id: dict[str, dict]
    hist: dict[str, list[list[Triple]]]  # station -> offday (0/1) -> hour -> triple
    gbm: dict[str, list[Triple]]  # station -> hour index from test_start -> triple
    dep: dict[str, list[int]]  # station -> hour index from start
    arr: dict[str, list[int]]
    daily: list[dict]
    hourly: dict
    evidence: dict

    @property
    def ids(self) -> list[str]:
        return [s["id"] for s in self.stations]

    def coords(self) -> dict[str, tuple[float, float]]:
        return {s["id"]: (s["lat"], s["lng"]) for s in self.stations}

    def hour_index(self, ts: datetime) -> int | None:
        i = int((ts - self.start) / timedelta(hours=1))
        return i if 0 <= i < self.hours else None

    def gbm_index(self, ts: datetime) -> int | None:
        i = int((ts - self.test_start) / timedelta(hours=1))
        return i if 0 <= i < self.test_hours else None


@lru_cache(maxsize=1)
def load() -> Bundle:
    if not BUNDLE_PATH.exists():
        raise RuntimeError(f"missing {BUNDLE_PATH}; run `make data` first")
    with gzip.open(BUNDLE_PATH, "rt", encoding="utf-8") as f:
        raw = json.load(f)
    return Bundle(
        start=datetime.fromisoformat(raw["start"]),
        hours=raw["hours"],
        test_start=datetime.fromisoformat(raw["test_start"]),
        test_hours=raw["test_hours"],
        stations=raw["stations"],
        by_id={s["id"]: s for s in raw["stations"]},
        hist=raw["hist"],
        gbm=raw["gbm"],
        dep=raw["dep"],
        arr=raw["arr"],
        daily=raw["daily"],
        hourly=raw["hourly"],
        evidence=raw["evidence"],
    )
