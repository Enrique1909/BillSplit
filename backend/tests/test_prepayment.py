"""Pre-payment / cover charge correctness test.

Scenario (modeled on the District Red Box Bar bill):
  Bill amount        : 7,733
  Instant discount   : 1,933.25  (platform — applies to whole bill)
  Cover charge       : 150       (paid by Alice upfront — pre_payment)
  DINECASH coupon    : 93        (coupon — applies to whole bill)
  Convenience fee    : 215
  --------------------------------
  Total paid         : 5,771.75

  4 people share the bill equally (everyone consumed equally).
  Alice paid the ₹150 cover charge at booking — she should get ₹150 credit
  back when the split happens.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schema import (
    Bill, BillItem, BillLevelCharge, BillSection, BillTax, ChargeKind,
    Discount, DiscountKind, DiscountTarget, Reconciliation, TaxClass,
)
from app.splitter import Assignment, SplitOptions, split_bill


def build_district_bill() -> Bill:
    section = BillSection(
        id="s0",
        name="Restaurant items",
        default_tax_class=TaxClass.FOOD,
        items=[
            BillItem(
                id="s0_i0", parent_id=None, name="Restaurant bill (placeholder)",
                qty=1, unit_price=7733.0, line_total=7733.0,
                tax_class=TaxClass.FOOD, raw_text="Bill amount 7733",
            )
        ],
        subtotal=7733.0,
    )
    convenience = BillLevelCharge(
        id="c0", label="Convenience fee", kind=ChargeKind.CONVENIENCE_FEE,
        rate_pct=None, amount=215.0, is_voluntary=False,
        applies_to_section_ids="all", is_taxable=False,
    )
    instant = Discount(
        id="d0", label="Instant discount", kind=DiscountKind.PLATFORM,
        rate_pct=None, amount=1933.25,
        applies_to=DiscountTarget(type="bill"),
    )
    coupon = Discount(
        id="d1", label="DINECASH10MJZVERKCNM", kind=DiscountKind.COUPON,
        rate_pct=None, amount=93.0,
        applies_to=DiscountTarget(type="bill"),
    )
    cover = Discount(
        id="d2", label="Cover charge settlement", kind=DiscountKind.PRE_PAYMENT,
        rate_pct=None, amount=150.0,
        applies_to=DiscountTarget(type="bill"),
        paid_by_person_id="alice",   # Alice pre-paid this at booking
    )

    grand = 7733.0 + 215.0 - 1933.25 - 93.0 - 150.0  # 5771.75
    bill = Bill(
        sections=[section],
        taxes=[],
        bill_level_charges=[convenience],
        discounts=[instant, coupon, cover],
        round_off=0.0,
        grand_total=round(grand, 2),
        reconciliation=Reconciliation(computed_total=round(grand, 2), delta=0.0),
    )
    bill.reconciliation = bill.reconcile()
    return bill


def test_cover_charge_credits_only_alice():
    bill = build_district_bill()
    assert abs(bill.reconciliation.delta) < 0.01, \
        f"Bill should reconcile, delta={bill.reconciliation.delta}"

    # 4 people share the food equally
    everyone = ["alice", "bob", "carl", "dave"]
    assignments: dict[str, list[Assignment]] = {
        "s0_i0": [Assignment(p, 0.25) for p in everyone]
    }

    res = split_bill(bill, assignments, SplitOptions())

    print(f"\n=== District bill — 4-way split with Alice pre-paid cover ===")
    print(f"  Grand total : ₹{res.grand_total}")
    print(f"  Sum of ppl  : ₹{res.sum_of_people}")
    print(f"  Match       : {res.grand_total == res.sum_of_people}")
    for b in res.breakdowns:
        print(f"  {b.person_id:6s} items=₹{b.items_subtotal:.2f}  "
              f"chg=₹{b.charges:.2f}  disc=₹{b.discounts:.2f}  total=₹{b.total:.0f}")

    by_id = {b.person_id: b for b in res.breakdowns}

    # Alice's discount should be at least ₹150 more than anyone else's
    # (she gets the full cover-charge credit on top of her share of the other discounts)
    others_disc = [by_id[p].discounts for p in ["bob", "carl", "dave"]]
    assert by_id["alice"].discounts >= others_disc[0] + 149, (
        f"Alice's discount {by_id['alice'].discounts} should be "
        f"~₹150 more than others' {others_disc[0]}"
    )

    # Bob, Carl, Dave should all pay roughly the same (within ₹2 — one of them
    # absorbs the sub-rupee residual that keeps sum == grand_total exact).
    others = sorted([by_id["bob"].total, by_id["carl"].total, by_id["dave"].total])
    assert others[-1] - others[0] <= 2, \
        f"Equal-share diners should be within ₹2: {others}"

    # Alice should pay ~₹150 LESS than the average non-Alice diner.
    others_avg = sum(others) / 3
    diff = others_avg - by_id["alice"].total
    assert 148 <= diff <= 152, f"Alice should owe ~₹150 less; she owes ₹{diff:.2f} less"

    # Sum must equal grand total exactly
    assert res.sum_of_people == res.grand_total

    print(f"\n  ✓ Alice pays ₹{diff} less than others (the cover charge she pre-paid)")
    print(f"  ✓ Bob/Carl/Dave pay identical amounts")
    print(f"  ✓ Sum matches grand total exactly")


if __name__ == "__main__":
    test_cover_charge_credits_only_alice()
    print("\n✅ Pre-payment test passed.")
