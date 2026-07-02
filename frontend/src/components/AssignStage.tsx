import type { Assignment, Bill, Person, SplitOptions } from "../types";
import { ArrowLeft, CornerDownRight, RotateCcw, Sparkles, Users } from "./icons";

export function AssignStage({
  bill,
  people,
  assignments,
  options,
  onOptionsChange,
  onToggle,
  onBulkAssign,
  onContinue,
  onBack,
  busy,
  unassignedCount,
}: {
  bill: Bill;
  people: Person[];
  assignments: Record<string, Assignment[]>;
  options: SplitOptions;
  onOptionsChange: (o: SplitOptions) => void;
  onToggle: (itemId: string, personId: string) => void;
  onBulkAssign: (mode: "all" | "remaining" | "clear") => void;
  onContinue: () => void;
  onBack: () => void;
  busy: boolean;
  unassignedCount: number;
}) {
  const personById = Object.fromEntries(people.map((p) => [p.id, p]));
  const parentItemsCount = bill.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.parent_id === null && !i.is_complimentary).length,
    0
  );

  // Surface a service-charge toggle ONLY if the bill actually has a service charge
  // (otherwise the option is meaningless and just adds noise).
  const hasServiceCharge = bill.bill_level_charges.some(
    (c) => c.kind === "service_charge"
  );
  // The "service charge on food only" option only matters when the bill has both
  // a service charge AND alcohol items.
  const hasAlcohol = bill.sections.some((s) =>
    s.items.some((i) => i.parent_id === null && i.tax_class === "alcohol")
  );

  const assignedCount = parentItemsCount - unassignedCount;

  return (
    <div>
      <h2 className="flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight mb-1">
        <Users className="text-accent text-xl" />
        Assign items
      </h2>
      <p className="text-fg-muted mb-4 text-sm leading-relaxed">
        Tap people to claim each item. Multiple people on one item splits it equally.
        Free items don't appear here.
      </p>

      {/* Bulk shortcut row: assign-all / assign-rest / clear. */}
      {people.length >= 2 && (
        <div className="mb-5 card p-3 sm:p-4 flex flex-col gap-3">
          <div className="flex items-start gap-2 text-sm">
            <Sparkles className="text-accent text-base mt-0.5 shrink-0" />
            <span>
              <span className="font-medium text-fg">Everyone shared most items?</span>{" "}
              <span className="text-fg-muted">
                One tap assigns all of them to all {people.length} people.
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onBulkAssign("all")} className="btn-primary btn-sm">
              Everyone shares all
            </button>
            {unassignedCount > 0 && unassignedCount < parentItemsCount && (
              <button onClick={() => onBulkAssign("remaining")} className="btn-secondary btn-sm">
                Everyone gets the rest
              </button>
            )}
            {assignedCount > 0 && (
              <button
                onClick={() => {
                  if (confirm("Clear all item assignments and start over?")) {
                    onBulkAssign("clear");
                  }
                }}
                className="btn-danger btn-sm gap-1.5 ml-auto"
              >
                <RotateCcw className="text-sm" />
                Reset all
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {bill.sections.map((section) => {
          const assignableItems = section.items.filter(
            (i) => i.parent_id === null && !i.is_complimentary
          );
          if (assignableItems.length === 0) return null;
          return (
            <section key={section.id} className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line bg-surface-2/40">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-fg-muted">
                  {section.name}
                </h3>
              </div>
              <ul className="divide-y divide-line">
                {assignableItems.map((item) => {
                  const claims = assignments[item.id] ?? [];
                  const children = section.items.filter((c) => c.parent_id === item.id);
                  const unassigned = claims.length === 0;
                  return (
                    <li
                      key={item.id}
                      className={`px-4 py-3 flex items-start gap-3 flex-wrap transition-colors ${
                        unassigned ? "bg-danger-soft/30" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.name}</div>
                        <div className="text-xs text-fg-subtle tabular-nums">
                          ₹{item.line_total.toFixed(2)} ·{" "}
                          {item.tax_class.replace("_", " ")}
                        </div>
                        {children.length > 0 && (
                          <ul className="mt-1 text-xs text-fg-subtle space-y-0.5">
                            {children.map((c) => (
                              <li key={c.id} className="truncate flex items-center gap-1">
                                <CornerDownRight className="text-[10px] shrink-0" /> {c.name}
                                {c.line_total > 0 && (
                                  <span className="text-fg-subtle">
                                    {" "}(+₹{c.line_total.toFixed(2)})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-wrap items-center">
                        <button
                          onClick={() => {
                            // Quick "everyone shares this" shortcut
                            const allHave = people.every((p) =>
                              claims.some((c) => c.person_id === p.id)
                            );
                            if (allHave) {
                              people.forEach((p) => {
                                if (claims.some((c) => c.person_id === p.id)) {
                                  onToggle(item.id, p.id);
                                }
                              });
                            } else {
                              people.forEach((p) => {
                                if (!claims.some((c) => c.person_id === p.id)) {
                                  onToggle(item.id, p.id);
                                }
                              });
                            }
                          }}
                          className="text-xs font-medium text-fg-subtle hover:text-accent transition px-1.5"
                          title="Toggle: everyone shares this"
                        >
                          all
                        </button>
                        {people.map((p) => {
                          const claim = claims.find((c) => c.person_id === p.id);
                          const active = !!claim;
                          return (
                            <button
                              key={p.id}
                              onClick={() => onToggle(item.id, p.id)}
                              className={`min-h-[44px] px-3.5 py-2 rounded-full text-sm font-medium
                                transition-all border touch-manipulation active:scale-95
                                ${active ? "text-white shadow-card" : "text-fg bg-surface hover:bg-surface-2"}`}
                              style={
                                active
                                  ? { backgroundColor: p.color, borderColor: p.color }
                                  : { borderColor: "rgb(var(--line))" }
                              }
                            >
                              {p.name}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Split options — only shown when the relevant inputs exist on the bill */}
      {(hasServiceCharge || people.length >= 2) && (
        <div className="mt-6 card p-4 text-sm space-y-3">
          <div className="font-semibold text-fg">Split options</div>
          {hasServiceCharge && (
            <>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={options.skip_service_charge}
                  onChange={(e) =>
                    onOptionsChange({ ...options, skip_service_charge: e.target.checked })
                  }
                />
                <span>
                  Don't add the service charge to the split
                  <span className="text-fg-subtle ml-1">(it's voluntary by Indian rules)</span>
                </span>
              </label>
              {hasAlcohol && (
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={options.service_charge_excludes_alcohol}
                    onChange={(e) =>
                      onOptionsChange({
                        ...options,
                        service_charge_excludes_alcohol: e.target.checked,
                      })
                    }
                    disabled={options.skip_service_charge}
                  />
                  <span>
                    Apply service charge only to food, not alcohol
                    <span className="text-fg-subtle ml-1">(less common)</span>
                  </span>
                </label>
              )}
            </>
          )}
          {people.length >= 2 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span>Round-off residual goes to:</span>
              <select
                className="field field-sm w-auto"
                value={options.residual_recipient_id ?? ""}
                onChange={(e) =>
                  onOptionsChange({
                    ...options,
                    residual_recipient_id: e.target.value || null,
                  })
                }
              >
                <option value="">Auto (largest payer)</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <span className="text-fg-subtle text-xs">
                (the few paise/rupees needed to make the sum match exactly)
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-between items-center gap-3">
        <button onClick={onBack} className="btn-ghost btn-md gap-1.5">
          <ArrowLeft className="text-sm" />
          Back
        </button>
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap justify-end">
          {unassignedCount > 0 && (
            <span className="text-sm text-danger font-medium">
              {unassignedCount} item{unassignedCount === 1 ? "" : "s"} unassigned
            </span>
          )}
          <button
            onClick={onContinue}
            disabled={busy || unassignedCount > 0}
            className="btn-primary btn-md gap-1.5"
          >
            <Sparkles className="text-sm" />
            {busy ? "Calculating…" : "Show split"}
          </button>
        </div>
      </div>

      {/* Suppress unused warning */}
      <div className="hidden">{Object.keys(personById).length}</div>
    </div>
  );
}
