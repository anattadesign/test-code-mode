import { describe, expect, it } from "vitest";
import { checkCode, segmentIdsToCheck, visibleCoupons, type CouponRecord, type Shopper } from "../eligibility";

const now = new Date("2026-11-15T12:00:00Z");
const coupon = (over: Partial<CouponRecord> = {}): CouponRecord => ({
  id: "gid://shopify/DiscountCodeNode/1",
  code: "SAVE10",
  title: "10% off",
  summary: "",
  status: "ACTIVE",
  startsAt: "2026-11-01T00:00:00Z",
  endsAt: null,
  usageLimit: null,
  usageCount: 0,
  audience: "all",
  segmentIds: [],
  minimumSubtotal: null,
  minimumQuantity: null,
  ...over,
});
const guest: Shopper = { loggedIn: false, memberSegmentIds: [] };
const vip = { loggedIn: true, memberSegmentIds: ["seg-vip"] };
const regular = { loggedIn: true, memberSegmentIds: [] };
const cart = { subtotal: 100, quantity: 2 };

describe("visibleCoupons", () => {
  const list = [
    coupon({ code: "GLOBAL" }),
    coupon({ code: "VIP", audience: "segment", segmentIds: ["seg-vip"] }),
    coupon({ code: "OLD", status: "EXPIRED" }),
    coupon({ code: "SOON", status: "SCHEDULED", startsAt: "2026-12-01T00:00:00Z" }),
    coupon({ code: "USEDUP", usageLimit: 5, usageCount: 5 }),
    coupon({ code: "ENDED", endsAt: "2026-11-10T00:00:00Z" }),
    coupon({ code: "PERSONAL", audience: "customers" }),
  ];
  const codes = (s: Shopper) => visibleCoupons(list, s, now).map((c) => c.code);

  it("shows guests only global, active, available coupons", () => {
    expect(codes(guest)).toEqual(["GLOBAL"]);
  });
  it("adds segment coupons for members", () => {
    expect(codes(vip)).toEqual(["GLOBAL", "VIP"]);
  });
  it("hides segment coupons from logged-in non-members", () => {
    expect(codes(regular)).toEqual(["GLOBAL"]);
  });
  it("collects unique segment IDs to check", () => {
    expect(segmentIdsToCheck([...list, coupon({ audience: "segment", segmentIds: ["seg-vip", "seg-b"] })])).toEqual([
      "seg-vip",
      "seg-b",
    ]);
  });
});

describe("checkCode", () => {
  it.each([
    [null, guest, cart, "not_found"],
    [coupon({ status: "EXPIRED" }), guest, cart, "expired"],
    [coupon({ endsAt: "2026-11-14T00:00:00Z" }), guest, cart, "expired"],
    [coupon({ status: "SCHEDULED", startsAt: "2026-12-01T00:00:00Z" }), guest, cart, "not_started"],
    [coupon({ usageLimit: 1, usageCount: 1 }), guest, cart, "usage_limit"],
    [coupon({ audience: "segment", segmentIds: ["seg-vip"] }), guest, cart, "login_required"],
    [coupon({ audience: "segment", segmentIds: ["seg-vip"] }), regular, cart, "not_eligible"],
    [coupon({ minimumSubtotal: 150 }), guest, cart, "minimum_subtotal"],
    [coupon({ minimumQuantity: 3 }), guest, cart, "minimum_quantity"],
    [coupon({ audience: "segment", segmentIds: ["seg-vip"], minimumSubtotal: 50 }), vip, cart, "applicable"],
  ] as const)("%#: returns %s", (c, shopper, snapshot, reason) => {
    expect(checkCode(c as CouponRecord | null, shopper, snapshot, now).reason).toBe(reason);
  });

  it("includes the minimum so the message can show it", () => {
    expect(checkCode(coupon({ minimumSubtotal: 150 }), guest, cart, now)).toEqual({
      reason: "minimum_subtotal",
      minimumSubtotal: 150,
    });
  });
});
