import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { APP_URL } from "./config.js";

export default async () => {
  render(<CouponPicker />, document.body);
};

const TIP_PRODUCT_TYPE = "Tip";

async function api(path) {
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${APP_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Merchandise subtotal and quantity, without the tip line. */
function cartSnapshot() {
  const lines = shopify.lines.value.filter((l) => l.merchandise.product.productType !== TIP_PRODUCT_TYPE);
  return {
    subtotal: lines.reduce((sum, l) => sum + l.cost.totalAmount.amount, 0),
    quantity: lines.reduce((sum, l) => sum + l.quantity, 0),
  };
}

function CouponPicker() {
  const t = shopify.i18n.translate;
  const money = (n) => shopify.i18n.formatCurrency(n);
  const settings = shopify.settings.value;
  const heading = settings.heading || t("heading");
  const showManual = settings.show_manual_entry !== false;

  const applied = shopify.discountCodes.value.map((d) => d.code.toUpperCase());
  const canUpdate = shopify.instructions.value.discounts.canUpdateDiscountCodes;

  const [state, setState] = useState({ loading: true, coupons: [], loggedIn: false, failed: false });
  const [busyCode, setBusyCode] = useState(null);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState(null);

  const customerId = shopify.buyerIdentity?.customer.value?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api("/api/checkout/coupons")
      .then((data) => !cancelled && setState({ loading: false, failed: false, ...data }))
      .catch(() => !cancelled && setState({ loading: false, coupons: [], loggedIn: false, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  async function explain(code) {
    const { subtotal, quantity } = cartSnapshot();
    try {
      const params = new URLSearchParams({ code, subtotal: subtotal.toFixed(2), quantity: String(quantity) });
      const r = await api(`/api/checkout/coupons?${params}`);
      return t(`msg_${r.reason}`, {
        code,
        amount: r.minimumSubtotal != null ? money(r.minimumSubtotal) : "",
        count: String(r.minimumQuantity ?? ""),
      });
    } catch {
      return t("msg_error", { code });
    }
  }

  async function apply(rawCode) {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    if (!canUpdate) return setMessage({ tone: "warning", text: t("msg_not_supported") });
    if (applied.includes(code)) return setMessage({ tone: "info", text: t("msg_already", { code }) });

    setBusyCode(code);
    setMessage(null);
    try {
      const result = await shopify.applyDiscountCodeChange({ type: "addDiscountCode", code });
      // A code can be accepted but not applicable; check that it's really on the checkout.
      const nowApplied = shopify.discountCodes.value.some((d) => d.code.toUpperCase() === code);
      if (result.type === "success" && nowApplied) {
        setMessage({ tone: "success", text: t("msg_applied", { code }) });
        setManual("");
      } else {
        if (result.type === "success") {
          await shopify.applyDiscountCodeChange({ type: "removeDiscountCode", code });
        }
        setMessage({ tone: "critical", text: await explain(code) });
      }
    } catch {
      setMessage({ tone: "critical", text: t("msg_error", { code }) });
    } finally {
      setBusyCode(null);
    }
  }

  async function remove(code) {
    setBusyCode(code);
    setMessage(null);
    try {
      const result = await shopify.applyDiscountCodeChange({ type: "removeDiscountCode", code });
      setMessage(
        result.type === "success"
          ? { tone: "info", text: t("msg_removed", { code }) }
          : { tone: "critical", text: t("msg_error", { code }) },
      );
    } finally {
      setBusyCode(null);
    }
  }

  const { quantity, subtotal } = cartSnapshot();

  return (
    <s-section heading={heading}>
      <s-stack gap="base">
        {state.loading ? <s-text color="subdued">{t("loading")}</s-text> : null}

        {!state.loading && state.coupons.length === 0 && !state.failed ? (
          <s-text color="subdued">{state.loggedIn ? t("none") : `${t("none")} ${t("loginHint")}`}</s-text>
        ) : null}

        {state.coupons.map((c) => {
          const isApplied = applied.includes(c.code.toUpperCase());
          const short =
            (c.minimumSubtotal != null && subtotal < c.minimumSubtotal) ||
            (c.minimumQuantity != null && quantity < c.minimumQuantity);
          return (
            <s-stack
              key={c.code}
              direction="inline"
              gap="base"
              justifyContent="space-between"
              alignItems="center"
              border="base"
              borderRadius="base"
              padding="base"
            >
              <s-stack gap="none">
                <s-text type="strong">{c.code}</s-text>
                <s-text>{c.title}</s-text>
                {c.summary ? (
                  <s-text type="small" color="subdued">
                    {c.summary}
                  </s-text>
                ) : null}
                {c.minimumSubtotal != null ? (
                  <s-text type="small" tone={short ? "warning" : "neutral"}>
                    {t("minSubtotal", { amount: money(c.minimumSubtotal) })}
                  </s-text>
                ) : null}
                {c.minimumQuantity != null ? (
                  <s-text type="small" tone={short ? "warning" : "neutral"}>
                    {t("minQuantity", { count: String(c.minimumQuantity) })}
                  </s-text>
                ) : null}
                {c.endsAt ? (
                  <s-text type="small" color="subdued">
                    {t("endsOn", { date: shopify.i18n.formatDate(new Date(c.endsAt)) })}
                  </s-text>
                ) : null}
              </s-stack>
              {isApplied ? (
                <s-button
                  variant="secondary"
                  loading={busyCode === c.code}
                  accessibilityLabel={`${t("remove")} ${c.code}`}
                  onClick={() => remove(c.code)}
                >
                  {t("remove")}
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  loading={busyCode === c.code}
                  disabled={busyCode !== null}
                  accessibilityLabel={`${t("apply")} ${c.code}`}
                  onClick={() => apply(c.code)}
                >
                  {t("apply")}
                </s-button>
              )}
            </s-stack>
          );
        })}

        {showManual ? (
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-text-field
              label={t("codeLabel")}
              value={manual}
              onInput={(e) => setManual(e.currentTarget.value)}
              onChange={(e) => setManual(e.currentTarget.value)}
            />
            <s-button
              variant="secondary"
              disabled={!manual.trim() || busyCode !== null}
              loading={busyCode !== null && busyCode === manual.trim().toUpperCase()}
              onClick={() => apply(manual)}
            >
              {t("apply")}
            </s-button>
          </s-stack>
        ) : null}

        {message ? (
          <s-banner tone={message.tone}>{message.text}</s-banner>
        ) : null}
      </s-stack>
    </s-section>
  );
}
