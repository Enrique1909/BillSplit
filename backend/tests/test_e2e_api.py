"""End-to-end test through the FastAPI HTTP layer.

Uses already-extracted sample JSON (no Gemini call) for /api/split,
and uses an in-memory mock for /api/extract.
This keeps the test fast and avoids burning the daily Gemini quota.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SAMPLES = Path(__file__).resolve().parent / "extraction_samples"


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_split_endpoint_old_street():
    """Hit /api/split with the Old Street Cafe extracted bill.

    Same scenario as test_splitter.py but through HTTP.
    """
    bill = json.loads((SAMPLES / "IMG_0823.json").read_text())

    # Build assignments by tax_class
    assignments: dict[str, list[dict]] = {}
    for s in bill["sections"]:
        for i in s["items"]:
            if i["parent_id"] is not None or i["is_complimentary"]:
                continue
            if i["tax_class"] == "food":
                assignments[i["id"]] = [{"person_id": "alice", "share": 1.0}]
            elif i["tax_class"] == "non_alcoholic_beverage":
                assignments[i["id"]] = [
                    {"person_id": "alice", "share": 0.5},
                    {"person_id": "bob", "share": 0.5},
                ]
            elif i["tax_class"] == "alcohol":
                assignments[i["id"]] = [{"person_id": "bob", "share": 1.0}]

    payload = {
        "bill": bill,
        "assignments": assignments,
        "options": {
            "skip_service_charge": False,
            "service_charge_excludes_alcohol": False,
            "skip_voluntary_charges": False,
        },
    }

    r = client.post("/api/split", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()

    print("\n=== /api/split response ===")
    print(f"  grand_total    : ₹{data['grand_total']}")
    print(f"  sum_of_people  : ₹{data['sum_of_people']}")
    print(f"  residual_to    : {data['residual_assigned_to']}")
    for b in data["breakdowns"]:
        print(f"  {b['person_id']:6s}  items=₹{b['items_subtotal']:.2f}  tax=₹{b['taxes']:.2f}  "
              f"chg=₹{b['charges']:.2f}  total=₹{b['total']:.0f}")

    assert data["grand_total"] == 11632.0
    assert data["sum_of_people"] == 11632.0
    alice = next(b for b in data["breakdowns"] if b["person_id"] == "alice")
    bob = next(b for b in data["breakdowns"] if b["person_id"] == "bob")
    # Bob should have ALL the alcohol VAT (₹729) plus his share of CGST/SGST
    assert bob["taxes"] >= 729.0, f"Bob's tax {bob['taxes']} should include all VAT"
    assert alice["taxes"] < 200, f"Alice paid no VAT, taxes should be small ({alice['taxes']})"
    print(f"  ✓ Bob's tax (₹{bob['taxes']}) includes all alcohol VAT")
    print(f"  ✓ Alice's tax (₹{alice['taxes']}) excludes alcohol VAT entirely")


def test_split_endpoint_rejects_unassigned():
    """If an item has no assignment, /api/split returns 400."""
    bill = json.loads((SAMPLES / "IMG_0823.json").read_text())
    payload = {
        "bill": bill,
        "assignments": {},  # nothing assigned
        "options": {
            "skip_service_charge": False,
            "service_charge_excludes_alcohol": False,
            "skip_voluntary_charges": False,
        },
    }
    r = client.post("/api/split", json=payload)
    assert r.status_code == 400, r.text
    assert "no assignments" in r.text.lower()
    print("  ✓ Empty assignments correctly rejected with 400")


def test_split_endpoint_skip_service_charge():
    """Toggling skip_service_charge reduces totals by ₹511 (the service-charge amount on Old Street)."""
    bill = json.loads((SAMPLES / "IMG_0823.json").read_text())

    assignments: dict[str, list[dict]] = {}
    for s in bill["sections"]:
        for i in s["items"]:
            if i["parent_id"] is not None or i["is_complimentary"]:
                continue
            assignments[i["id"]] = [{"person_id": "alice", "share": 1.0}]

    base = client.post("/api/split", json={
        "bill": bill, "assignments": assignments,
        "options": {"skip_service_charge": False, "service_charge_excludes_alcohol": False, "skip_voluntary_charges": False},
    }).json()
    skipped = client.post("/api/split", json={
        "bill": bill, "assignments": assignments,
        "options": {"skip_service_charge": True, "service_charge_excludes_alcohol": False, "skip_voluntary_charges": False},
    }).json()

    diff = base["sum_of_people"] - skipped["sum_of_people"]
    print(f"  Service charge toggle saves alice ₹{diff}")
    assert abs(diff - 511) < 1.5, f"Expected ~₹511 saving, got ₹{diff}"
    print(f"  ✓ Skipping service charge saves the right amount")


if __name__ == "__main__":
    test_health()
    print("✓ /api/health OK")
    test_split_endpoint_old_street()
    test_split_endpoint_rejects_unassigned()
    test_split_endpoint_skip_service_charge()
    print("\n✅ All e2e API tests passed.")
