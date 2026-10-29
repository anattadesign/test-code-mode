import { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  collectionsContainingProduct,
  createCoupon,
  getCoupon,
  getShopBasics,
  listSegments,
  updateCoupon,
} from "../lib/coupons.server";
import { buildDiscountInput, parseCouponForm, toShopDate } from "../lib/coupon-form";
import { ensureDiscountScope, getTippingStatus } from "../lib/tipping.server";
import {
  collectFormData,
  readChecked,
  readValue,
  readValues,
  useElementValue,
} from "../lib/use-element-value";

type Picked = { id: string; title: string };

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const isNew = params.id === "new";
  if (!isNew && !/^\d+$/.test(params.id ?? "")) {
    throw new Response("Not found", { status: 404 });
  }

  const [shop, segments, tipping] = await Promise.all([
    getShopBasics(admin),
    listSegments(admin),
    getTippingStatus(admin),
  ]);
  const coupon = isNew
    ? null
    : await getCoupon(admin, `gid://shopify/DiscountCodeNode/${params.id}`, tipping.collectionId);
  if (!isNew && !coupon) throw new Response("Coupon not found", { status: 404 });

  return {
    isNew,
    shop,
    segments,
    coupon,
    today: toShopDate(new Date(), shop.timezoneOffset),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const parsed = parseCouponForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const form = parsed.data;

  const scope = await ensureDiscountScope(admin);
  if ("error" in scope) return { errors: { form: scope.error } };

  // Coupons must never touch the tip line.
  if (scope.tipProductId) {
    if (form.appliesTo === "products" && form.productIds.includes(scope.tipProductId)) {
      return { errors: { productIds: "Remove the Tip product: tips can't be discounted." } };
    }
    if (form.appliesTo === "collections") {
      const withTip = await collectionsContainingProduct(admin, form.collectionIds, scope.tipProductId);
      if (withTip.length > 0) {
        return {
          errors: {
            collectionIds: `These collections contain the Tip product: ${withTip.join(", ")}. Exclude it or pick other collections.`,
          },
        };
      }
    }
  }

  const shop = await getShopBasics(admin);
  const isNew = params.id === "new";
  const id = `gid://shopify/DiscountCodeNode/${params.id}`;
  const existing = isNew ? null : await getCoupon(admin, id, scope.collectionId);
  if (!isNew && !existing) return { errors: { form: "Coupon not found." } };

  const input = buildDiscountInput(form, {
    discountableCollectionId: scope.collectionId,
    timezoneOffset: shop.timezoneOffset,
    existing: existing?.scope,
  });

  const result = isNew ? await createCoupon(admin, input) : await updateCoupon(admin, id, input);
  if ("error" in result) return { errors: { form: result.error } };
  return redirect("/app/coupons");
};

function PickerList({
  label,
  items,
  error,
  onPick,
}: {
  label: string;
  items: Picked[];
  error?: string;
  onPick: () => void;
}) {
  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-button onClick={onPick}>{label}</s-button>
        <s-text color="subdued">{items.length} selected</s-text>
      </s-stack>
      {items.length > 0 && (
        <s-unordered-list>
          {items.map((i) => (
            <s-list-item key={i.id}>{i.title}</s-list-item>
          ))}
        </s-unordered-list>
      )}
      {error && <s-text tone="critical">{error}</s-text>}
    </s-stack>
  );
}

export default function CouponEditor() {
  const { isNew, shop, segments, coupon, today } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = (actionData?.errors ?? {}) as Record<string, string | undefined>;
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const shopify = useAppBridge();

  const [valueTypeRef, valueType] = useElementValue(coupon?.valueType ?? "percentage", readValue);
  const [minimumRef, minimumType] = useElementValue(coupon?.minimumType ?? "none", readValue);
  const [appliesRef, appliesTo] = useElementValue<string>(coupon?.scope.appliesTo ?? "all", readValue);
  const [visibilityRef, visibility] = useElementValue<string>(coupon?.scope.visibility ?? "global", readValue);
  const [segmentRef, segmentIds] = useElementValue<string[]>(coupon?.scope.segmentIds ?? [], readValues);
  const [pickerRef, showInPicker] = useElementValue(coupon?.showInPicker ?? true, readChecked);

  const [products, setProducts] = useState<Picked[]>(coupon?.products ?? []);
  const [collections, setCollections] = useState<Picked[]>(coupon?.collections ?? []);

  const pick = async (type: "product" | "collection") => {
    const current = type === "product" ? products : collections;
    const selected = await shopify.resourcePicker({
      type,
      multiple: true,
      selectionIds: current.map((c) => ({ id: c.id })),
      ...(type === "product" ? { filter: { variants: false } } : {}),
    });
    if (!selected) return;
    const picked = selected.map((s: { id: string; title?: string }) => ({ id: s.id, title: s.title ?? s.id }));
    if (type === "product") setProducts(picked);
    else setCollections(picked);
  };

  const formRef = useRef<HTMLFormElement>(null);
  const submit = useSubmit();
  const save = () => {
    if (formRef.current) submit(collectFormData(formRef.current), { method: "post" });
  };

  const startsAt = coupon ? toShopDate(coupon.startsAt, shop.timezoneOffset) : today;
  const endsAt = coupon?.endsAt ? toShopDate(coupon.endsAt, shop.timezoneOffset) : "";

  return (
    <s-page heading={isNew ? "Create coupon" : `Edit ${coupon?.code}`}>
      <s-link slot="breadcrumb-actions" href="/app/coupons">
        Coupons
      </s-link>

      <Form
        method="post"
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input type="hidden" name="productIds" value={JSON.stringify(products.map((p) => p.id))} />
        <input type="hidden" name="collectionIds" value={JSON.stringify(collections.map((c) => c.id))} />
        <input type="hidden" name="segmentIds" value={JSON.stringify(segmentIds)} />

        <s-stack gap="base">
          {errors.form && (
            <s-banner tone="critical" heading="Couldn't save the coupon">
              {errors.form}
            </s-banner>
          )}

          <s-section heading="Coupon">
            <s-stack gap="base">
              <s-text-field
                label="Code"
                name="code"
                defaultValue={coupon?.code ?? ""}
                details="Customers see and enter this code. Letters, numbers, dashes and underscores."
                error={errors.code}
                required
              />
              <s-text-field
                label="Title"
                name="title"
                defaultValue={coupon?.title ?? ""}
                details="Shown in the coupon picker, for example “10% off your first order”."
                error={errors.title}
                required
              />
            </s-stack>
          </s-section>

          <s-section heading="Discount">
            <s-stack gap="base">
              <s-select ref={valueTypeRef} label="Discount type" name="valueType" value={valueType}>
                <s-option value="percentage">Percentage</s-option>
                <s-option value="fixed">Fixed amount ({shop.currencyCode})</s-option>
              </s-select>
              <s-number-field
                label={valueType === "percentage" ? "Percentage off" : `Amount off (${shop.currencyCode})`}
                name="value"
                defaultValue={coupon ? String(coupon.value) : ""}
                min={0}
                max={valueType === "percentage" ? 100 : undefined}
                step={0.01}
                suffix={valueType === "percentage" ? "%" : undefined}
                error={errors.value}
                required
              />
              <s-select ref={appliesRef} label="Applies to" name="appliesTo" value={appliesTo}>
                <s-option value="all">All products (tip excluded)</s-option>
                <s-option value="products">Specific products</s-option>
                <s-option value="collections">Specific collections</s-option>
              </s-select>
              {appliesTo === "products" && (
                <PickerList
                  label="Select products"
                  items={products}
                  error={errors.productIds}
                  onPick={() => pick("product")}
                />
              )}
              {appliesTo === "collections" && (
                <PickerList
                  label="Select collections"
                  items={collections}
                  error={errors.collectionIds}
                  onPick={() => pick("collection")}
                />
              )}
            </s-stack>
          </s-section>

          <s-section heading="Minimum purchase">
            <s-stack gap="base">
              <s-select ref={minimumRef} label="Minimum requirement" name="minimumType" value={minimumType}>
                <s-option value="none">No minimum</s-option>
                <s-option value="subtotal">Minimum purchase amount ({shop.currencyCode})</s-option>
                <s-option value="quantity">Minimum quantity of items</s-option>
              </s-select>
              {minimumType !== "none" && (
                <s-number-field
                  label={minimumType === "subtotal" ? `Minimum amount (${shop.currencyCode})` : "Minimum quantity"}
                  name="minimumValue"
                  defaultValue={coupon?.minimumValue ? String(coupon.minimumValue) : ""}
                  min={0}
                  step={minimumType === "subtotal" ? 0.01 : 1}
                  error={errors.minimumValue}
                />
              )}
            </s-stack>
          </s-section>

          <s-section heading="Who can use it">
            <s-stack gap="base">
              <s-select ref={visibilityRef} label="Visibility" name="visibility" value={visibility}>
                <s-option value="global">Global: all customers</s-option>
                <s-option value="segment">Customer segments only</s-option>
              </s-select>
              {visibility === "segment" &&
                (segments.length === 0 ? (
                  <s-banner tone="warning" heading="No customer segments yet">
                    Create segments in Shopify admin under Customers → Segments, then come back.
                  </s-banner>
                ) : (
                  <s-choice-list
                    ref={segmentRef}
                    label="Segments"
                    multiple
                    values={segmentIds}
                    error={errors.segmentIds}
                    details="Only logged-in customers in these segments see and can use the coupon."
                  >
                    {segments.map((s) => (
                      <s-choice key={s.id} value={s.id} selected={segmentIds.includes(s.id)}>
                        {s.name}
                      </s-choice>
                    ))}
                  </s-choice-list>
                ))}
            </s-stack>
          </s-section>

          <s-section heading="Active dates and limits">
            <s-stack gap="base">
              <s-stack direction="inline" gap="base">
                <s-date-field label="Start date" name="startsAt" defaultValue={startsAt} error={errors.startsAt} />
                <s-date-field
                  label="End date (optional)"
                  name="endsAt"
                  defaultValue={endsAt}
                  error={errors.endsAt}
                />
              </s-stack>
              <s-number-field
                label="Total usage limit (optional)"
                name="usageLimit"
                defaultValue={coupon?.usageLimit ? String(coupon.usageLimit) : ""}
                min={1}
                step={1}
                error={errors.usageLimit}
              />
              <s-checkbox
                label="Limit to one use per customer"
                name="oncePerCustomer"
                value="on"
                defaultChecked={coupon?.oncePerCustomer ?? false}
              />
            </s-stack>
          </s-section>

          <s-section heading="Combinations">
            <s-stack gap="small-200">
              <s-checkbox
                label="Combines with product discounts"
                name="combinesProduct"
                value="on"
                defaultChecked={coupon?.combinesWith.productDiscounts ?? false}
              />
              <s-checkbox
                label="Combines with order discounts"
                name="combinesOrder"
                value="on"
                defaultChecked={coupon?.combinesWith.orderDiscounts ?? false}
              />
              <s-checkbox
                label="Combines with shipping discounts"
                name="combinesShipping"
                value="on"
                defaultChecked={coupon?.combinesWith.shippingDiscounts ?? true}
              />
            </s-stack>
          </s-section>
        </s-stack>

        <s-section slot="aside" heading="Storefront">
          <s-checkbox
            ref={pickerRef}
            label="Show in coupon picker"
            name="showInPicker"
            value="on"
            checked={showInPicker}
            details="Eligible customers see this coupon in the cart coupon block. Off: the code still works when typed."
          />
        </s-section>
      </Form>

      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving}>
        Save
      </s-button>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
