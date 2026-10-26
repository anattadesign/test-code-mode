/**
 * #WhatMovesYou community carousel (WAK-34): drag-to-scroll on pointer devices and
 * muted inline video playback while visible (posters only with prefers-reduced-motion).
 */
class AscentCommunity extends HTMLElement {
  connectedCallback() {
    this.rail = /** @type {HTMLElement | null} */ (this.querySelector('[data-rail]'));
    if (!this.rail) return;
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = /** @type {HTMLVideoElement} */ (entry.target);
          if (entry.isIntersecting && !this.motion?.matches) {
            video.preload = 'auto';
            video.muted = true;
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        }
      },
      { threshold: 0.25 }
    );
    this.videos.forEach((video) => {
      video.muted = true;
      video.removeAttribute('autoplay');
      this.observer?.observe(video);
    });
    this.motion.addEventListener('change', this.#onMotionChange);

    this.rail.addEventListener('pointerdown', this.#onPointerDown);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.motion?.removeEventListener('change', this.#onMotionChange);
    this.rail?.removeEventListener('pointerdown', this.#onPointerDown);
  }

  /** @returns {HTMLVideoElement[]} */
  get videos() {
    return [...this.querySelectorAll('video')];
  }

  #onMotionChange = () => {
    if (this.motion?.matches) this.videos.forEach((v) => v.pause());
    else this.videos.forEach((v) => { this.observer?.unobserve(v); this.observer?.observe(v); });
  };

  /** @param {PointerEvent} event */
  #onPointerDown = (event) => {
    const rail = this.rail;
    if (!rail || event.pointerType !== 'mouse' || event.button !== 0) return;
    const startX = event.clientX;
    const startLeft = rail.scrollLeft;
    let moved = false;

    /** @param {PointerEvent} e */
    const onMove = (e) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) {
        moved = true;
        rail.classList.add('is-dragging');
        rail.setPointerCapture(event.pointerId);
      }
      rail.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      rail.removeEventListener('pointermove', onMove);
      rail.removeEventListener('pointerup', onUp);
      rail.removeEventListener('pointercancel', onUp);
      rail.classList.remove('is-dragging');
    };
    rail.addEventListener('pointermove', onMove);
    rail.addEventListener('pointerup', onUp);
    rail.addEventListener('pointercancel', onUp);
  };
}

if (!customElements.get('ascent-community')) customElements.define('ascent-community', AscentCommunity);
