/*
 * AP-62 · Collection browser behaviour (sections/ap-collection-browser.liquid)
 *
 * - Filters, sort and pagination update the grid in place via the Section Rendering
 *   API (?section_id=…) and keep the URL in sync (back/forward supported).
 * - Mobile: the sidebar is a drawer (focus moves in, Escape / backdrop closes,
 *   focus returns to the Filters button).
 * Without JS everything still works: the form submits, links navigate.
 */
(() => {
  if (customElements.get('ap-collection-browser')) return;

  const MOBILE = window.matchMedia('(max-width: 749px)');

  class ApCollectionBrowser extends HTMLElement {
    connectedCallback() {
      this.sectionId = this.dataset.sectionId;
      this.abort = null;
      this.debounceTimer = null;

      this.addEventListener('change', this.onChange);
      this.addEventListener('input', this.onInput);
      this.addEventListener('click', this.onClick);
      this.addEventListener('submit', this.onSubmit);
      this.addEventListener('keydown', this.onKeydown);

      this.onPopState = this.onPopState.bind(this);
      window.addEventListener('popstate', this.onPopState);
    }

    disconnectedCallback() {
      window.removeEventListener('popstate', this.onPopState);
    }

    get form() {
      return this.querySelector('[data-apcb-form]');
    }

    get drawer() {
      return this.querySelector('[data-apcb-drawer]');
    }

    /* ---------- Events ---------- */

    onChange = (event) => {
      const target = event.target;

      if (target.matches('[data-apcb-sort]')) {
        const hidden = this.querySelector('[data-apcb-sort-input]');
        if (hidden) hidden.value = target.value;
        const label = this.querySelector('[data-apcb-sort-label]');
        if (label) {
          const prefix = label.textContent.split(' ')[0];
          label.textContent = `${prefix} ${target.selectedOptions[0]?.textContent.trim() ?? ''}`;
        }
        this.update(this.formParams(target.value));
        return;
      }

      if (target.closest('[data-apcb-form]') && !target.matches('[data-apcb-debounce]')) {
        this.update(this.formParams());
      }
    };

    onInput = (event) => {
      if (!event.target.matches('[data-apcb-debounce]')) return;
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.update(this.formParams()), 600);
    };

    onSubmit = (event) => {
      if (!event.target.matches('[data-apcb-form]')) return;
      event.preventDefault();
      this.update(this.formParams());
    };

    onClick = (event) => {
      const link = event.target.closest('a[data-apcb-link]');
      if (link) {
        event.preventDefault();
        const url = new URL(link.href, window.location.origin);
        this.update(url.searchParams, { scroll: link.closest('.apcb__pagination') !== null });
        return;
      }

      if (event.target.closest('[data-apcb-open]')) {
        this.openDrawer();
        return;
      }

      if (event.target.closest('[data-apcb-close]')) {
        this.closeDrawer();
      }
    };

    onKeydown = (event) => {
      if (event.key === 'Escape' && this.drawer?.hasAttribute('data-open')) {
        event.stopPropagation();
        this.closeDrawer();
      }
    };

    onPopState() {
      this.update(new URL(window.location.href).searchParams, { push: false });
    }

    /* ---------- Drawer ---------- */

    openDrawer() {
      const drawer = this.drawer;
      if (!drawer) return;
      drawer.setAttribute('data-open', '');
      if (MOBILE.matches) {
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        document.documentElement.style.overflow = 'hidden';
      }
      this.querySelector('.apcb__backdrop')?.removeAttribute('hidden');
      this.querySelector('[data-apcb-open]')?.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => drawer.querySelector('.apcb__drawer-close')?.focus());
    }

    closeDrawer() {
      const drawer = this.drawer;
      if (!drawer || !drawer.hasAttribute('data-open')) return;
      drawer.removeAttribute('data-open');
      drawer.removeAttribute('role');
      drawer.removeAttribute('aria-modal');
      document.documentElement.style.overflow = '';
      this.querySelector('.apcb__backdrop')?.setAttribute('hidden', '');
      const toggle = this.querySelector('[data-apcb-open]');
      toggle?.setAttribute('aria-expanded', 'false');
      toggle?.focus();
    }

    /* ---------- Rendering ---------- */

    formParams(sortValue) {
      const params = new URLSearchParams();
      const form = this.form;
      if (form) {
        for (const [key, value] of new FormData(form)) {
          if (value !== '') params.append(key, value);
        }
      }
      const sort = sortValue ?? this.querySelector('[data-apcb-sort]')?.value;
      if (sort) params.set('sort_by', sort);
      return params;
    }

    async update(params, { push = true, scroll = false } = {}) {
      params.delete('section_id');
      const query = params.toString();
      const pageUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
      const fetchUrl = `${window.location.pathname}?${query ? `${query}&` : ''}section_id=${this.sectionId}`;

      this.abort?.abort();
      this.abort = new AbortController();
      this.setAttribute('aria-busy', 'true');

      try {
        const response = await fetch(fetchUrl, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = new DOMParser().parseFromString(await response.text(), 'text/html');
        this.swap(html);
        if (push) history.pushState({ apcb: true }, '', pageUrl);
        if (scroll) this.querySelector('.apcb__results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        if (error.name !== 'AbortError') window.location.href = pageUrl;
      } finally {
        this.removeAttribute('aria-busy');
      }
    }

    swap(html) {
      const fresh = html.querySelector('ap-collection-browser');
      if (!fresh) return;

      const focusedId = document.activeElement?.id;

      const pairs = ['[data-apcb-results]', '[data-apcb-filters]', '[data-apcb-count]', '[data-apcb-active-count]', '[data-apcb-count-number]'];
      for (const selector of pairs) {
        const current = this.querySelector(selector);
        const next = fresh.querySelector(selector);
        if (current && next) current.innerHTML = next.innerHTML;
      }

      const sortInput = this.querySelector('[data-apcb-sort-input]');
      const freshSortInput = fresh.querySelector('[data-apcb-sort-input]');
      if (sortInput && freshSortInput) sortInput.value = freshSortInput.value;

      if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
    }
  }

  customElements.define('ap-collection-browser', ApCollectionBrowser);
})();
