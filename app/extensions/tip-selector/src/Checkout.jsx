import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { TIP_AMOUNT_ATTRIBUTE, TIP_CHOICE_ATTRIBUTE, amountForChoice, attr } from "./tip.js";

export default async () => {
  render(<TipSelector />, document.body);
};

/** @returns {any} */
function readConfig() {
  const entry = shopify.appMetafields.value.find(
    (m) => m.target.type === "shop" && m.metafield.key === "tipping_config",
  );
  if (!entry) return null;
  try {
    return JSON.parse(entry.metafield.value);
  } catch {
    return null;
  }
}

function customerAllowed() {
  const entry = shopify.appMetafields.value.find(
    (m) => m.target.type === "customer" && m.metafield.key === "allowed_tipping",
  );
  return entry?.metafield.value === "true";
}

function TipSelector() {
  const t = shopify.i18n.translate;
  const money = (n) => shopify.i18n.formatCurrency(n);

  const config = readConfig();
  const customer = shopify.buyerIdentity?.customer.value;
  const instructions = shopify.instructions.value;
  const lines = shopify.lines.value;

  const tipLine = config?.variantId
    ? lines.find((l) => l.merchandise.id === config.variantId)
    : undefined;
  const tipCost = tipLine ? tipLine.cost.totalAmount.amount : 0;
  const subtotal = Math.max(0, shopify.cost.subtotalAmount.value.amount - tipCost);

  const savedChoice = tipLine ? (attr(tipLine, TIP_CHOICE_ATTRIBUTE) ?? "custom") : "none";
  const savedAmount = tipLine ? Number(attr(tipLine, TIP_AMOUNT_ATTRIBUTE) ?? 0) : 0;

  const [choice, setChoice] = useState(savedChoice);
  const [custom, setCustom] = useState(savedChoice === "custom" && savedAmount ? String(savedAmount) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(/** @type {null | {tone: string, text: string}} */ (null));

  const visible =
    Boolean(config?.enabled && config.variantId) && Boolean(customer) && customerAllowed();
  const canEdit =
    instructions.lines.canAddCartLine &&
    instructions.lines.canUpdateCartLine &&
    instructions.lines.canRemoveCartLine;

  // Keep a percentage tip in step with the subtotal (for example after a coupon or quantity change).
  useEffect(() => {
    if (!visible || !tipLine || busy || !savedChoice.startsWith("preset:")) return;
    const expected = amountForChoice(config, savedChoice, subtotal, 0);
    if (expected > 0 && Math.abs(expected - savedAmount) >= 0.01) {
      applyTip(savedChoice, expected, { quiet: true });
    }
    // Only re-run when the subtotal changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  if (!visible) {
    // Buyers never see a hidden tip selector; merchants in the checkout editor get the reason.
    if (!shopify.extension.editor) return null;
    const reason = !config?.enabled
      ? t("editorDisabled")
      : !config.variantId
        ? t("editorNotSetUp")
        : !customer
          ? t("editorNoCustomer")
          : t("editorNotAllowed");
    return (
      <s-banner tone="info" heading={t("editorHeading")}>
        {reason}
      </s-banner>
    );
  }

  if (!canEdit) {
    return (
      <s-banner tone="info" heading={config.heading}>
        {t("notEditable")}
      </s-banner>
    );
  }

  async function applyTip(nextChoice, amount, { quiet = false } = {}) {
    setBusy(true);
    if (!quiet) setMessage(null);
    try {
      let result;
      if (nextChoice === "none" || amount <= 0) {
        result = tipLine
          ? await shopify.applyCartLinesChange({ type: "removeCartLine", id: tipLine.id, quantity: tipLine.quantity })
          : { type: "success" };
      } else {
        const attributes = [
          { key: TIP_AMOUNT_ATTRIBUTE, value: amount.toFixed(2) },
          { key: TIP_CHOICE_ATTRIBUTE, value: nextChoice },
        ];
        result = tipLine
          ? await shopify.applyCartLinesChange({ type: "updateCartLine", id: tipLine.id, quantity: 1, attributes })
          : await shopify.applyCartLinesChange({
              type: "addCartLine",
              merchandiseId: config.variantId,
              quantity: 1,
              attributes,
            });
      }
      if (result.type === "error") {
        setMessage({ tone: "critical", text: t("error") });
      } else if (!quiet) {
        setMessage(
          nextChoice === "none" || amount <= 0
            ? { tone: "info", text: t("removed") }
            : { tone: "success", text: t("added", { amount: money(amount) }) },
        );
      }
    } catch {
      setMessage({ tone: "critical", text: t("error") });
    } finally {
      setBusy(false);
    }
  }

  function onChoice(event) {
    const next = event.currentTarget.values?.[0] ?? "none";
    setChoice(next);
    if (next === "custom") return; // wait for the amount
    applyTip(next, amountForChoice(config, next, subtotal, 0));
  }

  function onCustomSubmit() {
    const value = Number(custom);
    const max = Math.floor(config.maxTip * 100) / 100;
    if (!Number.isFinite(value) || value < 0.01 || value > max) {
      setMessage({ tone: "critical", text: t("invalidAmount", { min: money(0.01), max: money(max) }) });
      return;
    }
    applyTip("custom", Math.round(value * 100) / 100);
  }

  const presetLabel = (value) => {
    const amount = amountForChoice(config, `preset:${value}`, subtotal, 0);
    return config.mode === "percent"
      ? t("percentOption", { percent: String(value), amount: money(amount) })
      : money(amount);
  };

  return (
    <s-section heading={config.heading}>
      <s-stack gap="base">
        {config.description ? <s-text color="subdued">{config.description}</s-text> : null}

        <s-choice-list
          label={config.heading}
          labelAccessibilityVisibility="exclusive"
          name="tip"
          variant="inline"
          values={[choice]}
          disabled={busy}
          onChange={onChoice}
        >
          {config.presets.map((value) => (
            <s-choice key={value} value={`preset:${value}`} selected={choice === `preset:${value}`}>
              {presetLabel(value)}
            </s-choice>
          ))}
          {config.allowCustom ? (
            <s-choice value="custom" selected={choice === "custom"}>
              {t("custom")}
            </s-choice>
          ) : null}
          <s-choice value="none" selected={choice === "none"}>
            {t("noTip")}
          </s-choice>
        </s-choice-list>

        {choice === "custom" ? (
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-money-field
              label={t("customLabel")}
              value={custom}
              min={0.01}
              max={config.maxTip}
              step={0.01}
              onInput={(e) => setCustom(e.currentTarget.value)}
              onChange={(e) => setCustom(e.currentTarget.value)}
            />
            <s-button variant="secondary" loading={busy} onClick={onCustomSubmit}>
              {t("update")}
            </s-button>
          </s-stack>
        ) : null}

        {message ? <s-banner tone={message.tone}>{message.text}</s-banner> : null}
      </s-stack>
    </s-section>
  );
}
