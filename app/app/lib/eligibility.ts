/** A discount code, reduced to what the storefront picker and the code check need. */
export interface CouponRecord {
  id: string;
  code: string;
  title: string;
  summary: string;
  status: "ACTIVE" | "EXPIRED" | "SCHEDULED";
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  usageCount: number;
  /** "all" = every customer; "segment" = segmentIds; anything else is never listed. */
  audience: "all" | "segment" | "customers" | "markets" | "unknown";
  segmentIds: string[];
  minimumSubtotal: number | null;
  minimumQuantity: number | null;
}

export interface Shopper {
  loggedIn: boolean;
  /** Segment IDs the logged-in customer belongs to (only segments we asked about). */
  memberSegmentIds: string[];
}

export interface CartSnapshot {
  /** Merchandise subtotal, tip line excluded, in the shop's presentment currency. */
  subtotal: number;
  /** Item count, tip line excluded. */
  quantity: number;
}

export type CodeReason =
  | "applicable"
  | "not_found"
  | "expired"
  | "not_started"
  | "usage_limit"
  | "login_required"
  | "not_eligible"
  | "minimum_subtotal"
  | "minimum_quantity";

export interface CodeCheck {
  reason: CodeReason;
  minimumSubtotal?: number;
  minimumQuantity?: number;
}

function usageExhausted(c: CouponRecord) {
  return c.usageLimit !== null && c.usageCount >= c.usageLimit;
}

function audienceMatches(c: CouponRecord, shopper: Shopper) {
  if (c.audience === "all") return true;
  if (c.audience === "segment") {
    return shopper.loggedIn && c.segmentIds.some((id) => shopper.memberSegmentIds.includes(id));
  }
  return false;
}

/** Coupons the picker may show to this shopper: active, not used up, audience matches. */
export function visibleCoupons(coupons: CouponRecord[], shopper: Shopper, now = new Date()) {
  return coupons.filter(
    (c) =>
      c.status === "ACTIVE" &&
      new Date(c.startsAt) <= now &&
      (c.endsAt === null || new Date(c.endsAt) > now) &&
      !usageExhausted(c) &&
      audienceMatches(c, shopper),
  );
}

/** Segment IDs worth a membership lookup for this list of coupons. */
export function segmentIdsToCheck(coupons: CouponRecord[]) {
  return [...new Set(coupons.filter((c) => c.audience === "segment").flatMap((c) => c.segmentIds))];
}

/**
 * Explain why a code would or wouldn't apply. Shopify remains the authority on
 * whether a code applies; this only turns a rejected code into a clear message.
 */
export function checkCode(
  coupon: CouponRecord | null,
  shopper: Shopper,
  cart: CartSnapshot,
  now = new Date(),
): CodeCheck {
  if (!coupon) return { reason: "not_found" };
  if (coupon.status === "EXPIRED" || (coupon.endsAt && new Date(coupon.endsAt) <= now)) {
    return { reason: "expired" };
  }
  if (coupon.status === "SCHEDULED" || new Date(coupon.startsAt) > now) {
    return { reason: "not_started" };
  }
  if (usageExhausted(coupon)) return { reason: "usage_limit" };
  if (coupon.audience !== "all") {
    if (!shopper.loggedIn) return { reason: "login_required" };
    if (!audienceMatches(coupon, shopper)) return { reason: "not_eligible" };
  }
  if (coupon.minimumSubtotal !== null && cart.subtotal < coupon.minimumSubtotal) {
    return { reason: "minimum_subtotal", minimumSubtotal: coupon.minimumSubtotal };
  }
  if (coupon.minimumQuantity !== null && cart.quantity < coupon.minimumQuantity) {
    return { reason: "minimum_quantity", minimumQuantity: coupon.minimumQuantity };
  }
  return { reason: "applicable" };
}
