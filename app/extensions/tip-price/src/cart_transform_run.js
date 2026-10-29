// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/** Hard ceiling when the shop config can't be read (shop currency). */
const DEFAULT_MAX_TIP = 500;

/**
 * Parse a tip amount attribute: a positive decimal with at most 2 places.
 * @param {string | null | undefined} raw
 * @returns {number | null}
 */
export function parseTipAmount(raw) {
  if (!raw || !/^\d{1,7}(\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw);
  return amount > 0 ? amount : null;
}

/**
 * Prices each Tip line at exactly the amount the customer chose in checkout
 * (cart line attribute `_tip_amount`, presentment currency), capped at the
 * merchant's maximum tip. Never touches any other line.
 *
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const config = /** @type {{ maxTip?: number } | null} */ (input.shop.config?.jsonValue ?? null);
  const rate = Number(input.presentmentCurrencyRate) || 1;
  const maxTip = (typeof config?.maxTip === "number" ? config.maxTip : DEFAULT_MAX_TIP) * rate;

  const operations = [];
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename !== "ProductVariant" || !line.merchandise.product.isTip) continue;
    const amount = parseTipAmount(line.tipAmount?.value);
    if (amount === null) continue; // tip-guard blocks checkout for invalid tips
    const capped = Math.min(amount, Math.round(maxTip * 100) / 100);
    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        title: "Tip",
        price: {
          adjustment: { fixedPricePerUnit: { amount: capped.toFixed(2) } },
        },
      },
    });
  }
  return { operations };
}
