/**
 * Ascent Knowledge Center (WAK-33): tag tabs that filter the cards client-side, featured-card promotion
 * and a scroll-linked carousel nav (arrows + progress thumb).
 */
class AscentKnowledge extends HTMLElement {
  connectedCallback() {
    this.rail = /** @type {HTMLElement | null} */ (this.querySelector('[data-rail]'));
    this.nav = /** @type {HTMLElement | null} */ (this.querySelector('[data-nav]'));
    this.thumb = /** @type {HTMLElement | null} */ (this.querySelector('[data-thumb]'));
    this.prev = /** @type {HTMLButtonElement | null} */ (this.querySelector('[data-prev]'));
    this.next = /** @type {HTMLButtonElement | null} */ (this.querySelector('[data-next]'));
    if (!this.rail) return;

    const tabs = this.tabs;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-controls', this.rail?.id || '');
      if (!tab.id) tab.id = `${this.rail?.id}-tab-${i}`;
    });
    tabs[0] && this.rail.setAttribute('aria-labelledby', tabs[0].id);

    this.addEventListener('click', this.#onClick);
    this.addEventListener('keydown', this.#onKeydown);
    this.rail.addEventListener('scroll', this.#update, { passive: true });
    this.resizeObserver = new ResizeObserver(this.#update);
    this.resizeObserver.observe(this.rail);

    const initial = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];
    this.select(initial || null, false);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('keydown', this.#onKeydown);
    this.rail?.removeEventListener('scroll', this.#update);
    this.resizeObserver?.disconnect();
  }

  /** @returns {HTMLButtonElement[]} */
  get tabs() {
    return [...this.querySelectorAll('[role="tab"]')].filter((el) => el instanceof HTMLButtonElement);
  }

  /** @returns {HTMLElement[]} */
  get cards() {
    return [...this.querySelectorAll('.kc-card')].filter((el) => el instanceof HTMLElement);
  }

  /**
   * Activates a tab and filters the cards by its tag (empty tag = all).
   * @param {HTMLButtonElement | null} tab
   * @param {boolean} [focus]
   */
  select(tab, focus = true) {
    for (const t of this.tabs) {
      const active = t === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active || (!tab && t === this.tabs[0]) ? 0 : -1;
    }
    if (tab) {
      this.rail?.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    const tag = tab?.dataset.tag || '';
    let featured = false;
    for (const card of this.cards) {
      const tags = (card.dataset.tags || '').split(',').filter(Boolean);
      const visible = !tag || tags.includes(tag);
      card.hidden = !visible;
      card.classList.toggle('kc-card--featured', visible && !featured);
      if (visible) featured = true;
    }

    const empty = /** @type {HTMLElement | null} */ (this.querySelector('[data-empty]'));
    if (empty) empty.hidden = featured;

    if (this.rail) {
      this.rail.style.scrollBehavior = 'auto';
      this.rail.scrollLeft = 0;
      this.rail.style.scrollBehavior = '';
    }
    this.#update();
  }

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = /** @type {Element} */ (event.target);
    const tab = target.closest('[role="tab"]');
    if (tab instanceof HTMLButtonElement && this.contains(tab)) {
      this.select(tab, false);
      return;
    }
    if (target.closest('[data-prev]')) this.#scrollByCard(-1);
    else if (target.closest('[data-next]')) this.#scrollByCard(1);
  };

  /** @param {KeyboardEvent} event */
  #onKeydown = (event) => {
    const tab = /** @type {Element} */ (event.target).closest?.('[role="tab"]');
    if (!(tab instanceof HTMLButtonElement)) return;
    const tabs = this.tabs;
    const index = tabs.indexOf(tab);
    /** @type {Record<string, number>} */
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const nextIndex = (moves[event.key] + tabs.length) % tabs.length;
    this.select(tabs[nextIndex] || null);
  };

  /** @param {1 | -1} direction */
  #scrollByCard(direction) {
    const rail = this.rail;
    if (!rail) return;
    const card = this.cards.find((c) => !c.hidden && !c.classList.contains('kc-card--featured')) || this.cards[0];
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    const step = (card?.getBoundingClientRect().width || rail.clientWidth * 0.8) + gap;
    rail.scrollBy({ left: direction * step });
  }

  #update = () => {
    const rail = this.rail;
    if (!rail || !this.nav) return;
    const max = rail.scrollWidth - rail.clientWidth;
    const overflow = max > 2;
    this.nav.hidden = !overflow;
    if (!overflow) return;

    const ratio = Math.min(1, rail.clientWidth / rail.scrollWidth);
    const progress = Math.min(1, Math.max(0, rail.scrollLeft / max));
    const track = this.thumb?.parentElement?.clientWidth || 0;
    const thumbWidth = track * ratio;
    this.style.setProperty('--kc-thumb-width', `${thumbWidth}px`);
    this.style.setProperty('--kc-thumb-x', `${(track - thumbWidth) * progress}px`);
    if (this.prev) this.prev.disabled = rail.scrollLeft <= 1;
    if (this.next) this.next.disabled = rail.scrollLeft >= max - 1;
  };
}

if (!customElements.get('ascent-knowledge')) customElements.define('ascent-knowledge', AscentKnowledge);
