import styles from "./Legend.module.css";

export function Legend({ title, streets }: { title: string; streets: boolean | null }) {
  return (
    <div className={styles.legend} aria-label="Map legend">
      <span className={styles.title}>{title}</span>
      <span className={styles.item}>
        <span className={`${styles.dot} ${styles.surplus}`} /> Surplus
      </span>
      <span className={styles.item}>
        <span className={`${styles.dot} ${styles.deficit}`} /> Deficit
      </span>
      <span className={styles.item}>
        <span className={`${styles.dot} ${styles.balanced}`} /> Balanced
      </span>
      {streets === false && <span className={styles.note}>Street paths unavailable · straight lines</span>}
    </div>
  );
}
