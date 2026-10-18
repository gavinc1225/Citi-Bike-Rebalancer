"""Rebalancing planners. Distances are haversine so results match the A2 experiments.

`need` maps station_id -> integer imbalance: positive = surplus bikes to pick up,
negative = deficit to fill. Planners never mutate the caller's dict.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Iterable, Literal

from app.constants import RIDE_KMH, STEP_OVERHEAD_MIN, WALK_KMH
from app.geo import haversine_km

DRIVE_KMH = 20.0  # van mode only; an assumption, not from A2 (van mode is untested)

Point = tuple[float, float]
Coords = dict[str, Point]
StepKind = Literal["walk", "ride", "drive"]


@dataclass
class Step:
    kind: StepKind
    from_: str | None  # station id, or None for the user's start point
    to: str
    km: float
    minutes: float
    bikes: int  # bikes carried (ride) or loaded(+)/unloaded(-) at `to` (drive)
    from_need_before: int | None
    to_need_before: int

    def to_dict(self) -> dict:
        d = asdict(self)
        d["from"] = d.pop("from_")
        d["km"] = round(d["km"], 3)
        d["minutes"] = round(d["minutes"], 2)
        return d


@dataclass
class Move:
    """One rider move: pick a bike up at `pickup`, drop it at `dropoff`."""

    pickup: str
    dropoff: str
    walk_km: float
    ride_km: float
    minutes: float
    score: float


def _dist(a: Point, b: Point) -> float:
    return haversine_km(a[0], a[1], b[0], b[1])


def move_minutes(walk_km: float, ride_km: float) -> float:
    return 60 * (walk_km / WALK_KMH + ride_km / RIDE_KMH) + STEP_OVERHEAD_MIN


def _surplus(need: dict[str, int]) -> list[str]:
    return [s for s, n in need.items() if n >= 1]


def _deficit(need: dict[str, int]) -> list[str]:
    return [t for t, n in need.items() if n <= -1]


def plan_value_per_minute(
    start: Point, need: dict[str, int], coords: Coords, moves: int, max_walk_km: float
) -> list[Move]:
    need = dict(need)
    pos = start
    plan: list[Move] = []
    for _ in range(moves):
        deficits = _deficit(need)
        best: Move | None = None
        for s in _surplus(need):
            walk = _dist(pos, coords[s])
            if walk > max_walk_km:
                continue
            for t in deficits:
                ride = _dist(coords[s], coords[t])
                minutes = move_minutes(walk, ride)
                score = math.sqrt(min(need[s], -need[t])) / minutes
                if best is None or score > best.score:
                    best = Move(s, t, walk, ride, minutes, score)
        if best is None:
            break
        plan.append(best)
        need[best.pickup] -= 1
        need[best.dropoff] += 1
        pos = coords[best.dropoff]
    return plan


def plan_nearest_first(start: Point, need: dict[str, int], coords: Coords, moves: int) -> list[Move]:
    need = dict(need)
    pos = start
    plan: list[Move] = []
    for _ in range(moves):
        surplus, deficits = _surplus(need), _deficit(need)
        if not surplus or not deficits:
            break
        s = min(surplus, key=lambda sid: _dist(pos, coords[sid]))
        t = min(deficits, key=lambda tid: _dist(coords[s], coords[tid]))
        walk, ride = _dist(pos, coords[s]), _dist(coords[s], coords[t])
        minutes = move_minutes(walk, ride)
        plan.append(Move(s, t, walk, ride, minutes, math.sqrt(min(need[s], -need[t])) / minutes))
        need[s] -= 1
        need[t] += 1
        pos = coords[t]
    return plan


def rider_steps(plan: Iterable[Move], need: dict[str, int]) -> list[Step]:
    """Expand moves into walk + ride steps, recording the need before each visit."""
    need = dict(need)
    steps: list[Step] = []
    prev: str | None = None
    for m in plan:
        steps.append(Step("walk", prev, m.pickup, m.walk_km, 60 * m.walk_km / WALK_KMH, 0,
                          need.get(prev) if prev else None, need[m.pickup]))
        steps.append(Step("ride", m.pickup, m.dropoff, m.ride_km,
                          60 * m.ride_km / RIDE_KMH + STEP_OVERHEAD_MIN, 1, need[m.pickup], need[m.dropoff]))
        need[m.pickup] -= 1
        need[m.dropoff] += 1
        prev = m.dropoff
    return steps


def count_useful(plan: Iterable[Move], actual: dict[str, int]) -> int:
    """A move is useful if, on actual flow, the pickup still had >= 1 surplus and the dropoff <= -1."""
    actual = dict(actual)
    useful = 0
    for m in plan:
        if actual.get(m.pickup, 0) >= 1 and actual.get(m.dropoff, 0) <= -1:
            useful += 1
        actual[m.pickup] = actual.get(m.pickup, 0) - 1
        actual[m.dropoff] = actual.get(m.dropoff, 0) + 1
    return useful


# ---------------------------------------------------------------- van mode (untested)


@dataclass
class VanStop:
    station: str
    bikes: int  # +loaded, -unloaded


def _drive_minutes(km: float) -> float:
    return 60 * km / DRIVE_KMH + STEP_OVERHEAD_MIN


def _route_km(start: Point, stops: list[VanStop], coords: Coords) -> float:
    pts = [start, *(coords[s.station] for s in stops)]
    return sum(_dist(a, b) for a, b in zip(pts, pts[1:]))


def _load_ok(stops: list[VanStop], capacity: int) -> bool:
    load = 0
    for s in stops:
        load += s.bikes
        if load < 0 or load > capacity:
            return False
    return True


def _two_opt(start: Point, stops: list[VanStop], coords: Coords, capacity: int) -> list[VanStop]:
    best = list(stops)
    best_km = _route_km(start, best, coords)
    improved = True
    while improved:
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                cand = best[:i] + best[i : j + 1][::-1] + best[j + 1 :]
                km = _route_km(start, cand, coords)
                if km < best_km - 1e-9 and _load_ok(cand, capacity):
                    best, best_km, improved = cand, km, True
    return best


def plan_van(start: Point, need: dict[str, int], coords: Coords, max_stops: int, capacity: int) -> list[VanStop]:
    need = dict(need)
    pos = start
    load = 0
    stops: list[VanStop] = []

    def pick(cands: list[str], amount) -> tuple[str, int] | None:
        best, best_val = None, -1.0
        for sid in cands:
            n = amount(sid)
            if n <= 0:
                continue
            val = n / _drive_minutes(_dist(pos, coords[sid]))
            if val > best_val:
                best, best_val = (sid, n), val
        return best

    while len(stops) < max_stops:
        if load == 0:
            choice = pick(_surplus(need), lambda s: min(need[s], capacity - load))
            if choice is None or not _deficit(need):
                break
            sid, n = choice
            load += n
            need[sid] -= n
            stops.append(VanStop(sid, n))
        else:
            choice = pick(_deficit(need), lambda t: min(-need[t], load))
            if choice is None:
                break
            sid, n = choice
            load -= n
            need[sid] += n
            stops.append(VanStop(sid, -n))
        pos = coords[sid]
    return _two_opt(start, stops, coords, capacity)


def van_steps(start_need: dict[str, int], stops: list[VanStop], start: Point, coords: Coords) -> list[Step]:
    need = dict(start_need)
    steps: list[Step] = []
    pos, prev = start, None
    for stop in stops:
        km = _dist(pos, coords[stop.station])
        steps.append(Step("drive", prev, stop.station, km, _drive_minutes(km), stop.bikes,
                          need.get(prev) if prev else None, need[stop.station]))
        need[stop.station] -= stop.bikes
        pos, prev = coords[stop.station], stop.station
    return steps
