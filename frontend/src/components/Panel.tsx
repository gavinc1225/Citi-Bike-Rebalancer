import type { ReactNode } from "react";
import type { Tab } from "../types";
import styles from "./Panel.module.css";

const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "activity", label: "Activity" },
  { id: "evidence", label: "Evidence" },
];

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  expanded: boolean;
  onExpanded: (v: boolean) => void;
  wide: boolean;
  children: ReactNode;
}

export function Panel({ tab, onTab, expanded, onExpanded, wide, children }: Props) {
  return (
    <section
      className={`${styles.panel} ${expanded ? styles.expanded : ""} ${wide ? styles.wide : ""}`}
      aria-label="Citi Bike Rebalancer"
    >
      <button
        type="button"
        className={styles.handle}
        aria-label={expanded ? "Collapse panel" : "Expand panel"}
        aria-expanded={expanded}
        onClick={() => onExpanded(!expanded)}
      >
        <span className={styles.grip} />
      </button>
      <header className={styles.header}>
        <h1 className={styles.brand}>Citi Bike Rebalancer</h1>
        <div role="tablist" aria-label="Sections" className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-${t.id}`}
              className={styles.tab}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className={styles.body}>
        {children}
      </div>
    </section>
  );
}
