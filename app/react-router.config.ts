import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Required by @cloudflare/vite-plugin (the server build runs in workerd).
  future: { v8_viteEnvironmentApi: true },
  // React Router 7.12+ rejects POST actions whose Origin differs from the request host.
  // Embedded admin requests come from admin.shopify.com; the production Worker host is
  // listed so its own form posts pass. Keep in sync with SHOPIFY_APP_URL in wrangler.jsonc.
  allowedActionOrigins: ["coupons-tipping.star-rating.workers.dev", "admin.shopify.com"],
} satisfies Config;
