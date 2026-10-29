import type { AdminClient } from "./admin.server";
import { memberSegmentIds } from "./coupons.server";
import type { Shopper } from "./eligibility";

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Answers depend on the logged-in customer: never cache them.
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Read the logged-in customer from an app proxy request. Call only AFTER
 * authenticate.public.appProxy(request) has verified the signature:
 * `logged_in_customer_id` is part of the signed query, so it can then be trusted.
 */
export function proxyCustomer(request: Request, admin: unknown) {
  const url = new URL(request.url);
  const rawCustomerId = url.searchParams.get("logged_in_customer_id") ?? "";
  const customerId = /^\d+$/.test(rawCustomerId) ? `gid://shopify/Customer/${rawCustomerId}` : null;
  return { admin: admin as AdminClient | undefined, url, customerId };
}

export async function shopperFor(
  admin: AdminClient,
  customerId: string | null,
  segmentIds: string[],
): Promise<Shopper> {
  if (!customerId) return { loggedIn: false, memberSegmentIds: [] };
  return {
    loggedIn: true,
    memberSegmentIds: await memberSegmentIds(admin, customerId, segmentIds),
  };
}
