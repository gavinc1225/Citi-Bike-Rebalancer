import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import styles from "./EvidenceTab.module.css";
import { Skeleton } from "./ui";

type Source = "reproduced" | "a2";

interface EvidenceDoc {
  status?: string;
  forecast_mae: {
    window: string;
    rows: { model: string; mae: number; a2: number; source: Source; in_app?: string }[];
  };
  planner: {
    setup: string;
    moves: number;
    rows: { planner: string; useful: number; a2: number; minutes: number; km: number; source: Source }[];
  };
  roles: { role: string; count: number; a2_count: number; mean_morning_net: number; examples: string[] }[];
  labels: { agreement_sept28: number; source: Source };
  grounding: {
    a2: { correct: number; total: number; misses: string; source: Source };
    app_checks: { query: string; expected: string; got: string | null; via: string | null; correct: boolean }[];
  };
  decisions: { component: string; decision: string; status: "Adopt" | "Modify" | "Reject" | "Defer"; evidence: string }[];
  a2_raw: unknown;
}

function SourceTag({ source }: { source: Source }) {
  return (
    <span className={styles.source} title={source === "reproduced" ? "Recomputed by this app's pipeline" : "Quoted from A2"}>
      {source === "reproduced" ? "reproduced" : "A2"}
    </span>
  );
}

function Card({ title, children, lede }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {lede && <p className={styles.lede}>{lede}</p>}
      {children}
    </section>
  );
}

export function EvidenceTab() {
  const [doc, setDoc] = useState<EvidenceDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.evidence().then((e) => setDoc(e as unknown as EvidenceDoc), (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className={styles.lede}>{error}</p>;
  if (!doc) {
    return (
      <div className={styles.tab}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={140} />
        ))}
      </div>
    );
  }
  if (!doc.forecast_mae) {
    return <p className={styles.lede}>Evidence not built yet. Run `make data` and reload.</p>;
  }

  const bestMae = Math.min(...doc.forecast_mae.rows.map((r) => r.mae));
  const maxUseful = Math.max(...doc.planner.rows.map((r) => r.useful));

  return (
    <div className={styles.tab}>
      <p className={styles.legendLine}>
        <span className={styles.source}>reproduced</span> recomputed by this app from the Sept 2026 data ·{" "}
        <span className={styles.source}>A2</span> quoted from our A2 review
        {!doc.a2_raw && " (results.json not attached yet)"}
      </p>

      <Card title="Decisions" lede="What A2's evidence settled, and how the app implements it.">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Status</th>
              <th scope="col">In the app</th>
            </tr>
          </thead>
          <tbody>
            {doc.decisions.map((d) => (
              <tr key={d.component}>
                <th scope="row">{d.component}</th>
                <td>
                  <span className={`${styles.chip} ${styles[d.status.toLowerCase()]}`}>{d.status}</span>
                </td>
                <td>
                  {d.decision}
                  <div className={styles.why}>{d.evidence}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Forecasting" lede={`Mean absolute error, ${doc.forecast_mae.window}. Lower is better.`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col" className={styles.num}>MAE</th>
              <th scope="col" className={styles.num}>A2</th>
              <th scope="col">In app</th>
            </tr>
          </thead>
          <tbody>
            {doc.forecast_mae.rows.map((r) => (
              <tr key={r.model} className={r.mae === bestMae ? styles.best : undefined}>
                <th scope="row">{r.model}</th>
                <td className={styles.num}>
                  {r.mae.toFixed(2)} <SourceTag source={r.source} />
                </td>
                <td className={styles.num}>{r.a2.toFixed(2)}</td>
                <td>{r.in_app ?? "baseline"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.footnote}>
          Fixed monthly surplus/deficit labels agreed with the actual window only{" "}
          {Math.round(doc.labels.agreement_sept28 * 100)}% of the time on Sept 28 <SourceTag source={doc.labels.source} />,
          so labels come from the forecast for the selected window.
        </p>
      </Card>

      <Card title="Planner" lede={doc.planner.setup}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Planner</th>
              <th scope="col" className={styles.num}>Useful moves</th>
              <th scope="col" className={styles.num}>A2</th>
              <th scope="col" className={styles.num}>Total time</th>
            </tr>
          </thead>
          <tbody>
            {doc.planner.rows.map((r) => (
              <tr key={r.planner} className={r.useful === maxUseful ? styles.best : undefined}>
                <th scope="row">{r.planner}</th>
                <td className={styles.num}>
                  {r.useful}/{doc.planner.moves} <SourceTag source={r.source} />
                </td>
                <td className={styles.num}>{r.a2}</td>
                <td className={styles.num}>{Math.round(r.minutes / 60)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.footnote}>
          A move is useful if, on actual flow, the pickup really had a surplus and the dropoff a deficit. Value per
          minute spends a little more time but wastes far fewer moves.
        </p>
      </Card>

      <Card title="Station roles" lede="k-means (k=3) on normalized weekday 24-h net-flow profiles. Used for display only.">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col" className={styles.num}>Stations</th>
              <th scope="col" className={styles.num}>7–10am net</th>
              <th scope="col">Busiest</th>
            </tr>
          </thead>
          <tbody>
            {doc.roles.map((r) => (
              <tr key={r.role}>
                <th scope="row">{r.role}</th>
                <td className={styles.num}>
                  {r.count} <span className={styles.muted}>(A2 {r.a2_count})</span>
                </td>
                <td className={styles.num}>
                  {r.mean_morning_net > 0 ? "+" : ""}
                  {r.mean_morning_net.toFixed(1)}
                </td>
                <td className={styles.small}>{r.examples.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Location search"
        lede={`A2: ${doc.grounding.a2.correct}/${doc.grounding.a2.total} queries correct; the misses were ${doc.grounding.a2.misses}. The app adds a landmark alias table in front of TF-IDF.`}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Query</th>
              <th scope="col">Top match</th>
              <th scope="col" className={styles.center}>
                OK
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.grounding.app_checks.map((g) => (
              <tr key={g.query}>
                <th scope="row">“{g.query}”</th>
                <td>
                  {g.got ?? "—"} {g.via === "alias" && <span className={styles.muted}>(alias)</span>}
                </td>
                <td className={styles.center}>
                  <span className={g.correct ? styles.ok : styles.miss} aria-label={g.correct ? "correct" : "wrong"}>
                    {g.correct ? "✓" : "✗"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.footnote}>These are the app's own check queries, not the A2 query set.</p>
      </Card>
    </div>
  );
}
