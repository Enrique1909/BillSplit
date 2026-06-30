import type { Bill, Person, SplitResponse } from "../types";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, WhatsApp } from "./icons";

export function SummaryStage({
  bill,
  people,
  split,
  onBack,
  onShare,
}: {
  bill: Bill;
  people: Person[];
  split: SplitResponse;
  onBack: () => void;
  onShare: () => void;
}) {
  const personById = Object.fromEntries(people.map((p) => [p.id, p]));
  const exact = split.sum_of_people === split.grand_total;

  return (
    <div>
      {/* Hero total */}
      <div className="card p-5 sm:p-6 mb-6 animate-scale-in">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
              Final split
            </h2>
            <p className="text-fg-muted text-sm mt-0.5">
              Each person pays only for what they had.
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl sm:text-4xl font-display font-bold tabular-nums leading-none">
              ₹{split.grand_total.toLocaleString("en-IN")}
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-1.5 text-xs">
              {exact ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent px-2 py-0.5 font-medium">
                  <Check className="text-xs" /> Splits exactly
                </span>
              ) : (
                <span className="text-fg-subtle tabular-nums">
                  sum ₹{split.sum_of_people.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {split.warnings.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-warn-soft border border-warn/30 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="text-base mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {split.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        {[...split.breakdowns]
          .sort((a, b) => b.total - a.total)
          .map((b) => {
          const p = personById[b.person_id];
          if (!p) return null;
          return (
            <article
              key={b.person_id}
              className="card overflow-hidden animate-slide-up"
              style={{ borderLeft: `3px solid ${p.color}` }}
            >
              <div className="flex items-center justify-between px-4 py-3 bg-surface-2/40">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-10 h-10 rounded-full grid place-items-center text-white font-bold shrink-0"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.name[0]?.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-fg-subtle">
                      {b.items.length} item{b.items.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <div className="text-2xl font-display font-bold tabular-nums text-accent shrink-0">
                  ₹{b.total.toLocaleString("en-IN")}
                </div>
              </div>

              <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-t border-line">
                <Stat label="Items" value={`₹${b.items_subtotal.toFixed(2)}`} />
                <Stat label="Taxes" value={`₹${b.taxes.toFixed(2)}`} />
                <Stat label="Charges" value={`₹${b.charges.toFixed(2)}`} />
                <Stat
                  label="Discounts"
                  value={`−₹${b.discounts.toFixed(2)}`}
                  accent
                />
              </div>

              <details className="group px-4 pb-3 text-sm border-t border-line">
                <summary className="flex items-center gap-1.5 cursor-pointer text-fg-muted hover:text-fg py-2.5 list-none">
                  <ChevronDown className="text-sm transition-transform group-open:rotate-180" />
                  Show items
                </summary>
                <ul className="mt-1 divide-y divide-line">
                  {b.items.map((it: any, i: number) => {
                    const others = (it.co_claimant_ids ?? [])
                      .map((id: string) => personById[id]?.name)
                      .filter(Boolean) as string[];
                    return (
                      <li
                        key={i}
                        className="flex items-center justify-between py-1.5 text-xs gap-2"
                      >
                        <span className="truncate flex-1 min-w-0">
                          {it.name}
                          {others.length > 0 && (
                            <span className="text-fg-subtle ml-1">
                              (split with {others.join(", ")})
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums text-fg-muted">
                          ₹{it.amount.toFixed(2)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>

              {b.notes.length > 0 && (
                <div className="px-4 pb-3 text-xs text-fg-subtle border-t border-line pt-2">
                  {b.notes.join(" · ")}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap justify-between items-center gap-3">
        <button onClick={onBack} className="btn-ghost btn-md gap-1.5">
          <ArrowLeft className="text-sm" />
          Tweak assignments
        </button>
        <button onClick={onShare} className="btn-primary btn-md gap-2">
          <WhatsApp className="text-base" />
          Share split
        </button>
      </div>

      <div className="mt-6 text-xs text-fg-subtle text-center">
        {bill.restaurant.name} · Bill #{bill.meta.bill_no} · {bill.meta.date}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-fg-subtle uppercase tracking-wider text-[10px]">{label}</div>
      <div
        className={`font-semibold tabular-nums ${accent ? "text-accent" : "text-fg"}`}
      >
        {value}
      </div>
    </div>
  );
}
