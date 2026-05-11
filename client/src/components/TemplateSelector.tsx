import type { LayoutTemplate } from "../App";

const OPTIONS: { id: LayoutTemplate; label: string }[] = [
  { id: "single", label: "Single" },
  { id: "split", label: "Split" },
  { id: "mosaic", label: "Mosaic" },
];

interface Props {
  value: LayoutTemplate;
  onChange: (v: LayoutTemplate) => void;
}

/**
 * Minimal template switcher. Each template maps to a different arrangement
 * of mining "pools" in the HUD. Only `single` is wired in the skeleton.
 */
export function TemplateSelector({ value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Layout template" className="glass-pill">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          role="radio"
          aria-checked={value === opt.id}
          className={value === opt.id ? "glass-pill__item is-active" : "glass-pill__item"}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
