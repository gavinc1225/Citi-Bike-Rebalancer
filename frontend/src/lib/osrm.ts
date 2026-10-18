import type { LatLng } from "../types";

export type Leg = { coords: [number, number][]; onStreets: boolean };

const OSRM = "https://router.project-osrm.org/route/v1";
const TIMEOUT_MS = 1500;

interface OsrmResponse {
  code: string;
  routes?: { legs: { steps: { geometry: { coordinates: [number, number][] } }[] }[] }[];
}

const straight = (a: LatLng, b: LatLng): Leg => ({
  coords: [
    [a.lng, a.lat],
    [b.lng, b.lat],
  ],
  onStreets: false,
});

/** One OSRM request for the whole route (one leg per step). Any failure or timeout -> straight legs. */
export async function routeLegs(points: LatLng[], profile: "foot" | "bike" | "driving"): Promise<Leg[]> {
  if (points.length < 2) return [];
  const fallback = points.slice(1).map((p, i) => straight(points[i]!, p));
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OSRM}/${profile}/${coords}?overview=false&steps=true&geometries=geojson`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as OsrmResponse;
    const legs = body.routes?.[0]?.legs;
    if (body.code !== "Ok" || !legs || legs.length !== fallback.length) return fallback;
    return legs.map((leg, i) => {
      const line = leg.steps.flatMap((s) => s.geometry.coordinates);
      return line.length >= 2 ? { coords: line, onStreets: true } : fallback[i]!;
    });
  } catch {
    return fallback;
  } finally {
    window.clearTimeout(timer);
  }
}
