import type { LoaderFunctionArgs } from "react-router";
import { listPickerCoupons } from "../lib/coupons.server";
import { segmentIdsToCheck, visibleCoupons } from "../lib/eligibility";
import { json, proxyCustomer, shopperFor } from "../lib/proxy.server";
import { authenticate } from "../shopify.server";

/**
 * GET /apps/coupons/eligible  →  coupons the current shopper may see in the picker.
 * Global coupons for everyone, segment coupons only for logged-in members.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const proxy = await authenticate.public.appProxy(request);
  const { admin, customerId } = proxyCustomer(request, proxy.admin);
  if (!admin) return json({ coupons: [], loggedIn: Boolean(customerId) });

  const coupons = await listPickerCoupons(admin);
  const shopper = await shopperFor(admin, customerId, segmentIdsToCheck(coupons));

  return json({
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
