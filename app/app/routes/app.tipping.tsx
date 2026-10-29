import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { env } from "cloudflare:workers";
import { authenticate } from "../shopify.server";
import { getShopBasics } from "../lib/coupons.server";
import { parseTippingSettingsForm } from "../lib/tipping";
import {
  getTippingStatus,
  loadTippingConfig,
  saveTippingConfig,
  setUpTipping,
  type TippingStatus,
} from "../lib/tipping.server";
import { collectFormData, readValue, useElementValue } from "../lib/use-element-value";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ config }, status, shop] = await Promise.all([
    loadTippingConfig(admin),
    getTippingStatus(admin),
    getShopBasics(admin),
  ]);
  const storeHandle = session.shop.replace(".myshopify.com", "");
  return { config, status, currency: shop.currencyCode, storeHandle };
};

function tippingSetupBlocked(shop: string) {
  return (env.TIPPING_SETUP_BLOCKED_SHOPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(shop);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const { shopId, config } = await loadTippingConfig(admin);

  if (intent === "setup") {
    // The dev app shares terraform-anatta with production. Its tip functions read the dev
    // app's own metafields, so its tip guard would block real checkouts. Set in vite.config.ts
    // for `vite dev` only; production never sets it.
    if (tippingSetupBlocked(session.shop)) {
      return {
        intent: "setup",
        errors: [
          "Tipping setup is turned off for the dev app on this store, because production tipping already runs here. Use a separate development store to test tipping setup.",
        ],
        fieldErrors: {} as Record<string, string>,
      };
    }
    const { status, errors } = await setUpTipping(admin);
    const saveError = await saveTippingConfig(admin, shopId, {
      ...config,
      variantId: status.variantId,
      productId: status.productId,
      discountableCollectionId: status.collectionId,
    });
    if (saveError) errors.push(`Saving settings: ${saveError}`);
    return { intent: "setup", errors, fieldErrors: {} as Record<string, string> };
  }

  const parsed = parseTippingSettingsForm(formData);
  if (!parsed.ok) return { intent: "save", errors: [], fieldErrors: parsed.errors };

  const status = await getTippingStatus(admin);
  if (parsed.data.enabled && !status.ready) {
    return {
      intent: "save",
      errors: ["Finish setup before turning tipping on."],
      fieldErrors: {} as Record<string, string>,
    };
  }
  const saveError = await saveTippingConfig(admin, shopId, {
    ...config,
    ...parsed.data,
    variantId: status.variantId,
    productId: status.productId,
    discountableCollectionId: status.collectionId,
  });
  return {
    intent: "save",
    errors: saveError ? [saveError] : [],
    fieldErrors: {} as Record<string, string>,
  };
};

function StatusRow({ done, label, help }: { done: boolean; label: string; help?: string }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-icon type={done ? "check-circle" : "alert-circle"} tone={done ? "success" : "caution"} />
      <s-text>{label}</s-text>
      {!done && help && <s-text color="subdued">— {help}</s-text>}
    </s-stack>
  );
}

function SetupSection({ status, onSetup, busy }: { status: TippingStatus; onSetup: () => void; busy: boolean }) {
  return (
    <s-section heading="Setup">
      <s-stack gap="base">
        <s-paragraph>
          Setup creates a hidden Tip product, the Discountable products collection, and turns on
          the tip pricing and tip guard functions. Running it again only adds what’s missing.
        </s-paragraph>
        <s-stack gap="small-200">
          <StatusRow done={Boolean(status.variantId)} label="Tip product (unlisted, untaxed, no shipping)" />
          <StatusRow done={Boolean(status.collectionId)} label="Discountable products collection" />
          <StatusRow
            done={status.cartTransformActive}
            label="Tip pricing function"
            help={status.missingFunctions.includes("tip-price") ? "deploy the app first" : undefined}
          />
          <StatusRow
            done={status.validationActive}
            label="Tip guard function"
            help={status.missingFunctions.includes("tip-guard") ? "deploy the app first" : undefined}
          />
        </s-stack>
        {!status.ready && (
          <s-button onClick={onSetup} loading={busy}>
            Set up tipping
          </s-button>
        )}
      </s-stack>
    </s-section>
  );
}

export default function Tipping() {
  const { config, status, currency, storeHandle } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLDivElement>(null);
  const busyIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const [modeRef, mode] = useElementValue(config.mode, readValue);

  useEffect(() => {
    if (result && result.errors.length === 0 && Object.keys(result.fieldErrors).length === 0) {
      shopify.toast.show(result.intent === "setup" ? "Tipping set up" : "Settings saved");
    }
  }, [result, shopify]);

  const save = () => {
    if (!formRef.current) return;
    const data = collectFormData(formRef.current);
    data.set("intent", "save");
    submit(data, { method: "post" });
  };
  const setup = () => submit({ intent: "setup" }, { method: "post" });
  const fieldErrors: Record<string, string> = result?.fieldErrors ?? {};

  return (
    <s-page heading="Tipping">
      <s-button slot="primary-action" variant="primary" onClick={save} loading={busyIntent === "save"}>
        Save
      </s-button>

      <s-stack gap="base">
        {result && result.errors.length > 0 && (
          <s-banner tone="critical" heading="Something needs attention">
            <s-unordered-list>
              {result.errors.map((e) => (
                <s-list-item key={e}>{e}</s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        )}

        <SetupSection status={status} onSetup={setup} busy={busyIntent === "setup"} />

        <div ref={formRef}>
          <s-section heading="Tip options">
            <s-stack gap="base">
              <s-switch
                label="Show the tip selector at checkout"
                name="enabled"
                value="on"
                defaultChecked={config.enabled}
                disabled={!status.ready}
                details="Only customers with “Allowed tipping” turned on see it."
              />
              <s-select ref={modeRef} label="Preset type" name="mode" value={mode}>
                <s-option value="percent">Percentage of the order subtotal</s-option>
                <s-option value="amount">Fixed amounts ({currency})</s-option>
              </s-select>
              <s-text-field
                label={mode === "percent" ? "Presets (%)" : `Presets (${currency})`}
                name="presets"
                defaultValue={config.presets.join(", ")}
                details="Up to four values, separated by commas. For example 10, 15, 20."
                error={fieldErrors.presets}
              />
              <s-checkbox
                label="Let customers enter a custom amount"
                name="allowCustom"
                value="on"
                defaultChecked={config.allowCustom}
              />
              <s-number-field
                label={`Maximum tip (${currency})`}
                name="maxTip"
                defaultValue={String(config.maxTip)}
                min={1}
                step={0.01}
                error={fieldErrors.maxTip}
              />
              <s-text-field
                label="Heading"
                name="heading"
                defaultValue={config.heading}
                error={fieldErrors.heading}
              />
              <s-text-area
                label="Description (optional)"
                name="description"
                defaultValue={config.description}
                error={fieldErrors.description}
              />
            </s-stack>
          </s-section>
        </div>
      </s-stack>

      <s-section slot="aside" heading="Who sees tipping">
        <s-paragraph>
          Turn on <s-text type="strong">Allowed tipping</s-text> on a customer’s page in Shopify admin
          (Customers → customer → Metafields). Guests and other customers never see the tip selector.
        </s-paragraph>
        <s-link href={`https://admin.shopify.com/store/${storeHandle}/customers`} target="_blank">
          Open customers
        </s-link>
      </s-section>

      <s-section slot="aside" heading="Add it to checkout">
        <s-paragraph>
          In Settings → Checkout → Customize, add the <s-text type="strong">Tip selector</s-text> app
          block where you want it, then save.
        </s-paragraph>
        <s-link href={`https://admin.shopify.com/store/${storeHandle}/settings/checkout`} target="_blank">
          Open checkout settings
        </s-link>
      </s-section>

      <s-section slot="aside" heading="Tips and discounts">
        <s-paragraph>
          Coupons from this app never apply to the tip. For discounts created elsewhere, limit them to
          the Discountable products collection so they skip the tip too.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
