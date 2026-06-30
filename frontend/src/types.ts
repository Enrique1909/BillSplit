// Mirror of backend/app/schema.py (TypeScript-ified). Keep in sync.

export type TaxClass = "food" | "alcohol" | "non_alcoholic_beverage" | "non_taxable" | "other";
export type OrderType = "dine_in" | "delivery" | "takeaway" | "unknown";
export type Platform = "swiggy" | "zomato" | "dineout" | "direct" | "unknown";
export type ChargeKind = "service_charge" | "packaging" | "delivery" | "platform_fee" | "convenience_fee" | "tip" | "other";
export type DiscountKind = "platform" | "restaurant" | "coupon" | "loyalty" | "pre_payment" | "other";

export interface BillItem {
  id: string;
  parent_id: string | null;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  is_complimentary: boolean;
  tax_class: TaxClass;
  raw_text: string;
}

export interface BillSection {
  id: string;
  name: string;
  default_tax_class: TaxClass;
  items: BillItem[];
  subtotal: number;
}

export interface BillTax {
  id: string;
  label: string;
  rate_pct: number | null;
  amount: number;
  applies_to_classes: TaxClass[];
  includes_service_charge_in_basis: boolean;
}

export interface BillLevelCharge {
  id: string;
  label: string;
  kind: ChargeKind;
  rate_pct: number | null;
  amount: number;
  is_voluntary: boolean;
  applies_to_section_ids: string[] | "all";
  is_taxable: boolean;
}

export interface Discount {
  id: string;
  label: string;
  kind: DiscountKind;
  rate_pct: number | null;
  amount: number;
  applies_to: { type: "bill" | "section" | "item"; section_id?: string; item_id?: string };
  paid_by_person_id?: string | null;
}

export interface Bill {
  schema_version: number;
  source_image: string;
  currency: string;
  restaurant: { name: string | null; address: string | null; gstin: string | null };
  meta: {
    bill_no: string | null;
    date: string | null;
    pax: number | null;
    order_type: OrderType;
    platform: Platform;
  };
  sections: BillSection[];
  taxes: BillTax[];
  bill_level_charges: BillLevelCharge[];
  discounts: Discount[];
  round_off: number;
  grand_total: number;
  reconciliation: { computed_total: number; delta: number; notes: string[] };
  preview_image_base64?: string | null;
}

// ---------- assignments / split ----------

export interface Assignment {
  person_id: string;
  share: number;
}

export interface Person {
  id: string;
  name: string;
  color: string;
}

export interface SplitOptions {
  skip_service_charge: boolean;
  service_charge_excludes_alcohol: boolean;
  skip_voluntary_charges: boolean;
  residual_recipient_id?: string | null;  // null/undefined = auto (largest-payer)
}

export interface PersonBreakdown {
  person_id: string;
  items_subtotal: number;
  taxes: number;
  charges: number;
  discounts: number;
  round_off: number;
  total: number;
  items: { item_id: string; name: string; share: number; amount: number; tax_class: string }[];
  notes: string[];
}

export interface SplitResponse {
  breakdowns: PersonBreakdown[];
  grand_total: number;
  sum_of_people: number;
  residual_assigned_to: string | null;
  warnings: string[];
}
