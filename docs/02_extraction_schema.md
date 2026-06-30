# Extraction Schema & Split Algorithm

The canonical structure the vision-LLM (or OCR pipeline) returns, and the algorithm the backend uses to compute per-person totals.

## Design principles

1. **Sections are first-class.** A bill is a list of sections; each section has its own tax block. This makes "alcohol VAT only for drinkers" trivial.
2. **Modifiers are children, not siblings.** Sub-items of a parent are nested. Assignment happens at the parent level.
3. **Permissive "other" buckets.** Unknown charge or tax types don't get dropped — they go into `other_charges` with their raw label.
4. **Reconciliation is mandatory.** The model returns a `reconciliation_delta`; the UI refuses to proceed until it's zero (or accepted).
5. **Stable IDs.** Every item gets a synthetic ID so the assignment payload can reference it without ambiguity.

## JSON Schema (TypeScript-style, for clarity)

```ts
type Currency = "INR";

type TaxClass =
  | "food"          // CGST/SGST/IGST applies
  | "alcohol"       // VAT/MVAT applies
  | "general"       // mixed / unknown — taxed as bill-level
  | "non_taxable";  // bottled water in some states, etc.

interface BillItem {
  id: string;                    // stable, e.g., "s0_i3"
  parent_id: string | null;      // null for top-level; set for modifiers
  name: string;                  // joined across wrapped lines
  qty: number;                   // default 1
  unit_price: number;            // ₹
  line_total: number;            // qty * unit_price (model fills both, we verify)
  is_complimentary: boolean;     // true if 0-price freebie
  tax_class: TaxClass;           // determines which taxes apply (food/alcohol/etc.)
  raw_text: string;              // as-extracted, for human verification
}

interface BillSection {
  id: string;                    // "s0", "s1"
  name: string;                  // "Food Menu", "Bar Menu", "Restaurant"
  default_tax_class: TaxClass;   // initial guess for items in this section (user can override per-item)
  items: BillItem[];
  subtotal: number;              // gross for this section, sum of items' line_total + child rollups
}

interface BillTax {
  id: string;
  label: string;                 // "CGST", "SGST", "VAT", "MVAT", "IGST"
  rate_pct: number | null;       // 2.5, 10, etc. null if flat amount
  amount: number;                // ₹ as printed on bill
  applies_to_classes: TaxClass[]; // e.g., ["food", "non_alcoholic_beverage"] for CGST
  includes_service_charge_in_basis: boolean;  // common in Indian bills
}

interface BillLevelCharge {
  id: string;                    // "c0", "c1"
  label: string;                 // "Service Charge", "Packaging", "Delivery Fee", "Platform Fee", "Convenience Fee"
  kind: "service_charge" | "packaging" | "delivery" | "platform_fee" | "tip" | "other";
  rate_pct: number | null;       // 5, 10, etc.
  amount: number;                // ₹
  is_voluntary: boolean;         // service charge defaults to true (per Indian rules)
  applies_to_sections: string[] | "all";  // some discounts/charges only apply to food, not alcohol
  is_taxable: boolean;           // platform fees are themselves GST-taxed
}

interface Discount {
  id: string;
  label: string;                 // "Zomato Gold", "FLAT200", "10% off food"
  kind: "platform" | "restaurant" | "coupon" | "loyalty" | "other";
  rate_pct: number | null;
  amount: number;                // ₹ (always positive; sign is implied)
  applies_to: { type: "bill" } | { type: "section"; section_id: string } | { type: "item"; item_id: string };
}

interface Bill {
  schema_version: 1;
  source_image: string;          // filename or hash
  currency: Currency;
  restaurant: {
    name: string | null;
    address: string | null;
    gstin: string | null;
  };
  meta: {
    bill_no: string | null;
    date: string | null;         // ISO 8601 if parseable
    pax: number | null;          // sometimes printed (e.g., "Pax: 2")
    order_type: "dine_in" | "delivery" | "takeaway" | "unknown";
    platform: "swiggy" | "zomato" | "dineout" | "direct" | "unknown";
  };
  sections: BillSection[];
  bill_level_charges: BillLevelCharge[];
  discounts: Discount[];
  round_off: number;             // can be negative
  grand_total: number;           // as printed on bill
  reconciliation: {
    computed_total: number;      // what our math says it should be
    delta: number;               // grand_total - computed_total; |delta| > 0.5 = parse error
    notes: string[];             // any oddities the model noticed
  };
}
```

## Split algorithm

Input: a `Bill` plus an `assignments` map of `{ item_id → [{person_id, share}] }` where `share` sums to 1.0 per item (allows fractional/shared items).

```
PER PERSON p, INITIALIZE: subtotal_by_section = {}, total = 0

# Step 1: per-section per-person subtotals
FOR each section s in bill.sections:
  FOR each item i in s.items WHERE parent_id is null:
    children = items where parent_id == i.id
    item_total = i.line_total + sum(children.line_total)  # modifier prices roll up
    FOR each (person, share) in assignments[i.id]:
      subtotal_by_section[p][s.id] += item_total * share

# Step 2: section taxes (proportional within section)
FOR each section s in bill.sections:
  FOR each tax t in s.taxes:
    FOR each person p:
      person_share = subtotal_by_section[p][s.id] / s.subtotal
      total[p] += t.amount * person_share

# Step 3: bill-level charges
#   Service charge etc. apply proportionally to each person's pre-charge subtotal
#   restricted to sections in `applies_to_sections` (default: all)
FOR each charge c in bill.bill_level_charges WHERE NOT (c.kind == "service_charge" AND user_opted_out):
  applicable_sections = c.applies_to_sections == "all" ? all : c.applies_to_sections
  applicable_total = sum over applicable_sections of section.subtotal
  FOR each person p:
    person_applicable = sum over applicable_sections of subtotal_by_section[p][s]
    total[p] += c.amount * (person_applicable / applicable_total)

# Step 4: discounts (subtract)
FOR each discount d in bill.discounts:
  IF d.applies_to.type == "item":
    # subtract proportionally from people assigned to that item
    FOR each (person, share) in assignments[d.applies_to.item_id]:
      total[p] -= d.amount * share
  ELIF d.applies_to.type == "section":
    s = section by id
    FOR each person p:
      total[p] -= d.amount * (subtotal_by_section[p][s.id] / s.subtotal)
  ELSE:  # bill-level
    bill_subtotal = sum of all section subtotals
    FOR each person p:
      person_subtotal = sum across sections of subtotal_by_section[p]
      total[p] -= d.amount * (person_subtotal / bill_subtotal)

# Step 5: round-off — distribute proportionally
total_pre_roundoff = sum(total[p] for all p)
FOR each person p:
  total[p] += bill.round_off * (total[p] / total_pre_roundoff)

# Step 6: each person's subtotal contribution = their food + alcohol items
person_subtotal[p] = sum across sections of subtotal_by_section[p]

# Step 7: rupee rounding
#   Round each person to ₹1, then redistribute residual to highest contributor
ROUND each total[p] to nearest rupee
residual = grand_total - sum(total[p])
ASSIGN residual ± to person with largest total
```

## Key correctness properties

- `sum(total[p] for all p) == grand_total` exactly — to the rupee, no fractions left over
- A person assigned to zero alcohol items pays zero alcohol VAT
- A person assigned to zero food items pays zero food GST
- A "complimentary" item (0-price modifier) does not affect anyone's total
- Service charge is correctly proportional to each person's actual consumption
- Toggling "remove service charge" updates totals without re-OCR

## Service charge — per-section behavior

When a bill prints a single "Service Charge X%" line on the gross of the whole bill, the splitter treats it as a per-section charge: each section absorbs `X% × section_subtotal`, and that amount is split only among the people who consumed in that section (proportional to their consumption).

This is **mathematically equivalent** to whole-bill proportional split when the rate is uniform — each person pays `X% × their_own_consumption` either way. The per-section framing matters for two reasons:

1. **Opt-out per section.** A user can disable service charge on alcohol while keeping it on food (a common preference) without re-doing the math.
2. **Bills that print separate service charges per section** (rare but possible) work without special-casing.

The schema represents this via `BillLevelCharge.applies_to_sections`. The default for a generic service-charge line is `"all"`; if the user toggles "no service charge on alcohol", we update it to the food section ID(s) only.

## Edge cases handled

- **Duplicate bills** (IMG_0822 = IMG_0823): hash uploaded image; warn if same hash already in session
- **Two sub-bills on one receipt** (IMG_7746): each becomes its own `BillSection` with its own tax block
- **Modifier breakdowns** (IMG_1645 "Half N Half"): nested under parent, prices roll up at the parent level
- **Multi-line item names** (IMG_8850): the LLM is instructed to join continuation lines into one `name`
- **Zero-price complimentary items**: kept in schema (visible in UI) but `line_total = 0` so they affect nothing
- **Negative round-off**: handled (it's signed in the schema)

## Reconciliation rule

After extraction:
```
expected = sum(section.subtotals)
         + sum(section.taxes.amount across all sections)
         + sum(bill_level_charges.amount)
         - sum(discounts.amount)
         + round_off
delta    = grand_total - expected
```

If `|delta| > 0.5`, the UI surfaces a "**Bill didn't balance — review extracted items**" banner with a side-by-side photo + parsed-items diff. The user can edit any field; on save, delta is recomputed.
