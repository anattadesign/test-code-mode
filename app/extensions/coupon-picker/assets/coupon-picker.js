/* Coupon picker — theme app extension (cart page block + cart drawer embed).
 * Lists the coupons the current customer is eligible for (via the app proxy),
 * applies/removes them with the Cart AJAX API, and explains rejected codes.
 */
(() => {
  if (customElements.get('coupon-picker')) return;

  const STANDARD_EVENTS_URL = 'https://cdn.shopify.com/storefront/standard-events.js';
  const SYNC_EVENTS = ['shopify:cart:discount-update', 'shopify:cart:lines-update', 'cart:refresh'];

  /** Shared across every picker on the page so they stay in sync. */
  const store = {
    eligible: null,
    cartPromise: null,
    listeners: new Set(),
    loadEligible(root) {
      this.eligible ??= fetch(`${root}apps/coupons/eligible`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .catch(() => ({ coupons: [], loggedIn: false, failed: true }));
      return this.eligible;
    },
    loadCart(root, force = false) {
      if (force || !this.cartPromise) {
        this.cartPromise = fetch(`${root}cart.js`, { headers: { Accept: 'application/json' } }).then((r) => r.json());
      }
      return this.cartPromise;
    },
    setCart(cart) {
      this.cartPromise = Promise.resolve(cart);
      this.listeners.forEach((fn) => fn(cart));
    },
  };

  let standardEvents = null;
  const loadStandardEvents = () => (standardEvents ??= import(STANDARD_EVENTS_URL).catch(() => null));

  const formatMoney = (cents, format) => {
    const value = (cents / 100).toFixed(2);
    const [whole, decimals] = value.split('.');
    const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (format || '{{amount}}').replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
      switch (key) {
        case 'amount_no_decimals':
          return withCommas;
        case 'amount_with_comma_separator':
          return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
        case 'amount_no_decimals_with_comma_separator':
          return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        default:
          return `${withCommas}.${decimals}`;
      }
    });
  };

  class CouponPicker extends HTMLElement {
    connectedCallback() {
      if (!this.initialized) this.init();
      store.listeners.add(this.onCart);
      SYNC_EVENTS.forEach((name) => document.addEventListener(name, this.onExternal));
      Promise.all([store.loadEligible(this.root), store.loadCart(this.root)]).then(([eligible, cart]) => {
        this.eligible = eligible;
        this.render(cart);
      });
    }

    disconnectedCallback() {
      store.listeners.delete(this.onCart);
      SYNC_EVENTS.forEach((name) => document.removeEventListener(name, this.onExternal));
    }

    /** One-time setup; the element may be moved (drawer embed) and reconnected. */
    init() {
      this.initialized = true;
      this.root = this.dataset.root || '/';
      this.messages = JSON.parse(this.querySelector('[data-messages]')?.textContent || '{}');
      this.list = this.querySelector('[data-list]');
      this.messageEl = this.querySelector('[data-message]');
      this.form = this.querySelector('[data-form]');
      this.busy = false;

      this.form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = this.form.elements.namedItem('code');
        this.apply(input.value, input);
      });
      this.list.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-code]');
        if (!button) return;
        if (button.dataset.action === 'remove') this.remove(button.dataset.code);
        else this.apply(button.dataset.code);
      });

      this.onCart = (cart) => this.render(cart);
      this.onExternal = (event) => {
        if (this.busy) return; // our own update; the store is refreshed when it finishes
        // Wait for the other component's request to finish, then re-read the cart.
        Promise.resolve(event.promise)
          .catch(() => null)
          .then(() => store.loadCart(this.root, true))
          .then((cart) => store.setCart(cart));
      };
    }

    t(key, vars = {}) {
      let text = this.messages[key] || key;
      for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`%${k.toUpperCase()}%`, String(v));
      return text;
    }

    money(amount) {
      return formatMoney(Math.round(amount * 100), this.dataset.moneyFormat);
    }

    appliedCodes(cart) {
      return (cart.discount_codes || []).filter((d) => d.applicable).map((d) => d.code.toUpperCase());
    }

    render(cart) {
      if (!this.eligible) return;
      this.cart = cart;
      const applied = this.appliedCodes(cart);
      const subtotal = cart.items_subtotal_price / 100;
      const quantity = cart.item_count;
      const { coupons = [], loggedIn } = this.eligible;
      this.list.setAttribute('aria-busy', 'false');

      if (coupons.length === 0) {
        const hint = loggedIn || this.dataset.loggedIn === 'true' ? '' : ` ${this.t('login_hint')}`;
        this.list.innerHTML = '';
        const li = document.createElement('li');
        li.className = 'coupon-picker__empty';
        li.textContent = `${this.t('none')}${hint}`;
        this.list.append(li);
        return;
      }

      this.list.replaceChildren(
        ...coupons.map((c) => {
          const isApplied = applied.includes(c.code.toUpperCase());
          const short =
            (c.minimumSubtotal != null && subtotal < c.minimumSubtotal) ||
            (c.minimumQuantity != null && quantity < c.minimumQuantity);
          const li = document.createElement('li');
          li.className = `coupon-picker__item${isApplied ? ' is-applied' : ''}`;

          const info = document.createElement('div');
          info.className = 'coupon-picker__info';
          const add = (cls, text) => {
            const el = document.createElement('span');
            el.className = cls;
            el.textContent = text;
            info.append(el);
          };
          add('coupon-picker__code', c.code);
          add('coupon-picker__title', c.title);
          if (c.summary && c.summary !== c.title) add('coupon-picker__meta', c.summary);
          if (c.minimumSubtotal != null) {
            add(`coupon-picker__meta${short ? ' is-short' : ''}`, this.t('min_subtotal', { amount: this.money(c.minimumSubtotal) }));
          }
          if (c.minimumQuantity != null) {
            add(`coupon-picker__meta${short ? ' is-short' : ''}`, this.t('min_quantity', { count: c.minimumQuantity }));
          }
          if (c.endsAt) {
            add('coupon-picker__meta', this.t('ends_on', { date: new Date(c.endsAt).toLocaleDateString(document.documentElement.lang || undefined) }));
          }

          const button = document.createElement('button');
          button.type = 'button';
          button.className = `coupon-picker__button${isApplied ? ' coupon-picker__button--secondary' : ''}`;
          button.dataset.code = c.code;
          button.dataset.action = isApplied ? 'remove' : 'apply';
          button.textContent = isApplied ? this.t('remove') : this.t('apply');
          button.setAttribute('aria-label', `${button.textContent} ${c.code}`);
          button.disabled = this.busy;

          li.append(info, button);
          return li;
        }),
      );
    }

    showMessage(text, tone) {
      this.messageEl.textContent = text;
      this.messageEl.dataset.tone = tone;
      this.messageEl.hidden = false;
    }

    setBusy(busy) {
      this.busy = busy;
      this.toggleAttribute('aria-busy', busy);
      this.querySelectorAll('button').forEach((b) => (b.disabled = busy));
    }

    /** Update the cart's discount codes and let the theme refresh itself. */
    async updateDiscounts(codes) {
      const events = this.dataset.refresh === 'events' ? await loadStandardEvents() : null;
      const Evt = events?.CartDiscountUpdateEvent;
      const deferred = Evt?.createPromise?.();
      if (Evt && deferred) {
        try {
          const event = new Evt({ discountCodes: codes.map((code) => ({ code })), promise: deferred.promise });
          document.dispatchEvent(event);
        } catch {
          /* theme doesn't support standard events */
        }
      }
      try {
        const response = await fetch(`${this.root}cart/update.js`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ discount: codes.join(',') }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const cart = await response.json();
        deferred?.resolve({ cart: Evt.createCartFromAjaxResponse ? Evt.createCartFromAjaxResponse(cart) : null });
        store.setCart(cart);
        return cart;
      } catch (error) {
        deferred?.reject(error);
        throw error;
      }
    }

    async explain(code) {
      const cart = this.cart || (await store.loadCart(this.root));
      const params = new URLSearchParams({
        code,
        subtotal: (cart.items_subtotal_price / 100).toFixed(2),
        quantity: String(cart.item_count),
      });
      try {
        const r = await fetch(`${this.root}apps/coupons/check?${params}`, { headers: { Accept: 'application/json' } });
        const data = await r.json();
        return this.t(`msg_${data.reason}`, {
          code,
          amount: data.minimumSubtotal != null ? this.money(data.minimumSubtotal) : '',
          count: data.minimumQuantity ?? '',
        });
      } catch {
        return this.t('msg_error', { code });
      }
    }

    async apply(rawCode, input) {
      const code = String(rawCode || '').trim().toUpperCase();
      if (!code || this.busy) return;
      if (!/^[A-Z0-9_-]{1,255}$/.test(code)) {
        this.showMessage(this.t('msg_not_found', { code }), 'error');
        return;
      }
      const current = await store.loadCart(this.root);
      const existing = (current.discount_codes || []).map((d) => d.code.toUpperCase());
      if (this.appliedCodes(current).includes(code)) {
        this.showMessage(this.t('msg_already', { code }), 'info');
        return;
      }

      this.setBusy(true);
      try {
        const keep = existing.filter((c) => c !== code && this.appliedCodes(current).includes(c));
        const cart = await this.updateDiscounts([...keep, code]);
        const entry = (cart.discount_codes || []).find((d) => d.code.toUpperCase() === code);
        if (entry?.applicable) {
          this.showMessage(this.t('msg_applied', { code }), 'success');
          if (input) input.value = '';
          if (this.dataset.refresh === 'reload') window.location.reload();
        } else {
          // Don't leave a code that doesn't apply sitting on the cart.
          if (entry) await this.updateDiscounts(keep);
          this.showMessage(await this.explain(code), 'error');
        }
      } catch {
        this.showMessage(this.t('msg_error', { code }), 'error');
      } finally {
        this.setBusy(false);
        this.render(await store.loadCart(this.root));
      }
    }

    async remove(code) {
      if (this.busy) return;
      this.setBusy(true);
      try {
        const current = await store.loadCart(this.root);
        const keep = this.appliedCodes(current).filter((c) => c !== code.toUpperCase());
        await this.updateDiscounts(keep);
        this.showMessage(this.t('msg_removed', { code }), 'info');
        if (this.dataset.refresh === 'reload') window.location.reload();
      } catch {
        this.showMessage(this.t('msg_error', { code }), 'error');
      } finally {
        this.setBusy(false);
        this.render(await store.loadCart(this.root));
      }
    }
  }

  customElements.define('coupon-picker', CouponPicker);

  /* Cart drawer embed: keep one picker inside the drawer, even after re-renders. */
  const template = document.querySelector('template[data-coupon-picker-embed]');
  if (!template) return;
  const selector = template.dataset.target;
  const position = template.dataset.position || 'afterbegin';
  let node = null;

  const mount = () => {
    if (!selector) return;
    let target;
    try {
      target = document.querySelector(selector);
    } catch {
      return; // invalid selector in settings
    }
    if (!target) return;
    const inPlace =
      node?.isConnected &&
      (position === 'beforebegin' ? target.previousElementSibling === node : target.contains(node));
    if (inPlace) return;
    node ??= template.content.firstElementChild.cloneNode(true);
    target.insertAdjacentElement(position, node);
  };

  mount();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      mount();
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
