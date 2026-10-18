import { REPLAY_MAX, REPLAY_MIN, hourLabel } from "../lib/format";
import type { GeocodeResult, Mode, Model, PlanResponse, StateResponse, Totals } from "../types";
import { BikeIcon, VanIcon } from "./icons";
import styles from "./PlanTab.module.css";
import { SearchBox } from "./SearchBox";
import { StepList } from "./StepList";
import { Badge, ChipGroup, Segmented, Skeleton, Switch } from "./ui";

export interface PlanTabProps {
  searchText: string;
  onSearchText: (v: string) => void;
  onPick: (r: GeocodeResult) => void;
  onLocate: () => void;
  onClearStart: () => void;
  locating: boolean;
  hasStart: boolean;

  mode: Mode;
  onMode: (m: Mode) => void;
  date: string;
  onDate: (d: string) => void;
  hour: number;
  onHour: (h: number) => void;
  windowH: number;
  onWindow: (w: number) => void;
  model: Model;
  onModel: (m: Model) => void;
  gbmOk: boolean;
  state: StateResponse | null;

  onFind: () => void;
  planning: boolean;
  plan: PlanResponse | null;
  compare: boolean;
  onCompare: (v: boolean) => void;
  activeStep: number | null;
  onSelectStep: (i: number) => void;
  explainEnabled: boolean;
  onExplain: () => void;
}

const WINDOWS = [1, 3, 4] as const;

function summary(t: Totals, mode: Mode): string {
  const unit = mode === "van" ? "stop" : "move";
  const fix = mode === "van" ? `delivers ${t.bikes_fixed} bikes` : `fixes ${t.bikes_fixed} bikes of imbalance`;
  return `${t.moves} ${unit}${t.moves === 1 ? "" : "s"} · ${t.km.toFixed(1)} km · ~${Math.round(t.minutes)} min · ${fix}`;
}

export function PlanTab(p: PlanTabProps) {
  const plan = p.plan;
  const alt = plan?.comparison ?? null;

  return (
    <div className={styles.tab}>
      <SearchBox
        value={p.searchText}
        onValueChange={p.onSearchText}
        onPick={p.onPick}
        onLocate={p.onLocate}
        onClear={p.onClearStart}
        locating={p.locating}
      />
      {!p.hasStart && <p className={styles.hint}>Search, use your location, or click the map to drop a pin.</p>}

      <Segmented
        label="Mode"
        value={p.mode}
        onChange={p.onMode}
        options={[
          { value: "rider", label: <><BikeIcon size={18} /> Rider</> },
          { value: "van", label: <><VanIcon size={18} /> Van</> },
        ]}
      />

      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Date</span>
          <input
            type="date"
            className={styles.input}
            min={REPLAY_MIN}
            max={REPLAY_MAX}
            value={p.date}
            onChange={(e) => e.target.value && p.onDate(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Start</span>
          <select className={styles.input} value={p.hour} onChange={(e) => p.onHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.row}>
        <ChipGroup
          label="Forecast window"
          value={String(p.windowH)}
          onChange={(v) => p.onWindow(Number(v))}
          options={WINDOWS.map((w) => ({ value: String(w), label: `${w} h` }))}
        />
        <ChipGroup
          label="Forecast model"
          value={p.model}
          onChange={p.onModel}
          options={[
            { value: "hist", label: "Average" },
            {
              value: "gbm",
              label: "Boosted",
              disabled: !p.gbmOk,
              title: p.gbmOk
                ? "Gradient-boosted forecast"
                : "Boosted forecasts exist only for the test week, Sept 24–30",
            },
          ]}
        />
      </div>

      <StateLine state={p.state} />

      <button type="button" className={styles.primary} onClick={p.onFind} disabled={!p.hasStart || p.planning}>
        {p.planning ? "Finding moves…" : "Find best moves"}
      </button>

      {p.planning && !plan && (
        <div className={styles.results} aria-hidden="true">
          <Skeleton height={20} width="80%" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      )}

      {plan && (
        <section className={styles.results} aria-label="Plan" aria-busy={p.planning}>
          {plan.empty_reason ? (
            <div className={styles.empty}>{plan.empty_reason}</div>
          ) : (
            <>
              <div className={styles.summaryRow}>
                <p className={styles.summary}>{summary(plan.totals, plan.mode)}</p>
                {plan.mode === "van" && <Badge tone="warn">Untested</Badge>}
              </div>
              {plan.totals.useful_on_actual !== undefined && (
                <p className={styles.hindsight}>
                  In hindsight: {plan.totals.useful_on_actual} of {plan.totals.moves} moves helped on what actually
                  happened.
                </p>
              )}
              {alt && (
                <>
                  <Switch label="Compare with nearest-first" checked={p.compare} onChange={p.onCompare} />
                  {p.compare && <CompareTable best={plan.totals} alt={alt.totals} />}
                </>
              )}
              <StepList steps={plan.steps} active={p.activeStep} onSelect={p.onSelectStep} />
            </>
          )}
          {plan.explanation.length > 0 && (
            <details className={styles.why}>
              <summary>Why this plan</summary>
              <ul>
                {plan.explanation.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </details>
          )}
          {p.explainEnabled && (
            <button type="button" className={styles.secondary} onClick={p.onExplain}>
              Explain this plan
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function StateLine({ state }: { state: StateResponse | null }) {
  if (!state) return <Skeleton height={18} width="70%" />;
  const fellBack = state.model_requested === "gbm" && state.model_used === "hist";
  return (
    <p className={styles.stateLine}>
      <span className={styles.dotSurplus} aria-hidden="true" /> {state.counts.surplus} surplus
      <span className={styles.dotDeficit} aria-hidden="true" /> {state.counts.deficit} deficit
      <span className={styles.dotBalanced} aria-hidden="true" /> {state.counts.balanced} balanced
      {fellBack && <span className={styles.note}> · using Average (Boosted unavailable for this window)</span>}
    </p>
  );
}

function CompareTable({ best, alt }: { best: Totals; alt: Totals }) {
  const rows: [string, (t: Totals) => string][] = [
    ["Bikes moved", (t) => String(t.bikes_fixed)],
    ["Distance", (t) => `${t.km.toFixed(1)} km`],
    ["Time", (t) => `~${Math.round(t.minutes)} min`],
  ];
  if (best.useful_on_actual !== undefined) rows.push(["Helped (actual)", (t) => `${t.useful_on_actual}/${t.moves}`]);
  return (
    <table className={styles.compare}>
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">Metric</span>
          </th>
          <th scope="col">Value per minute</th>
          <th scope="col" className={styles.altHead}>
            Nearest-first
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, f]) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            <td>{f(best)}</td>
            <td className={styles.altCell}>{f(alt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
