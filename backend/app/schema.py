"""Pydantic models for the extracted bill structure.

This is the canonical shape every extractor (Gemini, PaddleOCR, manual entry) must produce.
The split algorithm in splitter.py operates exclusively on this schema.

See docs/02_extraction_schema.md for design rationale.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class TaxClass(str, Enum):
    FOOD = "food"
    ALCOHOL = "alcohol"
    NON_ALCOHOLIC_BEVERAGE = "non_alcoholic_beverage"
    NON_TAXABLE = "non_taxable"
    OTHER = "other"


class OrderType(str, Enum):
    DINE_IN = "dine_in"
    DELIVERY = "delivery"
    TAKEAWAY = "takeaway"
    UNKNOWN = "unknown"


class Platform(str, Enum):
    SWIGGY = "swiggy"
    ZOMATO = "zomato"
    DINEOUT = "dineout"
    DIRECT = "direct"
    UNKNOWN = "unknown"


class ChargeKind(str, Enum):
    SERVICE_CHARGE = "service_charge"
    PACKAGING = "packaging"
    DELIVERY = "delivery"
    PLATFORM_FEE = "platform_fee"
    CONVENIENCE_FEE = "convenience_fee"
    TIP = "tip"
    OTHER = "other"


class DiscountKind(str, Enum):
    PLATFORM = "platform"        # Zomato Gold, Swiggy One, District instant discount
    RESTAURANT = "restaurant"    # 10% off bill
    COUPON = "coupon"            # FLAT200, HDFCCARDS, DINECASH etc.
    LOYALTY = "loyalty"
    PRE_PAYMENT = "pre_payment"  # Cover charge / reservation deposit paid upfront by ONE person
    OTHER = "other"


class BillItem(BaseModel):
    id: str
    parent_id: Optional[str] = None  # null for top-level; set for modifiers
    name: str
    qty: float = 1.0
    unit_price: float = 0.0
    line_total: float = 0.0
    is_complimentary: bool = False
    tax_class: TaxClass = TaxClass.FOOD
    raw_text: str = ""

    # Gemini occasionally returns `null` for qty / unit_price / line_total on
    # rows that aren't really items (header lines, totals rows, FOC entries
    # with no printed price, badly-cropped scans). Pydantic's `float` type
    # rejects None outright and the whole extraction fails — even though the
    # user could just delete the junk row in the Review stage. Coerce None
    # (and empty strings) to safe zeros so the bill loads; the Review UI
    # then surfaces the row for the user to fix or remove.
    @field_validator("qty", mode="before")
    @classmethod
    def _coerce_qty(cls, v):
        if v is None or v == "":
            return 1.0
        return v

    @field_validator("unit_price", "line_total", mode="before")
    @classmethod
    def _coerce_amount(cls, v):
        if v is None or v == "":
            return 0.0
        return v

    @field_validator("line_total")
    @classmethod
    def validate_line_total(cls, v: float, info) -> float:
        # Allow small float drift; we don't want to crash on rounding
        return round(float(v), 2)


class BillSection(BaseModel):
    id: str
    name: str
    default_tax_class: TaxClass = TaxClass.FOOD
    items: list[BillItem] = Field(default_factory=list)
    subtotal: float = 0.0

    @field_validator("subtotal", mode="before")
    @classmethod
    def _coerce_subtotal(cls, v):
        # Gemini sometimes emits an explicit null here (a default only applies
        # when the key is absent). It's recomputed in Bill.recompute() anyway.
        if v is None or v == "":
            return 0.0
        return v


class BillTax(BaseModel):
    id: str
    label: str
    rate_pct: Optional[float] = None
    amount: float = 0.0
    applies_to_classes: list[TaxClass] = Field(default_factory=list)
    includes_service_charge_in_basis: bool = False

    @field_validator("amount", mode="before")
    @classmethod
    def _coerce_amount(cls, v):
        # See BillItem._coerce_amount — Gemini sometimes returns null for taxes
        # it spotted by label but couldn't read the numeric column for.
        if v is None or v == "":
            return 0.0
        return v


class BillLevelCharge(BaseModel):
    id: str
    label: str
    kind: ChargeKind
    rate_pct: Optional[float] = None
    amount: float = 0.0
    is_voluntary: bool = False
    applies_to_section_ids: list[str] | Literal["all"] = "all"
    is_taxable: bool = False

    @field_validator("amount", mode="before")
    @classmethod
    def _coerce_amount(cls, v):
        if v is None or v == "":
            return 0.0
        return v


class DiscountTarget(BaseModel):
    type: Literal["bill", "section", "item"]
    section_id: Optional[str] = None
    item_id: Optional[str] = None

    @field_validator("type", mode="before")
    @classmethod
    def _accept_bare_type(cls, v):
        # Model occasionally returns the bare type string ("bill") instead of
        # a dict — happens when there's nothing else to specify. We coerce in
        # the parent Discount field below; this is here defensively.
        return v


class Discount(BaseModel):
    id: str
    label: str
    kind: DiscountKind
    rate_pct: Optional[float] = None
    amount: float = 0.0               # always stored positive; semantically subtractive
    applies_to: DiscountTarget
    # If set, the entire credit goes to ONE specific person (e.g., cover charge / deposit
    # paid upfront by the reservation maker). If None, distributes across diners
    # according to `applies_to` (the normal coupon/discount behavior).
    paid_by_person_id: Optional[str] = None

    @field_validator("applies_to", mode="before")
    @classmethod
    def _coerce_applies_to(cls, v):
        # The model sometimes returns just the type string ("bill", "section",
        # "item") instead of the full {type: ...} object. Coerce it.
        if isinstance(v, str):
            return {"type": v}
        if v is None:
            return {"type": "bill"}
        return v

    @field_validator("amount", mode="before")
    @classmethod
    def _coerce_amount(cls, v):
        if v is None or v == "":
            return 0.0
        return v


class Restaurant(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None


class BillMeta(BaseModel):
    bill_no: Optional[str] = None
    date: Optional[str] = None        # ISO 8601 if parseable; else raw
    pax: Optional[int] = None
    order_type: OrderType = OrderType.UNKNOWN
    platform: Platform = Platform.UNKNOWN


class Reconciliation(BaseModel):
    computed_total: float = 0.0
    delta: float = 0.0                # grand_total - computed_total
    notes: list[str] = Field(default_factory=list)

    @field_validator("computed_total", "delta", mode="before")
    @classmethod
    def _coerce_amount(cls, v):
        if v is None or v == "":
            return 0.0
        return v


class Bill(BaseModel):
    schema_version: int = 1
    source_image: str = ""
    currency: str = "INR"
    restaurant: Restaurant = Field(default_factory=Restaurant)
    meta: BillMeta = Field(default_factory=BillMeta)
    sections: list[BillSection] = Field(default_factory=list)
    taxes: list[BillTax] = Field(default_factory=list)
    bill_level_charges: list[BillLevelCharge] = Field(default_factory=list)
    discounts: list[Discount] = Field(default_factory=list)
    round_off: float = 0.0
    grand_total: float = 0.0
    reconciliation: Reconciliation = Field(default_factory=Reconciliation)
    # Browser-renderable JPEG (base64). Set by the extractor so the UI can show the
    # uploaded photo even if it was HEIC (which Chrome/Firefox can't render natively).
    preview_image_base64: Optional[str] = None

    @field_validator("round_off", "grand_total", mode="before")
    @classmethod
    def _coerce_round_off(cls, v):  # accept None / "" -> 0.0
        if v is None or v == "":
            return 0.0
        return v

    @field_validator("restaurant", mode="before")
    @classmethod
    def _coerce_restaurant(cls, v):  # accept None -> empty Restaurant
        if v is None:
            return {}
        return v

    @field_validator("meta", mode="before")
    @classmethod
    def _coerce_meta(cls, v):  # accept None -> empty BillMeta
        if v is None:
            return {}
        return v

    def recompute(self, auto_correct_round_off: bool = True) -> "Bill":
        """Programmatically recompute every derived numeric field.

        Architecture: the OCR layer (Gemini) returns RAW extracted values only.
        Every aggregation — section subtotals, the reconciliation total, the delta —
        is performed in Python so we never depend on LLM arithmetic.

        Args:
          auto_correct_round_off: If True (default), and the reconciliation delta
            is small (≤ ₹2), absorb it into `round_off` instead of surfacing it as
            an error. Restaurants frequently print round-offs that are slightly off
            from a strict re-derivation, and forcing the user to fix a 30-paise
            discrepancy isn't useful.
        """
        # 1. Always recompute every section subtotal from its items.
        #    Includes children, since paid children represent real costs (e.g., halves).
        for s in self.sections:
            s.subtotal = round(sum(i.line_total for i in s.items), 2)

        # 1b. CGST = SGST (Indian convention — they're two halves of one GST rate).
        # If Gemini extracted them with a small mismatch (OCR drift, e.g. 64.82 vs
        # 64.83 because the printer displayed them with different rounding), average.
        cgst = next((t for t in self.taxes if t.label.strip().upper() == "CGST"), None)
        sgst = next((t for t in self.taxes if t.label.strip().upper() == "SGST"), None)
        if cgst and sgst and cgst.amount != sgst.amount:
            avg = round((cgst.amount + sgst.amount) / 2, 2)
            if abs(cgst.amount - sgst.amount) < 5:
                cgst.amount = avg
                sgst.amount = avg

        # 2. Verify each item's line_total = qty * unit_price; record a note if not,
        #    but trust the printed line_total (it's what the bill actually charged).
        notes: list[str] = list(self.reconciliation.notes) if self.reconciliation else []
        for s in self.sections:
            for i in s.items:
                expected = round(i.qty * i.unit_price, 2)
                if abs(expected - i.line_total) > 0.01 and not i.is_complimentary:
                    notes.append(
                        f"item '{i.name}': qty×price = ₹{expected} but line_total = ₹{i.line_total}"
                    )

        # 3. Compute the reconciliation.
        sec_total = sum(s.subtotal for s in self.sections)
        tax_total = sum(t.amount for t in self.taxes)
        charge_total = sum(c.amount for c in self.bill_level_charges)
        discount_total = sum(d.amount for d in self.discounts)
        pre_round = sec_total + tax_total + charge_total - discount_total
        computed = round(pre_round + self.round_off, 2)
        delta = round(self.grand_total - computed, 2)

        # 4. If reconciliation is off by a tiny amount (typical thermal-printer
        #    rounding artifact), absorb it into round_off. Larger gaps are real
        #    extraction errors and stay surfaced.
        if auto_correct_round_off and 0.0 < abs(delta) <= 2.0:
            implied_round_off = round(self.grand_total - pre_round, 2)
            notes.append(
                f"auto-corrected round_off: extracted ₹{self.round_off}, "
                f"derived ₹{implied_round_off} from grand_total to balance the bill"
            )
            self.round_off = implied_round_off
            computed = round(pre_round + self.round_off, 2)
            delta = 0.0

        self.reconciliation = Reconciliation(
            computed_total=computed,
            delta=delta,
            notes=notes,
        )
        return self

    def reconcile(self) -> Reconciliation:
        """Backward-compatible wrapper around recompute()."""
        self.recompute()
        return self.reconciliation
