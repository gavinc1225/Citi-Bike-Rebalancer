from __future__ import annotations

import json

import pandas as pd
import pytest

from app.constants import ARTIFACTS


def _require(name: str):
    path = ARTIFACTS / name
    if not path.exists():
        pytest.fail(f"{path} missing; run `make data` first")
    return path


@pytest.fixture(scope="session")
def stations() -> list[dict]:
    return json.loads(_require("stations.json").read_text())


@pytest.fixture(scope="session")
def panel() -> pd.DataFrame:
    df = pd.read_parquet(_require("panel.parquet"))
    df["date"] = df["ts"].dt.date
    return df


@pytest.fixture(scope="session")
def hist_mean() -> pd.DataFrame:
    return pd.read_parquet(_require("hist_mean.parquet"))


@pytest.fixture(scope="session")
def gbm() -> pd.DataFrame:
    return pd.read_parquet(_require("gbm_forecast.parquet"))
