/**
 * Ascent collection page (sections/ap-main-collection.liquid).
 *
 * <ap-collection> enhances the plain GET filter form:
 * - Desktop: ticking a filter or changing the sort re-renders the section in place.
 * - Mobile: filters open in a modal bottom sheet (<dialog>); choices apply on
 *   "Apply filters". Closing without applying restores the rendered state.
 * - Filter pills, "Clear all" and pagination-free links re-render in place.
 * The section is fetched through the Section Rendering API and swapped into
 * [data-plp-root]; the URL is kept in sync so back/forward work.
 */

const DESKTOP_QUERY = '(min-width: 990px)';

class ApCollection extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abort;
  /** @type {AbortController | undefined} */
  #request;
  /** @type {MediaQueryList | undefined} */
  #desktop;
  /** Serialized form state when the sheet opened; null when not tracking. @type {string | null} */
  #initialState = null;

  connectedCallback() {
    this.#abort = new AbortController();
    const { signal } = this.#abort;

    this.#desktop = window.matchMedia(DESKTOP_QUERY);
    this.#desktop.addEventListener('change', () => this.#onBreakpointChange(), { signal });

    this.addEventListener('change', (event) => this.#onChange(event), { signal });
    this.addEventListener('input', () => this.#onInput(), { signal });
    this.addEventListener('submit', (event) => this.#onSubmit(event), { signal });
    this.addEventListener('click', (event) => this.#onClick(event), { signal });
    this.addEventListener('close', (event) => this.#onDialogClose(event), { signal, capture: true });
    window.addEventListener('popstate', () => this.renderUrl(window.location.href, { push: false }), { signal });
  }

  disconnectedCallback() {
    this.#abort?.abort();
    this.#request?.abort();
  }

  get sectionId() {
    return this.dataset.sectionId ?? '';
  }

  /** @returns {HTMLElement | null} */
  get root() {
    return this.querySelector('[data-plp-root]');
  }

  /** @returns {HTMLFormElement | null} */
  get form() {
    return this.querySelector('form[data-plp-form]');
  }

  /** @returns {HTMLDialogElement | null} */
  get dialog() {
    return this.querySelector('dialog.ap-plp__filters');
  }

  /** @returns {HTMLButtonElement | null} */
  get applyButton() {
    return this.querySelector('[data-plp-apply]');
  }

  get isDesktop() {
    return Boolean(this.#desktop?.matches);
  }

  /** Opens the mobile filter sheet. */
  openFilters() {
    const dialog = this.dialog;
    if (!dialog || dialog.open || this.isDesktop) return;
    this.#initialState = this.#serialize();
    this.#updateApplyState();
    dialog.showModal();
  }

  /** Closes the mobile filter sheet. */
  closeFilters() {
    const dialog = this.dialog;
    if (dialog?.open) dialog.close();
  }

  /** Applies the current form state. */
  apply() {
    const form = this.form;
    if (!form) return;
    const url = new URL(form.action, window.location.origin);
    url.search = this.#serialize();
    this.renderUrl(url.toString());
  }

  /**
   * Fetches the section for a collection URL and swaps it in.
   * @param {string} href
   * @param {{ push?: boolean }} [options]
   */
  async renderUrl(href, { push = true } = {}) {
    const root = this.root;
    if (!root || !this.sectionId) {
      window.location.assign(href);
      return;
    }

    this.#request?.abort();
    const request = new AbortController();
    this.#request = request;

    const pageUrl = new URL(href, window.location.origin);
    pageUrl.searchParams.delete('page');
    const fetchUrl = new URL(pageUrl);
    fetchUrl.searchParams.set('section_id', this.sectionId);

    const restoreFocus = this.#focusKey();
    const dialog = this.dialog;
    if (dialog?.open) {
      this.#initialState = null;
      dialog.close();
    }
    root.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(fetchUrl, { signal: request.signal });
      if (!response.ok) throw new Error(`Section request failed: ${response.status}`);
      const html = await response.text();
      if (request.signal.aborted) return;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nextRoot = doc.querySelector('[data-plp-root]');
      if (!nextRoot) throw new Error('Section response has no [data-plp-root]');

      root.replaceChildren(...Array.from(nextRoot.childNodes, (node) => document.importNode(node, true)));
      if (push) window.history.pushState({ apCollection: true }, '', pageUrl);
      this.#announce();
      this.#restoreFocus(restoreFocus);
    } catch (error) {
      if (request.signal.aborted) return;
      console.error(error);
      window.location.assign(pageUrl);
    } finally {
      if (this.#request === request) {
        root.removeAttribute('aria-busy');
        this.#request = undefined;
      }
    }
  }

  /** @param {Event} event */
  #onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

    if (target instanceof HTMLSelectElement && target.matches('[data-plp-sort]')) {
      const label = this.querySelector('[data-plp-sort-label]');
      if (label) label.textContent = target.selectedOptions[0]?.textContent?.trim() ?? '';
      this.apply();
      return;
    }
    if (!target.form?.matches('[data-plp-form]')) return;

    if (this.isDesktop) {
      this.apply();
    } else {
      this.#updateApplyState();
    }
  }

  #onInput() {
    if (!this.isDesktop) this.#updateApplyState();
  }

  /** @param {SubmitEvent} event */
  #onSubmit(event) {
    if (!(event.target instanceof HTMLFormElement) || !event.target.matches('[data-plp-form]')) return;
    event.preventDefault();
    this.apply();
  }

  /** @param {MouseEvent} event */
  #onClick(event) {
    if (!(event.target instanceof Element)) return;

    if (event.target.closest('[data-plp-open]')) {
      this.openFilters();
      return;
    }
    if (event.target.closest('[data-plp-close]')) {
      this.closeFilters();
      return;
    }

    const dialog = this.dialog;
    if (dialog?.open && event.target === dialog) {
      // Click on the backdrop area of the modal sheet.
      this.closeFilters();
      return;
    }

    const link = event.target.closest('a[data-plp-link]');
    if (link instanceof HTMLAnchorElement) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      this.renderUrl(link.href);
    }
  }

  /** @param {Event} event */
  #onDialogClose(event) {
    if (event.target !== this.dialog) return;
    // Drop unapplied choices so the sheet reopens in the rendered state.
    if (this.#initialState !== null) this.form?.reset();
    this.#initialState = null;
    this.querySelector('[data-plp-open]')?.focus?.();
  }

  #onBreakpointChange() {
    if (this.isDesktop) this.closeFilters();
  }

  #updateApplyState() {
    const button = this.applyButton;
    if (!button) return;
    button.disabled = this.#initialState !== null && this.#serialize() === this.#initialState;
  }

  /** @returns {string} */
  #serialize() {
    const form = this.form;
    if (!form) return '';
    const params = new URLSearchParams();
    const sort = /** @type {HTMLSelectElement | null} */ (this.querySelector('[data-plp-sort]'));
    for (const [name, value] of new FormData(form)) {
      if (typeof value !== 'string' || value === '') continue;
      // Keep URLs clean: the collection's default sort needs no parameter.
      if (name === 'sort_by' && sort && value === sort.dataset.default) continue;
      params.append(name, value);
    }
    return params.toString();
  }

  /** @returns {string | null} */
  #focusKey() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.contains(active)) return null;
    if (active.id) return `#${CSS.escape(active.id)}`;
    if (active instanceof HTMLAnchorElement && active.matches('.ap-plp__pill, .ap-plp__clear')) {
      return '[data-plp-sort], .ap-plp__filter-btn';
    }
    return null;
  }

  /** @param {string | null} selector */
  #restoreFocus(selector) {
    if (!selector) return;
    const candidates = /** @type {NodeListOf<HTMLElement>} */ (this.querySelectorAll(selector));
    const target = Array.from(candidates).find((element) => element.offsetParent !== null);
    target?.focus({ preventScroll: true });
  }

  #announce() {
    const status = this.querySelector('[data-plp-status]');
    const count = this.querySelector('[data-plp-count]');
    if (status && count) status.textContent = count.textContent?.trim() ?? '';
  }
}

if (!customElements.get('ap-collection')) {
  customElements.define('ap-collection', ApCollection);
}
