import type {
  DayResponse,
  Evidence,
  GeocodeResult,
  Model,
  PlanRequest,
  PlanResponse,
  Profile,
  StateResponse,
  Station,
  SystemResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error("Can't reach the backend. Is `make dev` running?");
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep the status text */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  stations: () => request<Station[]>("/api/stations"),
  state: (at: string, window: number, model: Model, signal?: AbortSignal) =>
    request<StateResponse>(`/api/state?${qs({ at, window, model })}`, { signal }),
  profile: (id: string) => request<Profile>(`/api/station/${encodeURIComponent(id)}/profile`),
  plan: (body: PlanRequest, signal?: AbortSignal) =>
    request<PlanResponse>("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  geocode: (q: string, signal?: AbortSignal) => request<GeocodeResult[]>(`/api/geocode?${qs({ q })}`, { signal }),
  system: () => request<SystemResponse>("/api/system"),
  day: (date: string) => request<DayResponse>(`/api/day?${qs({ date })}`),
  evidence: () => request<Evidence>("/api/evidence"),
};

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";
