"""Verifies that ALL arithmetic happens in Python, never trusts Gemini's math.

Architectural contract:
  - Gemini extracts raw values from the image.
  - Python recomputes section.subtotal, reconciliation.computed_total,
    and reconciliation.delta on every Bill.recompute().
  - Small round_off discrepancies (≤ ₹2) auto-correct so a mis-OCR'd
    round-off digit doesn't surface as a bogus reconciliation error.

Test scenarios:
  1. Bill with a deliberately-wrong section.subtotal — Python re-derives the right one.
  2. Si Nonna's-style bill where round_off is mis-OCR'd as -0.92 (vs +0.38) —
     auto-correct kicks in, delta becomes 0, and a note records the fix.
  3. Bill with a large gap (₹50+) — auto-correct does NOT kick in, delta surfaces.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schema import (
    Bill, BillItem, BillLevelCharge, BillSection, BillTax,
    ChargeKind, Reconciliation, TaxClass,
)


def _base_section(items_data: list[tuple[str, float, TaxClass]]) -> BillSection:
    items = [
        BillItem(
            id=f"s0_i{i}", parent_id=None, name=name, qty=1.0,
            unit_price=price, line_total=price, tax_class=cls, raw_text=""
        )
        for i, (name, price, cls) in enumerate(items_data)
    ]
    return BillSection(id="s0", name="Items", default_tax_class=TaxClass.FOOD, items=items, subtotal=0)


def test_python_recomputes_wrong_subtotal():
    """Even if Gemini ships a section.subtotal of 9999, Python re-derives correctly."""
    section = _base_section([("Pizza", 500.0, TaxClass.FOOD), ("Pasta", 300.0, TaxClass.FOOD)])
    section.subtotal = 9999.0  # deliberately wrong
    bill = Bill(
        sections=[section], taxes=[], bill_level_charges=[], discounts=[],
        round_off=0.0, grand_total=800.0,
        reconciliation=Reconciliation(computed_total=0, delta=0),
    )
    bill.recompute()
    assert bill.sections[0].subtotal == 800.0, \
        f"subtotal should be re-derived to 800, got {bill.sections[0].subtotal}"
    assert bill.reconciliation.delta == 0.0
    print(f"  ✓ Wrong subtotal {9999} re-derived to {bill.sections[0].subtotal}")


def test_si_nonnas_bad_round_off_auto_corrects():
    """Reproduces the Si Nonna's case: items + taxes + service charge are right,
    but Gemini wrote round_off=-0.92 when the bill math implies round_off=+0.38."""
    section = _base_section([
        ("MEAT SPECIAL PIZZA", 929.0, TaxClass.FOOD),
        ("PIZZA 2 - MARGHERITA", 499.0, TaxClass.FOOD),
        ("Buratta", 250.0, TaxClass.FOOD),
        ("Buratta", 250.0, TaxClass.FOOD),
        ("NONNA'S TIRAMISU", 429.0, TaxClass.FOOD),
    ])
    # Add the wine line as a separate alcohol item
    section.items.append(BillItem(
        id="s0_i5", parent_id=None, name="MS FRATELLI SANGIOVESE",
        qty=2.0, unit_price=549.0, line_total=1098.0,
        tax_class=TaxClass.ALCOHOL, raw_text="",
    ))
    section.subtotal = 0  # will be recomputed

    taxes = [
        BillTax(id="t0", label="CGST", rate_pct=2.5, amount=64.82,
                applies_to_classes=[TaxClass.FOOD, TaxClass.NON_ALCOHOLIC_BEVERAGE],
                includes_service_charge_in_basis=True),
        BillTax(id="t1", label="SGST", rate_pct=2.5, amount=64.82,
                applies_to_classes=[TaxClass.FOOD, TaxClass.NON_ALCOHOLIC_BEVERAGE],
                includes_service_charge_in_basis=True),
        BillTax(id="t2", label="VAT", rate_pct=10.0, amount=120.48,
                applies_to_classes=[TaxClass.ALCOHOL],
                includes_service_charge_in_basis=True),
    ]
    charges = [
        BillLevelCharge(
            id="c0", label="Service Charge", kind=ChargeKind.SERVICE_CHARGE,
            rate_pct=10.0, amount=345.5, is_voluntary=True,
            applies_to_section_ids="all", is_taxable=True,
        )
    ]
    bill = Bill(
        sections=[section], taxes=taxes, bill_level_charges=charges, discounts=[],
        round_off=-0.92,                      # <-- Gemini's wrong value
        grand_total=4051.0,
        reconciliation=Reconciliation(computed_total=0, delta=0),
    )

    bill.recompute()

    print(f"\n=== Si Nonna's recompute ===")
    print(f"  subtotal           : ₹{bill.sections[0].subtotal}")
    print(f"  taxes              : ₹{sum(t.amount for t in bill.taxes)}")
    print(f"  service charge     : ₹{sum(c.amount for c in bill.bill_level_charges)}")
    print(f"  round_off (was -0.92): ₹{bill.round_off}")
    print(f"  computed_total     : ₹{bill.reconciliation.computed_total}")
    print(f"  delta              : ₹{bill.reconciliation.delta}")
    print(f"  notes              : {bill.reconciliation.notes}")

    assert bill.reconciliation.delta == 0.0, \
        f"After recompute, delta should be 0 (auto-corrected); got {bill.reconciliation.delta}"
    assert any("auto-corrected round_off" in n for n in bill.reconciliation.notes), \
        "Should record that round-off was auto-corrected"
    assert abs(bill.round_off - 0.38) < 0.01, \
        f"Auto-corrected round_off should be ~+0.38, got {bill.round_off}"
    print(f"  ✓ Auto-correct kicked in: round_off -0.92 → +0.38, delta now 0")


def test_large_gap_does_not_auto_correct():
    """If the gap is large (>₹2), it's a real extraction error, not a print artifact."""
    section = _base_section([("Pizza", 500.0, TaxClass.FOOD)])
    bill = Bill(
        sections=[section], taxes=[], bill_level_charges=[], discounts=[],
        round_off=0.0, grand_total=800.0,  # 300 short — items only sum to 500
        reconciliation=Reconciliation(computed_total=0, delta=0),
    )
    bill.recompute()
    assert abs(bill.reconciliation.delta) > 100, \
        f"Large gap should NOT auto-correct, got delta={bill.reconciliation.delta}"
    print(f"  ✓ Large gap (₹{bill.reconciliation.delta}) preserved for user review")


if __name__ == "__main__":
    test_python_recomputes_wrong_subtotal()
    test_si_nonnas_bad_round_off_auto_corrects()
    test_large_gap_does_not_auto_correct()
    print("\n✅ All recompute tests passed.")
