import { describe, expect, it } from "vitest";
import { DEFAULT_TIPPING_CONFIG, parseTippingConfig, parseTippingSettingsForm, tipAmount } from "../tipping";
// The checkout extension has its own copy of the amount logic; keep them in agreement.
import { amountForChoice } from "../../../extensions/tip-selector/src/tip.js";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries({ mode: "percent", presets: "10, 15, 20", maxTip: "100", heading: "Add a tip", ...v }))
    f.set(k, val);
  return f;
};

describe("tipping settings", () => {
  it("parses presets and switches", () => {
    const r = parseTippingSettingsForm(form({ enabled: "on", allowCustom: "on" }));
    expect(r.ok && r.data).toMatchObject({ enabled: true, allowCustom: true, presets: [10, 15, 20], maxTip: 100 });
  });
  it.each([
    [{ presets: "" }, "presets"],
    [{ presets: "1,2,3,4,5" }, "presets"],
    [{ presets: "10, abc" }, "presets"],
    [{ presets: "150" }, "presets"],
    [{ mode: "amount", presets: "5, 200" }, "presets"],
    [{ maxTip: "0" }, "maxTip"],
    [{ heading: " " }, "heading"],
  ])("rejects %o", (v, field) => {
    const r = parseTippingSettingsForm(form(v));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field]).toBeTruthy();
  });
  it("falls back to defaults for missing or bad stored config", () => {
    expect(parseTippingConfig(null)).toEqual(DEFAULT_TIPPING_CONFIG);
    expect(parseTippingConfig({ presets: "bad" })).toEqual(DEFAULT_TIPPING_CONFIG);
    expect(parseTippingConfig({ enabled: true }).enabled).toBe(true);
  });
});

describe("tip amounts", () => {
  const pct = { mode: "percent" as const, maxTip: 50 };
  const amt = { mode: "amount" as const, maxTip: 50 };
  it.each([
    [pct, { kind: "preset", value: 15 }, 80, 12],
    [pct, { kind: "preset", value: 15 }, 33.33, 5],
    [pct, { kind: "preset", value: 20 }, 1000, 50],
    [amt, { kind: "preset", value: 5 }, 80, 5],
    [amt, { kind: "custom", amount: 7.456 }, 80, 7.46],
    [amt, { kind: "custom", amount: 75 }, 80, 50],
  ] as const)("%o %o of %d → %d", (config, choice, subtotal, expected) => {
    expect(tipAmount(config, choice, subtotal)).toBe(expected);
    const extChoice = choice.kind === "custom" ? "custom" : `preset:${choice.value}`;
    const custom = choice.kind === "custom" ? choice.amount : 0;
    expect(amountForChoice(config, extChoice, subtotal, custom)).toBe(expected);
  });
});
