import { authenticate, unauthenticated } from "../shopify.server";
import type { AdminClient } from "./admin.server";

/**
 * Authenticate a request from a checkout UI extension (session token in the
 * Authorization header). Returns the shop's Admin client, the logged-in
 * customer (from the verified token's `sub`), and a CORS helper.
 */
export async function checkoutContext(request: Request) {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const shop = new URL(String(sessionToken.dest)).hostname;
  const sub = typeof sessionToken.sub === "string" ? sessionToken.sub : "";
  const customerId = sub.startsWith("gid://shopify/Customer/") ? sub : null;
  const { admin } = await unauthenticated.admin(shop);
  return { admin: admin as AdminClient, customerId, cors };
}

export function corsJson(cors: (r: Response) => Response, body: unknown, status = 200) {
  return cors(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    }),
  );
}
