// Pure helpers shared by the tip selector. Keep in sync with app/lib/tipping.ts.

export const TIP_AMOUNT_ATTRIBUTE = "_tip_amount";
export const TIP_CHOICE_ATTRIBUTE = "_tip_choice";

/**
 * @param {{ mode: "percent" | "amount", maxTip: number }} config
 * @param {string} choice  "none" | "custom" | "preset:<value>"
 * @param {number} subtotal  merchandise subtotal without the tip
 * @param {number} customAmount
 * @param {number} rate  presentment currency rate (shop → buyer currency)
 */
export function amountForChoice(config, choice, subtotal, customAmount, rate = 1) {
  const max = config.maxTip * rate;
  let raw = 0;
  if (choice === "custom") raw = customAmount;
  else if (choice.startsWith("preset:")) {
    const value = Number(choice.slice(7));
    raw = config.mode === "percent" ? (subtotal * value) / 100 : value * rate;
  }
  const rounded = Math.round(raw * 100) / 100;
  return Math.max(0, Math.min(rounded, Math.floor(max * 100) / 100));
}

/** @param {{ attributes: { key: string, value: string }[] }} line */
export function attr(line, key) {
  return line.attributes.find((a) => a.key === key)?.value ?? null;
}
