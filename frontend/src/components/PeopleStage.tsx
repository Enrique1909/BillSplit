import { useRef, useState } from "react";
import type { Bill, Person } from "../types";
import { ArrowLeft, ArrowRight, Info, Plus, Users, X } from "./icons";

export function PeopleStage({
  bill,
  people,
  onAdd,
  onRemove,
  onPrePaymentChange,
  onContinue,
  onBack,
}: {
  bill: Bill;
  people: Person[];
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
  onPrePaymentChange: (discountId: string, personId: string | null) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const prePayments = bill.discounts.filter((d) => d.kind === "pre_payment");

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight mb-1">
        <Users className="text-accent text-xl" />
        Who's splitting?
      </h2>
      <p className="text-fg-muted mb-6 text-sm leading-relaxed">
        Add everyone who ate at the table. The keyboard stays open so you can
        type names back-to-back — tap Continue when you're done.
      </p>

      <form
        className="flex gap-2 mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onAdd(name);
          setName("");
          // Keep focus on the input so iOS / Android keyboards don't dismiss
          // between names. Calling .focus() inside the user-gesture handler
          // (form submit) is the only way iOS Safari will keep the soft
          // keyboard up.
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          className="field flex-1"
          placeholder="Add a name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
        />
        <button type="submit" className="btn-primary btn-md gap-1.5" disabled={!name.trim()}>
          <Plus className="text-base" />
          Add
        </button>
      </form>

      {people.length > 0 ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
          {people.map((p) => (
            <li
              key={p.id}
              className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface border border-line animate-scale-in"
            >
              <span
                className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-sm shrink-0"
                style={{ backgroundColor: p.color }}
              >
                {p.name[0]?.toUpperCase()}
              </span>
              <span className="flex-1 font-medium truncate">{p.name}</span>
              <button
                onClick={() => onRemove(p.id)}
                className="grid place-items-center w-8 h-8 rounded-lg text-fg-subtle hover:text-danger hover:bg-danger-soft transition"
                aria-label={`Remove ${p.name}`}
              >
                <X className="text-base" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mb-8 rounded-xl border border-dashed border-line-strong bg-surface-2/50 px-4 py-8 text-center">
          <Users className="text-2xl text-fg-subtle mx-auto mb-2" />
          <p className="text-sm text-fg-subtle">
            No one yet — add the first person above.
          </p>
        </div>
      )}

      {/* Pre-payment attribution panel */}
      {prePayments.length > 0 && (
        <section className="mb-8 rounded-xl border border-warn/30 bg-warn-soft p-4">
          <h3 className="flex items-center gap-1.5 font-semibold text-sm text-warn mb-1">
            <Info className="text-base" />
            Who paid these upfront?
          </h3>
          <p className="text-xs text-warn/90 mb-3 leading-relaxed">
            Cover charges and reservation deposits are paid by one person at booking
            time. Whoever paid gets credited the full amount in the split.
          </p>
          <ul className="space-y-2">
            {prePayments.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface border border-line"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{d.label}</div>
                  <div className="text-xs text-fg-subtle tabular-nums">
                    Credit: ₹{d.amount.toFixed(2)}
                  </div>
                </div>
                <select
                  className="field field-sm w-auto min-w-[8.5rem]"
                  value={d.paid_by_person_id ?? ""}
                  onChange={(e) => onPrePaymentChange(d.id, e.target.value || null)}
                >
                  <option value="">— select person —</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap justify-between items-center gap-2">
        <button onClick={onBack} className="btn-ghost btn-md gap-1.5">
          <ArrowLeft className="text-sm" />
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={people.length < 2 || prePayments.some((d) => !d.paid_by_person_id)}
          className="btn-primary btn-md gap-1.5"
        >
          Continue
          <ArrowRight className="text-sm" />
        </button>
      </div>
      {people.length < 2 && (
        <p className="text-xs text-fg-subtle text-right mt-2">
          Add at least 2 people to continue.
        </p>
      )}
    </div>
  );
}
