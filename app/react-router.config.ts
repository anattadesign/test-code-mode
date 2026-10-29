import type { Config } from "@react-router/dev/config";

export default {
  // React Router 7.12+ rejects POST actions whose Origin differs from the request host.
  // Embedded admin requests arrive through the `shopify app dev` tunnel and the
  // production host. Add the production host here before deploying.
  allowedActionOrigins: ["*.trycloudflare.com", "admin.shopify.com"],
} satisfies Config;
