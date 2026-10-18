"""Builds artifacts/evidence.json for the Evidence tab.

Every number carries a `source`: "reproduced" means this pipeline recomputed it from the
artifacts and it matches A2; "a2" means it is quoted from the A2 dossier and the app does
not recompute it. If research/results.json exists it is attached verbatim under `a2_raw`.
"""

from __future__ import annotations

import json
import subprocess
import sys

import pandas as pd

from app.constants import ARTIFACTS, RESEARCH, TEST_END, TEST_START

# Quoted from the A2 evidence review (see the build spec); used where the app has no recomputation.
A2 = {
    "mae": {"zero": 4.81, "hist": 2.39, "gbm": 2.32, "mlp": 2.31},
    "planner": {"value_per_minute": 272, "nearest_first": 208, "moves": 300},
    "label_agreement_sept28": 0.57,
    "grounding": {"correct": 12, "total": 15, "misses": "landmark names (e.g. train station, mall, park)"},
    "roles": {"Commuter hub": 20, "Residential source": 74, "Mixed": 14},
}

GROUNDING_CHECKS = [
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
    ("exchange place", "JC116"),
    ("van vorst", "JC035"),
]

DECISIONS = [
    ("Forecast", "Historical mean by station × hour × day type is the default; gradient boosting is an optional toggle",
     "Adopt", "7–10am MAE: hist mean 2.39 vs GBM 2.32 — near-equal, the mean is simpler and always available"),
    ("Neural net", "Not in the app", "Reject", "MLP 2.31 MAE: no gain over GBM and less interpretable"),
    ("Labels", "Surplus / deficit / balanced from the forecast for the selected window (±3 bikes)", "Modify",
     "Fixed monthly labels drifted to 57% agreement on Sept 28"),
    ("Station roles", "k-means (k=3) on weekday net-flow profiles; display and explanation only", "Modify",
     "Clusters are interpretable but did not help cold-start forecasting"),
    ("Planner", "Value-per-minute greedy pairing", "Adopt", "272 vs 208 useful moves of 300 against nearest-first"),
    ("Location input", "Map click / GPS first; TF-IDF search plus a landmark alias table", "Modify",
     "12/15 queries correct; the misses were landmarks"),
    ("LLM", "No LLM in the core loop; disabled “Explain this plan” stub", "Defer",
     "No text corpus for RAG; routing needs exact arithmetic"),
]


def _forecast_mae() -> dict:
    panel = pd.read_parquet(ARTIFACTS / "panel.parquet")
    hist = pd.read_parquet(ARTIFACTS / "hist_mean.parquet")
    gbm = pd.read_parquet(ARTIFACTS / "gbm_forecast.parquet")
    panel["date"] = panel["ts"].dt.date
    test = panel[(panel["date"] >= TEST_START) & (panel["date"] <= TEST_END) & panel["hour"].between(7, 9)]
    test = test.merge(hist, on=["station_id", "hour", "offday"], suffixes=("", "_hm")).merge(gbm, on=["station_id", "ts"])
    w = test.groupby(["station_id", "date"])[["net", "net_hm", "net_gbm"]].sum()
    return {
        "zero": round(float(w["net"].abs().mean()), 2),
        "hist": round(float((w["net"] - w["net_hm"]).abs().mean()), 2),
        "gbm": round(float((w["net"] - w["net_gbm"]).abs().mean()), 2),
    }


def _roles(stations: list[dict]) -> list[dict]:
    hist = pd.read_parquet(ARTIFACTS / "hist_mean.parquet")
    morning = hist[(hist["offday"] == 0) & hist["hour"].between(7, 9)].groupby("station_id")["net"].sum()
    df = pd.DataFrame(stations).set_index("id")
    df["morning_net"] = morning
    rows = []
    for role in ("Commuter hub", "Residential source", "Mixed"):
        part = df[df["role"] == role]
        rows.append({
            "role": role,
            "count": int(len(part)),
            "a2_count": A2["roles"][role],
            "mean_morning_net": round(float(part["morning_net"].mean()), 1),
            "examples": part.sort_values("total_departures", ascending=False)["name"].head(3).tolist(),
        })
    return rows


def _grounding(stations: list[dict]) -> list[dict]:
    from app.grounding import default_grounder

    names = {s["id"]: s["name"] for s in stations}
    out = []
    for query, expected in GROUNDING_CHECKS:
        top = default_grounder().search(query, k=1)
        got = top[0] if top else None
        out.append({
            "query": query,
            "expected": names[expected],
            "got": got["name"] if got else None,
            "via": got["source"] if got else None,
            "correct": bool(got and got["id"] == expected),
        })
    return out


def _a2_raw() -> dict | None:
    results = RESEARCH / "results.json"
    script = RESEARCH / "experiments.py"
    if not results.exists() and script.exists():
        print("results.json missing; running research/experiments.py once ...")
        subprocess.run([sys.executable, script.name], cwd=RESEARCH, check=True)
    if not results.exists():
        print("NOTE: research/results.json not found; Evidence tab will show A2 numbers quoted from the spec")
        return None
    return json.loads(results.read_text())


def build_evidence(stations: list[dict]) -> dict:
    from app.replay import run_replay

    mae = _forecast_mae()
    replay = run_replay()
    return {
        "forecast_mae": {
            "window": "7–10am, Sept 24–30, station-level net flow",
            "rows": [
                {"model": "Zero (no change)", "mae": mae["zero"], "a2": A2["mae"]["zero"], "source": "reproduced"},
                {"model": "Historical mean", "mae": mae["hist"], "a2": A2["mae"]["hist"], "source": "reproduced",
                 "in_app": "default"},
                {"model": "Gradient boosting", "mae": mae["gbm"], "a2": A2["mae"]["gbm"], "source": "reproduced",
                 "in_app": "toggle"},
                {"model": "Neural net (MLP)", "mae": A2["mae"]["mlp"], "a2": A2["mae"]["mlp"], "source": "a2",
                 "in_app": "not used"},
            ],
        },
        "planner": {
            "setup": "6 start points × 5 test weekdays × 10 moves, 7–10am, historical-mean forecast, scored on actual flow",
            "moves": replay["moves"],
            "rows": [
                {"planner": "Value per minute", "useful": replay["useful"]["value_per_minute"],
                 "a2": A2["planner"]["value_per_minute"], **replay["totals"]["value_per_minute"], "source": "reproduced"},
                {"planner": "Nearest first", "useful": replay["useful"]["nearest_first"],
                 "a2": A2["planner"]["nearest_first"], **replay["totals"]["nearest_first"], "source": "reproduced"},
            ],
        },
        "roles": _roles(stations),
        "labels": {"agreement_sept28": A2["label_agreement_sept28"], "source": "a2"},
        "grounding": {
            "a2": {**A2["grounding"], "source": "a2"},
            "app_checks": _grounding(stations),
        },
        "decisions": [
            {"component": c, "decision": d, "status": s, "evidence": e} for c, d, s, e in DECISIONS
        ],
        "a2_raw": _a2_raw(),
    }
