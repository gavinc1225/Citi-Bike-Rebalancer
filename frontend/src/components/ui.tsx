import type { ReactNode } from "react";
import styles from "./ui.module.css";

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

/** Segmented control (radio group semantics). */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className={styles.segmented}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          disabled={o.disabled}
          title={o.title}
          className={styles.segment}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pill chips, single choice. */
export function ChipGroup<T extends string>(props: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className={styles.chips}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          disabled={o.disabled}
          title={o.title}
          className={styles.chip}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "dark" | "warn" }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

export function Switch(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={styles.switchRow}>
      <span>{props.label}</span>
      <input
        type="checkbox"
        role="switch"
        className={styles.switch}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <div className={styles.skeleton} style={{ height, width }} aria-hidden="true" />;
}

export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div className={styles.sectionLabel} id={id}>
      {children}
    </div>
  );
}
