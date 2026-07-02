import { useState } from "react";
import { createPortal } from "react-dom";
import type {
  Bill, BillItem, BillLevelCharge, BillSection, BillTax, Discount, DiscountKind, TaxClass,
} from "../types";
import {
  AlertTriangle, ArrowRight, CheckCircle, ChevronDown, CornerDownRight, Gift,
  Maximize, Plus, RotateCcw, Scissors, Trash, X,
} from "./icons";

function FullscreenImage({ src, onClose }: { src: string; onClose: () => void }) {
  // Esc-to-close + click-outside-to-close. Portaled to <body> so the app's
  // animated stage wrapper (a stacking context) can't trap this overlay below
  // the sticky header.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white grid place-items-center transition"
      >
        <X className="text-xl" />
      </button>
      <img
        src={src}
        alt="bill (fullscreen)"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[95vh] max-w-[95vw] object-contain rounded-lg shadow-2xl cursor-default"
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs">
        Click anywhere or press Esc to close
      </div>
    </div>,
    document.body
  );
}

// Opacity-tinted backgrounds + dark: text variants so the chips read correctly
// on both the light and dark surfaces.
const TAX_LABELS: Record<TaxClass, { label: string; className: string }> = {
  food: { label: "food", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  alcohol: { label: "alcohol", className: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
  non_alcoholic_beverage: { label: "soft drink", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  non_taxable: { label: "non-tax", className: "bg-slate-500/15 text-slate-600 dark:text-slate-300" },
  other: { label: "other", className: "bg-slate-500/15 text-slate-600 dark:text-slate-300" },
};

const TAX_CLASS_OPTIONS: TaxClass[] = [
  "food", "alcohol", "non_alcoholic_beverage", "non_taxable", "other",
];

function recomputeSubtotals(b: Bill): Bill {
  return {
    ...b,
    sections: b.sections.map((s) => ({
      ...s,
      subtotal: s.items
        .filter((i) => i.parent_id === null)
        .reduce((sum, p) => {
          const kids = s.items.filter((c) => c.parent_id === p.id);
          return sum + p.line_total + kids.reduce((kk, k) => kk + k.line_total, 0);
        }, 0),
    })),
  };
}

function recomputeReconciliation(b: Bill): Bill {
  const sec = b.sections.reduce((s, x) => s + x.subtotal, 0);
  const tax = b.taxes.reduce((s, x) => s + x.amount, 0);
  const chg = b.bill_level_charges.reduce((s, x) => s + x.amount, 0);
  const dis = b.discounts.reduce((s, x) => s + x.amount, 0);
  const computed = +(sec + tax + chg - dis + b.round_off).toFixed(2);
  const delta = +(b.grand_total - computed).toFixed(2);
  return {
    ...b,
    reconciliation: { ...b.reconciliation, computed_total: computed, delta },
  };
}

export function ReviewStage({
  bill,
  onChange,
  onContinue,
  canContinue,
  imagePreview,
  onRetake,
  onAddPlatformSummary,
  busy,
}: {
  bill: Bill;
  onChange: (b: Bill) => void;
  onContinue: () => void;
  canContinue: boolean;
  imagePreview: string | null;
  onRetake: () => void;
  onAddPlatformSummary: (file: File) => void;
  busy: boolean;
}) {
  const [zoomed, setZoomed] = useState(false);
  // Inline popover state for "split in 2" — which item, which mode, what value.
  const [splitDialog, setSplitDialog] = useState<
    | { itemId: string; sectionId: string; mode: "equal" | "amount" | "percent"; firstValue: string }
    | null
  >(null);
  const delta = bill.reconciliation.delta;
  const reconciles = Math.abs(delta) <= 0.5;

  function update(b: Bill) {
    onChange(recomputeReconciliation(recomputeSubtotals(b)));
  }

  // ----- items -----
  function updateItem(id: string, patch: Partial<BillItem>) {
    update({
      ...bill,
      sections: bill.sections.map((s) => ({
        ...s,
        items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
      })),
    });
  }
  function deleteItem(id: string) {
    update({
      ...bill,
      sections: bill.sections.map((s) => ({
        ...s,
        items: s.items.filter((it) => it.id !== id && it.parent_id !== id),
      })),
    });
  }
  function addItem(sectionId: string) {
    const newId = `${sectionId}_i${Date.now()}`;
    update({
      ...bill,
      sections: bill.sections.map((s) =>
        s.id !== sectionId ? s : {
          ...s,
          items: [...s.items, {
            id: newId, parent_id: null, name: "New item",
            qty: 1, unit_price: 0, line_total: 0,
            is_complimentary: false, tax_class: s.default_tax_class, raw_text: "",
          }],
        }
      ),
    });
  }
  function splitItemInTwo(
    itemId: string,
    sectionId: string,
    mode: "equal" | "amount" | "percent",
    firstValue: number
  ) {
    const section = bill.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const item = section.items.find((i) => i.id === itemId);
    if (!item) return;
    // Roll children's line_total into the base so we don't lose any value.
    const childrenTotal = section.items
      .filter((c) => c.parent_id === itemId)
      .reduce((sum, c) => sum + c.line_total, 0);
    const fullTotal = +(item.line_total + childrenTotal).toFixed(2);

    let firstAmount: number;
    if (mode === "equal") {
      firstAmount = +(fullTotal / 2).toFixed(2);
    } else if (mode === "amount") {
      firstAmount = +Math.max(0, Math.min(fullTotal, firstValue)).toFixed(2);
    } else {
      // percent: clamp 0..100
      const pct = Math.max(0, Math.min(100, firstValue));
      firstAmount = +((fullTotal * pct) / 100).toFixed(2);
    }
    const secondAmount = +(fullTotal - firstAmount).toFixed(2);

    const baseName = item.name.replace(/\s*\(half[^)]*\)\s*$/i, "").trim();
    const idA = `${itemId}_h1_${Date.now()}`;
    const idB = `${itemId}_h2_${Date.now() + 1}`;

    // Names reflect the split mode so users can tell at a glance which is which.
    const nameA =
      mode === "equal"
        ? `${baseName} (half 1)`
        : mode === "percent"
        ? `${baseName} (first ${firstValue}%)`
        : `${baseName} (₹${firstAmount.toFixed(2)} portion)`;
    const nameB =
      mode === "equal"
        ? `${baseName} (half 2)`
        : mode === "percent"
        ? `${baseName} (remaining ${(100 - firstValue).toFixed(0)}%)`
        : `${baseName} (₹${secondAmount.toFixed(2)} portion)`;

    update({
      ...bill,
      sections: bill.sections.map((s) =>
        s.id !== sectionId
          ? s
          : {
              ...s,
              items: [
                ...s.items.filter(
                  (it) => it.id !== itemId && it.parent_id !== itemId
                ),
                {
                  id: idA,
                  parent_id: null,
                  name: nameA,
                  qty: 1,
                  unit_price: firstAmount,
                  line_total: firstAmount,
                  is_complimentary: firstAmount === 0,
                  tax_class: item.tax_class,
                  raw_text: item.raw_text,
                },
                {
                  id: idB,
                  parent_id: null,
                  name: nameB,
                  qty: 1,
                  unit_price: secondAmount,
                  line_total: secondAmount,
                  is_complimentary: secondAmount === 0,
                  tax_class: item.tax_class,
                  raw_text: item.raw_text,
                },
              ],
            }
      ),
    });
    setSplitDialog(null);
  }

  function commitSplitDialog() {
    if (!splitDialog) return;
    const v = parseFloat(splitDialog.firstValue) || 0;
    splitItemInTwo(splitDialog.itemId, splitDialog.sectionId, splitDialog.mode, v);
  }

  function addChild(parentId: string, sectionId: string) {
    const newId = `${parentId}_m${Date.now()}`;
    update({
      ...bill,
      sections: bill.sections.map((s) =>
        s.id !== sectionId ? s : {
          ...s,
          items: [...s.items, {
            id: newId, parent_id: parentId, name: "Add detail",
            qty: 1, unit_price: 0, line_total: 0,
            is_complimentary: true, tax_class: s.default_tax_class, raw_text: "",
          }],
        }
      ),
    });
  }

  // ----- sections -----
  function updateSection(id: string, patch: Partial<BillSection>) {
    update({
      ...bill,
      sections: bill.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }
  function addSection() {
    const id = `s${Date.now()}`;
    update({
      ...bill,
      sections: [
        ...bill.sections,
        { id, name: "New section", default_tax_class: "food", items: [], subtotal: 0 },
      ],
    });
  }
  function deleteSection(id: string) {
    const target = bill.sections.find((s) => s.id === id);
    if (target && target.items.length > 0) {
      // Keep the user safe — don't quietly drop their data.
      if (!confirm(`Section "${target.name}" has ${target.items.length} item${target.items.length === 1 ? "" : "s"}. Delete them all?`)) return;
    }
    update({ ...bill, sections: bill.sections.filter((s) => s.id !== id) });
  }

  // ----- taxes -----
  function updateTax(id: string, patch: Partial<BillTax>) {
    const target = bill.taxes.find((t) => t.id === id);
    if (!target) return;
    const updatedLabel = (patch.label ?? target.label).trim().toUpperCase();

    let newTaxes = bill.taxes.map((t) => (t.id === id ? { ...t, ...patch } : t));

    // CGST ↔ SGST mirror: in India these are always two equal halves of GST.
    // When the user edits one, propagate amount/rate_pct to its sibling so they
    // stay in lockstep. Same applies if the user retypes the label.
    if (
      (updatedLabel === "CGST" || updatedLabel === "SGST") &&
      (patch.amount !== undefined || patch.rate_pct !== undefined)
    ) {
      const siblingLabel = updatedLabel === "CGST" ? "SGST" : "CGST";
      newTaxes = newTaxes.map((other) =>
        other.id !== id && other.label.trim().toUpperCase() === siblingLabel
          ? {
              ...other,
              amount: patch.amount !== undefined ? patch.amount : other.amount,
              rate_pct: patch.rate_pct !== undefined ? patch.rate_pct : other.rate_pct,
            }
          : other
      );
    }

    update({ ...bill, taxes: newTaxes });
  }
  function deleteTax(id: string) {
    update({ ...bill, taxes: bill.taxes.filter((t) => t.id !== id) });
  }
  function addTax() {
    const id = `t${Date.now()}`;
    update({
      ...bill,
      taxes: [...bill.taxes, {
        id, label: "GST", rate_pct: null, amount: 0,
        applies_to_classes: ["food", "non_alcoholic_beverage"],
        includes_service_charge_in_basis: false,
      }],
    });
  }
  function toggleTaxClass(taxId: string, cls: TaxClass) {
    const t = bill.taxes.find((x) => x.id === taxId);
    if (!t) return;
    const next = t.applies_to_classes.includes(cls)
      ? t.applies_to_classes.filter((c) => c !== cls)
      : [...t.applies_to_classes, cls];
    updateTax(taxId, { applies_to_classes: next });
  }

  // ----- charges -----
  function updateCharge(id: string, patch: Partial<BillLevelCharge>) {
    update({
      ...bill,
      bill_level_charges: bill.bill_level_charges.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    });
  }
  function deleteCharge(id: string) {
    update({ ...bill, bill_level_charges: bill.bill_level_charges.filter((c) => c.id !== id) });
  }
  function addCharge() {
    const id = `c${Date.now()}`;
    update({
      ...bill,
      bill_level_charges: [...bill.bill_level_charges, {
        id, label: "Service Charge", kind: "service_charge",
        rate_pct: null, amount: 0, is_voluntary: true,
        applies_to_section_ids: "all", is_taxable: false,
      }],
    });
  }

  // ----- discounts -----
  function updateDiscount(id: string, patch: Partial<Discount>) {
    update({
      ...bill,
      discounts: bill.discounts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    });
  }
  function deleteDiscount(id: string) {
    update({ ...bill, discounts: bill.discounts.filter((d) => d.id !== id) });
  }
  function addDiscount(kind: DiscountKind = "platform") {
    const id = `d${Date.now()}`;
    const labels: Record<DiscountKind, string> = {
      platform: "Platform discount",
      restaurant: "Restaurant discount",
      coupon: "Coupon",
      loyalty: "Loyalty",
      pre_payment: "Cover charge",
      other: "Discount",
    };
    update({
      ...bill,
      discounts: [...bill.discounts, {
        id, label: labels[kind], kind, rate_pct: null, amount: 0,
        applies_to: { type: "bill" },
        paid_by_person_id: null,
      }],
    });
  }

  // ----- bill-level scalars -----
  const updateGrandTotal = (v: number) => update({ ...bill, grand_total: v });
  const updateRoundOff = (v: number) => update({ ...bill, round_off: v });

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Review the bill</h2>
        <div className="text-sm text-fg-muted tabular-nums">
          {bill.restaurant.name ?? "Restaurant"} · ₹{bill.grand_total.toFixed(2)}
        </div>
      </div>
      <p className="text-fg-muted mb-4 text-sm leading-relaxed">
        Make sure items, prices, taxes, charges, and discounts match the photo.
        Tap any number to fix it,{" "}
        <button onClick={onRetake} className="text-accent underline underline-offset-2 hover:text-accent-hover transition">
          upload a different photo
        </button>
        , or add anything that was missed.
      </p>

      {/* Reconciliation banner */}
      <div
        className={`mb-6 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm border ${
          reconciles
            ? "bg-accent-soft border-accent/30 text-accent"
            : "bg-danger-soft border-danger/30 text-danger"
        }`}
      >
        {reconciles ? (
          <CheckCircle className="text-base mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle className="text-base mt-0.5 shrink-0" />
        )}
        <div className="min-w-0">
          {reconciles ? (
            <>
              <strong>Bill balances.</strong> Items + taxes + charges − discounts ± round-off ={" "}
              ₹{bill.grand_total.toFixed(2)} (delta ₹{delta.toFixed(2)}).
            </>
          ) : (
            <>
              <strong>Bill is off by ₹{delta.toFixed(2)}.</strong>{" "}
              {delta > 0
                ? "Items + taxes + charges adds up to LESS than the grand total — likely a missing tax, charge, or item price."
                : "Items + taxes + charges adds up to MORE than the grand total — likely a missing discount, an item priced too high, or a duplicate row."}
              {" "}Edit values below, add the missing line, or{" "}
              <button onClick={onRetake} className="underline font-medium underline-offset-2">
                retake the photo
              </button>
              .
            </>
          )}
        </div>
      </div>

      <div className="
        grid grid-cols-1 grid-rows-[auto_auto] gap-4
        lg:grid-cols-[1fr,420px] lg:grid-rows-1 lg:gap-6
      ">
        <div className="row-start-2 lg:row-start-1 lg:col-start-1">
          {/* Sections */}
          {bill.sections.map((section) => (
            <section key={section.id} className="mb-5 card">
              <div className="px-3 sm:px-4 py-2 border-b border-line flex items-center justify-between gap-2 group">
                <input
                  className="font-semibold text-sm uppercase tracking-wider text-fg edit-input edit-input-sm flex-1 min-w-0"
                  value={section.name}
                  onChange={(e) => updateSection(section.id, { name: e.target.value })}
                />
                <span className="text-sm font-medium text-fg tabular-nums shrink-0">
                  ₹{section.subtotal.toFixed(2)}
                </span>
                <button
                  onClick={() => deleteSection(section.id)}
                  className="grid place-items-center w-8 h-8 rounded-md text-fg-subtle hover:text-danger hover:bg-danger-soft transition opacity-60 sm:opacity-0 group-hover:opacity-100 shrink-0"
                  title="Delete section"
                  aria-label="Delete section"
                >
                  <Trash className="text-sm" />
                </button>
              </div>
              <ul className="divide-y divide-line">
                {section.items
                  .filter((i) => i.parent_id === null)
                  .map((item) => {
                    const children = section.items.filter((c) => c.parent_id === item.id);
                    const tag = TAX_LABELS[item.tax_class];
                    return (
                      <li key={item.id} className="px-3 sm:px-4 py-3 group">
                        {/* Row 1: name (always full width) */}
                        <input
                          className="w-full font-medium edit-input"
                          value={item.name}
                          placeholder="Item name"
                          onChange={(e) => updateItem(item.id, { name: e.target.value })}
                        />

                        {/* Row 2: tax-class chip + dropdown + delete */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className={`chip ${tag.className}`}>{tag.label}</span>
                          <select
                            className="field field-sm w-auto text-xs"
                            value={item.tax_class}
                            onChange={(e) =>
                              updateItem(item.id, { tax_class: e.target.value as TaxClass })
                            }
                          >
                            {TAX_CLASS_OPTIONS.map((c) => (
                              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                            ))}
                          </select>
                          <span className="flex-1" />
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="text-fg-subtle hover:text-danger transition w-9 h-9 grid place-items-center rounded-md hover:bg-danger-soft"
                            title="Delete item"
                            aria-label="Delete item"
                          >
                            <Trash className="text-sm" />
                          </button>
                        </div>

                        {/* Row 3: Qty × Price = Total. On mobile, two-row layout
                            (math on top, total below) so nothing overflows on
                            narrow screens. On desktop, single row right-aligned. */}
                        <div className="mt-2 text-sm">
                          {/* Math row: small-screen friendly */}
                          <div className="flex items-center gap-2 sm:justify-end">
                            <label className="text-xs text-fg-subtle sm:hidden">Qty</label>
                            <input
                              type="number" inputMode="decimal" step="0.5"
                              className="edit-input edit-input-sm w-16 text-right tabular-nums"
                              value={item.qty}
                              onChange={(e) =>
                                updateItem(item.id, {
                                  qty: parseFloat(e.target.value || "0"),
                                  line_total: parseFloat(e.target.value || "0") * item.unit_price,
                                })
                              }
                            />
                            <span className="text-fg-subtle">×</span>
                            <span className="text-xs text-fg-subtle sm:hidden">₹</span>
                            <input
                              type="number" inputMode="decimal" step="0.01"
                              className="edit-input edit-input-sm flex-1 sm:flex-none sm:w-24 min-w-0 text-right tabular-nums"
                              value={item.unit_price}
                              onChange={(e) =>
                                updateItem(item.id, {
                                  unit_price: parseFloat(e.target.value || "0"),
                                  line_total: item.qty * parseFloat(e.target.value || "0"),
                                })
                              }
                            />
                            <span className="text-fg-subtle hidden sm:inline">=</span>
                            <span className="hidden sm:inline font-semibold tabular-nums text-right w-24">
                              ₹{item.line_total.toFixed(2)}
                            </span>
                          </div>
                          {/* Mobile-only total row, right-aligned, large for readability */}
                          <div className="sm:hidden mt-1 text-right">
                            <span className="text-xs text-fg-subtle">total: </span>
                            <span className="font-semibold tabular-nums">
                              ₹{item.line_total.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {/* Row 4: per-item action chips — always visible on mobile (touch),
                            hover-revealed on desktop */}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <button
                            onClick={() =>
                              updateItem(item.id, {
                                is_complimentary: !item.is_complimentary,
                                line_total: item.is_complimentary
                                  ? item.qty * item.unit_price
                                  : 0,
                                unit_price: item.is_complimentary ? item.unit_price : 0,
                              })
                            }
                            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md transition ${
                              item.is_complimentary
                                ? "bg-accent-soft text-accent font-medium"
                                : "bg-surface-2 text-fg-muted hover:bg-accent-soft hover:text-accent"
                            }`}
                            title="Toggle: this item was free of charge"
                          >
                            <Gift className="text-sm" />
                            {item.is_complimentary ? "FOC" : "mark FOC"}
                          </button>
                          <button
                            onClick={() => addChild(item.id, section.id)}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-surface-2 text-fg-muted hover:bg-accent-soft hover:text-accent transition"
                            title="Add a sub-item / detail"
                          >
                            <Plus className="text-sm" /> detail
                          </button>
                          <button
                            onClick={() =>
                              setSplitDialog({
                                itemId: item.id,
                                sectionId: section.id,
                                mode: "equal",
                                firstValue: "50",
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-surface-2 text-fg-muted hover:bg-accent-soft hover:text-accent transition"
                            title="Split this item into two halves (equal, custom amount, or custom %)"
                          >
                            <Scissors className="text-sm" /> split in 2
                          </button>
                        </div>

                        {/* Inline split dialog — appears beneath the item it
                            applies to. Mobile-friendly because it doesn't open
                            a modal; the user sees both the item and the split
                            controls at once. */}
                        {splitDialog?.itemId === item.id && (
                          <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm animate-scale-in">
                            <div className="font-medium text-warn mb-2">
                              Split this item how?
                            </div>
                            <div className="space-y-2">
                              {(["equal", "amount", "percent"] as const).map((m) => (
                                <label
                                  key={m}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <input
                                    type="radio"
                                    name={`split-mode-${item.id}`}
                                    checked={splitDialog.mode === m}
                                    onChange={() =>
                                      setSplitDialog({
                                        ...splitDialog,
                                        mode: m,
                                        firstValue:
                                          m === "equal"
                                            ? "50"
                                            : m === "percent"
                                            ? "50"
                                            : `${(item.line_total / 2).toFixed(2)}`,
                                      })
                                    }
                                  />
                                  <span className="flex-1">
                                    {m === "equal" && "Equal halves (50 / 50)"}
                                    {m === "amount" && "First half is a specific amount"}
                                    {m === "percent" && "First half is a specific %"}
                                  </span>
                                  {m !== "equal" && splitDialog.mode === m && (
                                    <div className="flex items-center gap-1">
                                      {m === "amount" && <span className="text-slate-500">₹</span>}
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        autoFocus
                                        className="edit-input edit-input-sm w-24 text-right tabular-nums"
                                        value={splitDialog.firstValue}
                                        onChange={(e) =>
                                          setSplitDialog({
                                            ...splitDialog,
                                            firstValue: e.target.value,
                                          })
                                        }
                                      />
                                      {m === "percent" && <span className="text-slate-500">%</span>}
                                    </div>
                                  )}
                                </label>
                              ))}
                            </div>
                            <div className="flex gap-2 mt-3 justify-end">
                              <button
                                onClick={() => setSplitDialog(null)}
                                className="px-3 py-1.5 rounded-md text-fg-muted hover:bg-warn/10 transition text-sm"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={commitSplitDialog}
                                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-warn text-white font-medium hover:opacity-90 transition text-sm"
                              >
                                <Scissors className="text-sm" /> Split
                              </button>
                            </div>
                          </div>
                        )}

                        {children.length > 0 && (
                          <ul className="mt-3 ml-1 pl-3 border-l-2 border-line space-y-1.5">
                            {children.map((c) => (
                              <li key={c.id} className="flex items-center gap-2">
                                <CornerDownRight className="text-fg-subtle text-sm shrink-0" />
                                <input
                                  className="flex-1 min-w-0 edit-input edit-input-sm text-xs"
                                  value={c.name}
                                  placeholder="Detail / modifier"
                                  onChange={(e) => updateItem(c.id, { name: e.target.value })}
                                />
                                <input
                                  type="number" inputMode="decimal" step="0.01"
                                  className="w-16 text-right edit-input edit-input-sm tabular-nums text-xs"
                                  value={c.line_total}
                                  onChange={(e) =>
                                    updateItem(c.id, {
                                      unit_price: parseFloat(e.target.value || "0"),
                                      line_total: parseFloat(e.target.value || "0"),
                                    })
                                  }
                                />
                                <button
                                  onClick={() => deleteItem(c.id)}
                                  className="text-fg-subtle hover:text-danger transition w-8 h-8 grid place-items-center rounded-md hover:bg-danger-soft shrink-0"
                                  aria-label="Delete detail"
                                >
                                  <Trash className="text-sm" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
              </ul>
              <div className="px-4 py-2 border-t border-line">
                <button
                  onClick={() => addItem(section.id)}
                  className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-accent transition"
                >
                  <Plus className="text-sm" /> Add item to {section.name}
                </button>
              </div>
            </section>
          ))}

          {/* Add section button */}
          <div className="mb-5">
            <button
              onClick={addSection}
              className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-accent transition"
            >
              <Plus className="text-sm" /> Add a new section (e.g., Bar, Desserts)
            </button>
          </div>

          {/* Taxes / Charges / Discounts */}
          <section className="card px-4 py-3">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-semibold text-sm uppercase tracking-wider text-fg-muted">
                Taxes, Charges &amp; Discounts
              </h3>
            </div>

            {/* Taxes */}
            <div className="mb-3">
              <div className="text-xs uppercase text-fg-subtle tracking-wider mb-1.5 flex items-center justify-between">
                <span>Taxes</span>
                <button onClick={addTax} className="inline-flex items-center gap-1 text-fg-muted hover:text-accent transition"><Plus className="text-xs" /> tax</button>
              </div>
              <ul className="text-sm divide-y divide-line">
                {bill.taxes.length === 0 && (
                  <li className="text-xs text-fg-subtle italic py-1">none</li>
                )}
                {bill.taxes.map((t) => (
                  <li key={t.id} className="py-3 group">
                    <div className="grid grid-cols-[1fr,auto,auto,auto] sm:flex sm:items-center gap-2">
                      <input
                        className="font-medium edit-input edit-input-sm min-w-0 col-span-1 sm:w-28"
                        value={t.label}
                        placeholder="Label"
                        onChange={(e) => updateTax(t.id, { label: e.target.value })}
                      />
                      <input
                        type="number" inputMode="decimal" step="0.01" placeholder="%"
                        className="w-16 text-right edit-input edit-input-sm text-fg-muted"
                        value={t.rate_pct ?? ""}
                        onChange={(e) =>
                          updateTax(t.id, {
                            rate_pct: e.target.value === "" ? null : parseFloat(e.target.value),
                          })
                        }
                      />
                      <span className="hidden sm:block flex-1" />
                      <input
                        type="number" inputMode="decimal" step="0.01"
                        className="w-24 text-right edit-input edit-input-sm tabular-nums"
                        value={t.amount}
                        onChange={(e) =>
                          updateTax(t.id, { amount: parseFloat(e.target.value || "0") })
                        }
                      />
                      <button
                        onClick={() => deleteTax(t.id)}
                        className="text-fg-subtle hover:text-danger transition w-9 h-9 grid place-items-center rounded-md hover:bg-danger-soft"
                        aria-label="Delete tax"
                      ><Trash className="text-sm" /></button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="text-[10px] text-fg-subtle uppercase tracking-wider mr-1 leading-6">
                        applies to:
                      </span>
                      {TAX_CLASS_OPTIONS.map((cls) => {
                        const active = t.applies_to_classes.includes(cls);
                        return (
                          <button
                            key={cls}
                            onClick={() => toggleTaxClass(t.id, cls)}
                            className={`text-[11px] px-2 py-1 rounded uppercase tracking-wider transition ${
                              active
                                ? TAX_LABELS[cls].className
                                : "bg-surface-2 text-fg-subtle border border-dashed border-line"
                            }`}
                          >
                            {cls.replace(/_/g, " ")}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Charges */}
            <div className="mb-3">
              <div className="text-xs uppercase text-fg-subtle tracking-wider mb-1.5 flex items-center justify-between">
                <span>Charges</span>
                <button onClick={addCharge} className="inline-flex items-center gap-1 text-fg-muted hover:text-accent transition"><Plus className="text-xs" /> charge</button>
              </div>
              <ul className="text-sm divide-y divide-line">
                {bill.bill_level_charges.length === 0 && (
                  <li className="text-xs text-fg-subtle italic py-1">none</li>
                )}
                {bill.bill_level_charges.map((c) => (
                  <li key={c.id} className="py-3 group">
                    <div className="grid grid-cols-[1fr,auto,auto] sm:flex sm:items-center gap-2">
                      <input
                        className="font-medium edit-input edit-input-sm sm:w-36 col-span-3 sm:col-span-1"
                        value={c.label}
                        placeholder="Charge label"
                        onChange={(e) => updateCharge(c.id, { label: e.target.value })}
                      />
                      <select
                        className="field field-sm w-auto text-xs"
                        value={c.kind}
                        onChange={(e) => updateCharge(c.id, { kind: e.target.value as BillLevelCharge["kind"] })}
                      >
                        <option value="service_charge">service charge</option>
                        <option value="packaging">packaging</option>
                        <option value="delivery">delivery</option>
                        <option value="platform_fee">platform fee</option>
                        <option value="convenience_fee">convenience fee</option>
                        <option value="tip">tip</option>
                        <option value="other">other</option>
                      </select>
                      <span className="hidden sm:block flex-1" />
                      <div className="flex items-center gap-2 col-span-3 sm:col-span-1 justify-end">
                        <input
                          type="number" inputMode="decimal" step="0.01"
                          className="w-24 text-right edit-input edit-input-sm tabular-nums"
                          value={c.amount}
                          onChange={(e) => updateCharge(c.id, { amount: parseFloat(e.target.value || "0") })}
                        />
                        <button
                          onClick={() => deleteCharge(c.id)}
                          className="text-fg-subtle hover:text-danger transition w-9 h-9 grid place-items-center rounded-md hover:bg-danger-soft"
                          aria-label="Delete charge"
                        ><Trash className="text-sm" /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Discounts */}
            <div className="mb-3">
              <div className="text-xs uppercase text-fg-subtle tracking-wider mb-1.5 flex items-center justify-between">
                <span>Discounts</span>
                <div className="flex gap-3">
                  <button onClick={() => addDiscount("platform")} className="inline-flex items-center gap-1 text-fg-muted hover:text-accent transition"><Plus className="text-xs" /> discount</button>
                  <button onClick={() => addDiscount("pre_payment")} className="inline-flex items-center gap-1 text-fg-muted hover:text-accent transition"><Plus className="text-xs" /> cover charge</button>
                </div>
              </div>
              <ul className="text-sm divide-y divide-line">
                {bill.discounts.length === 0 && (
                  <li className="text-xs text-fg-subtle italic py-1">none</li>
                )}
                {bill.discounts.map((d) => (
                  <li key={d.id} className="py-3 group">
                    <div className="grid grid-cols-[1fr,auto,auto] sm:flex sm:items-center gap-2">
                      <input
                        className="font-medium edit-input edit-input-sm sm:w-36 col-span-3 sm:col-span-1 text-accent"
                        value={d.label}
                        placeholder="Discount label"
                        onChange={(e) => updateDiscount(d.id, { label: e.target.value })}
                      />
                      <select
                        className="field field-sm w-auto text-xs"
                        value={d.kind}
                        onChange={(e) => updateDiscount(d.id, { kind: e.target.value as DiscountKind })}
                      >
                        <option value="platform">platform</option>
                        <option value="restaurant">restaurant</option>
                        <option value="coupon">coupon</option>
                        <option value="loyalty">loyalty</option>
                        <option value="pre_payment">cover / pre-paid</option>
                        <option value="other">other</option>
                      </select>
                      <span className="hidden sm:block flex-1" />
                      <div className="flex items-center gap-2 col-span-3 sm:col-span-1 justify-end">
                        <input
                          type="number" inputMode="decimal" step="0.01"
                          className="w-24 text-right edit-input edit-input-sm tabular-nums text-accent"
                          value={d.amount}
                          onChange={(e) => updateDiscount(d.id, { amount: parseFloat(e.target.value || "0") })}
                        />
                        <button
                          onClick={() => deleteDiscount(d.id)}
                          className="text-fg-subtle hover:text-danger transition w-9 h-9 grid place-items-center rounded-md hover:bg-danger-soft"
                          aria-label="Delete discount"
                        ><Trash className="text-sm" /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Totals */}
            <ul className="text-sm divide-y divide-line border-t border-line pt-2">
              <li className="flex items-center justify-between py-1.5 text-fg-muted gap-2">
                <span>Round-off</span>
                <input
                  type="number" inputMode="decimal" step="0.01"
                  className="w-24 text-right edit-input tabular-nums"
                  value={bill.round_off}
                  onChange={(e) => updateRoundOff(parseFloat(e.target.value || "0"))}
                />
              </li>
              <li className="flex items-center justify-between pt-2 mt-1 border-t border-line font-semibold gap-2">
                <span className="text-base">Grand Total</span>
                <input
                  type="number" inputMode="decimal" step="0.01"
                  className="w-28 text-right edit-input tabular-nums font-display font-bold text-base"
                  value={bill.grand_total}
                  onChange={(e) => updateGrandTotal(parseFloat(e.target.value || "0"))}
                />
              </li>
            </ul>
          </section>
        </div>

        {/*
          Sidebar: image.
          - Mobile (<lg): rendered FIRST in source order so it appears at the top.
            Sticky at top of viewport with max-h-[35vh] so it stays visible while
            user scrolls items below — effectively giving side-by-side on phone.
          - Desktop (lg+): placed in the right column via lg:col-start-2,
            sticky in the column.
        */}
        <aside
          className="
            row-start-1 lg:col-start-2 lg:row-start-1
            space-y-2 lg:space-y-3
            sticky top-[110px] z-20 -mx-4 px-4 sm:mx-0 sm:px-0 bg-bg/95 backdrop-blur pb-2
            lg:static lg:bg-transparent lg:backdrop-blur-none lg:p-0
            lg:sticky lg:top-[124px] lg:self-start lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto
          "
        >
          {imagePreview ? (
            <div className="relative group">
              {/* Show the bill at full column width and let it SCROLL rather than
                  shrink-to-fit — a long or cropped receipt stays readable so the
                  user can actually cross-check line items against the fields
                  below. Fullscreen zoom is still one tap away. */}
              <div
                className="
                  max-h-[46vh] overflow-y-auto rounded-xl border border-line bg-surface
                  lg:max-h-none lg:overflow-visible
                "
              >
                <img
                  src={imagePreview}
                  alt="bill — tap to zoom"
                  onClick={() => setZoomed(true)}
                  className="block w-full h-auto cursor-zoom-in"
                />
              </div>
              <button
                type="button"
                onClick={() => setZoomed(true)}
                aria-label="Open bill image fullscreen"
                className="
                  absolute top-2 right-2 px-2.5 py-1.5 rounded-md bg-black/65 hover:bg-black/80
                  text-white text-xs flex items-center gap-1.5 transition
                  opacity-100 lg:opacity-0 lg:group-hover:opacity-100
                "
                title="Open fullscreen"
              >
                <Maximize className="text-xs" /> Tap to zoom
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong bg-surface p-4 text-xs text-fg-subtle text-center">
              No preview available — backend hasn't returned the image yet,
              or the upload was a format the browser can't render directly.
            </div>
          )}

          {/* Mobile-only: collapsible action panel; on desktop these stay open */}
          <details className="lg:hidden group card">
            <summary className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-fg-muted cursor-pointer list-none">
              <ChevronDown className="text-sm transition-transform group-open:rotate-180" />
              More photo options
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <button onClick={onRetake} className="btn-secondary btn-md w-full gap-1.5">
                <RotateCcw className="text-sm" /> Retake / upload new photo
              </button>
              <label className="btn-secondary btn-md w-full cursor-pointer gap-1.5">
                <Plus className="text-sm" />
                {busy ? "Reading platform summary…" : "Add Swiggy / Zomato / District"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onAddPlatformSummary(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </details>

          {/* Desktop-only: same actions, always visible */}
          <div className="hidden lg:block space-y-2">
            <button onClick={onRetake} className="btn-secondary btn-md w-full gap-1.5">
              <RotateCcw className="text-sm" /> Retake / upload new photo
            </button>
            <label className="btn-secondary btn-md w-full cursor-pointer gap-1.5">
              <Plus className="text-sm" />
              {busy ? "Reading platform summary…" : "Add Swiggy / Zomato / District"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onAddPlatformSummary(file);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-xs text-fg-subtle leading-snug">
              Got a Swiggy/Zomato/District screenshot of the bill summary?
              Adding it folds in the cover charge, instant discount, coupon, and
              convenience fee that the restaurant receipt doesn't show.
            </p>
          </div>
        </aside>
      </div>

      {zoomed && imagePreview && (
        <FullscreenImage src={imagePreview} onClose={() => setZoomed(false)} />
      )}

      <div className="mt-8 flex justify-end">
        <button onClick={onContinue} disabled={!canContinue} className="btn-primary btn-md gap-1.5">
          Looks right — add people
          <ArrowRight className="text-sm" />
        </button>
      </div>
    </div>
  );
}
