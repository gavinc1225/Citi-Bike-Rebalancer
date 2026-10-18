import { mins, needLabel } from "../lib/format";
import type { Step } from "../types";
import { BikeIcon, VanIcon, WalkIcon } from "./icons";
import styles from "./StepList.module.css";

const ICONS = { walk: WalkIcon, ride: BikeIcon, drive: VanIcon };
const VERB = { walk: "Walk", ride: "Ride", drive: "Drive" };

function detail(step: Step): string {
  if (step.kind === "drive") {
    const action = step.bikes > 0 ? `load ${step.bikes}` : `unload ${-step.bikes}`;
    return `${action} · ${needLabel(step.to_need_before)}`;
  }
  return needLabel(step.to_need_before);
}

export function StepList(props: { steps: Step[]; active: number | null; onSelect: (i: number) => void }) {
  let move = 0;
  return (
    <ol className={styles.list} aria-label="Steps">
      {props.steps.map((step, i) => {
        if (step.kind !== "ride") move += 1;
        const Icon = ICONS[step.kind];
        const showNumber = step.kind !== "ride";
        return (
          <li key={i}>
            <button
              type="button"
              className={styles.step}
              aria-current={props.active === i ? "step" : undefined}
              onClick={() => props.onSelect(i)}
            >
              <span className={styles.num} aria-hidden="true">
                {showNumber ? move : ""}
              </span>
              <span className={`${styles.icon} ${styles[step.kind]}`}>
                <Icon size={18} />
              </span>
              <span className={styles.text}>
                <span className={styles.main}>
                  {step.km < 0.03 && step.kind === "walk"
                    ? `Start at ${step.to_name}`
                    : `${VERB[step.kind]} ${mins(step.minutes)} to ${step.to_name}`}
                </span>
                <span className={styles.sub}>
                  {detail(step)} · {step.km.toFixed(2)} km
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
