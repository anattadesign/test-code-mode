import { z } from "zod";
import { APP_TAG, PICKER_TAG } from "./constants";

const idList = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (!raw) return [] as string[];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        return parsed as string[];
      }
    } catch {
      // fall through
    }
    ctx.addIssue({ code: "custom", message: "Invalid selection" });
    return z.NEVER;
  });

const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined));

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const couponFormSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title").max(255),
    code: z
      .string()
      .trim()
      .min(1, "Enter a code")
      .max(255)
      .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, dashes or underscores")
      .transform((v) => v.toUpperCase()),
    valueType: z.enum(["percentage", "fixed"]),
    value: z.coerce.number().positive("Enter a value above 0"),
    startsAt: z.string().regex(isoDate, "Pick a start date"),
    endsAt: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() !== "" ? v : undefined))
      .refine((v) => v === undefined || isoDate.test(v), "Pick a valid end date"),
    usageLimit: optionalNumber.refine(
      (v) => v === undefined || (Number.isInteger(v) && v > 0),
      "Usage limit must be a whole number above 0",
    ),
    oncePerCustomer: checkbox,
    minimumType: z.enum(["none", "subtotal", "quantity"]),
    minimumValue: optionalNumber,
    appliesTo: z.enum(["all", "products", "collections"]),
    productIds: idList,
    collectionIds: idList,
    visibility: z.enum(["global", "segment"]),
    segmentIds: idList,
    showInPicker: checkbox,
    combinesProduct: checkbox,
    combinesOrder: checkbox,
    combinesShipping: checkbox,
  })
  .superRefine((f, ctx) => {
    if (f.valueType === "percentage" && f.value > 100) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage can't be above 100" });
    }
    if (f.endsAt && f.endsAt < f.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End date must be after the start date" });
    }
    if (f.minimumType !== "none" && !(f.minimumValue && f.minimumValue > 0)) {
      ctx.addIssue({ code: "custom", path: ["minimumValue"], message: "Enter a minimum above 0" });
    }
    if (f.minimumType === "quantity" && f.minimumValue && !Number.isInteger(f.minimumValue)) {
      ctx.addIssue({ code: "custom", path: ["minimumValue"], message: "Minimum quantity must be a whole number" });
    }
    if (f.appliesTo === "products" && f.productIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["productIds"], message: "Select at least one product" });
    }
    if (f.appliesTo === "collections" && f.collectionIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["collectionIds"], message: "Select at least one collection" });
    }
    if (f.visibility === "segment" && f.segmentIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["segmentIds"], message: "Select at least one customer segment" });
    }
  });

export type CouponForm = z.output<typeof couponFormSchema>;

/** The parts of an existing discount needed to compute add/remove diffs on update. */
export interface ExistingCouponScope {
  appliesTo: "all" | "products" | "collections";
  productIds: string[];
  collectionIds: string[];
  visibility: "global" | "segment";
  segmentIds: string[];
}

export function parseCouponForm(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  const result = couponFormSchema.safeParse(raw);
  if (result.success) return { ok: true as const, data: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return { ok: false as const, errors };
}

/** "+05:30" style offset from Shopify's "+0530" timezoneOffset. */
export function formatOffset(timezoneOffset: string): string {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(timezoneOffset);
  return m ? `${m[1]}${m[2]}:${m[3]}` : "Z";
}

/** YYYY-MM-DD of an instant in the shop's timezone ("+0530" style offset). */
export function toShopDate(iso: string | Date, timezoneOffset: string): string {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(timezoneOffset);
  const minutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const t = new Date(iso).getTime() + minutes * 60_000;
  return new Date(t).toISOString().slice(0, 10);
}

const diff = (next: string[], prev: string[]) => ({
  add: next.filter((id) => !prev.includes(id)),
  remove: prev.filter((id) => !next.includes(id)),
});

/**
 * Build the DiscountCodeBasicInput for discountCodeBasicCreate / discountCodeBasicUpdate.
 *
 * "All products" is never sent as `items.all`: it targets the automated
 * "Discountable products" collection (product type is not "Tip"), so a coupon can
 * never discount the tip line.
 */
export function buildDiscountInput(
  form: CouponForm,
  opts: {
    discountableCollectionId: string;
    timezoneOffset: string;
    existing?: ExistingCouponScope;
  },
) {
  const offset = formatOffset(opts.timezoneOffset);
  const existing = opts.existing;

  const value =
    form.valueType === "percentage"
      ? { percentage: Math.round(form.value * 100) / 10000 }
      : { discountAmount: { amount: form.value.toFixed(2), appliesOnEachItem: false } };

  const collectionIds =
    form.appliesTo === "all" ? [opts.discountableCollectionId] : form.collectionIds;

  let items: Record<string, unknown>;
  if (form.appliesTo === "products") {
    const prev = existing?.appliesTo === "products" ? existing.productIds : [];
    const d = diff(form.productIds, prev);
    items = { products: { productsToAdd: d.add, productsToRemove: d.remove } };
  } else {
    const prev =
      existing && existing.appliesTo !== "products"
        ? existing.appliesTo === "all"
          ? [opts.discountableCollectionId]
          : existing.collectionIds
        : [];
    const d = diff(collectionIds, prev);
    items = { collections: { add: d.add, remove: d.remove } };
  }

  let context: Record<string, unknown>;
  if (form.visibility === "global") {
    context = { all: "ALL" };
  } else {
    const prev = existing?.visibility === "segment" ? existing.segmentIds : [];
    const d = diff(form.segmentIds, prev);
    context = { customerSegments: { add: d.add, remove: d.remove } };
  }

  let minimumRequirement: Record<string, unknown>;
  if (form.minimumType === "subtotal") {
    minimumRequirement = {
      subtotal: { greaterThanOrEqualToSubtotal: form.minimumValue!.toFixed(2) },
    };
  } else if (form.minimumType === "quantity") {
    minimumRequirement = {
      quantity: { greaterThanOrEqualToQuantity: String(form.minimumValue) },
    };
  } else {
    // Clears an existing minimum on update.
    minimumRequirement = { subtotal: { greaterThanOrEqualToSubtotal: null } };
  }

  return {
    title: form.title,
    code: form.code,
    startsAt: `${form.startsAt}T00:00:00${offset}`,
    endsAt: form.endsAt ? `${form.endsAt}T23:59:59${offset}` : null,
    usageLimit: form.usageLimit ?? null,
    appliesOncePerCustomer: form.oncePerCustomer,
    tags: form.showInPicker ? [APP_TAG, PICKER_TAG] : [APP_TAG],
    context,
    minimumRequirement,
    customerGets: { value, items },
    combinesWith: {
      productDiscounts: form.combinesProduct,
      orderDiscounts: form.combinesOrder,
      shippingDiscounts: form.combinesShipping,
    },
  };
}
