import { describe, expect, it } from "vitest";
import { buildDiscountInput, parseCouponForm, toShopDate } from "../coupon-form";

const COLL = "gid://shopify/Collection/999";

function fd(values: Record<string, string>) {
  const f = new FormData();
  const base = {
    title: "Ten off",
    code: "save10",
    valueType: "percentage",
    value: "10",
    startsAt: "2026-11-01",
    minimumType: "none",
    appliesTo: "all",
    visibility: "global",
    showInPicker: "on",
    combinesShipping: "on",
  };
  for (const [k, v] of Object.entries({ ...base, ...values })) f.set(k, v);
  return f;
}

describe("parseCouponForm", () => {
  it("accepts a global percentage coupon and uppercases the code", () => {
    const r = parseCouponForm(fd({}));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.code).toBe("SAVE10");
  });

  it.each([
    [{ value: "120" }, "value"],
    [{ code: "bad code" }, "code"],
    [{ endsAt: "2026-10-01" }, "endsAt"],
    [{ minimumType: "subtotal" }, "minimumValue"],
    [{ minimumType: "quantity", minimumValue: "1.5" }, "minimumValue"],
    [{ appliesTo: "products" }, "productIds"],
    [{ appliesTo: "collections", collectionIds: "[]" }, "collectionIds"],
    [{ visibility: "segment" }, "segmentIds"],
    [{ usageLimit: "0" }, "usageLimit"],
  ])("rejects %o with an error on %s", (values, field) => {
    const r = parseCouponForm(fd(values));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field]).toBeTruthy();
  });
});

describe("buildDiscountInput", () => {
  const parse = (v: Record<string, string>) => {
    const r = parseCouponForm(fd(v));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.data;
  };

  it("targets the Discountable products collection for 'all products' (never items.all)", () => {
    const input = buildDiscountInput(parse({}), { discountableCollectionId: COLL, timezoneOffset: "+0530" });
    expect(input.customerGets.items).toEqual({ collections: { add: [COLL], remove: [] } });
    expect(JSON.stringify(input)).not.toContain('"all":true');
    expect(input.customerGets.value).toEqual({ percentage: 0.1 });
    expect(input.context).toEqual({ all: "ALL" });
    expect(input.startsAt).toBe("2026-11-01T00:00:00+05:30");
    expect(input.endsAt).toBeNull();
    expect(input.tags).toEqual(["coupon-app", "coupon-picker"]);
  });

  it("builds a segment coupon with fixed amount, minimum subtotal and end date", () => {
    const input = buildDiscountInput(
      parse({
        valueType: "fixed",
        value: "5",
        visibility: "segment",
        segmentIds: '["gid://shopify/Segment/1"]',
        minimumType: "subtotal",
        minimumValue: "50",
        endsAt: "2026-12-31",
        usageLimit: "100",
        showInPicker: "",
      }),
      { discountableCollectionId: COLL, timezoneOffset: "-0400" },
    );
    expect(input.customerGets.value).toEqual({ discountAmount: { amount: "5.00", appliesOnEachItem: false } });
    expect(input.context).toEqual({ customerSegments: { add: ["gid://shopify/Segment/1"], remove: [] } });
    expect(input.minimumRequirement).toEqual({ subtotal: { greaterThanOrEqualToSubtotal: "50.00" } });
    expect(input.endsAt).toBe("2026-12-31T23:59:59-04:00");
    expect(input.usageLimit).toBe(100);
    expect(input.tags).toEqual(["coupon-app"]);
  });

  it("diffs products, collections and segments against the existing coupon on update", () => {
    const input = buildDiscountInput(
      parse({
        appliesTo: "products",
        productIds: '["gid://shopify/Product/2","gid://shopify/Product/3"]',
        visibility: "segment",
        segmentIds: '["gid://shopify/Segment/2"]',
      }),
      {
        discountableCollectionId: COLL,
        timezoneOffset: "+0000",
        existing: {
          appliesTo: "all",
          productIds: [],
          collectionIds: [],
          visibility: "segment",
          segmentIds: ["gid://shopify/Segment/1"],
        },
      },
    );
    expect(input.customerGets.items).toEqual({
      products: { productsToAdd: ["gid://shopify/Product/2", "gid://shopify/Product/3"], productsToRemove: [] },
    });
    expect(input.context).toEqual({
      customerSegments: { add: ["gid://shopify/Segment/2"], remove: ["gid://shopify/Segment/1"] },
    });
  });

  it("swaps specific collections back to the Discountable collection", () => {
    const input = buildDiscountInput(parse({}), {
      discountableCollectionId: COLL,
      timezoneOffset: "+0000",
      existing: {
        appliesTo: "collections",
        productIds: [],
        collectionIds: ["gid://shopify/Collection/5"],
        visibility: "global",
        segmentIds: [],
      },
    });
    expect(input.customerGets.items).toEqual({ collections: { add: [COLL], remove: ["gid://shopify/Collection/5"] } });
  });

  it("uses a whole-number minimum quantity", () => {
    const input = buildDiscountInput(parse({ minimumType: "quantity", minimumValue: "3" }), {
      discountableCollectionId: COLL,
      timezoneOffset: "+0000",
    });
    expect(input.minimumRequirement).toEqual({ quantity: { greaterThanOrEqualToQuantity: "3" } });
  });
});

describe("toShopDate", () => {
  it("converts an instant to the shop's calendar date", () => {
    expect(toShopDate("2026-10-31T20:00:00Z", "+0530")).toBe("2026-11-01");
    expect(toShopDate("2026-11-01T02:00:00Z", "-0500")).toBe("2026-10-31");
  });
});
