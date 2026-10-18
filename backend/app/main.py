"""FastAPI app. Times are replay times in Sept 2026; all planning logic lives here, not in the UI."""

from __future__ import annotations

import json
import math
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Literal

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import forecast
from app.constants import ARTIFACTS, DEFAULT_MAX_WALK_KM, LABEL_THRESHOLD
from app.geo import haversine_km
from app.grounding import default_grounder
from app.planner import (
    DRIVE_KMH,
    Move,
    Step,
    count_useful,
    plan_nearest_first,
    plan_value_per_minute,
    plan_van,
    rider_steps,
    van_steps,
)

REPLAY_START, REPLAY_END = datetime(2026, 9, 1), datetime(2026, 10, 1)
MODEL_LABEL = {"hist": "historical average", "gbm": "gradient boosting"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    forecast.load()  # fail fast and keep the first request quick
    default_grounder()
    yield


app = FastAPI(title="Citi Bike Rebalancer", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check_at(at: datetime) -> datetime:
    if not REPLAY_START <= at < REPLAY_END:
        raise HTTPException(422, "replay time must be in September 2026")
    return at


def _artifact(name: str):
    return json.loads((ARTIFACTS / name).read_text())


def _coords() -> dict[str, tuple[float, float]]:
    st = forecast.load().stations
    return {sid: (row.lat, row.lng) for sid, row in st.iterrows()}


def _name(sid: str | None) -> str | None:
    return None if sid is None else str(forecast.load().stations.at[sid, "name"])


def _num(x: float) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 2)


def _window_text(hours: list[datetime]) -> str:
    start, end = hours[0], hours[-1] + pd.Timedelta(hours=1)
    fmt = lambda t: t.strftime("%I %p").lstrip("0").lower().replace(" ", " ")  # noqa: E731
    return f"{start:%a %b} {start.day}, {fmt(start)}–{fmt(end)}"


@app.get("/api/stations")
def stations() -> list[dict]:
    return _artifact("stations.json")


@app.get("/api/state")
def state(
    at: datetime = Query(datetime(2026, 9, 29, 7)),
    window: int = Query(3, ge=1, le=12),
    model: Literal["hist", "gbm"] = "hist",
) -> dict:
    fc = forecast.forecast_window(_check_at(at), window, model)
    rows = [
        {
            "id": sid,
            "forecast_net": _num(r.net),
            "forecast_dep": _num(r.dep),
            "forecast_arr": _num(r.arr),
            "need": int(r.need),
            "label": r.label,
            "actual_net": None if pd.isna(r.actual_net) else int(r.actual_net),
        }
        for sid, r in fc.table.iterrows()
    ]
    counts = fc.table["label"].value_counts().to_dict()
    return {
        "at": fc.hours[0].isoformat(),
        "window": window,
        "model_requested": model,
        "model_used": fc.model_used,
        "gbm_available": forecast.gbm_available(fc.hours),
        "has_actual": fc.has_actual,
        "threshold": LABEL_THRESHOLD,
        "counts": {k: int(counts.get(k, 0)) for k in ("surplus", "deficit", "balanced")},
        "stations": rows,
    }


@app.get("/api/station/{station_id}/profile")
def station_profile(station_id: str) -> dict:
    a = forecast.load()
    if station_id not in a.stations.index:
        raise HTTPException(404, f"unknown station {station_id}")
    hist = a.hist.loc[station_id].reset_index()

    def series(offday: int) -> list[dict]:
        part = hist[hist["offday"] == offday].set_index("hour").reindex(range(24), fill_value=0.0)
        return [{"hour": h, "dep": _num(r.dep), "arr": _num(r.arr), "net": _num(r.net)} for h, r in part.iterrows()]

    panel = a.panel.loc[station_id]
    daily = panel.groupby(panel.index.date)["dep"].sum()
    info = a.stations.loc[station_id]
    return {
        "id": station_id,
        "name": info["name"],
        "role": info["role"],
        "weekday": series(0),
        "offday": series(1),
        "daily_departures": [{"date": d.isoformat(), "dep": int(n)} for d, n in daily.items()],
    }


@app.get("/api/day")
def day(date_: date = Query(date(2026, 9, 29), alias="date")) -> dict:
    """Actual hourly net flow per station for one day (map playback)."""
    if not REPLAY_START.date() <= date_ < REPLAY_END.date():
        raise HTTPException(422, "date must be in September 2026")
    a = forecast.load()
    panel = a.panel.reset_index()
    rows = panel[panel["ts"].dt.date == date_]
    net = rows.pivot(index="station_id", columns="ts", values="net")
    dep = rows.groupby(rows["ts"].dt.hour)["dep"].sum()
    return {
        "date": date_.isoformat(),
        "net": {sid: [int(v) for v in vals] for sid, vals in net.iterrows()},
        "system_trips": [int(dep.get(h, 0)) for h in range(24)],
    }


@app.get("/api/geocode")
def geocode(q: str = Query(..., min_length=1, max_length=100)) -> list[dict]:
    st = forecast.load().stations
    return [
        {**r, "lat": float(st.at[r["id"], "lat"]), "lng": float(st.at[r["id"], "lng"])}
        for r in default_grounder().search(q, k=3)
    ]


@app.get("/api/evidence")
def evidence() -> dict:
    return _artifact("evidence.json")


@app.get("/api/system")
def system() -> dict:
    return {"daily": _artifact("system_daily.json"), "hourly": _artifact("system_hourly.json")}


# ------------------------------------------------------------------------- planning


class PlanRequest(BaseModel):
    lat: float = Field(ge=40.6, le=40.85)
    lng: float = Field(ge=-74.2, le=-73.9)
    at: datetime = datetime(2026, 9, 29, 7)
    window: int = Field(3, ge=1, le=12)
    model: Literal["hist", "gbm"] = "hist"
    mode: Literal["rider", "van"] = "rider"
    moves: int = Field(10, ge=1, le=40)
    max_walk_km: float = Field(DEFAULT_MAX_WALK_KM, gt=0, le=5)
    van_capacity: int = Field(20, ge=1, le=60)


def _step_dict(step: Step) -> dict:
    return {**step.to_dict(), "from_name": _name(step.from_), "to_name": _name(step.to)}


def _totals(steps: list[Step]) -> dict:
    rides = [s for s in steps if s.kind == "ride"]
    drives = [s for s in steps if s.kind == "drive"]
    moved = sum(s.bikes for s in rides) + sum(-s.bikes for s in drives if s.bikes < 0)
    return {
        "moves": len(rides) + len(drives),
        "km": round(sum(s.km for s in steps), 2),
        "minutes": round(sum(s.minutes for s in steps), 1),
        "walk_km": round(sum(s.km for s in steps if s.kind == "walk"), 2),
        "ride_km": round(sum(s.km for s in steps if s.kind == "ride"), 2),
        "bikes_fixed": int(moved),
    }


def _rider_plan(req: PlanRequest, fc: forecast.WindowForecast, need: dict[str, int]) -> dict:
    coords = _coords()
    start = (req.lat, req.lng)
    vpm = plan_value_per_minute(start, need, coords, req.moves, req.max_walk_km)
    near = plan_nearest_first(start, need, coords, req.moves)
    steps, near_steps = rider_steps(vpm, need), rider_steps(near, need)
    totals, near_totals = _totals(steps), _totals(near_steps)

    actual = fc.table["actual_net"].astype(int).to_dict() if fc.has_actual else None
    if actual is not None:
        totals["useful_on_actual"] = count_useful(vpm, actual)
        near_totals["useful_on_actual"] = count_useful(near, actual)

    reachable = [s for s, n in need.items() if n >= 1 and haversine_km(*start, *coords[s]) <= req.max_walk_km]
    explanation = [_forecast_line(fc)]
    empty_reason = None
    if not vpm:
        empty_reason = (
            f"No surplus stations within {req.max_walk_km:g} km of you at this time — try a larger window"
            if not reachable else "No deficit stations need bikes in this window."
        )
    else:
        explanation.append(f"{len(reachable)} surplus station{'s' if len(reachable) != 1 else ''} "
                           f"within a {req.max_walk_km:g} km walk of your start.")
        explanation.append(_first_move_line(vpm[0], need))
        explanation.append(
            f"Value-per-minute: {totals['bikes_fixed']} bikes in ~{totals['minutes']:.0f} min. "
            f"Nearest-first: {near_totals['bikes_fixed']} bikes in ~{near_totals['minutes']:.0f} min."
        )
        if actual is not None:
            explanation.append(
                f"On what actually happened, {totals['useful_on_actual']} of {len(vpm)} moves would have helped "
                f"(nearest-first: {near_totals['useful_on_actual']} of {len(near)})."
            )
    return {
        "steps": [_step_dict(s) for s in steps],
        "totals": totals,
        "comparison": {"name": "nearest-first", "steps": [_step_dict(s) for s in near_steps], "totals": near_totals},
        "explanation": explanation,
        "empty_reason": empty_reason,
    }


def _van_plan(req: PlanRequest, fc: forecast.WindowForecast, need: dict[str, int]) -> dict:
    coords = _coords()
    start = (req.lat, req.lng)
    stops = plan_van(start, need, coords, req.moves, req.van_capacity)
    steps = van_steps(need, stops, start, coords)
    totals = _totals(steps)
    picked = sum(s.bikes for s in stops if s.bikes > 0)
    explanation = [
        _forecast_line(fc),
        f"Van mode is untested: assumes {DRIVE_KMH:g} km/h driving, 1 min per stop, capacity {req.van_capacity}.",
    ]
    if stops:
        explanation.append(
            f"{len(stops)} stops: load {picked} bikes, deliver {totals['bikes_fixed']}, "
            f"~{totals['km']:.1f} km after 2-opt reordering."
        )
    return {
        "steps": [_step_dict(s) for s in steps],
        "totals": totals,
        "comparison": None,
        "explanation": explanation,
        "empty_reason": None if stops else "No surplus and deficit stations to pair in this window.",
    }


def _forecast_line(fc: forecast.WindowForecast) -> str:
    c = fc.table["label"].value_counts()
    return (
        f"Forecast ({MODEL_LABEL[fc.model_used]}) for {_window_text(fc.hours)}: "
        f"{c.get('surplus', 0)} stations in surplus, {c.get('deficit', 0)} in deficit "
        f"(±{LABEL_THRESHOLD} bikes)."
    )


def _first_move_line(m: Move, need: dict[str, int]) -> str:
    return (
        f"First move: {_name(m.pickup)} is forecast {need[m.pickup]:+d} and {_name(m.dropoff)} {need[m.dropoff]:+d}; "
        f"{m.minutes:.0f} min for the pair, the best value per minute available."
    )


@app.post("/api/plan")
def plan(req: PlanRequest) -> dict:
    fc = forecast.forecast_window(_check_at(req.at), req.window, req.model)
    need = fc.need()
    body = _van_plan(req, fc, need) if req.mode == "van" else _rider_plan(req, fc, need)
    return {
        "mode": req.mode,
        "model_used": fc.model_used,
        "at": fc.hours[0].isoformat(),
        "window": req.window,
        "start": {"lat": req.lat, "lng": req.lng},
        "has_actual": fc.has_actual,
        **body,
    }


@app.post("/api/explain")
def explain() -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content={"detail": "Not implemented: the LLM explanation is disabled by design (no LLM in the core loop)."},
    )

