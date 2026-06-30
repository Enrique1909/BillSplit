"""Smoke tests for the splitter using extracted sample bills."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schema import Bill
from app.splitter import Assignment, SplitOptions, split_bill


SAMPLES = Path(__file__).resolve().parent / "extraction_samples"


def load(name: str) -> Bill:
    return Bill.model_validate(json.loads((SAMPLES / f"{name}.json").read_text()))


def test_old_street_food_vs_alcohol():
    """Alice (food only) vs Bob (alcohol drinker). VAT must hit Bob only.

    Bill: 11632 total, two sections (Food Menu + Bar Menu).
    """
    bill = load("IMG_0823")

    # Assign by tax_class (more robust than name matching)
    assignments: dict[str, list[Assignment]] = {}
    for s in bill.sections:
        for i in s.items:
            if i.parent_id is not None or i.is_complimentary:
                continue
            if i.tax_class.value == "food":
                assignments[i.id] = [Assignment("alice", 1.0)]
            elif i.tax_class.value == "non_alcoholic_beverage":
                assignments[i.id] = [Assignment("alice", 0.5), Assignment("bob", 0.5)]
            elif i.tax_class.value == "alcohol":
                assignments[i.id] = [Assignment("bob", 1.0)]
            else:
                assignments[i.id] = [Assignment("alice", 0.5), Assignment("bob", 0.5)]

    result = split_bill(bill, assignments, SplitOptions())

    print(f"\n=== Old Street Cafe split ===")
    print(f"Grand total: ₹{result.grand_total:.2f}")
    print(f"Sum of people: ₹{result.sum_of_people:.2f}  (must equal grand_total)")
    if result.warnings:
        print(f"Warnings: {result.warnings}")

    for b in result.breakdowns:
        print(f"\n  {b.person_id}:")
        print(f"    items subtotal : ₹{b.items_subtotal:.2f}")
        print(f"    taxes          : ₹{b.taxes:.2f}")
        print(f"    charges        : ₹{b.charges:.2f}")
        print(f"    discounts      : ₹{b.discounts:.2f}")
        print(f"    round-off      : ₹{b.round_off:.2f}")
        print(f"    -------------------")
        print(f"    TOTAL          : ₹{b.total:.0f}")
        if b.notes: print(f"    notes: {b.notes}")

    assert result.sum_of_people == result.grand_total, \
        f"sum {result.sum_of_people} != total {result.grand_total}"

    # Sanity: Bob (drinker) pays substantially more than Alice
    alice = next(b for b in result.breakdowns if b.person_id == "alice")
    bob = next(b for b in result.breakdowns if b.person_id == "bob")
    assert bob.total > alice.total * 2, \
        f"Bob should pay much more than Alice ({bob.total} vs {alice.total})"
    print(f"\n  ✓ Bob pays {bob.total/alice.total:.1f}x what Alice pays — alcohol VAT hit only Bob")


def test_hariprasad_two_section():
    """Hotel Hariprasad: 4 people, only 2 of them drank K F Ultra beer (qty 6 — split 3 each).
    The drinkers should pay ALL the MVAT 10%; the non-drinkers should pay zero alcohol tax.
    """
    bill = load("IMG_8334")
    by_name = {
        i.name.lower(): i.id
        for s in bill.sections for i in s.items if i.parent_id is None
    }

    everyone = ["alice", "bob", "carl", "dave"]
    assignments: dict[str, list[Assignment]] = {}
    for s in bill.sections:
        for i in s.items:
            if i.parent_id is not None or i.is_complimentary:
                continue
            if i.tax_class.value in ("food", "non_alcoholic_beverage"):
                assignments[i.id] = [Assignment(p, 1 / 4) for p in everyone]
            elif "blue riband" in i.name.lower():
                # Carl drinks the whisky solo
                assignments[i.id] = [Assignment("carl", 1.0)]
            elif "k f ultra" in i.name.lower() or i.tax_class.value == "alcohol":
                # Carl and Dave split the beer
                assignments[i.id] = [Assignment("carl", 0.5), Assignment("dave", 0.5)]

    result = split_bill(bill, assignments, SplitOptions())

    print(f"\n=== Hariprasad split ===")
    print(f"Grand total: ₹{result.grand_total:.2f}, sum: ₹{result.sum_of_people:.2f}")
    for b in result.breakdowns:
        print(f"  {b.person_id}: items=₹{b.items_subtotal:.2f}  tax=₹{b.taxes:.2f}  total=₹{b.total:.0f}")

    assert result.sum_of_people == result.grand_total

    alice = next(b for b in result.breakdowns if b.person_id == "alice")
    bob = next(b for b in result.breakdowns if b.person_id == "bob")
    carl = next(b for b in result.breakdowns if b.person_id == "carl")
    dave = next(b for b in result.breakdowns if b.person_id == "dave")

    # Alice & Bob should have IDENTICAL totals (same food consumption, no alcohol)
    # And substantially less than Carl/Dave who drank
    assert abs(alice.total - bob.total) <= 1, \
        f"Alice and Bob should pay equal amounts: {alice.total} vs {bob.total}"
    assert carl.total > alice.total * 3, "Carl drank — should pay much more"
    assert dave.total > alice.total * 3, "Dave drank — should pay much more"
    print(f"  ✓ Non-drinkers (Alice, Bob) paid identical small amounts")
    print(f"  ✓ Drinkers (Carl, Dave) paid significantly more")


if __name__ == "__main__":
    test_old_street_food_vs_alcohol()
    test_hariprasad_two_section()
    print("\n\n✅ All splitter tests passed.")
