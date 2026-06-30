# BillSplit

A web app that scans Indian restaurant bills and splits them per person — with the rule that **you only pay for what you consumed, including the taxes that apply to it**.

If two people sit at a table and only one of them drinks beer, the drinker pays *all* the alcohol VAT — not half of it. The non-drinker pays zero VAT but their full share of GST on the food they ate. Nobody in the existing market does this correctly without a paywall, so I built it.

## What makes this different

Most existing splitters (Splitwise, Tab, Splittr) either don't itemize at all or split tax/tip equally regardless of consumption. The math on Indian bills is more nuanced than that:

- **Per-section tax classes.** Food (CGST + SGST 2.5% each), alcohol (VAT/MVAT 5–10%), and non-alcoholic bar items (GST again) follow different rules. Each item carries a `tax_class` and the splitter routes taxes accordingly.
- **Two-section bills work.** Many Indian dine-ins (e.g. Hotel Hariprasad in this dataset) print food and alcohol as two sub-bills on a single receipt. The schema models them as separate sections.
- **Modifier sub-items.** Half-and-half pizzas with two flavors plus a free dip get nested under the parent — the parent gets one assignment, modifier prices roll up.
- **Service charge is voluntary.** One-tap toggle to drop it, or restrict it to food only.
- **Reconciliation is a hard gate.** The model returns a delta; if items + taxes + charges − discounts ± round-off ≠ grand total, the UI blocks Continue and surfaces what's wrong.
- **Rupee-perfect splits.** `sum(per-person totals) == grand_total` exactly. Residual rupee pushed to the largest payer.

## How it works

```
   ┌─────────┐      ┌─────────────┐     ┌──────────┐     ┌──────────┐
   │ Upload  │ ───▶ │  Gemini     │ ──▶ │ Review & │ ──▶ │ Tap-to-  │ ──▶ Split
   │  image  │      │  vision +   │     │  edit    │     │ assign   │
   │         │      │  schema     │     │ items    │     │ items    │
   └─────────┘      └─────────────┘     └──────────┘     └──────────┘
                          │                                    │
                          ▼                                    ▼
                  Pydantic Bill                     splitter.py
                  (sections, taxes,                 (per-section,
                   charges, discounts)               per-tax-class
                                                     proportional)
```

## Tech stack

- **Backend:** Python 3.10+, FastAPI, Pydantic v2, Google Gemini API (free tier) for vision-LLM extraction.
- **Frontend:** Vite + React 18 + TypeScript + Tailwind CSS.
- **No database.** The MVP is single-device; bills don't persist server-side.

## Repo layout

```
BillSplit/
├── docs/
│   ├── 01_bill_analysis.md       # what real Indian bills look like
│   └── 02_extraction_schema.md   # JSON schema + split algorithm
├── backend/
│   ├── app/
│   │   ├── schema.py             # Pydantic Bill model
│   │   ├── prompts.py            # Gemini extraction prompt
│   │   ├── extractor.py          # Vision-LLM extractor
│   │   ├── splitter.py           # Per-tax-class split algorithm
│   │   └── main.py               # FastAPI app (/api/extract, /api/split)
│   ├── tests/
│   │   ├── extraction_samples/   # cached Gemini outputs for 7 real bills
│   │   ├── test_splitter.py
│   │   └── test_e2e_api.py
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.tsx               # state-machine UX (upload → review → assign → summary)
    │   └── components/
    └── package.json
```

## Running it

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # then add your GEMINI_API_KEY
uvicorn app.main:app --reload
```

Get a free Gemini key at [aistudio.google.com](https://aistudio.google.com/) (no credit card). The MVP uses `gemini-2.5-flash-lite` because it has a generous free-tier quota.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api/*` to the FastAPI backend.

## Validation on 7 real bills

I tested on 7 of my own bills (Old Street Cafe, Badboy Pizza, Hotel Hariprasad, sN. at Phoenix Marketcity, etc.). The extractor reconciled 5 of 7 to ₹0–₹0.50 of grand total. The other two flagged correctly:

- **Badboy Pizza** had a discount cropped off the photo — model produced delta ₹-494, UI blocks "Continue" until the user fixes prices.
- **sN.** was off by ₹1.30 (minor service-charge rounding) — within the threshold but visible in the review screen.

Splitter test cases (`tests/test_splitter.py`):

- Old Street Cafe (₹11,632, two-section food + bar with mixed alcoholic and non-alcoholic items): one person eats food only, one drinks all the alcohol. Result: drinker pays ₹8,777 including all ₹729 of VAT; non-drinker pays ₹2,855 with zero VAT. Sum matches grand total to the rupee.
- Hotel Hariprasad (₹3,305, four people, only two drink): non-drinkers pay identical ₹63 each; drinkers split the K F Ultra and absorb all the MVAT. Sum exact.

## Roadmap (post-MVP)

- **GPay / UPI deep links per person** — generate a payable UPI intent for each split.
- **Shareable session links** — generate a host-managed URL where guests claim their items in-browser without an account.
- **Swiggy / Zomato bill formats** — schema already supports platform fees, packaging, delivery, restaurant/platform/coupon discounts; needs end-to-end validation against real Swiggy bills.
- **PaddleOCR fallback** — fully-offline extraction for users who don't want to use a cloud API.
- **Receipt history** — opt-in localStorage cache of past splits.
- **Multi-currency travel mode** — for trips abroad with live FX.

## Acknowledgements

The market research at the top of this project surveyed Splitwise, Tab, splitty, SplitEven, SplitterUp, and a half-dozen others; the gaps they all share (no per-class tax routing, paywalls on basic OCR, gallery-upload blocked, equal tax splits) shaped what I built here.

## License

Personal project, MIT.
