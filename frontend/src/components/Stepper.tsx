import { Check } from "./icons";

/**
 * Flow progress indicator. Five logical steps (the crop screen is folded into
 * "Capture"). Mobile shows a compact bar + current-step label; >=sm shows the
 * full dotted rail with labels. Purely presentational — driven by `current`.
 */
export const STEPS = ["Capture", "Review", "People", "Assign", "Split", "Share"] as const;
export type StepKey = (typeof STEPS)[number];

export function Stepper({ current }: { current: number }) {
  const pct = STEPS.length > 1 ? (current / (STEPS.length - 1)) * 100 : 0;

  return (
    <nav aria-label="Progress" className="w-full">
      {/* Mobile: label + slim progress bar */}
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm font-semibold text-fg">
            {STEPS[current]}
          </span>
          <span className="text-xs text-fg-subtle tabular-nums">
            Step {current + 1} of {STEPS.length}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
            style={{ width: `${Math.max(8, pct)}%` }}
          />
        </div>
      </div>

      {/* Desktop: dotted rail */}
      <ol className="hidden sm:flex items-center">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={label}
              className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}
            >
              <div className="flex items-center gap-2.5 shrink-0">
                <span
                  className={`grid place-items-center w-7 h-7 rounded-full text-xs font-semibold tabular-nums transition-colors duration-300
                    ${
                      done
                        ? "bg-accent text-accent-fg"
                        : active
                        ? "bg-accent/15 text-accent ring-2 ring-accent"
                        : "bg-surface-2 text-fg-subtle ring-1 ring-line"
                    }`}
                >
                  {done ? <Check className="text-sm" /> : i + 1}
                </span>
                <span
                  className={`text-sm font-medium transition-colors duration-300 ${
                    active ? "text-fg" : done ? "text-fg-muted" : "text-fg-subtle"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span className="flex-1 mx-3 h-px bg-line relative overflow-hidden">
                  <span
                    className="absolute inset-y-0 left-0 bg-accent transition-all duration-500 ease-out"
                    style={{ width: done ? "100%" : "0%" }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
