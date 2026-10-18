import { useEffect, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { REPLAY_MAX, REPLAY_MIN, dayLabel, hourLabel, shortHour } from "../lib/format";
import { CHART, type ChartPalette } from "../lib/palette";
import type { DailyPoint, DayResponse, SystemResponse } from "../types";
import styles from "./ActivityTab.module.css";
import { PauseIcon, PlayIcon } from "./icons";
import { SectionLabel, Skeleton } from "./ui";

const STEP_MS = 750;
const LABOR_DAY = "2026-09-07";

export interface PlaybackFrame {
  date: string;
  hour: number;
  net: Record<string, number[]>;
}

interface Props {
  initialDate: string;
  dark: boolean;
  onPlayback: (frame: PlaybackFrame | null) => void;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

function tooltipStyle(c: ChartPalette) {
  return {
    contentStyle: { background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 13 },
    labelStyle: { color: c.ink, fontWeight: 600 },
    itemStyle: { color: c.ink },
  };
}

export function ActivityTab({ initialDate, dark, onPlayback }: Props) {
  const c = CHART[dark ? "dark" : "light"];
  const [system, setSystem] = useState<SystemResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.system().then(setSystem, (e: Error) => setError(e.message));
  }, []);

  return (
    <div className={styles.tab}>
      <Playback initialDate={initialDate} onPlayback={onPlayback} />
      {error && <p className={styles.error}>{error}</p>}
      <section className={styles.block} aria-labelledby="daily-title">
        <SectionLabel id="daily-title">Trips per day · September 2026</SectionLabel>
        {system ? <DailyChart daily={system.daily} c={c} /> : <Skeleton height={220} />}
        <p className={styles.note}>
          Sept 26–28 dropped far below normal (652 trips on Sun 27) with no cause in the data. The boosted forecast
          (black line) did not see it coming.
        </p>
      </section>
      <section className={styles.block} aria-labelledby="hourly-title">
        <SectionLabel id="hourly-title">Average trips by hour of day</SectionLabel>
        {system ? <HourlyChart hourly={system.hourly} c={c} /> : <Skeleton height={200} />}
      </section>
    </div>
  );
}

function DailyChart({ daily, c }: { daily: DailyPoint[]; c: ChartPalette }) {
  const data = daily.map((d) => ({ ...d, day: Number(d.date.slice(8)) }));
  return (
    <div className={styles.chart}>
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: -8 }} barCategoryGap={2}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <ReferenceArea
            x1={26}
            x2={28}
            fill={c.grid}
            fillOpacity={0.9}
            label={{ value: "Unexplained drop", position: "insideTop", fill: c.ink2, fontSize: 11, dy: -18 }}
          />
          <XAxis
            dataKey="day"
            ticks={[1, 7, 14, 21, 28]}
            tickFormatter={(d: number) => (d === 7 ? "Labor Day" : `Sep ${d}`)}
            stroke={c.ink2}
            tickLine={false}
            axisLine={{ stroke: c.grid }}
            fontSize={11}
          />
          <YAxis
            stroke={c.ink2}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={44}
            tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))}
          />
          <Tooltip
            {...tooltipStyle(c)}
            cursor={{ fill: c.grid }}
            labelFormatter={(_, payload) => {
              const p = payload?.[0]?.payload as (DailyPoint & { day: number }) | undefined;
              if (!p) return "";
              return `${dayLabel(p.date)}${p.date === LABOR_DAY ? " · Labor Day" : p.offday ? " · weekend" : ""}`;
            }}
            formatter={(v, name) => [fmtInt(Number(v)), name]}
          />
          <Bar dataKey="trips" name="Trips" radius={[3, 3, 0, 0]} isAnimationActive={false} fill={c.gray}>
            {data.map((d) => (
              <Cell key={d.date} fill={d.offday ? c.lightGray : c.gray} />
            ))}
          </Bar>
          <Line
            dataKey="gbm_trips"
            name="Boosted forecast"
            stroke={c.ink}
            strokeWidth={1.5}
            dot={{ r: 2, fill: c.ink }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className={styles.keyline}>
        <span className={styles.swatch} style={{ background: c.gray }} /> weekday
        <span className={styles.swatch} style={{ background: c.lightGray }} /> weekend & Labor Day
        <span className={styles.lineSwatch} style={{ background: c.ink }} /> boosted forecast (test week)
      </p>
    </div>
  );
}

function HourlyChart({ hourly, c }: { hourly: SystemResponse["hourly"]; c: ChartPalette }) {
  const data = hourly.hours.map((h, i) => ({ hour: h, weekday: hourly.weekday[i], offday: hourly.offday[i] }));
  return (
    <div className={styles.chart}>
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis
            dataKey="hour"
            ticks={[0, 6, 8, 12, 17, 23]}
            tickFormatter={shortHour}
            stroke={c.ink2}
            tickLine={false}
            axisLine={{ stroke: c.grid }}
            fontSize={11}
          />
          <YAxis stroke={c.ink2} tickLine={false} axisLine={false} fontSize={11} width={44} />
          <Tooltip
            {...tooltipStyle(c)}
            labelFormatter={(h) => hourLabel(Number(h))}
            formatter={(v, name) => [fmtInt(Number(v)), name]}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: c.ink2 }} />
          <Line
            dataKey="weekday"
            name="Weekday"
            stroke={c.accent}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
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
  );
}

function Playback({ initialDate, onPlayback }: { initialDate: string; onPlayback: Props["onPlayback"] }) {
  const [date, setDate] = useState(initialDate);
  const [hour, setHour] = useState(6);
  const [playing, setPlaying] = useState(false);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useRef(onPlayback);
  report.current = onPlayback;

  useEffect(() => {
    setDay(null);
    setError(null);
    api.day(date).then(setDay, (e: Error) => setError(e.message));
  }, [date]);

  useEffect(() => {
    if (day) report.current({ date: day.date, hour, net: day.net });
  }, [day, hour]);

  // Leaving the tab hands the map back to the forecast colouring.
  useEffect(() => () => report.current(null), []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setHour((h) => {
        if (h >= 23) {
          setPlaying(false);
          return 23;
        }
        return h + 1;
      });
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  const trips = day?.system_trips[hour];

  return (
    <section className={`${styles.block} ${styles.playback}`} aria-labelledby="playback-title">
      <SectionLabel id="playback-title">Playback · actual net flow on the map</SectionLabel>
      <div className={styles.playRow}>
        <button
          type="button"
          className={styles.play}
          aria-label={playing ? "Pause playback" : "Play the day hour by hour"}
          onClick={() => {
            if (!playing && hour >= 23) setHour(0);
            setPlaying(!playing);
          }}
          disabled={!day}
        >
          {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </button>
        <div className={styles.sliderWrap}>
          <label htmlFor="playback-hour" className={styles.hourReadout}>
            <strong>{hourLabel(hour)}</strong>
            <span>{trips !== undefined ? `${fmtInt(trips)} trips started` : "loading…"}</span>
          </label>
          <input
            id="playback-hour"
            type="range"
            min={0}
            max={23}
            step={1}
            value={hour}
            className={styles.slider}
            aria-valuetext={hourLabel(hour)}
            onChange={(e) => {
              setPlaying(false);
              setHour(Number(e.target.value));
            }}
          />
        </div>
        <label className={styles.dateField}>
          <span className="visually-hidden">Playback date</span>
          <input
            type="date"
            min={REPLAY_MIN}
            max={REPLAY_MAX}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.note}>
        Blue stations gained bikes that hour, red ones lost them. Watch hubs fill in the morning and drain in the
        evening.
      </p>
    </section>
  );
}
