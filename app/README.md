# Coupons & Tipping (custom app)

Custom Shopify app for **terraform-anatta.myshopify.com** (development store).
Built on Shopify's React Router app template, Admin GraphQL API `2026-10`.

| Feature | Where |
| --- | --- |
| Coupon dashboard: create, edit, activate, deactivate, delete native discount codes; global or customer-segment coupons; percentage/fixed, dates, usage limits, minimums, products/collections, combinations | `app/routes/app.coupons.*`, `app/lib/coupon-form.ts`, `app/lib/coupons.server.ts` |
| Storefront coupon picker: cart page **app block** + cart drawer **app embed**; eligible coupons, one-click apply, manual entry, clear messages | `extensions/coupon-picker`, `app/routes/proxy.*` (app proxy `/apps/coupons/*`) |
| Checkout coupon picker | `extensions/checkout-coupons`, `app/routes/api.checkout.coupons.tsx` |
| Checkout tip selector (presets / custom / no tip), only for customers with **Allowed tipping** on | `extensions/tip-selector` |
| Tip pricing (Cart Transform `lineUpdate`) | `extensions/tip-price` |
| Tip guard (blocks the Tip product for anyone not allowed to tip) | `extensions/tip-guard` |
| Tipping settings + one-click setup (Tip product, Discountable products collection, functions) | `app/routes/app.tipping.tsx`, `app/lib/tipping.server.ts` |

## How the tip stays undiscounted

- The tip is its own line (hidden **Tip** product: unlisted, untaxed, no shipping, inventory not tracked, `seo.hidden`).
- Coupons made in this app never use "all items": "All products" targets the automated
  **Discountable products** collection (every product except the one tagged `app-tip`).
  Saving a coupon that includes the Tip product, or a collection containing it, is refused.
- **Automatic discounts and discounts made outside this app** must also be limited to the
  Discountable products collection (or specific products/collections). An "all products"
  discount created in Shopify admin *would* discount the tip — test this before launch.

## Setup (run these yourself; they need your Partner login)

```sh
cd app
npm install
npm run dev              # dev app (shopify.app.dev.toml) on a development store
npm run deploy           # production app (shopify.app.toml)
```

1. Set `APP_URL` in `extensions/checkout-coupons/src/config.js` to the app URL
   (`dev` prints the tunnel URL; use the production URL before deploying), and add the
   production host to `react-router.config.ts`.
2. `npm run deploy` — the functions must be deployed before tipping setup can turn them on.
3. Partner Dashboard → the app → **API access**:
   - **Protected customer data access**: request level 1 (the tip selector reads a customer metafield in checkout).
   - Checkout UI extension **network access**: allow (the checkout coupon picker calls the app).
4. In the app: **Tipping → Set up tipping**, choose presets, turn tipping on, Save.
5. Shopify admin → a customer → Metafields → **Allowed tipping** = on.
6. Theme editor ("Code - End to End"): add the **Coupon picker** block to the cart page and
   turn on the **Coupon picker in cart drawer** app embed.
7. Settings → Checkout → Customize: add **Tip selector** and **Coupon picker** blocks.

## Production hosting (Cloudflare Workers)

The app server runs as the Worker `coupons-tipping` (workers.dev). Shopify sessions are in
the D1 database `coupons-tipping-sessions` (`migrations/`, `app/lib/d1-session-storage.server.ts`).
Needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (Workers Scripts + D1 edit).

First time:

```sh
npx wrangler d1 create coupons-tipping-sessions   # put the id in wrangler.jsonc
npm run db:migrate                                # creates the sessions table
npx wrangler secret put SHOPIFY_API_SECRET        # the app's client secret
```

Set the Worker URL in `wrangler.jsonc` (`SHOPIFY_APP_URL`), `react-router.config.ts`
(`allowedActionOrigins`), `shopify.app.toml` (`application_url`, redirect URL, `[app_proxy] url`,
`[network_access]`) and `extensions/checkout-coupons/src/config.js` (`APP_URL`). Then:

```sh
npm run deploy:worker   # build + wrangler deploy
npm run deploy          # release the Shopify app version (extensions, functions, config)
```

After `shopify app dev`, run `shopify app dev clean` (the dev preview overrides the released version
and removes the cart transform/validation with it; re-run Tipping → Set up). Local dev uses a local D1:
`npx wrangler d1 migrations apply coupons-tipping-sessions --local` once.

## Checks

```sh
npm run typecheck && npm run lint && npm test && npm run build
npm run test:functions   # builds both functions to Wasm and runs their fixtures
```

## Test plan (store)

- Coupons: global, segment (member / non-member / guest), expired, scheduled, usage limit hit,
  minimum subtotal and quantity not met, specific products, specific collections.
- Picker messages in cart page, cart drawer and checkout: applied, expired, not eligible, minimum not met.
- Tipping: allowed customer sees selector; guest and non-allowed customer never do; preset %,
  preset amount, custom, no tip; tip line price on the order; tip never discounted by
  app coupons **and by automatic discounts**; adding the Tip product by URL as a guest is blocked at checkout.
- Fulfillment: the Tip line needs no shipping and is not tracked.

## Notes

- Settings live in the shop metafield `$app:tipping_config` (checkout and functions read it), so
  Prisma only stores sessions.
- Fixed-amount tip presets are in the shop currency. With multiple currencies, the tip cap is
  converted by the functions, but preset amounts aren't.
- Template notes: `TEMPLATE-README.md`.
