import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { findCouponByCode } from "../lib/coupons.server";
import { checkCode } from "../lib/eligibility";
import { json, proxyCustomer, shopperFor } from "../lib/proxy.server";
import { authenticate } from "../shopify.server";

const querySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_-]+$/),
  subtotal: z.coerce.number().min(0).max(10_000_000),
  quantity: z.coerce.number().int().min(0).max(100_000),
});

/**
 * GET /apps/coupons/check?code=…&subtotal=…&quantity=…
 * Explains why Shopify rejected a code (expired, not eligible, minimum not met…).
 * Shopify's cart remains the authority on whether a code applies.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const proxy = await authenticate.public.appProxy(request);
  const { admin, url, customerId } = proxyCustomer(request, proxy.admin);
  const parsed = querySchema.safeParse({
    code: url.searchParams.get("code") ?? "",
    subtotal: url.searchParams.get("subtotal") ?? "0",
    quantity: url.searchParams.get("quantity") ?? "0",
  });
  if (!parsed.success) return json({ reason: "not_found" }, 400);
  if (!admin) return json({ reason: "not_found" });

  const coupon = await findCouponByCode(admin, parsed.data.code);
  const shopper = await shopperFor(
    admin,
    customerId,
    coupon?.audience === "segment" ? coupon.segmentIds : [],
  );
  const result = checkCode(coupon, shopper, {
    subtotal: parsed.data.subtotal,
    quantity: parsed.data.quantity,
  });
  return json(result);
};
