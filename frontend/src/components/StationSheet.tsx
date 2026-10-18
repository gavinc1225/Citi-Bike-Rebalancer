import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { hourLabel, shortHour, signed } from "../lib/format";
import { CHART } from "../lib/palette";
import type { Profile, Role, StateResponse, Station } from "../types";
import { CloseIcon } from "./icons";
import styles from "./StationSheet.module.css";
import { Badge, SectionLabel, Skeleton } from "./ui";

const ROLE_NOTE: Record<Role, string> = {
  "Commuter hub": "Fills with bikes on weekday mornings as commuters arrive.",
  "Residential source": "Empties on weekday mornings as riders head out.",
  Mixed: "No strong weekday pattern.",
};

interface Props {
  station: Station;
  state: StateResponse | null;
  hour: number;
  windowH: number;
  dark: boolean;
  onClose: () => void;
}

export function StationSheet({ station, state, hour, windowH, dark, onClose }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = CHART[dark ? "dark" : "light"];
  const s = state?.stations.find((x) => x.id === station.id);

  useEffect(() => {
    setProfile(null);
    setError(null);
    api.profile(station.id).then(setProfile, (e: Error) => setError(e.message));
  }, [station.id]);

  const data = profile?.weekday.map((w, i) => ({
    hour: w.hour,
    weekday: w.net,
    offday: profile.offday[i]?.net ?? 0,
  }));

  return (
    <aside className={styles.sheet} aria-label={`Station ${station.name}`}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{station.name}</h2>
          <div className={styles.meta}>
            <Badge tone="dark">{station.role}</Badge>
            <span>{ROLE_NOTE[station.role]}</span>
          </div>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close station details">
          <CloseIcon size={18} />
        </button>
      </header>

      <section className={styles.block}>
        <SectionLabel>
          Forecast · {hourLabel(hour)}–{hourLabel(hour + windowH)}
        </SectionLabel>
        {s ? (
          <div className={styles.stats}>
            <div>
              <div className={`${styles.big} ${styles[s.label]}`}>{signed(Math.round(s.forecast_net))}</div>
              <div className={styles.statLabel}>net bikes · {s.label}</div>
            </div>
            <div>
              <div className={styles.mid}>{s.forecast_dep.toFixed(1)}</div>
              <div className={styles.statLabel}>departures</div>
            </div>
            <div>
              <div className={styles.mid}>{s.forecast_arr.toFixed(1)}</div>
              <div className={styles.statLabel}>arrivals</div>
            </div>
          </div>
        ) : (
          <Skeleton height={48} />
        )}
        {s && s.actual_net !== null && (
          <p className={styles.actual}>
            What actually happened: <strong>{signed(s.actual_net)}</strong> net bikes
            {Math.abs(s.actual_net - s.forecast_net) >= 5 && " — the forecast missed by a lot here"}.
          </p>
        )}
      </section>

      <section className={styles.block}>
        <SectionLabel>Typical net flow by hour (Sept 2–23)</SectionLabel>
        {error && <p className={styles.actual}>{error}</p>}
        {!data && !error && <Skeleton height={190} />}
        {data && (
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="hour"
                  ticks={[0, 6, 12, 18, 23]}
                  tickFormatter={shortHour}
                  stroke={c.ink2}
                  tickLine={false}
                  axisLine={{ stroke: c.grid }}
                  fontSize={12}
                />
                <YAxis stroke={c.ink2} tickLine={false} axisLine={false} fontSize={12} width={44} />
                <ReferenceLine y={0} stroke={c.gray} />
                <ReferenceLine
                  x={hour}
                  stroke={c.ink}
                  strokeDasharray="3 3"
                  label={{ value: "now", position: "insideTopRight", fill: c.ink2, fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v, name) => [signed(Math.round(Number(v) * 10) / 10), name]}
                  labelFormatter={(h) => hourLabel(Number(h))}
                  contentStyle={{ background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 13 }}
                  labelStyle={{ color: c.ink }}
                  itemStyle={{ color: c.ink }}
                />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: c.ink2 }} />
                <Line
                  type="monotone"
                  dataKey="weekday"
                  name="Weekday"
                  stroke={c.accent}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="offday"
                  name="Weekend & holiday"
                  stroke={c.gray}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className={styles.footnote}>Positive = bikes pile up (arrivals exceed departures).</p>
      </section>
    </aside>
  );
}
