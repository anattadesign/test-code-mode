import { z } from "zod";

/**
 * Tipping settings, stored as JSON in the shop metafield `$app.tipping_config`
 * and read by the checkout extension. Keep in sync with
 * extensions/tip-selector/src/tip.js.
 */
export const tippingConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["percent", "amount"]),
  presets: z.array(z.number().positive()).min(1).max(4),
  allowCustom: z.boolean(),
  maxTip: z.number().positive(),
  heading: z.string().max(80),
  description: z.string().max(200),
  /** Set by "Set up tipping"; the checkout extension adds this variant as the tip line. */
  variantId: z.string().nullable(),
  productId: z.string().nullable(),
  discountableCollectionId: z.string().nullable(),
});

export type TippingConfig = z.infer<typeof tippingConfigSchema>;

export const DEFAULT_TIPPING_CONFIG: TippingConfig = {
  enabled: false,
  mode: "percent",
  presets: [10, 15, 20],
  allowCustom: true,
  maxTip: 500,
  heading: "Add a tip",
  description: "",
  variantId: null,
  productId: null,
  discountableCollectionId: null,
};

export function parseTippingConfig(json: unknown): TippingConfig {
  const result = tippingConfigSchema.partial().safeParse(json);
  return { ...DEFAULT_TIPPING_CONFIG, ...(result.success ? result.data : {}) };
}

const settingsFormSchema = z
  .object({
    enabled: z.string().optional().transform((v) => v === "on" || v === "true"),
    mode: z.enum(["percent", "amount"]),
    presets: z
      .string()
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number),
      )
      .pipe(
        z
          .array(z.number().positive("Presets must be numbers above 0"))
          .min(1, "Enter at least one preset")
          .max(4, "Use up to four presets"),
      ),
    allowCustom: z.string().optional().transform((v) => v === "on" || v === "true"),
    maxTip: z.coerce.number().positive("Maximum tip must be above 0"),
    heading: z.string().trim().min(1, "Enter a heading").max(80),
    description: z.string().trim().max(200).optional().default(""),
  })
  .superRefine((f, ctx) => {
    if (f.mode === "percent" && f.presets.some((p) => p > 100)) {
      ctx.addIssue({ code: "custom", path: ["presets"], message: "Percentages can't be above 100" });
    }
    if (f.mode === "amount" && f.presets.some((p) => p > f.maxTip)) {
      ctx.addIssue({ code: "custom", path: ["presets"], message: "A preset is above the maximum tip" });
    }
  });

export function parseTippingSettingsForm(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  const result = settingsFormSchema.safeParse(raw);
  if (result.success) return { ok: true as const, data: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return { ok: false as const, errors };
}

/** Tip amount for a choice, rounded to cents and capped at maxTip. */
export function tipAmount(
  config: Pick<TippingConfig, "mode" | "maxTip">,
  choice: { kind: "preset"; value: number } | { kind: "custom"; amount: number },
  subtotal: number,
): number {
  const raw =
    choice.kind === "custom"
      ? choice.amount
      : config.mode === "percent"
        ? (subtotal * choice.value) / 100
        : choice.value;
  const rounded = Math.round(raw * 100) / 100;
  return Math.max(0, Math.min(rounded, config.maxTip));
}
