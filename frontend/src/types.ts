export type Role = "Commuter hub" | "Residential source" | "Mixed";
export type Label = "surplus" | "deficit" | "balanced";
export type Model = "hist" | "gbm";
export type Mode = "rider" | "van";
export type Tab = "plan" | "activity" | "evidence";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Station extends LatLng {
  id: string;
  name: string;
  role: Role;
  total_departures: number;
}

export interface StationState {
  id: string;
  forecast_net: number;
  forecast_dep: number;
  forecast_arr: number;
  need: number;
  label: Label;
  actual_net: number | null;
}

export interface StateResponse {
  at: string;
  window: number;
  model_requested: Model;
  model_used: Model;
  gbm_available: boolean;
  has_actual: boolean;
  threshold: number;
  counts: Record<Label, number>;
  stations: StationState[];
}

export interface Step {
  kind: "walk" | "ride" | "drive";
  from: string | null;
  to: string;
  km: number;
  minutes: number;
  bikes: number;
  from_need_before: number | null;
  to_need_before: number;
  from_name: string | null;
  to_name: string;
}

export interface Totals {
  moves: number;
  km: number;
  minutes: number;
  walk_km: number;
  ride_km: number;
  bikes_fixed: number;
  useful_on_actual?: number;
}

export interface PlanAlt {
  name: string;
  steps: Step[];
  totals: Totals;
}

export interface PlanResponse {
  mode: Mode;
  model_used: Model;
  at: string;
  window: number;
  start: LatLng;
  has_actual: boolean;
  steps: Step[];
  totals: Totals;
  comparison: PlanAlt | null;
  explanation: string[];
  empty_reason: string | null;
}

export interface PlanRequest extends LatLng {
  at: string;
  window: number;
  model: Model;
  mode: Mode;
  moves: number;
  max_walk_km: number;
  van_capacity: number;
}

export interface GeocodeResult extends LatLng {
  id: string;
  name: string;
  score: number;
  source: "alias" | "tfidf";
}

export interface HourFlow {
  hour: number;
  dep: number;
  arr: number;
  net: number;
}

export interface Profile {
  id: string;
  name: string;
  role: Role;
  weekday: HourFlow[];
  offday: HourFlow[];
  daily_departures: { date: string; dep: number }[];
}

export interface DailyPoint {
  date: string;
  trips: number;
  dow: number;
  offday: boolean;
  gbm_trips: number | null;
}

export interface SystemResponse {
  daily: DailyPoint[];
  hourly: { hours: number[]; weekday: number[]; offday: number[] };
}

export interface DayResponse {
  date: string;
  net: Record<string, number[]>;
  system_trips: number[];
}

export type Evidence = Record<string, unknown>;
