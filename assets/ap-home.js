/**
 * Ascent homepage behaviours.
 * - <ap-rail-scroller>: horizontal rail with prev/next buttons and a progress thumb.
 * - <ap-filter-tabs>: tab buttons that filter rail items by topic.
 * - <ap-video-card>: plays an inline video when its button is pressed.
 */

class ApRailScroller extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abort;
  /** @type {ResizeObserver | undefined} */
  #resizeObserver;
  #frame = 0;

  connectedCallback() {
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    const rail = this.rail;
    if (!rail) return;

    rail.addEventListener('scroll', () => this.#schedule(), { passive: true, signal });
    this.prevButton?.addEventListener('click', () => this.scrollByPage(-1), { signal });
    this.nextButton?.addEventListener('click', () => this.scrollByPage(1), { signal });

    this.#resizeObserver = new ResizeObserver(() => this.#schedule());
    this.#resizeObserver.observe(rail);
    this.#schedule();
  }

  disconnectedCallback() {
    this.#abort?.abort();
    this.#resizeObserver?.disconnect();
    cancelAnimationFrame(this.#frame);
  }

  /** @returns {HTMLElement | null} */
  get rail() {
    return this.querySelector('[data-rail]');
  }

  /** @returns {HTMLButtonElement | null} */
  get prevButton() {
    return this.querySelector('[data-rail-prev]');
  }

  /** @returns {HTMLButtonElement | null} */
  get nextButton() {
    return this.querySelector('[data-rail-next]');
  }

  /** @param {number} direction */
  scrollByPage(direction) {
    const rail = this.rail;
    if (!rail) return;
    const item = /** @type {HTMLElement | null} */ (rail.querySelector(':scope > :not([hidden])'));
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    const step = item ? item.offsetWidth + gap : rail.clientWidth * 0.8;
    const isRtl = getComputedStyle(rail).direction === 'rtl';
    rail.scrollBy({ left: step * direction * (isRtl ? -1 : 1), behavior: 'smooth' });
  }

  refresh() {
    this.#schedule();
  }

  #schedule() {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#update());
  }

  #update() {
    const rail = this.rail;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    const scrollable = max > 2;
    const nav = /** @type {HTMLElement | null} */ (this.querySelector('[data-rail-nav]'));
    if (nav) nav.hidden = !scrollable;

    const position = Math.abs(rail.scrollLeft);
    const ratio = scrollable ? position / max : 0;
    const size = scrollable ? Math.max(rail.clientWidth / rail.scrollWidth, 0.1) : 1;
    const track = /** @type {HTMLElement | null} */ (this.querySelector('[data-rail-track]'));
    if (track) {
      const trackWidth = track.clientWidth;
      track.style.setProperty('--ap-thumb-size', `${size * 100}%`);
      track.style.setProperty('--ap-thumb-offset', `${ratio * trackWidth * (1 - size)}px`);
    }
    if (this.prevButton) this.prevButton.disabled = !scrollable || position <= 2;
    if (this.nextButton) this.nextButton.disabled = !scrollable || position >= max - 2;
  }
}

class ApFilterTabs extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abort;

  connectedCallback() {
    this.#abort = new AbortController();
    this.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-filter-tab]') : null;
        if (target instanceof HTMLButtonElement) this.select(target);
      },
      { signal: this.#abort.signal }
    );
  }

  disconnectedCallback() {
    this.#abort?.abort();
  }

  /** @param {HTMLButtonElement} tab */
  select(tab) {
    const deselect = tab.getAttribute('aria-pressed') === 'true';
    const topic = deselect ? '' : (tab.dataset.filterTab ?? '');
    for (const button of this.querySelectorAll('[data-filter-tab]')) {
      button.setAttribute('aria-pressed', String(!deselect && button === tab));
    }
    for (const item of this.querySelectorAll('[data-topic]')) {
      if (!(item instanceof HTMLElement)) continue;
      const topics = (item.dataset.topic ?? '').split(',').map((value) => value.trim());
      item.hidden = topic !== '' && !topics.includes(topic);
    }
    const rail = this.querySelector('[data-rail]');
    if (rail) rail.scrollTo({ left: 0 });
    const scroller = this.querySelector('ap-rail-scroller');
    if (scroller instanceof ApRailScroller) scroller.refresh();
  }
}

class ApVideoCard extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abort;

  connectedCallback() {
    this.#abort = new AbortController();
    const button = this.querySelector('[data-video-play]');
    button?.addEventListener('click', () => this.play(), { signal: this.#abort.signal });
  }

  disconnectedCallback() {
    this.#abort?.abort();
  }

  play() {
    const template = this.querySelector('template');
    if (!template) return;
    const content = template.content.cloneNode(true);
    this.querySelector('[data-video-target]')?.replaceChildren(content);
    this.setAttribute('playing', '');
    const media = this.querySelector('video');
    if (media) media.play().catch(() => {});
  }
}

if (!customElements.get('ap-rail-scroller')) customElements.define('ap-rail-scroller', ApRailScroller);
if (!customElements.get('ap-filter-tabs')) customElements.define('ap-filter-tabs', ApFilterTabs);
if (!customElements.get('ap-video-card')) customElements.define('ap-video-card', ApVideoCard);
