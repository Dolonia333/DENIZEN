/**
 * Segmented sub-nav for consolidated sections (Sales, Schedule).
 * Understated control — no emoji, no pill rainbow.
 */
interface SubTab {
  key: string;
  label: string;
  icon?: string;
}

interface Props {
  tabs: SubTab[];
  active: string;
  onSelect: (key: string) => void;
}

export function SubTabNav({ tabs, active, onSelect }: Props) {
  return (
    <div
      className="crm-seg"
      role="tablist"
      style={{
        marginBottom: 20,
        maxWidth: "100%",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
      }}
    >
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            aria-pressed={on}
            className={`crm-seg-btn${on ? " is-active" : ""}`}
            onClick={() => onSelect(t.key)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
