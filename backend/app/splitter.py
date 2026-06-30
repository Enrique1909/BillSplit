"""Split algorithm.

Given a Bill plus an assignments map (item_id -> [(person_id, share)]), compute
each person's exact rupee total.

Design tenets (from docs/02_extraction_schema.md):
  1. Pay only for what you consumed.
  2. Taxes follow tax_class — alcohol VAT only hits people who consumed alcohol items.
  3. Service charge is per-section proportional (defaults to "all sections", toggleable).
  4. Modifier sub-items roll up into their parent — assignment is at the parent level.
  5. Sum of person totals == grand_total exactly. Residual rupee goes to the largest payer.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Mapping, Optional, Sequence

from .schema import Bill, BillItem, ChargeKind, TaxClass


@dataclass
class Assignment:
    person_id: str
    share: float  # 0.0 < share <= 1.0


@dataclass
class PersonBreakdown:
    person_id: str
    items_subtotal: float = 0.0     # gross consumed
    taxes: float = 0.0
    charges: float = 0.0            # service charge / packaging / etc.
    discounts: float = 0.0          # subtractive
    round_off: float = 0.0
    total: float = 0.0              # final rupee total
    items: list[dict] = field(default_factory=list)  # debug/UI: which items they took
    notes: list[str] = field(default_factory=list)


@dataclass
class SplitOptions:
    skip_service_charge: bool = False     # opt-out (it's voluntary)
    service_charge_excludes_alcohol: bool = False
    skip_voluntary_charges: bool = False  # tip etc.
    # Whom should the sub-rupee rounding residual land on?
    # None = auto (the largest-total payer absorbs it).
    # Otherwise: the person_id whose total absorbs the residual.
    residual_recipient_id: Optional[str] = None


@dataclass
class SplitResult:
    breakdowns: list[PersonBreakdown]
    grand_total: float
    sum_of_people: float
    residual_assigned_to: str | None
    warnings: list[str]


def _resolve_assignments(
    bill: Bill, assignments: Mapping[str, Sequence[Assignment]]
) -> dict[str, list[Assignment]]:
    """Validate and normalize assignments. Each parent item must have shares summing to 1.0."""
    parent_ids = {
        i.id for s in bill.sections for i in s.items if i.parent_id is None and not i.is_complimentary
    }
    out: dict[str, list[Assignment]] = {}
    for iid in parent_ids:
        shares = list(assignments.get(iid, []))
        total = sum(a.share for a in shares)
        if not shares:
            raise ValueError(f"item {iid} has no assignments")
        if abs(total - 1.0) > 1e-3:
            raise ValueError(f"item {iid} shares sum to {total}, must be 1.0")
        out[iid] = list(shares)
    return out


def _item_full_total(bill: Bill, item: BillItem) -> float:
    """Item total including any modifier children rolled up."""
    children_total = 0.0
    for s in bill.sections:
        for child in s.items:
            if child.parent_id == item.id:
                children_total += child.line_total
    return round(item.line_total + children_total, 2)


def _item_class_subtotal(bill: Bill, person_subtotal_by_class: dict[TaxClass, float]) -> float:
    return round(sum(person_subtotal_by_class.values()), 2)


def split_bill(
    bill: Bill,
    assignments: Mapping[str, Sequence[Assignment]],
    options: SplitOptions | None = None,
) -> SplitResult:
    options = options or SplitOptions()
    warnings: list[str] = []

    # Reject splitting on a non-reconciling bill — the UI must force a fix first.
    if abs(bill.reconciliation.delta) > 0.5:
        warnings.append(
            f"Bill does not reconcile: delta = ₹{bill.reconciliation.delta}. "
            f"Edit items / taxes before splitting."
        )

    norm_assignments = _resolve_assignments(bill, assignments)

    # Collect person IDs (deterministic order = first-seen order in assignments)
    person_ids: list[str] = []
    seen = set()
    for iid, shares in norm_assignments.items():
        for a in shares:
            if a.person_id not in seen:
                seen.add(a.person_id)
                person_ids.append(a.person_id)

    # 1) Per-person, per-item-class subtotal (food/alcohol/non_alc/etc.)
    sub_by_class: dict[str, dict[TaxClass, float]] = {p: defaultdict(float) for p in person_ids}
    person_items: dict[str, list[dict]] = {p: [] for p in person_ids}

    # Build lookup: item_id -> (item, section)
    parent_lookup: dict[str, BillItem] = {}
    for s in bill.sections:
        for i in s.items:
            if i.parent_id is None:
                parent_lookup[i.id] = i

    for iid, shares in norm_assignments.items():
        item = parent_lookup[iid]
        if item.is_complimentary:
            continue
        item_total = _item_full_total(bill, item)
        # All people who claimed this item, deterministic order, deduped.
        claimant_ids = list(dict.fromkeys(a.person_id for a in shares))
        for a in shares:
            contrib = round(item_total * a.share, 4)
            sub_by_class[a.person_id][item.tax_class] += contrib
            person_items[a.person_id].append({
                "item_id": iid,
                "name": item.name,
                "share": a.share,
                "amount": round(contrib, 2),
                "tax_class": item.tax_class.value,
                # Other people sharing this item, so the UI can render
                # "split with Bob, Carl" instead of "split by 3".
                "co_claimant_ids": [
                    pid for pid in claimant_ids if pid != a.person_id
                ],
            })

    # 2) Taxes — distributed proportionally within the eligible tax_class basis
    person_tax: dict[str, float] = {p: 0.0 for p in person_ids}
    for tax in bill.taxes:
        eligible_classes = set(tax.applies_to_classes)
        # Compute basis = sum of all items in eligible classes (across all people, == across the bill)
        basis = 0.0
        for s in bill.sections:
            for i in s.items:
                if i.parent_id is None and i.tax_class in eligible_classes:
                    basis += _item_full_total(bill, i)
        if basis <= 0:
            warnings.append(f"tax {tax.label} has zero basis; skipping")
            continue
        # If the tax includes service charge in basis, we treat it implicitly:
        # the printed `amount` already reflects that; we just distribute by item-class consumption.
        for p in person_ids:
            person_eligible = sum(
                v for cls, v in sub_by_class[p].items() if cls in eligible_classes
            )
            person_tax[p] += tax.amount * (person_eligible / basis) if basis else 0.0

    # 3) Bill-level charges — service charge, packaging, delivery, platform, tip, etc.
    person_charge: dict[str, float] = {p: 0.0 for p in person_ids}
    bill_subtotal = sum(s.subtotal for s in bill.sections)

    for charge in bill.bill_level_charges:
        if options.skip_service_charge and charge.kind == ChargeKind.SERVICE_CHARGE:
            continue
        if options.skip_voluntary_charges and charge.is_voluntary and charge.kind != ChargeKind.SERVICE_CHARGE:
            continue

        # If user opted out of service charge on alcohol, restrict applicable scope.
        if (
            charge.kind == ChargeKind.SERVICE_CHARGE
            and options.service_charge_excludes_alcohol
        ):
            applicable_classes = {TaxClass.FOOD, TaxClass.NON_ALCOHOLIC_BEVERAGE, TaxClass.OTHER}
        else:
            applicable_classes = None  # all classes eligible

        # Compute basis: total subtotal restricted to applicable sections / classes
        if charge.applies_to_section_ids == "all":
            applicable_section_ids = {s.id for s in bill.sections}
        else:
            applicable_section_ids = set(charge.applies_to_section_ids)

        basis = 0.0
        for s in bill.sections:
            if s.id not in applicable_section_ids:
                continue
            for i in s.items:
                if i.parent_id is None and (
                    applicable_classes is None or i.tax_class in applicable_classes
                ):
                    basis += _item_full_total(bill, i)

        if basis <= 0:
            warnings.append(f"charge {charge.label} has zero basis; skipping")
            continue

        for p in person_ids:
            person_eligible = sum(
                v
                for cls, v in sub_by_class[p].items()
                if (applicable_classes is None or cls in applicable_classes)
            )
            person_charge[p] += charge.amount * (person_eligible / basis) if basis else 0.0

    # 4) Discounts
    person_disc: dict[str, float] = {p: 0.0 for p in person_ids}
    for d in bill.discounts:
        # Pre-payment / cover charge: full credit to the specific person who paid upfront.
        if d.paid_by_person_id:
            if d.paid_by_person_id in person_ids:
                person_disc[d.paid_by_person_id] += d.amount
            else:
                warnings.append(
                    f"Discount '{d.label}' is attributed to person "
                    f"'{d.paid_by_person_id}' who isn't in the assignment list — "
                    f"credit not applied."
                )
            continue
        target = d.applies_to
        if target.type == "item" and target.item_id:
            shares = norm_assignments.get(target.item_id, [])
            for a in shares:
                person_disc[a.person_id] += d.amount * a.share
        elif target.type == "section" and target.section_id:
            sec = next((s for s in bill.sections if s.id == target.section_id), None)
            if not sec or sec.subtotal <= 0:
                continue
            sec_classes = {i.tax_class for i in sec.items if i.parent_id is None}
            for p in person_ids:
                person_eligible = sum(
                    v for cls, v in sub_by_class[p].items() if cls in sec_classes
                )
                person_disc[p] += d.amount * (person_eligible / sec.subtotal)
        else:  # bill
            for p in person_ids:
                person_subtotal = _item_class_subtotal(bill, sub_by_class[p])
                person_disc[p] += d.amount * (person_subtotal / bill_subtotal) if bill_subtotal else 0.0

    # 5) Round-off — distributed proportionally to each person's pre-roundoff total
    pre_roundoff: dict[str, float] = {}
    for p in person_ids:
        pre_roundoff[p] = (
            _item_class_subtotal(bill, sub_by_class[p])
            + person_tax[p]
            + person_charge[p]
            - person_disc[p]
        )
    pre_total = sum(pre_roundoff.values())
    person_round: dict[str, float] = {p: 0.0 for p in person_ids}
    if pre_total > 0:
        for p in person_ids:
            person_round[p] = bill.round_off * (pre_roundoff[p] / pre_total)

    # 6) Build per-person breakdown (still floating point at this stage)
    breakdowns: list[PersonBreakdown] = []
    for p in person_ids:
        items_sub = _item_class_subtotal(bill, sub_by_class[p])
        total = pre_roundoff[p] + person_round[p]
        breakdowns.append(PersonBreakdown(
            person_id=p,
            items_subtotal=round(items_sub, 2),
            taxes=round(person_tax[p], 2),
            charges=round(person_charge[p], 2),
            discounts=round(person_disc[p], 2),
            round_off=round(person_round[p], 2),
            total=round(total, 2),
            items=person_items[p],
        ))

    # 7) Rupee-rounding & residual: round each person to ₹1, then push residual to highest payer.
    for b in breakdowns:
        b.total = float(round(b.total))

    sum_people = sum(b.total for b in breakdowns)
    residual = round(bill.grand_total - sum_people, 2)
    residual_assigned_to: str | None = None

    # Only redistribute *small* rounding drift (e.g., a few rupees from rounding to ₹1).
    # Large gaps mean the user opted out of a charge or skipped voluntary fees on
    # purpose — that's a legitimate reduction, not a math error.
    voluntary_skipped = (
        options.skip_service_charge or options.skip_voluntary_charges
    )
    rounding_threshold = max(len(breakdowns), 1) + 1  # ~₹1 per person headroom
    if (
        abs(residual) >= 1
        and abs(residual) <= rounding_threshold
        and breakdowns
        and not voluntary_skipped
    ):
        # User-chosen recipient if provided AND that person is in the split,
        # else fall back to the largest-total payer.
        target: PersonBreakdown | None = None
        if options.residual_recipient_id:
            target = next(
                (b for b in breakdowns if b.person_id == options.residual_recipient_id),
                None,
            )
            if target is None:
                warnings.append(
                    f"Residual recipient '{options.residual_recipient_id}' not in "
                    f"the split; falling back to largest payer."
                )
        if target is None:
            target = max(breakdowns, key=lambda b: b.total)
        target.total += residual
        target.notes.append(f"absorbed ₹{residual:+.0f} rounding residual")
        residual_assigned_to = target.person_id
        sum_people = sum(b.total for b in breakdowns)
    elif abs(residual) > rounding_threshold and not voluntary_skipped:
        warnings.append(
            f"Sum of person totals (₹{sum_people:.2f}) doesn't match grand total "
            f"(₹{bill.grand_total:.2f}). Residual ₹{residual:.2f} not assigned — "
            f"likely a math discrepancy in the bill or assignments."
        )

    return SplitResult(
        breakdowns=breakdowns,
        grand_total=bill.grand_total,
        sum_of_people=sum_people,
        residual_assigned_to=residual_assigned_to,
        warnings=warnings,
    )
