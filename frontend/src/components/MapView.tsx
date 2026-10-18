import {
  LngLatBounds,
  Map as MLMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type PaddingOptions,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";
import { routeLegs, type Leg } from "../lib/osrm";
import { MAP_STYLE, PALETTE, type MapPalette } from "../lib/palette";
import type { Label, LatLng, PlanResponse, Station, Step } from "../types";
import styles from "./MapView.module.css";

export interface StationPaint {
  label: Label;
  mag: number;
}

export interface MapFocus extends LatLng {
  key: number;
}

interface Props {
  stations: Station[];
  paint: Record<string, StationPaint>;
  selectedId: string | null;
  start: LatLng | null;
  plan: PlanResponse | null;
  showCompare: boolean;
  activeStep: number | null;
  focus: MapFocus | null;
  padding: PaddingOptions;
  dark: boolean;
  reducedMotion: boolean;
  onMapClick: (p: LatLng) => void;
  onStationClick: (id: string) => void;
  onRouteDrawn: (onStreets: boolean) => void;
}

// Vite's dep optimizer can't see maplibre's worker file, so point at it explicitly.
setWorkerUrl(workerUrl);

type FC = FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };
const CENTER: [number, number] = [-74.045, 40.729];

function addLayers(map: MLMap, p: MapPalette) {
  map.addSource("stations", { type: "geojson", data: EMPTY });
  map.addSource("route", { type: "geojson", data: EMPTY });
  map.addSource("compare", { type: "geojson", data: EMPTY });

  map.addLayer({
    id: "compare-line",
    type: "line",
    source: "compare",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.compare, "line-width": 3, "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "route-walk",
    type: "line",
    source: "route",
    filter: ["==", ["get", "kind"], "walk"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.walk, "line-width": 3, "line-dasharray": [0.1, 2] },
  });
  map.addLayer({
    id: "route-ride",
    type: "line",
    source: "route",
    filter: ["all", ["!=", ["get", "kind"], "walk"], ["==", ["get", "onStreets"], true]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": p.route, "line-width": ["case", ["get", "active"], 6, 4] },
  });
  map.addLayer({
    id: "route-ride-straight",
    type: "line",
    source: "route",
    filter: ["all", ["!=", ["get", "kind"], "walk"], ["==", ["get", "onStreets"], false]],
    layout: { "line-join": "round" },
    paint: { "line-color": p.route, "line-width": ["case", ["get", "active"], 5, 3], "line-dasharray": [2, 1.5] },
  });

  const radius = (k: number): ExpressionSpecification => [
    "*",
    k,
    ["interpolate", ["linear"], ["sqrt", ["get", "mag"]], 0, 4, 1.7, 6, 3, 9, 6, 15, 9, 21],
  ];
  map.addLayer({
    id: "stations-circle",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, radius(0.7), 13, radius(1), 16, radius(1.4)],
      "circle-color": [
        "match",
        ["get", "label"],
        "surplus",
        p.surplus,
        "deficit",
        p.deficit,
        p.balanced,
      ],
      "circle-opacity": ["match", ["get", "label"], "deficit", 0.85, 1],
      "circle-stroke-color": ["case", ["get", "selected"], p.selected, p.stroke],
      "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
    },
  });
  // Invisible, larger hit target so stations are easy to tap.
  map.addLayer({
    id: "stations-hit",
    type: "circle",
    source: "stations",
    paint: { "circle-radius": 14, "circle-opacity": 0 },
  });
}

function stepMarkers(steps: Step[], coords: Map<string, LatLng>): { at: LatLng; text: string; pickup: boolean }[] {
  const groups = new Map<string, { at: LatLng; nums: number[]; pickup: boolean }>();
  let move = 0;
  for (const s of steps) {
    const pickup = s.kind === "walk" || (s.kind === "drive" && s.bikes > 0);
    if (s.kind !== "ride") move += 1;
    const at = coords.get(s.to);
    if (!at) continue;
    const key = `${s.to}:${pickup}`;
    const g = groups.get(key) ?? { at, nums: [], pickup };
    if (g.nums.at(-1) !== move) g.nums.push(move);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    at: g.at,
    pickup: g.pickup,
    text: g.nums.length > 3 ? `${g.nums[0]} +${g.nums.length - 1}` : g.nums.join("·"),
  }));
}

function legFeatures(steps: Step[], legs: Leg[], activeIndex: number | null): FC {
  return {
    type: "FeatureCollection",
    features: legs.map((leg, i) => ({
      type: "Feature",
      properties: { kind: steps[i]?.kind ?? "ride", onStreets: leg.onStreets, active: i === activeIndex },
      geometry: { type: "LineString", coordinates: leg.coords },
    })),
  };
}

function stepPoints(start: LatLng, steps: Step[], coords: Map<string, LatLng>): LatLng[] {
  return [start, ...steps.map((s) => coords.get(s.to) ?? start)];
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const legsRef = useRef<Leg[]>([]);
  const pinRef = useRef<Marker | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const theme = props.dark ? "dark" : "light";

  const coordsRef = useRef(new Map<string, LatLng>());
  coordsRef.current = new Map(props.stations.map((s) => [s.id, { lat: s.lat, lng: s.lng }]));

  // --- data sync helpers (safe to call before the style has loaded)
  const syncStations = () => {
    const map = mapRef.current;
    const src = map?.getSource("stations") as GeoJSONSource | undefined;
    if (!src) return;
    const { stations, paint, selectedId } = latest.current;
    src.setData({
      type: "FeatureCollection",
      features: stations.map((s) => {
        const sp = paint[s.id];
        return {
          type: "Feature",
          id: s.id,
          properties: { id: s.id, name: s.name, label: sp?.label ?? "balanced", mag: sp?.mag ?? 0, selected: s.id === selectedId },
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        };
      }),
    });
  };

  const syncRoute = () => {
    const map = mapRef.current;
    const src = map?.getSource("route") as GeoJSONSource | undefined;
    if (!src) return;
    const steps = latest.current.plan?.steps ?? [];
    src.setData(steps.length ? legFeatures(steps, legsRef.current, latest.current.activeStep) : EMPTY);
  };

  const syncCompare = () => {
    const map = mapRef.current;
    const src = map?.getSource("compare") as GeoJSONSource | undefined;
    if (!src) return;
    const { plan, showCompare, start } = latest.current;
    const alt = plan?.comparison;
    if (!showCompare || !alt || !start || !alt.steps.length) {
      src.setData(EMPTY);
      return;
    }
    const pts = stepPoints(start, alt.steps, coordsRef.current);
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) },
        },
      ],
    });
  };

  // --- mount
  useEffect(() => {
    if (!container.current) return;
    const map = new MLMap({
      container: container.current,
      style: MAP_STYLE[theme],
      center: CENTER,
      zoom: 12.6,
      minZoom: 10,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.getCanvas().setAttribute("aria-label", "Map of Citi Bike stations in Jersey City and Hoboken");
    mapRef.current = map;

    map.on("style.load", () => {
      addLayers(map, PALETTE[latest.current.dark ? "dark" : "light"]);
      ready.current = true;
      syncStations();
      syncRoute();
      syncCompare();
    });

    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 12, className: styles.popup });
    map.on("mousemove", "stations-hit", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f || f.geometry.type !== "Point") return;
      popup
        .setLngLat(f.geometry.coordinates as [number, number])
        .setText(String(f.properties?.name ?? ""))
        .addTo(map);
    });
    map.on("mouseleave", "stations-hit", () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
    map.on("click", (e) => {
      const hits = map.getLayer("stations-hit") ? map.queryRenderedFeatures(e.point, { layers: ["stations-hit"] }) : [];
      const id = hits[0]?.properties?.id;
      if (typeof id === "string") latest.current.onStationClick(id);
      else latest.current.onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    return () => {
      ready.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- theme switch: reload the basemap; style.load re-adds our layers
  const firstTheme = useRef(theme);
  useEffect(() => {
    if (theme === firstTheme.current) return;
    firstTheme.current = theme;
    ready.current = false;
    mapRef.current?.setStyle(MAP_STYLE[theme], { diff: false });
    pinRef.current?.getElement().classList.toggle(styles.pinDark ?? "", props.dark);
  }, [theme, props.dark]);

  useEffect(syncStations, [props.stations, props.paint, props.selectedId]);
  useEffect(syncCompare, [props.plan, props.showCompare, props.start]);
  useEffect(syncRoute, [props.activeStep]);

  // --- user pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.start) {
      pinRef.current?.remove();
      pinRef.current = null;
      return;
    }
    if (!pinRef.current) {
      const el = document.createElement("div");
      el.className = `${styles.pin} ${latest.current.dark ? styles.pinDark : ""}`;
      el.setAttribute("aria-label", "Your start point");
      el.setAttribute("role", "img");
      pinRef.current = new Marker({ element: el, anchor: "bottom" });
    }
    pinRef.current.setLngLat([props.start.lng, props.start.lat]).addTo(map);
  }, [props.start]);

  // --- route: fetch street geometry, draw, add numbered markers, fit
  useEffect(() => {
    const map = mapRef.current;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    legsRef.current = [];
    const plan = props.plan;
    if (!map || !plan || !plan.steps.length) {
      syncRoute();
      return;
    }
    let cancelled = false;
    const coords = coordsRef.current;
    const points = stepPoints(plan.start, plan.steps, coords);
    // Straight legs first so something shows instantly, then upgrade to street paths.
    legsRef.current = points.slice(1).map((p, i) => ({
      coords: [
        [points[i]!.lng, points[i]!.lat],
        [p.lng, p.lat],
      ],
      onStreets: false,
    }));
    syncRoute();

    for (const m of stepMarkers(plan.steps, coords)) {
      const el = document.createElement("div");
      el.className = `${styles.stepMarker} ${m.pickup ? styles.pickup : ""}`;
      el.textContent = m.text;
      el.setAttribute("aria-hidden", "true");
      markersRef.current.push(new Marker({ element: el }).setLngLat([m.at.lng, m.at.lat]).addTo(map));
    }

    const bounds = new LngLatBounds();
    points.forEach((p) => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, {
      padding: latest.current.padding,
      maxZoom: 15.5,
      duration: latest.current.reducedMotion ? 0 : 700,
    });

    routeLegs(points, plan.mode === "van" ? "driving" : "bike").then((legs) => {
      if (cancelled) return;
      legsRef.current = legs;
      syncRoute();
      latest.current.onRouteDrawn(legs.length > 0 && legs.every((l) => l.onStreets));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.plan]);

  // --- camera focus (tapping a step)
  useEffect(() => {
    const map = mapRef.current;
    const f = props.focus;
    if (!map || !f) return;
    const opts = { center: [f.lng, f.lat] as [number, number], zoom: Math.max(map.getZoom(), 15), padding: props.padding };
    if (props.reducedMotion) map.jumpTo(opts);
    else map.flyTo({ ...opts, speed: 1.4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus]);

  return <div ref={container} className={styles.map} />;
}
