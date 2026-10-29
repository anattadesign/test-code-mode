import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { findCouponByCode, listPickerCoupons } from "../lib/coupons.server";
import { checkCode, segmentIdsToCheck, visibleCoupons } from "../lib/eligibility";
import { checkoutContext, corsJson } from "../lib/checkout-api.server";
import { shopperFor } from "../lib/proxy.server";

const checkSchema = z.object({
  code: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9_-]+$/),
  subtotal: z.coerce.number().min(0).max(10_000_000),
  quantity: z.coerce.number().int().min(0).max(100_000),
});

/**
 * Checkout coupon picker backend.
 *   GET /api/checkout/coupons                       → eligible coupons
 *   GET /api/checkout/coupons?code=X&subtotal=&quantity= → why code X didn't apply
 * Preflight (OPTIONS) is answered by authenticate.public.checkout.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, customerId, cors } = await checkoutContext(request);
  const url = new URL(request.url);

  if (url.searchParams.has("code")) {
    const parsed = checkSchema.safeParse({
      code: url.searchParams.get("code"),
      subtotal: url.searchParams.get("subtotal") ?? "0",
      quantity: url.searchParams.get("quantity") ?? "0",
    });
    if (!parsed.success) return corsJson(cors, { reason: "not_found" }, 400);
    const coupon = await findCouponByCode(admin, parsed.data.code);
    const shopper = await shopperFor(admin, customerId, coupon?.audience === "segment" ? coupon.segmentIds : []);
    return corsJson(cors, checkCode(coupon, shopper, parsed.data));
  }

  const coupons = await listPickerCoupons(admin);
  const shopper = await shopperFor(admin, customerId, segmentIdsToCheck(coupons));
  return corsJson(cors, {
    loggedIn: shopper.loggedIn,
    coupons: visibleCoupons(coupons, shopper).map((c) => ({
      code: c.code,
      title: c.title,
      summary: c.summary,
      endsAt: c.endsAt,
      minimumSubtotal: c.minimumSubtotal,
      minimumQuantity: c.minimumQuantity,
    })),
  });
};
