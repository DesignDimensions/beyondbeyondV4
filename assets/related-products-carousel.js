/**
 * Related products rail.
 *
 * One rail of product cards with an arrow either side. The rail is a native
 * scroll box — a swipe on a phone and a trackpad on a desktop already move it —
 * so the arrows only have to step it on by a card and say when there is nothing
 * left in that direction.
 *
 * The one thing this has to do that the other rails do not: wait. Its markup is
 * not on the page when the page loads. <product-recommendations> fetches the
 * section once it comes into view and writes the result back in as innerHTML,
 * so on a normal product page the rail simply does not exist yet at boot, and a
 * script written in with it would never have run anyway. Each recommendations
 * element is therefore watched, and the rail is picked up when it lands.
 */
(function () {
  'use strict';

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function RelatedRail(root) {
    this.root = root;
    this.rail = root.querySelector('[data-rp-rail]');
    if (!this.rail) return;

    this.prev = root.querySelector('[data-rp-arrow="prev"]');
    this.next = root.querySelector('[data-rp-arrow="next"]');

    this.onScroll = this.updateArrows.bind(this);
    this.onResize = this.updateArrows.bind(this);

    this.bind();
    this.updateArrows();

    // Cards are sized off the laid-out column and the images arrive after the
    // markup, so the rail's own width is only final once they have.
    if (document.fonts && document.fonts.ready) {
      var self = this;
      document.fonts.ready.then(function () {
        self.updateArrows();
      });
    }

    this.ready = true;
  }

  RelatedRail.prototype.bind = function () {
    var self = this;

    [this.prev, this.next].forEach(function (button) {
      if (!button) return;
      button.addEventListener('click', function () {
        self.page(button.dataset.rpArrow === 'next' ? 1 : -1);
      });
    });

    this.rail.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);
  };

  // One card plus the gap between them: the step the row was built on, so a
  // press always lands the next card where the last one started.
  RelatedRail.prototype.page = function (direction) {
    var card = this.rail.querySelector('.rp__card');
    var step = card ? card.offsetWidth : this.rail.clientWidth;
    var gap = parseFloat(getComputedStyle(this.rail).columnGap) || 0;

    this.rail.scrollBy({
      left: direction * (step + gap),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  };

  RelatedRail.prototype.updateArrows = function () {
    if (!this.prev || !this.next) return;

    var max = this.rail.scrollWidth - this.rail.clientWidth;
    this.prev.classList.toggle('is-disabled', this.rail.scrollLeft <= 1);
    this.next.classList.toggle('is-disabled', this.rail.scrollLeft >= max - 1);
  };

  RelatedRail.prototype.destroy = function () {
    this.rail.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    this.ready = false;
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-rp]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.rpInstance) return;
      root.rpInstance = new RelatedRail(root);
    });
  }

  // The recommendations are fetched and written in later, so what is watched is
  // the element they are written into rather than the rail, which is not there
  // to be watched yet. One observer per element, left running: the theme editor
  // can refill the same element more than once.
  function watch(scope) {
    var hosts = (scope || document).querySelectorAll('product-recommendations');
    Array.prototype.forEach.call(hosts, function (host) {
      if (host.rpWatched || typeof MutationObserver !== 'function') return;
      host.rpWatched = true;

      new MutationObserver(function () {
        init(host);
      }).observe(host, { childList: true });
    });
  }

  function boot(scope) {
    watch(scope);
    // Rendered with the section rather than fetched — the theme editor does
    // this — in which case there is nothing to wait for.
    init(scope);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      boot(document);
    });
  } else {
    boot(document);
  }

  document.addEventListener('shopify:section:load', function (event) {
    boot(event.target);
  });

  document.addEventListener('shopify:section:unload', function (event) {
    var root = event.target.querySelector('[data-rp]');
    if (root && root.rpInstance) {
      root.rpInstance.destroy();
      root.rpInstance = null;
    }
  });
})();
