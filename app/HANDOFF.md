# Coupons & Tipping — handoff (2026-10-29)

## What it is
A custom Shopify app for **terraform-anatta** (CLI domain: `anatta-store.myshopify.com`).
- **Coupons:** an embedded admin dashboard (Polaris web components) to create, edit, activate, deactivate and delete native Shopify discount codes.
  - Codes are global or limited to customer segments.
  - Each code has a type and value, dates, usage limits, minimums, and the products or collections it applies to.
  - Storefront picker: a theme app extension block on the cart page, plus an app embed for the cart drawer.
  - Checkout picker: a checkout UI extension.
  - The pickers list eligible coupons, apply one in a click, accept manual entry, and show these messages: applied, expired, not eligible, minimum not met.
- **Tipping:** at checkout only.
  - Options: presets, a custom amount, or no tip.
  - The tip is a separate line, and coupons never discount it.

## Where things are
- **Repo:** `anattadesign/test-code-mode`, branch `master`. The repo root is a Horizon theme; the app is in `app/`.
- **Shopify app:** Dev Dashboard app "Coupons & Tipping" in the Partner org Anatta Design, Inc (129416914).
  - client_id: `876c6e13ec9c73782b6f7dfd90cffafb`
  - Admin: https://admin.shopify.com/store/anatta-store/apps/876c6e13ec9c73782b6f7dfd90cffafb
- **Themes**
  - The cart block is placed in "Code - End to End" #191274811694.
  - Never touch the live theme, 🧩 Terraform Blocks #181466267950.

## Architecture
| Part | Where | Notes |
|---|---|---|
| Admin UI and API | `app/routes/app.*` | React Router 7 |
| Storefront API (app proxy `/apps/coupons/*` → `/proxy/*`) | `proxy.eligible`, `proxy.check`, `proxy.assets.$file` | Requests verified with `authenticate.public.appProxy`; `assets` is a fallback when the CDN returns 404 |
| Checkout coupons endpoint | `api.checkout.coupons` | Called by the checkout-coupons extension; needs network access |
| Theme extension | `extensions/coupon-picker` | JS source is in `theme-src/` and built with `npm run build:theme` (10 KB limit) |
| Checkout extensions | `checkout-coupons`, `tip-selector` | |
| Functions | `tip-price` (Cart Transform), `tip-guard` (Validation) | |
| Logic and tests | `app/lib/*` | 46 Vitest tests, plus 10 function fixture tests |

**How tipping works**
- **Gating:** the customer metafield `$app.allowed_tipping` must be on.
- **Configuration:** stored as JSON in the shop metafield `$app.tipping_config`. Currently: enabled, 10/15/20%, custom amounts allowed, max 500.
- **Tip product:** a hidden product, handle `tip`, tag `app-tip`, unlisted (Product 15446662119726, variant 67872667730222).
- **Price:** `tip-price` sets the line price from the line property `_tip_amount`.
- **Guard:** `tip-guard` blocks checkout when the tip isn't allowed.
- **Keeping coupons off the tip:** "All products" coupons target the automated collection `discountable-products` (540854944046), which excludes tag `app-tip`.

## Hosting: Cloudflare Workers (code done, not deployed)
- Last commit: `eade64b`.
- **What changed:**
  - The server runs as Worker `coupons-tipping` on the workers.dev free plan, using `@cloudflare/vite-plugin` with `workers/app.ts` as the entry.
  - It uses Shopify's web-api adapter.
  - Sessions live in D1 database `coupons-tipping-sessions` (`app/lib/d1-session-storage.server.ts`, `migrations/0001_sessions.sql`).
  - Prisma and Docker are removed.
- **Settings:** in `wrangler.jsonc` `vars`. The secret `SHOPIFY_API_SECRET` is set with `wrangler secret put`.
- **Verified locally in workerd:**
  - pages render
  - webhooks and proxy requests without a valid signature are rejected
  - a correctly signed proxy request returns 200
  - no secret in the build
- **Blocker:** the Cloudflare token (Vision secrets `YJ_CLOUDFLARE_ACCOUNT_ID` and `YJ_CLOUDFLARE_API_TOKEN`) has client IP filtering. Cloudflare rejects the sandbox's address `2a06:98c0:3600::103` with error 9109.
  - The user has to remove the filter, or add this address, and make sure the token has Workers Scripts Edit and D1 Edit.
  - The token expires 2026-11-05.

**Deploy steps once the token works** (run in `app/`, after `export CLOUDFLARE_ACCOUNT_ID=$YJ_CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN=$YJ_CLOUDFLARE_API_TOKEN`):
1. `npx wrangler d1 create coupons-tipping-sessions`, then put the returned id into `wrangler.jsonc`.
2. `npm run db:migrate`.
3. `npx wrangler secret put SHOPIFY_API_SECRET`. Read the value from the Shopify CLI (`shopify app env show`); never print or commit it.
4. `npm run deploy:worker`. This gives the URL `https://coupons-tipping.<subdomain>.workers.dev`.
5. Replace the placeholder `coupons-tipping.example.workers.dev` and the old tunnel URL in these places:
   - `wrangler.jsonc` `SHOPIFY_APP_URL`
   - `react-router.config.ts` `allowedActionOrigins`
   - `shopify.app.toml`: `application_url`, the redirect URL, `[app_proxy] url` (`…/proxy`), and `[network_access] allowed_sources`
   - `extensions/checkout-coupons/src/config.js` `APP_URL`
6. Redeploy the Worker. Then run `shopify app deploy`; the user agreed to release it. After that, stop `shopify app dev`.
7. Smoke-test the admin, the cart picker and checkout against the Worker. Commit and push.

**Free plan risk:** the CPU limit is 10 ms per request. If admin requests fail, Workers Paid ($5/month) fixes it.

## Open items
1. **Protected customer data is not approved yet.** A `customers` query returns ACCESS_DENIED.
   - Until it's approved, the tip selector never shows and segment coupons can't check membership.
   - Request it at partners.shopify.com → Apps → Dev Dashboard apps → Coupons & Tipping → API access requests. Reason: app functionality; fields: Name and Email.
2. **Network access for checkout extensions:** the user says it's allowed. It isn't verified yet; no request to `/api/checkout/coupons` has reached the server.
3. **Bug:** IAMYOGESH is saved with title "Code 75", but the form showed "Yogesh Coupon". Check the save path in `app.coupons.$id.tsx` and `lib/coupon-form.ts`.
4. **Design gap:** automatic discounts, and codes created outside the app, can still discount the tip. Order-level percentage discounts need checking too.
5. **Not tested yet:**
   - applying a coupon in the cart, and each error message
   - the drawer embed
   - the checkout picker
   - segment coupons
   - a full order with a tip (tax, shipping, Shop Pay, fulfillment)
6. **Reporting:** the tip is a product line, so reports count it as product sales.
7. **Inventory:** rerun `app-inventory`, because routes and hosting changed.
8. **Checkout extensions need Shopify Plus** in production; the dev store is fine.

## Commands (run in `app/`)
- **Checks:** `npm run typecheck && npm run lint && npm test && npm run build && npm run test:functions`, then `app-security .`
- **Local dev:**
  - `shopify app dev --store anatta-store.myshopify.com`. It runs in workerd; Vite passes the CLI's values to the Worker in dev only.
  - Run `npx wrangler d1 migrations apply coupons-tipping-sessions --local` once first.
  - Running dev rewrites the app's URLs to a tunnel. Run `npm run deploy` afterwards to restore production.
- **Push** (never store the token in git config):
  `H='!f(){ echo username=x-access-token; echo "password=$CODE_MODE_GIT_KEY"; }; f'; git -c credential.helper= -c credential.helper="$H" push origin master`

## Gotchas
- **Store domain:** the CLI only accepts `anatta-store.myshopify.com`.
- **CLI prompts:** they need a pseudo-TTY (`script -qfc` with a set terminal size). The device login is lost when the sandbox sleeps.
- **`shopify app config link`** overwrites `shopify.app.toml`. Restore the file and keep only client_id and the extension uids.
- **Limits:** block names max 25 characters; theme extension JS max 10 KB.
- **Smart collections:** rules with NOT_EQUALS need `matchType: "ALL"`.
- **Validation field:** it's `enabled`, not `enable`.
- **Themes query:** the Admin `themes` query returns null; use `shopify theme list`.
- **Shopify adapter:** import the Web API adapter from `@shopify/shopify-api/adapters/web-api`; React Router's package has only the Node one.
- **wrangler dev:** `.dev.vars` must sit next to the config it runs. Use `build/server/` for the built Worker.
