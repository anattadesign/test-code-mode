import type { LoaderFunctionArgs } from "react-router";
import pickerCss from "../../extensions/coupon-picker/assets/coupon-picker.css?raw";
// eslint-disable-next-line import/default -- Vite ?raw import, default export is the file text
import pickerJs from "../../extensions/coupon-picker/assets/coupon-picker.js?raw";
import { authenticate } from "../shopify.server";

/**
 * GET /apps/coupons/assets/coupon-picker.(js|css)
 *
 * Fallback copy of the theme app extension's assets. The block normally loads
 * them from Shopify's CDN; if that fails (dev-version CDN URLs often 404 while
 * `shopify app dev` runs), the block's inline loader fetches them from here,
 * through the store's own domain.
 */
const FILES: Record<string, { body: string; type: string }> = {
  "coupon-picker.js": { body: pickerJs, type: "application/javascript; charset=utf-8" },
  "coupon-picker.css": { body: pickerCss, type: "text/css; charset=utf-8" },
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const file = FILES[params.file ?? ""];
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body, {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
