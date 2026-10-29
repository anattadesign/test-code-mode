import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  deleteCoupon,
  isAppCoupon,
  listCoupons,
  setCouponActive,
  type CouponListItem,
} from "../lib/coupons.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return { coupons: await listCoupons(admin) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  if (!id.startsWith("gid://shopify/DiscountCodeNode/") || !(await isAppCoupon(admin, id))) {
    return { ok: false, message: "That coupon isn't managed by this app." };
  }

  let error: string | null = null;
  if (intent === "activate") error = await setCouponActive(admin, id, true);
  else if (intent === "deactivate") error = await setCouponActive(admin, id, false);
  else if (intent === "delete") error = await deleteCoupon(admin, id);
  else error = "Unknown action";

  const done = { activate: "Coupon activated", deactivate: "Coupon deactivated", delete: "Coupon deleted" };
  return error
    ? { ok: false, message: error }
    : { ok: true, message: done[intent as keyof typeof done] };
};

const STATUS_TONE: Record<CouponListItem["status"], "success" | "info" | "neutral"> = {
  ACTIVE: "success",
  SCHEDULED: "info",
  EXPIRED: "neutral",
};

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "No end date";
}

function CouponRow({ coupon }: { coupon: CouponListItem }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const numericId = coupon.id.split("/").pop();
  const active = coupon.status !== "EXPIRED";

  const submit = (intent: string) => {
    if (intent === "delete" && !window.confirm(`Delete coupon ${coupon.code}? This can't be undone.`)) return;
    fetcher.submit({ intent, id: coupon.id }, { method: "post" });
  };

  return (
    <s-table-row>
      <s-table-cell>
        <s-stack gap="small-200">
          <s-link href={`/app/coupons/${numericId}`}>{coupon.code}</s-link>
          <s-text color="subdued">{coupon.title}</s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={STATUS_TONE[coupon.status]}>{coupon.status.toLowerCase()}</s-badge>
      </s-table-cell>
      <s-table-cell>{coupon.audience}</s-table-cell>
      <s-table-cell>{coupon.inPicker ? "Shown" : "Hidden"}</s-table-cell>
      <s-table-cell>
        {coupon.usageCount}
        {coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""}
      </s-table-cell>
      <s-table-cell>{formatDate(coupon.endsAt)}</s-table-cell>
      <s-table-cell>
        <s-button-group>
          <s-button
            slot="secondary-actions"
            disabled={busy}
            onClick={() => submit(active ? "deactivate" : "activate")}
          >
            {active ? "Deactivate" : "Activate"}
          </s-button>
          <s-button slot="secondary-actions" tone="critical" disabled={busy} onClick={() => submit("delete")}>
            Delete
          </s-button>
        </s-button-group>
        <ActionToast data={fetcher.data} />
      </s-table-cell>
    </s-table-row>
  );
}

function ActionToast({ data }: { data?: { ok: boolean; message?: string } }) {
  const shopify = useAppBridge();
  useEffect(() => {
    if (data?.message) shopify.toast.show(data.message, { isError: !data.ok });
  }, [data, shopify]);
  return null;
}

export default function CouponsIndex() {
  const { coupons } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Coupons">
      <s-button slot="primary-action" variant="primary" href="/app/coupons/new">
        Create coupon
      </s-button>

      <s-section padding="none" accessibilityLabel="Coupons">
        {coupons.length === 0 ? (
          <s-box padding="base">
            <s-stack gap="base" alignItems="center">
              <s-heading>No coupons yet</s-heading>
              <s-paragraph>
                Create a coupon for every customer or for customer segments. Coupons marked “Show
                in coupon picker” appear in the storefront coupon block.
              </s-paragraph>
              <s-button href="/app/coupons/new">Create coupon</s-button>
            </s-stack>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Code</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Who can use it</s-table-header>
              <s-table-header>Coupon picker</s-table-header>
              <s-table-header format="numeric">Used</s-table-header>
              <s-table-header>Ends</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {coupons.map((c) => (
                <CouponRow key={c.id} coupon={c} />
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="How coupons work">
        <s-paragraph>
          Coupons are native Shopify discount codes, so Shopify enforces dates, usage limits,
          minimums and customer segments at checkout.
        </s-paragraph>
        <s-paragraph>
          “All products” coupons target the Discountable products collection, which leaves out
          the Tip product. Tips are never discounted.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
