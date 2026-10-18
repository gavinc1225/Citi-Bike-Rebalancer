import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isAbort } from "./api";
import { ActivityTab, type PlaybackFrame } from "./components/ActivityTab";
import { MapView, type MapFocus, type StationPaint } from "./components/MapView";
import { EvidenceTab } from "./components/EvidenceTab";
import { Legend } from "./components/Legend";
import { Panel } from "./components/Panel";
import { PlanTab } from "./components/PlanTab";
import { StationSheet } from "./components/StationSheet";
import { useToast } from "./components/Toasts";
import { hourLabel, inTestWeek, isoAt } from "./lib/format";
import { useDarkMode, useIsMobile, useReducedMotion } from "./lib/hooks";
import type { GeocodeResult, LatLng, Mode, Model, PlanResponse, StateResponse, Station, Tab } from "./types";

const EXPLAIN_ENABLED = import.meta.env.VITE_ENABLE_EXPLAIN === "true";
const SERVICE_AREA = { minLat: 40.68, maxLat: 40.78, minLng: -74.12, maxLng: -74.0 };

export default function App() {
  const toast = useToast();
  const dark = useDarkMode();
  const reducedMotion = useReducedMotion();
  const mobile = useIsMobile();

  const [stations, setStations] = useState<Station[]>([]);
  const [tab, setTab] = useState<Tab>("plan");
  const [expanded, setExpanded] = useState(false);

  const [start, setStart] = useState<LatLng | null>(null);
  const [searchText, setSearchText] = useState("");
  const [locating, setLocating] = useState(false);
  const [mode, setMode] = useState<Mode>("rider");
  const [date, setDate] = useState("2026-09-29");
  const [hour, setHour] = useState(7);
  const [windowH, setWindowH] = useState(3);
  const [model, setModel] = useState<Model>("hist");

  const [state, setState] = useState<StateResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planning, setPlanning] = useState(false);
  const [compare, setCompare] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [streets, setStreets] = useState<boolean | null>(null);
  const [playback, setPlayback] = useState<PlaybackFrame | null>(null);
  const planCtrl = useRef<AbortController | null>(null);

  const gbmOk = inTestWeek(date);
  const at = isoAt(date, hour);

  useEffect(() => {
    api.stations().then(setStations, (e: Error) => toast(e.message));
  }, [toast]);

  useEffect(() => {
    if (!gbmOk && model === "gbm") setModel("hist");
  }, [gbmOk, model]);

  useEffect(() => {
    const ctrl = new AbortController();
    api.state(at, windowH, model, ctrl.signal).then(setState, (e: Error) => {
      if (!isAbort(e)) toast(e.message);
    });
    return () => ctrl.abort();
  }, [at, windowH, model, toast]);

  // Any input change makes the current plan stale.
  useEffect(() => {
    planCtrl.current?.abort();
    setPlan(null);
    setActiveStep(null);
    setStreets(null);
  }, [start, mode, at, windowH, model]);

  const coords = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  const paint = useMemo(() => {
    const out: Record<string, StationPaint> = {};
    if (playback) {
      for (const [id, series] of Object.entries(playback.net)) {
        const v = series[playback.hour] ?? 0;
        out[id] = { label: v >= 1 ? "surplus" : v <= -1 ? "deficit" : "balanced", mag: Math.abs(v) * 3 };
      }
      return out;
    }
    for (const s of state?.stations ?? []) out[s.id] = { label: s.label, mag: Math.abs(s.forecast_net) };
    return out;
  }, [state, playback]);

  const padding = useMemo(
    () =>
      mobile
        ? { top: 70, right: 30, bottom: Math.round(window.innerHeight * 0.48), left: 30 }
        : { top: 50, right: selected ? 400 : 60, bottom: 50, left: tab === "plan" ? 420 : 600 },
    [mobile, selected, tab],
  );

  const pickStart = useCallback((p: LatLng, label: string) => {
    setStart(p);
    setSearchText(label);
  }, []);

  const onPick = (r: GeocodeResult) => pickStart({ lat: r.lat, lng: r.lng }, r.name);

  const onLocate = () => {
    if (!navigator.geolocation) {
      toast("Location isn't available in this browser. Search or click the map instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const inside =
          p.lat >= SERVICE_AREA.minLat && p.lat <= SERVICE_AREA.maxLat && p.lng >= SERVICE_AREA.minLng && p.lng <= SERVICE_AREA.maxLng;
        if (!inside) {
          toast("You're outside Jersey City / Hoboken. Search a station or click the map instead.", "info");
          return;
        }
        pickStart(p, "My location");
        setFocus({ ...p, key: Date.now() });
      },
      () => {
        setLocating(false);
        toast("Couldn't get your location. Search or click the map instead.");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const onFind = async () => {
    if (!start) return;
    planCtrl.current?.abort();
    const ctrl = new AbortController();
    planCtrl.current = ctrl;
    setPlanning(true);
    setActiveStep(null);
    try {
      const res = await api.plan(
        { ...start, at, window: windowH, model, mode, moves: 10, max_walk_km: 1.0, van_capacity: 20 },
        ctrl.signal,
      );
      setPlan(res);
      setSelected(null);
    } catch (e) {
      if (!isAbort(e)) toast((e as Error).message);
    } finally {
      if (planCtrl.current === ctrl) setPlanning(false);
    }
  };

  const onSelectStep = (i: number) => {
    const step = plan?.steps[i];
    const s = step && coords.get(step.to);
    if (!s) return;
    setActiveStep(i);
    setFocus({ lat: s.lat, lng: s.lng, key: Date.now() });
    if (mobile) setExpanded(false);
  };

  const onExplain = async () => {
    try {
      const res = await fetch("/api/explain", { method: "POST" });
      const body = (await res.json()) as { detail?: string };
      toast(body.detail ?? `Explain returned ${res.status}`, "info");
    } catch {
      toast("Explain endpoint unreachable.");
    }
  };

  const selectedStation = selected ? coords.get(selected) ?? null : null;
  const legendTitle = playback ? `Actual · ${hourLabel(playback.hour)}` : state?.model_used === "gbm" ? "Boosted forecast" : "Forecast";

  return (
    <main style={{ position: "absolute", inset: 0 }}>
      <MapView
        stations={stations}
        paint={paint}
        selectedId={selected}
        start={start}
        plan={tab === "plan" ? plan : null}
        showCompare={compare}
        activeStep={activeStep}
        focus={focus}
        padding={padding}
        dark={dark}
        reducedMotion={reducedMotion}
        onMapClick={(p) => {
          if (tab !== "plan") return;
          pickStart(p, "Dropped pin");
          setSelected(null);
        }}
        onStationClick={setSelected}
        onRouteDrawn={setStreets}
      />

      <Panel tab={tab} onTab={setTab} expanded={expanded} onExpanded={setExpanded} wide={tab !== "plan"}>
        {tab === "plan" && (
          <PlanTab
            searchText={searchText}
            onSearchText={setSearchText}
            onPick={onPick}
            onLocate={onLocate}
            onClearStart={() => {
              setStart(null);
              setSearchText("");
            }}
            locating={locating}
            hasStart={start !== null}
            mode={mode}
            onMode={setMode}
            date={date}
            onDate={setDate}
            hour={hour}
            onHour={setHour}
            windowH={windowH}
            onWindow={setWindowH}
            model={model}
            onModel={setModel}
            gbmOk={gbmOk}
            state={state}
            onFind={onFind}
            planning={planning}
            plan={plan}
            compare={compare}
            onCompare={setCompare}
            activeStep={activeStep}
            onSelectStep={onSelectStep}
            explainEnabled={EXPLAIN_ENABLED}
            onExplain={onExplain}
          />
        )}
        {tab === "activity" && <ActivityTab initialDate={date} dark={dark} onPlayback={setPlayback} />}
        {tab === "evidence" && <EvidenceTab />}
      </Panel>

      {selectedStation && (
        <StationSheet
          station={selectedStation}
          state={playback ? null : state}
          hour={hour}
          windowH={windowH}
          dark={dark}
          onClose={() => setSelected(null)}
        />
      )}

      <Legend title={legendTitle} streets={tab === "plan" && plan ? streets : null} />
    </main>
  );
}
