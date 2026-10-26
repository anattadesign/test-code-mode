import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';
import { formatMoney } from '@theme/money-formatting';

/**
 * @typedef {{ id: number, available: boolean, price: number, options: string[], allocations: Record<string, number> }} MembershipVariant
 * @typedef {{ id: number, requiresPlan: boolean, selectedVariantId: number, plans: { id: number, name: string }[], variants: MembershipVariant[] }} MembershipProduct
 * @typedef {{ moneyFormat: string, currency: string, cartUrl: string, planId: number | null, products: MembershipProduct[] }} MembershipData
 */

/**
 * Ascent "Membership · Bundle" purchase module (WAK-31).
 * Subscribe vs one-time, plan + flavour selection, live prices and a multi-line Cart AJAX add.
 */
class AscentMembership extends HTMLElement {
  /** @type {MembershipData | null} */
  data = null;
  /** @type {MembershipVariant | null} */
  variant = null;
  /** @type {string | null} */
  planId = null;

  connectedCallback() {
    const json = this.querySelector('script[data-membership-data]');
    if (!json) return;
    try {
      this.data = JSON.parse(json.textContent || '{}');
    } catch (error) {
      console.error('ascent-membership: invalid data', error);
      return;
    }

    const primary = this.primary;
    if (!primary) return;
    this.variant = primary.variants.find((v) => v.id === primary.selectedVariantId) || primary.variants[0] || null;
    this.planId = this.data?.planId != null ? String(this.data.planId) : this.#bestPlanId();

    this.addEventListener('change', this.#onChange);
    this.querySelector('[data-add-to-cart]')?.addEventListener('click', this.#onAdd);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener('change', this.#onChange);
    this.querySelector('[data-add-to-cart]')?.removeEventListener('click', this.#onAdd);
  }

  /** @returns {MembershipProduct | undefined} */
  get primary() {
    return this.data?.products[0];
  }

  /** @returns {MembershipProduct | undefined} */
  get second() {
    return this.data?.products[1];
  }

  /** @returns {'subscribe' | 'onetime'} */
  get mode() {
    const checked = /** @type {HTMLInputElement | null} */ (
      this.querySelector('input.ascent-membership__radio:checked')
    );
    if (checked) return checked.value === 'subscribe' ? 'subscribe' : 'onetime';
    return this.dataset.mode === 'subscribe' ? 'subscribe' : 'onetime';
  }

  /** Plan with the biggest discount for the current variant. */
  #bestPlanId() {
    const variant = this.variant;
    const plans = this.primary?.plans || [];
    let best = null;
    let bestSaving = -1;
    for (const plan of plans) {
      const price = variant?.allocations[plan.id];
      if (price == null || !variant) continue;
      const saving = variant.price - price;
      if (saving > bestSaving) {
        bestSaving = saving;
        best = String(plan.id);
      }
    }
    return best;
  }

  /**
   * Selling plan to use for the second product: same plan id, then same plan name.
   * Falls back to its first plan only when that product can't be bought without one.
   * @returns {{ variant: MembershipVariant, planId: string | null } | null}
   */
  #secondLine(mode = this.mode) {
    const second = this.second;
    if (!second) return null;
    const variant = second.variants.find((v) => v.id === second.selectedVariantId) || second.variants[0];
    if (!variant) return null;

    let planId = null;
    if (mode === 'subscribe' && this.planId) {
      if (variant.allocations[this.planId] != null) {
        planId = this.planId;
      } else {
        const name = this.primary?.plans.find((p) => String(p.id) === this.planId)?.name;
        const match = second.plans.find((p) => p.name === name && variant.allocations[p.id] != null);
        if (match) planId = String(match.id);
      }
    }
    if (!planId && second.requiresPlan && second.plans[0]) planId = String(second.plans[0].id);
    return { variant, planId };
  }

  /** @param {number} cents */
  #money(cents) {
    const data = this.data;
    return formatMoney(cents, data?.moneyFormat || '${{amount}}', data?.currency || 'USD');
  }

  /** @param {number} cents */
  #moneyShort(cents) {
    return this.#money(cents).replace(/[.,]00(?=\D*$)/, '');
  }

  #totals() {
    const variant = this.variant;
    let onetime = variant?.price ?? 0;
    let subscribe = variant && this.planId != null ? variant.allocations[this.planId] ?? variant.price : onetime;

    const asOneTime = this.#secondLine('onetime');
    const asSubscriber = this.#secondLine('subscribe');
    if (asOneTime && asSubscriber) {
      onetime += asOneTime.variant.price;
      const planPrice = asSubscriber.planId ? asSubscriber.variant.allocations[asSubscriber.planId] : undefined;
      subscribe += planPrice ?? asSubscriber.variant.price;
    }

    const savings = Math.max(0, onetime - subscribe);
    const percent = onetime > 0 ? Math.round((savings / onetime) * 100) : 0;
    return { onetime, subscribe, savings, percent };
  }

  /** @param {string} template @param {{ percent: number, savings: number }} totals */
  #fill(template, totals) {
    return template
      .replaceAll('[percent]', `${totals.percent}%`)
      .replaceAll('[savings]', this.#moneyShort(totals.savings));
  }

  render() {
    const totals = this.#totals();
    const mode = this.mode;
    const suffix = this.dataset.suffix || '';
    const hasDiscount = totals.savings > 0;

    this.#setText('[data-price="sub"]', `${this.#money(totals.subscribe)}${suffix}`);
    this.#setText('[data-price="sub-compare"]', `${this.#money(totals.onetime)}${suffix}`, !hasDiscount);
    this.#setText('[data-price="onetime"]', this.#money(totals.onetime));
    this.#setText('[data-price="total-compare"]', this.#money(totals.onetime), mode !== 'subscribe' || !hasDiscount);
    this.#setText(
      '[data-price="total"]',
      mode === 'subscribe' ? `${this.#money(totals.subscribe)}${suffix}` : this.#money(totals.onetime)
    );

    const label = /** @type {HTMLElement | null} */ (this.querySelector('[data-subscribe-label]'));
    if (label) {
      label.textContent =
        totals.percent > 0
          ? this.#fill(label.dataset.subscribeLabel || '', totals)
          : label.dataset.subscribeFallback || '';
    }

    for (const badge of /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll('[data-badge]'))) {
      const template = badge.dataset.badge || '';
      const dynamic = template.includes('[');
      const onOption = Boolean(badge.closest('.ascent-membership__option'));
      badge.textContent = this.#fill(template, totals);
      badge.hidden = dynamic && (!hasDiscount || (!onOption && mode !== 'subscribe'));
    }

    const select = /** @type {HTMLSelectElement | null} */ (this.querySelector('select[name="plan"]'));
    if (select && this.planId) select.value = this.planId;

    const button = /** @type {HTMLButtonElement | null} */ (this.querySelector('[data-add-to-cart]'));
    const buttonLabel = this.querySelector('[data-button-label]');
    if (button && buttonLabel) {
      const available = Boolean(this.variant?.available);
      button.disabled = !available;
      buttonLabel.textContent = !this.variant
        ? button.dataset.unavailable || ''
        : available
        ? button.dataset.label || ''
        : button.dataset.soldOut || '';
    }
  }

  /** @param {string} selector @param {string} text @param {boolean} [hidden] */
  #setText(selector, text, hidden = false) {
    const el = /** @type {HTMLElement | null} */ (this.querySelector(selector));
    if (!el) return;
    el.textContent = text;
    el.hidden = hidden;
  }

  /** @param {Event} event */
  #onChange = (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.name === 'plan') {
      this.planId = target.value;
      const subscribe = /** @type {HTMLInputElement | null} */ (this.querySelector('input[value="subscribe"]'));
      if (subscribe) subscribe.checked = true;
    } else if (target instanceof HTMLInputElement && target.dataset.optionIndex != null) {
      const selected = [...this.querySelectorAll('input[data-option-index]:checked')].map(
        (input) => /** @type {HTMLInputElement} */ (input).value
      );
      this.variant =
        this.primary?.variants.find((v) => v.options.every((value, i) => value === selected[i])) || null;
      if (this.variant && this.planId && this.variant.allocations[this.planId] == null) {
        this.planId = this.#bestPlanId();
      }
    }
    this.#hideError();
    this.render();
  };

  /** @param {string} message */
  #showError(message) {
    const el = /** @type {HTMLElement | null} */ (this.querySelector('[data-error-message]'));
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  #hideError() {
    const el = /** @type {HTMLElement | null} */ (this.querySelector('[data-error-message]'));
    if (el) el.hidden = true;
  }

  #onAdd = async () => {
    const button = /** @type {HTMLButtonElement | null} */ (this.querySelector('[data-add-to-cart]'));
    if (!this.variant || !this.variant.available || button?.getAttribute('aria-busy') === 'true') return;

    const subscribe = this.mode === 'subscribe' && this.planId;
    /** @type {{ id: number, quantity: number, selling_plan?: number }[]} */
    const items = [{ id: this.variant.id, quantity: 1 }];
    if (subscribe) items[0].selling_plan = Number(this.planId);

    const second = this.#secondLine();
    if (second) {
      const line = { id: second.variant.id, quantity: 1 };
      if (second.planId) line.selling_plan = Number(second.planId);
      items.push(line);
    }

    const sectionIds = [...document.querySelectorAll('cart-items-component')]
      .map((el) => (el instanceof HTMLElement ? el.dataset.sectionId : ''))
      .filter(Boolean);

    const deferred = CartLinesUpdateEvent.createPromise();
    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: items.map((item) => ({ merchandiseId: String(item.id), quantity: item.quantity })),
        promise: deferred.promise,
      })
    );

    button?.setAttribute('aria-busy', 'true');
    this.#hideError();
    const fallbackError = button?.dataset.error || 'Error adding to cart';

    try {
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items, sections: sectionIds.join(',') }),
      });
      const result = await response.json();
      const cart = await this.#fetchCart();

      if (!response.ok || result.status) {
        const message = result.description || result.message || fallbackError;
        this.#showError(message);
        this.dispatchEvent(new CartErrorEvent({ error: message, code: 'INVALID', detail: { errors: result.errors } }));
        deferred.resolve({
          cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
          detail: { didError: true, items: cart.items, source: 'ascent-membership', sourceId: this.dataset.sectionId },
        });
        return;
      }

      deferred.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          didError: false,
          items: cart.items,
          itemCount: items.length,
          sections: result.sections,
          source: 'ascent-membership',
          sourceId: this.dataset.sectionId,
          productId: String(this.primary?.id ?? ''),
        },
      });
      this.#openCart();
    } catch (error) {
      console.error(error);
      this.#showError(fallbackError);
      deferred.reject(error);
      this.dispatchEvent(new CartErrorEvent({ error: fallbackError, code: 'SERVICE_UNAVAILABLE' }));
    } finally {
      button?.removeAttribute('aria-busy');
    }
  };

  async #fetchCart() {
    const response = await fetch(`${Theme.routes.cart_url}.js`, { headers: { Accept: 'application/json' } });
    return response.json();
  }

  #openCart() {
    const drawer = /** @type {(HTMLElement & { open?: () => void, isOpen?: boolean }) | null | undefined} */ (
      document.querySelector('cart-drawer-component')?.closest('theme-drawer')
    );
    if (drawer && typeof drawer.open === 'function') {
      // Let the cart items morph from the resolved event before opening.
      requestAnimationFrame(() => {
        if (!drawer.isOpen) drawer.open?.();
      });
    } else {
      window.location.href = this.data?.cartUrl || Theme.routes.cart_url;
    }
  }
}

if (!customElements.get('ascent-membership')) customElements.define('ascent-membership', AscentMembership);
