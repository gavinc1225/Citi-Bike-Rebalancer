"""Shared constants and paths. These match the A2 experiments; do not tune them."""

from __future__ import annotations

from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_CSV = REPO_ROOT / "data" / "JC-202609-citibike-tripdata.csv"
ARTIFACTS = REPO_ROOT / "artifacts"
RESEARCH = REPO_ROOT / "research"

MONTH_START = "2026-09-01"
MONTH_END_EXCL = "2026-10-01"
LABOR_DAY = date(2026, 9, 7)

TRAIN_START, TRAIN_END = date(2026, 9, 2), date(2026, 9, 23)  # hist-mean window, inclusive
GBM_TRAIN_START = date(2026, 9, 8)  # first day with a 168-h lag
TEST_START, TEST_END = date(2026, 9, 24), date(2026, 9, 30)  # replay / GBM window, inclusive

SYSTEM_PREFIXES = ("JC", "HB")

LABEL_THRESHOLD = 3  # +/- bikes for surplus / deficit
WALK_KMH = 5.0
RIDE_KMH = 12.0
DEFAULT_MAX_WALK_KM = 1.0
STEP_OVERHEAD_MIN = 1.0  # dock / undock minute added per move

N_ROLES = 3
KMEANS_N_INIT = 20
KMEANS_SEED = 0
ROLE_NAMES = ("Commuter hub", "Residential source", "Mixed")


def is_offday(d: date) -> bool:
    return d.weekday() >= 5 or d == LABOR_DAY
