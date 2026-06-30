"""Quick smoke test: run the extractor on one bill, dump the result.

Usage:
    python scripts/test_extract_one.py <path/to/bill.jpg>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make the `app` package importable when running this script directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.extractor import extract_bill_with_gemini


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: test_extract_one.py <image>")
        return 2
    bill = extract_bill_with_gemini(sys.argv[1])
    print(bill.model_dump_json(indent=2))
    print()
    print(f"=== Reconciliation ===")
    print(f"  grand_total      : {bill.grand_total}")
    print(f"  computed_total   : {bill.reconciliation.computed_total}")
    print(f"  delta            : {bill.reconciliation.delta}")
    print(f"  status           : {'OK' if abs(bill.reconciliation.delta) <= 0.5 else 'OFF'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
