import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listCoupons } from "../lib/coupons.server";
import { getTippingStatus, loadTippingConfig } from "../lib/tipping.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const [coupons, status, { config }] = await Promise.all([
    listCoupons(admin),
    getTippingStatus(admin),
    loadTippingConfig(admin),
  ]);
  return {
    activeCoupons: coupons.filter((c) => c.status === "ACTIVE").length,
    pickerCoupons: coupons.filter((c) => c.status === "ACTIVE" && c.inPicker).length,
    segmentCoupons: coupons.filter((c) => c.audience !== "Everyone").length,
    tippingReady: status.ready,
    tippingEnabled: config.enabled,
  };
};

export default function Home() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Coupons & Tipping">
      <s-section heading="Coupons">
        <s-stack gap="base">
          <s-paragraph>
            {data.activeCoupons} active coupons, {data.pickerCoupons} shown in the coupon picker,{" "}
            {data.segmentCoupons} limited to customer segments.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href="/app/coupons/new" variant="primary">
              Create coupon
            </s-button>
            <s-button href="/app/coupons">Manage coupons</s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Tipping">
        <s-stack gap="base">
          <s-paragraph>
            {!data.tippingReady
              ? "Tipping isn't set up yet."
              : data.tippingEnabled
                ? "Tipping is on for customers with “Allowed tipping” turned on."
                : "Tipping is set up but turned off."}
          </s-paragraph>
          <s-button href="/app/tipping">{data.tippingReady ? "Tipping settings" : "Set up tipping"}</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Storefront coupon block">
        <s-paragraph>
          In the theme editor, add the <s-text type="strong">Coupon picker</s-text> app block to the
          cart page (or any page). For the cart drawer, turn on the{" "}
          <s-text type="strong">Coupon picker in cart drawer</s-text> app embed.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
