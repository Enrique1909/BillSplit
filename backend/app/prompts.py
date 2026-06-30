"""Prompt templates for the vision-LLM extractor.

The prompt is split into a system-style preamble and a JSON schema example.
Gemini handles both vision and structured output, but we still describe the
schema explicitly because it's tuned for Indian-bill quirks.
"""

EXTRACTION_PROMPT = """You are a precise extractor for Indian restaurant bills (dine-in, delivery, Swiggy, Zomato).

Return ONLY valid JSON matching the schema below. No prose, no markdown fences.

READING ORDER — CRITICAL:

Restaurant bills are TABULAR. Each printed row of the items table is ONE item — the
entire row is a single semantic unit. Read the bill ROW-BY-ROW from top to bottom.
For each row, consume ALL columns left-to-right (Description → Qty → Rate → Amount)
as ONE item before moving down to the next row. NEVER read column-by-column. NEVER
combine a description from one row with numbers from a different row. NEVER emit
two items for what is visibly a single row.

Self-check before emitting: walk down the bill image and count the printed item
rows. The number of parent items in your output (across all sections) MUST match
the count of printed item rows you can see. If your output has more items than
rows visible in the image, you've duplicated — fix it before returning.

EXTRACTION ALGORITHM for the items table — follow EXACTLY:

  Step 1. Scan the items area and identify every printed row that has a
          QTY + RATE + AMOUNT column. Call these "price-bearing rows".
          The total number of items you emit MUST EQUAL the number of
          price-bearing rows.

  Step 2. For each price-bearing row, the item's `qty`, `unit_price`, and
          `line_total` come ONLY from that row's columns. Do not borrow
          numbers from any other row.

  Step 3. The item's `name` starts with the description text on that
          price-bearing row, then APPENDS any lines IMMEDIATELY BELOW it
          that have NO qty/rate/amount columns (size qualifiers like
          "(330ML PINT)", continuation fragments like "Sangria" or
          "Sons (180ML)", etc.). Stop appending the moment you reach the
          next price-bearing row.

  Step 4. Lines whose entire content is in parentheses, lines that contain
          only a unit qualifier (ML, PINT, GM, etc.), and lines that are
          short fragments without their own qty/price ARE NEVER STANDALONE
          ITEMS. They always attach to the price-bearing row above.

          IMPORTANT — STRUCTURAL CUES OVERRIDE SEMANTIC INTUITION.
          A line WITHOUT qty/rate/amount columns is a continuation, even if
          it reads like a complete dish name on its own. Do not let your
          world knowledge of food override the receipt's column structure.

WORKED EXAMPLE 2 — Bombay Salad Company. The bill prints:

    HOMEMADE GREEN ICED TEA  1   210   210
    PLANT POWER (F)          1   510   510
    NON VEG - SKINNY         1   410   410
    CHICKEN WRAP

There are 3 price-bearing rows, so output must contain EXACTLY 3 items.
"CHICKEN WRAP" has no qty/rate/amount — it's a continuation of "NON VEG -
SKINNY", not a separate item, regardless of how plausible "chicken wrap"
sounds as a standalone dish.

CORRECT extraction (3 items):
    "Homemade Green Iced Tea"           qty=1  price=210  amount=210
    "Plant Power (F)"                   qty=1  price=510  amount=510
    "Non Veg - Skinny Chicken Wrap"     qty=1  price=410  amount=410   ← continuation joined

INCORRECT (4 items — would output a phantom "Chicken Wrap" with no price):
    DO NOT split into "Non Veg - Skinny" + a separate "Chicken Wrap" item.

WORKED EXAMPLE — Old Street Cafe Bar Menu (this is a real-world failure
mode the prompt must prevent). The bill prints:

    Packaged Water         4    45.00   180.00
    Redbull                1   200.00   200.00
    Budweiser              1   260.00   260.00
    Premium (330ML
    (PINT))
    White White            1   370.00   370.00
    Sangria
    Jal Jeera Gin &        3   420.00  1260.00
    Tonic
    Stranger And           4  1350.00  5400.00
    Sons (180ML)
    Tonic Water            3   110.00   330.00

Identify price-bearing rows: there are 7 of them — Packaged Water, Redbull,
Budweiser, White White, Jal Jeera Gin &, Stranger And, Tonic Water. Output
must have EXACTLY 7 items in this section.

CORRECT extraction:
    "Packaged Water"                    qty=4  price=45    amount=180
    "Redbull"                           qty=1  price=200   amount=200
    "Budweiser Premium (330ML (PINT))"  qty=1  price=260   amount=260   ← name appended from next 2 lines
    "White White Sangria"               qty=1  price=370   amount=370   ← name appended from "Sangria" line
    "Jal Jeera Gin & Tonic"             qty=3  price=420   amount=1260  ← name appended from "Tonic" line
    "Stranger And Sons (180ML)"         qty=4  price=1350  amount=5400  ← name appended from "Sons (180ML)" line
    "Tonic Water"                       qty=3  price=110   amount=330

Subtotal: 180+200+260+370+1260+5400+330 = 8000 ✓

THE TWO COMMON FAILURE MODES YOU MUST AVOID:
  (a) Emitting "Premium (330ML (PINT))" as a separate item that "borrows"
      ₹370 from the next row — you'd then drop "White White Sangria" entirely
      OR mis-label it. Total qty might still equal 23 by coincidence, so
      cross-checks won't catch it. The algorithm above prevents this.
  (b) Emitting fewer items than price-bearing rows by merging two real items.

CROSS-CHECK before returning (in order, fix and retry if any fail):
  1. If the bill prints "Total Qty: N", sum of all parent items' qty must equal N.
  2. If the bill prints a "Sub Total" / "Subtotal" / "Sub-Total" per section,
     your section subtotal must equal it EXACTLY (to the rupee).
  3. The number of items in each section must equal the number of
     price-bearing rows printed in that section.

KEY RULES:

1. Items
   - Join multi-line wrapped item names into one `name`.
   - **Modifier sub-items are CRITICAL — never drop them.** Indian bills frequently show
     modifier sub-items indented below a parent. Common patterns:
       a) Pizza split between two flavors ("Half N Half") with "Select Your Option:" lines
       b) Combo meals listing each component below the combo name
       c) Wine/cocktail descriptors in parentheses
       d) "Add-on" or "Extra" lines below the dish they belong to
     For each such sub-item, emit a separate item with `parent_id` set to the parent's id.
     If the parent's printed price already includes the components, set the parent's
     `line_total` to the printed parent price and the children to `line_total: 0` with
     `is_complimentary: true`. If the children have explicit prices that sum to the parent,
     emit them with their actual `line_total` and set the parent's `line_total` to 0.
     EITHER way, the SECTION SUBTOTAL only counts parents — never both.

   EXAMPLE — Half N Half pizza:
     Bill text (verbatim):
       "Half N Half  1  765.0  765.0
        Select Your Option: Cph2 (chicken Pepperoni Hot Honey) (half) - 1x357.5 = 357.5
        Select Your Option: Pushpa Malai Chicken (half) - 1x357.5 = 357.5
        Complimentry Ranch: Ranch - 1x0 = 0"
     Correct extraction:
       parent: { id: "s0_i2", parent_id: null, name: "Half N Half (Pepperoni Hot Honey + Pushpa Malai)", qty: 1, unit_price: 765, line_total: 765, tax_class: "food" }
       child:  { id: "s0_i2_m0", parent_id: "s0_i2", name: "Half: Cph2 (chicken Pepperoni Hot Honey)", qty: 1, unit_price: 0, line_total: 0, is_complimentary: true, tax_class: "food" }
       child:  { id: "s0_i2_m1", parent_id: "s0_i2", name: "Half: Pushpa Malai Chicken", qty: 1, unit_price: 0, line_total: 0, is_complimentary: true, tax_class: "food" }
       child:  { id: "s0_i2_m2", parent_id: "s0_i2", name: "Complimentary Ranch", qty: 1, unit_price: 0, line_total: 0, is_complimentary: true, tax_class: "food" }

   - "Complimentary" items have `is_complimentary: true` and `unit_price: 0`.
   - Each item gets a `tax_class`. RULE OF THUMB: anything you SIP and isn't
     alcoholic is a "non_alcoholic_beverage" — even if it's hot, even if it's
     fancy, even if it appears in the food section of the menu. The full list:
     - "food" — anything CHEWED. Cooked dishes, naan, biryani, sweets, salads,
       sandwiches, wraps, desserts, ice cream (yes ice cream — it's a chewed
       sweet, not a sipped drink).
     - "alcohol" — beer, wine, whisky, rum, gin, vodka, cocktails, sangria,
       hard kombucha. Anything intoxicating. (Budweiser, KF, Old Monk, Stranger
       And Sons, sangria, gin & tonic — all "alcohol".)
     - "non_alcoholic_beverage" — anything SIPPED that isn't alcoholic.
       Includes: water (bottled, mineral, sparkling), soft drinks (Coke, Pepsi,
       Sprite, Thums Up), juices (fresh, packaged, mocktails),
       coffee (espresso, cappuccino, latte, cold brew, filter coffee),
       tea (chai, masala chai, green tea, iced tea, kombucha non-alcoholic,
       lemon tea), Red Bull / energy drinks, tonic water, club soda,
       lassi (sweet, salty, mango), milkshakes, smoothies, hot chocolate.
     - "non_taxable" — only if the bill explicitly notes the item is exempt.
     - "other" — only if the item genuinely doesn't fit any of the above.

2. Sections
   - Use the printed section labels as section names ("Food Menu", "Bar Menu", or for receipts with two sub-bills, "Food Bill" / "Alcohol Bill"). If no section label, use one section named "Items".
   - `default_tax_class` is the most common class for items in that section.
   - Each section's `subtotal` = sum of its items' `line_total` (parents only, NOT children).

3. Taxes — applies_to_classes is critical
   - CGST, SGST, IGST: usually applies to ["food", "non_alcoholic_beverage"]
     (NOT alcohol — alcohol is outside GST in India and is taxed separately).
   - VAT, MVAT: usually applies to ["alcohol"] only.
   - If a tax label is unfamiliar, set `applies_to_classes` to ["food"] as a default.
   - `rate_pct` is the printed percentage (2.5, 5, 10, 18, etc.). Use null for flat-amount taxes.
   - `amount` is what's printed on the bill.
   - `includes_service_charge_in_basis: true` if the tax was clearly computed AFTER service charge was added (very common in India).

4. Bill-level charges
   - "Service Charge" → kind="service_charge", is_voluntary=true (always — it's voluntary by Indian regulation).
   - "Packing", "Packaging" → kind="packaging".
   - "Delivery Fee", "Delivery Charges", "Delivery partner fee" → kind="delivery".
   - "Platform Fee", "Convenience Fee", "Service Fee" (when from Swiggy/Zomato) → kind="platform_fee" or "convenience_fee".
   - "Tip" → kind="tip".
   - `applies_to_section_ids`: "all" unless the bill clearly applies a charge only to certain sections.

   STRIKETHROUGH + "FREE" / "WAIVED" / "₹0" — CRITICAL.
   Swiggy/Zomato/District frequently show a fee as a struck-through original price
   followed by the word "FREE" (or "Waived", or "₹0"). The actual amount charged
   for that line is ZERO. Do NOT extract the struck-through number as either:
     (a) a charge of that amount, or
     (b) a discount of that amount cancelling an unwritten charge.
   Both are wrong — there is no transaction here, just a marketing flourish
   showing the user what they "would have paid". Emit the charge with
   `amount: 0` so the user can see in the Review UI that the fee was waived,
   and DO NOT emit any discount for it.

   Examples of this pattern you must recognise:
     "Delivery partner fee   ₹30.00 FREE"    → charge amount=0, no discount
     "Delivery Fee           ₹49 Waived"    → charge amount=0, no discount
     "Packaging Fee          ₹25 → ₹0"      → charge amount=0, no discount
     "Platform Fee           ~~₹15~~ FREE"  → charge amount=0, no discount

5. Discounts
   - Always store `amount` as POSITIVE (the sign is implied by it being a discount).
   - NOT a discount: a struck-through fee followed by "FREE" / "Waived" / "₹0".
     That is a charge with amount=0 (see rule 4), NOT a discount. Emitting it
     as a discount would be a double-counting bug.
   - Indian delivery / dine-out app bills often show:
     - "Restaurant Discount" → kind="restaurant"
     - "Zomato Gold", "Swiggy One", "Instant discount", "Deal Discount X% off" → kind="platform"
     - Coupon codes (FLAT200, NEWUSER, HDFCCARDS, DINECASH...) → kind="coupon"
     - "Cover charge", "Cover charge settlement", "Cover Charge" — RESERVATION DEPOSITS
       prepaid by ONE person at booking time. → kind="pre_payment".
       Set `paid_by_person_id` to null (the UI will ask the user which person paid).
   - `applies_to`: pick the narrowest scope visible on the bill (item > section > bill).
     Cover charges typically apply at the bill level.

   PLATFORM EXAMPLES — the model frequently sees these structures:

   a) DISTRICT app summary page:
      "Bill amount         ₹7,733
       Instant discount   -₹1,933.25     → discount kind=platform
       Cover charge        -₹150          → discount kind=pre_payment, paid_by_person_id=null
       DINECASH coupon    -₹93           → discount kind=coupon
       Convenience fee    +₹215           → bill_level_charge kind=convenience_fee
       You paid           ₹5,771.75       → grand_total"

   b) SWIGGY DINEOUT order summary:
      "Bill Total          ₹3,053
       Deal Discount 10%  -₹305          → discount kind=platform
       Coupon HDFCCARDS   -₹200          → discount kind=coupon
       Convenience Fee    +₹55.08         → bill_level_charge kind=convenience_fee
       GST on conv. fee   +₹9.92          → tax label='GST on conv. fee', applies_to_classes=['other']
       Cover Charge       -₹100          → discount kind=pre_payment, paid_by_person_id=null
       Total Paid         ₹2,513          → grand_total"

   c) SWIGGY DELIVERY bill summary (FREE delivery — note the strikethrough!):
      "Item total                       ₹4,454.00
       GST & restaurant packaging       ₹459.22       → tax label='GST & restaurant packaging', applies_to_classes=['food']
       Delivery partner fee  ~~₹30.00~~ FREE          → bill_level_charge kind=delivery, amount=0
                                                       (NOT a ₹30 charge, NOT a ₹30 discount)
       Platform fee                     ₹14.90        → bill_level_charge kind=platform_fee
       Paid                             ₹4,928.12     → grand_total"

     Reconciliation check: 4454 + 459.22 + 0 + 14.90 = 4928.12 ✓
     If you had emitted the delivery fee as ₹30 + a ₹30 discount, the math
     would still add up — but you'd be misrepresenting the bill and the user
     would see a phantom discount that doesn't exist. Don't do it.

   When you see a platform summary page (no individual food items, just the bill-summary
   structure above), still produce a valid Bill object — put the printed "Bill Total" /
   "Bill amount" as a single placeholder item (e.g. name="Restaurant bill (itemized
   above-screen)") so subtotals reconcile, and let the user fill in actual items afterward.

6. Round off / rounding adjustment → put in `round_off` (signed; negative if it reduces the total).

7. Reconciliation — MANDATORY
   - Compute: sum(section subtotals) + sum(taxes.amount) + sum(charges.amount) - sum(discounts.amount) + round_off
   - This MUST equal `grand_total`. Set `reconciliation.computed_total` and `reconciliation.delta = grand_total - computed_total`.
   - If |delta| > 0.5, you missed something — re-read the bill, find the missing line, then return the result. Add notes to `reconciliation.notes` describing what you had to infer.

8. IDs
   - Sections: "s0", "s1", ...
   - Items: "{section_id}_i{n}" — e.g., "s0_i0", "s0_i1", "s1_i0"
   - Taxes: "t0", "t1", ...
   - Charges: "c0", "c1", ...
   - Discounts: "d0", "d1", ...

9. Order type / platform
   - Look for "DINE IN", "Dine In:", token numbers → order_type="dine_in"
   - "Delivery", "Home Delivery" → order_type="delivery"
   - "Takeaway", "Parcel" → order_type="takeaway"
   - Swiggy/Zomato logos or "powered by Swiggy/Zomato" → platform set accordingly
   - Most printed thermal restaurant receipts are direct dine-in unless platform branding is visible.

10. Currency
    - Default "INR". Look for ₹ symbol confirmation.

EXAMPLE OUTPUT SHAPE (schema, not real data):

{
  "schema_version": 1,
  "currency": "INR",
  "restaurant": {"name": "...", "address": "...", "gstin": "..."},
  "meta": {"bill_no": "...", "date": "...", "pax": null, "order_type": "dine_in", "platform": "direct"},
  "sections": [
    {
      "id": "s0",
      "name": "Food Menu",
      "default_tax_class": "food",
      "items": [
        {"id": "s0_i0", "parent_id": null, "name": "Chicken Peri Peri", "qty": 1, "unit_price": 330.0, "line_total": 330.0, "is_complimentary": false, "tax_class": "food", "raw_text": "Chicken Peri Peri 1 330.00 330.00"}
      ],
      "subtotal": 330.0
    }
  ],
  "taxes": [
    {"id": "t0", "label": "CGST", "rate_pct": 2.5, "amount": 86.03, "applies_to_classes": ["food", "non_alcoholic_beverage"], "includes_service_charge_in_basis": true}
  ],
  "bill_level_charges": [
    {"id": "c0", "label": "Service Charge", "kind": "service_charge", "rate_pct": 5.0, "amount": 511.0, "is_voluntary": true, "applies_to_section_ids": "all", "is_taxable": false}
  ],
  "discounts": [],
  "round_off": -0.06,
  "grand_total": 11632.0,
  "reconciliation": {"computed_total": 11632.0, "delta": 0.0, "notes": []}
}

Now extract the bill in the attached image. Return ONLY the JSON object."""
