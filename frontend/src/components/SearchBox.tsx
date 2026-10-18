import { useEffect, useId, useState } from "react";
import { api, isAbort } from "../api";
import { useDebounced } from "../lib/hooks";
import type { GeocodeResult } from "../types";
import { CloseIcon, LocateIcon, SearchIcon } from "./icons";
import styles from "./SearchBox.module.css";

interface Props {
  value: string;
  onValueChange: (v: string) => void;
  onPick: (r: GeocodeResult) => void;
  onLocate: () => void;
  onClear: () => void;
  locating: boolean;
}

export function SearchBox({ value, onValueChange, onPick, onLocate, onClear, locating }: Props) {
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(value.trim(), 150);
  const listId = useId();

  useEffect(() => {
    if (!open || query.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    api
      .geocode(query, ctrl.signal)
      .then((r) => {
        setResults(r);
        setActive(0);
      })
      .catch((err) => {
        if (!isAbort(err)) setResults([]);
      });
    return () => ctrl.abort();
  }, [query, open]);

  const pick = (r: GeocodeResult) => {
    onPick(r);
    setOpen(false);
    setResults([]);
  };

  const showList = open && results.length > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.field}>
        <SearchIcon className={styles.icon} />
        <label htmlFor={`${listId}-input`} className="visually-hidden">
          Where are you?
        </label>
        <input
          id={`${listId}-input`}
          className={styles.input}
          placeholder="Where are you?"
          value={value}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            onValueChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const r = results[active];
              if (r) pick(r);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {value && (
          <button type="button" className={styles.iconButton} aria-label="Clear start point" onClick={onClear}>
            <CloseIcon size={18} />
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Use my location"
          title="Use my location"
          onClick={onLocate}
          disabled={locating}
        >
          <LocateIcon size={20} />
        </button>
      </div>
      {showList && (
        <ul id={listId} role="listbox" className={styles.list}>
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              onMouseEnter={() => setActive(i)}
            >
              <span className={styles.optionName}>{r.name}</span>
              <span className={styles.optionMeta}>{r.source === "alias" ? "landmark" : `match ${Math.round(r.score * 100)}%`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
