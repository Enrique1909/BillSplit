# Sample Bill Analysis

Analysis of 7 sample bills (HEIC, converted to JPG) used to inform the extraction schema and prompt design for the BillSplit MVP.

## Inventory

| # | File | Restaurant | Type | Notable Feature |
|---|------|-----------|------|-----------------|
| 1 | IMG_0822 | Old Street Cafe & Bar (Bandra, Mumbai) | Dine-in | Two-section bill (Food + Bar), 5% service charge, VAT 10% on alcohol |
| 2 | IMG_0823 | Old Street Cafe & Bar | Dine-in | **Duplicate of #1** (same bill, different photo) — useful for dedup robustness check |
| 3 | IMG_1645 | Badboy Pizza | Dine-in | Modifier sub-items under parent ("Half N Half" pizzas), "Complimentary" 0-price items, paid via UPI |
| 4 | IMG_7746 | Hotel Hariprasad (Andheri) | Dine-in | **Two separate sub-bills** on one receipt — food (CGST+SGST 2.5%) and alcohol (VAT 10%) |
| 5 | IMG_8252 | sN. (Phoenix Marketcity) | Dine-in | Service Charge 10%, CGST+SGST 2.5%, "voluntary" service charge note |
| 6 | IMG_8334 | Hotel Hariprasad (Andheri) | Dine-in | Same two-sub-bill structure as #4, different visit |
| 7 | IMG_8850 | Restaurant (Delhi GSTIN) | Dine-in | Multi-line wrapped item names, dine-in qty=6, free home delivery noted |

## Observed Tax Structures

Indian restaurant bills use highly variable tax structures. Across these 7 bills:

- **CGST + SGST** at 2.5% each (food, intrastate) — most common
- **VAT / MVAT** at 10% (alcohol — separate sub-bill)
- **Service Charge** at 5% or 10% (voluntary, not all bills include it)
- **IGST** (not in this set, but expected for interstate ordering — Swiggy/Zomato delivery from another state)

Order of application matters: **service charge is added to subtotal *before* tax** in some bills, and is sometimes itself taxed.

## Observed Bill Sections

1. **Single-section bills** (food only): IMG_8850
2. **Two-section bills** (Food Menu + Bar Menu, single grand total): IMG_0822
3. **Two sub-bill bills** (separate gross + tax for food and alcohol, single TOTAL AMT): IMG_7746, IMG_8334
4. **Single-section with parent/modifier items**: IMG_1645

The schema must support a **list of sections**, each with its own line items, tax rules, and gross amount.

## Item-Level Variations

- **Quantity > 1** with `qty × unit price = line total` (e.g., "K F Ultra 650ML  6  400.00  2400.00" in IMG_8334)
- **Multi-line item names** wrapping across 2–3 lines (IMG_8850: "Butter Chicken 5 Chicken Tikka Pcs")
- **Modifier sub-items** with their own pricing (IMG_1645: "Half N Half — 1 — 765.0" followed by "Select Your Option: Cph2 (chicken Pepperoni Hot Honey) (half) 1x357.5")
- **Complimentary / zero-price items** ("Complimentary Ranch — 1x0")
- **Item codes / SKUs** (occasionally present, e.g., "Cph2")
- **Wine/cocktail descriptors** in parentheses (IMG_8252: "(12 INCH)", "Sangiovese Red Glass")

## Round-off

Most bills include a `Round off` adjustment of ±₹0.0X to ₹0.50 to make the grand total a whole rupee. Schema must capture this as its own line so per-person totals reconcile to grand total.

## Charges Not Yet Observed (must be designed for)

The user noted that Swiggy/Zomato dine-in reservations and delivery introduce additional charge types not present in this dataset. The schema must accommodate:

- **Platform discount** (Zomato Gold, Swiggy One, BOGO offers)
- **Restaurant discount** (10% off bill, % off food only, etc.)
- **Coupon discount** (FLAT200, NEWUSER, etc.)
- **Packaging charge** (delivery only)
- **Delivery fee** (delivery only)
- **Platform / convenience fee** (delivery only — itself GST-taxed)
- **Tip** (delivery and dine-in)

Discounts can be applied at:
- Item level (this dish only)
- Section level (food only, not alcohol)
- Bill level (whole bill)

## Implications for Schema Design

The schema must:
1. Support **multiple sections** per bill, each with its own subtotal and tax
2. Treat **modifiers as children of a parent item** (so the parent gets one assignment, modifier prices roll up)
3. Capture **all known Indian charge types** (CGST, SGST, IGST, VAT/MVAT, service charge, packaging, delivery, platform fee, tip, round-off)
4. Capture **discounts at item / section / bill level** with sign and basis (% or flat)
5. Be permissive — unknown line types fall through to a generic "other_charge" array so the parser doesn't drop info
6. Always carry a `raw_text` field per item so the user can verify against the photo

## Implications for Prompt Design (vision LLM)

The prompt must:
1. Identify Indian-specific terminology (CGST/SGST/VAT/MVAT/service charge as their own classes — not generic "tax")
2. Distinguish parent items from modifier sub-items
3. Reconcile: extracted line items + taxes + charges − discounts ± round-off **must equal grand total**, and the model should report a `reconciliation_delta` field so we can flag bills that don't balance
4. Handle multi-line wrapped item names by joining continuation lines
5. Treat "Complimentary" 0-price modifiers as informational (don't drop them, don't charge for them)

## Implications for UI/UX

- Each item should be tappable to assign to one or more people
- Modifiers should auto-assign to whoever takes the parent item
- The split must reconcile back to the grand total exactly (rupee-perfect)
- A "this isn't right" edit mode is needed for OCR errors — mandatory, not optional
- For multi-section bills (food + alcohol), people who didn't drink shouldn't pay alcohol VAT — proportional split must be **per-section**, not whole-bill
