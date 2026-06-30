"""Run Gemini extraction on every sample bill, cache result, summarize.

Output: backend/tests/extraction_samples/<basename>.json plus a summary table.
"""

from __future__ import annotations

import json
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.extractor import extract_bill_with_gemini

SAMPLES_DIR = Path("/sessions/funny-youthful-clarke/mnt/outputs/bills_jpg")
OUT_DIR = Path(__file__).resolve().parent.parent / "tests" / "extraction_samples"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def main() -> int:
    rows = []
    for img in sorted(SAMPLES_DIR.glob("*.jpg")):
        out_file = OUT_DIR / f"{img.stem}.json"
        print(f"\n=== {img.name} ===")
        t0 = time.time()
        try:
            bill = extract_bill_with_gemini(img)
            elapsed = time.time() - t0
            out_file.write_text(bill.model_dump_json(indent=2))
            n_items = sum(len(s.items) for s in bill.sections)
            n_sections = len(bill.sections)
            n_taxes = len(bill.taxes)
            n_charges = len(bill.bill_level_charges)
            delta = bill.reconciliation.delta
            status = "OK" if abs(delta) <= 0.5 else "OFF"
            rows.append({
                "file": img.name,
                "restaurant": bill.restaurant.name or "(unknown)",
                "sections": n_sections,
                "items": n_items,
                "taxes": n_taxes,
                "charges": n_charges,
                "grand_total": bill.grand_total,
                "delta": delta,
                "status": status,
                "elapsed_s": round(elapsed, 1),
            })
            print(f"  -> {bill.restaurant.name}, {n_sections} sec / {n_items} items, "
                  f"total ₹{bill.grand_total}, delta ₹{delta} ({status}) in {elapsed:.1f}s")
        except Exception:
            print(f"  -> EXTRACTION FAILED")
            traceback.print_exc()
            rows.append({"file": img.name, "status": "FAIL"})

    print("\n=== Summary ===")
    print(f"{'File':<16} {'Restaurant':<28} {'Secs':>4} {'Items':>5} {'Tax':>3} {'Chg':>3} {'Total':>10} {'Delta':>7} {'Stat':>4} {'Time':>5}")
    for r in rows:
        if r.get("status") == "FAIL":
            print(f"{r['file']:<16} (extraction failed)")
        else:
            print(f"{r['file']:<16} {r['restaurant'][:28]:<28} {r['sections']:>4} "
                  f"{r['items']:>5} {r['taxes']:>3} {r['charges']:>3} "
                  f"{r['grand_total']:>10.2f} {r['delta']:>7.2f} {r['status']:>4} {r['elapsed_s']:>5.1f}")

    # Save summary too
    (OUT_DIR / "_summary.json").write_text(json.dumps(rows, indent=2))
    return 0 if all(r.get("status") == "OK" for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
