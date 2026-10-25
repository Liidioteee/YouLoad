import styles from "../Inspector.module.css";

export function Group({ label, hint, children, aside }: { label: string; hint?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className="label">{label}</span>
        {aside}
      </div>
      {children}
      {hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}

export function Chips<V extends string>({
  options,
  value,
  onChange,
  mono = true,
}: {
  options: { value: V; label: string; disabled?: boolean; title?: string }[];
  value: V | null;
  onChange: (v: V) => void;
  mono?: boolean;
}) {
  return (
    <div className={styles.chips} role="radiogroup">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          disabled={opt.disabled}
          title={opt.title}
          className={`${styles.chip} ${mono ? "mono" : ""} ${value === opt.value ? styles.on : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((opt) => (
        <button type="button" role="tab" key={opt.value} aria-selected={value === opt.value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
