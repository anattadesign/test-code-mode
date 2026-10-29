// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

const DEFAULT_MAX_TIP = 500;

/**
 * Blocks checkout when a Tip line is present but shouldn't be: tipping is off,
 * the customer isn't allowed to tip (guest or `allowed_tipping` not true), more
 * than one tip, or an invalid amount. Carts without a Tip line always pass.
 *
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const tipLines = input.cart.lines.filter(
    (l) => l.merchandise.__typename === "ProductVariant" && l.merchandise.product.isTip,
  );
  if (tipLines.length === 0) return { operations: [{ validationAdd: { errors: [] } }] };

  const config = /** @type {{ enabled?: boolean, maxTip?: number } | null} */ (
    input.shop.config?.jsonValue ?? null
  );
  const rate = Number(input.presentmentCurrencyRate) || 1;
  const maxTip = (typeof config?.maxTip === "number" ? config.maxTip : DEFAULT_MAX_TIP) * rate;
  const allowed = input.cart.buyerIdentity?.customer?.allowedTipping?.value === "true";

  /** @type {string | null} */
  let message = null;
  if (!config?.enabled || !allowed) {
    message = "Tipping isn't available for this order. Remove the tip to continue.";
  } else if (tipLines.length > 1 || tipLines.some((l) => l.quantity !== 1)) {
    message = "Only one tip can be added. Choose a single tip amount.";
  } else {
    const raw = tipLines[0].tipAmount?.value;
    const valid = raw && /^\d{1,7}(\.\d{1,2})?$/.test(raw) && Number(raw) > 0;
    if (!valid) message = "The tip amount isn't valid. Choose a tip again.";
    else if (Number(raw) > Math.round(maxTip * 100) / 100 + 0.001) {
      message = "The tip is above the maximum allowed. Choose a smaller tip.";
    }
  }

  return {
    operations: [
      { validationAdd: { errors: message ? [{ message, target: "$.cart" }] : [] } },
    ],
  };
}
