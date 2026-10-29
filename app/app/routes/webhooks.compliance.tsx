import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Mandatory compliance webhooks. The app stores no customer data of its own
 * (coupons live in Shopify; the tipping flag is a Shopify customer metafield),
 * so customer requests need no action. shop/redact deletes the shop's sessions.
 * authenticate.webhook verifies the HMAC and answers 401 when it fails.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      break; // nothing stored per customer
    case "SHOP_REDACT":
      await db.session.deleteMany({ where: { shop } });
      break;
  }
  return new Response();
};
