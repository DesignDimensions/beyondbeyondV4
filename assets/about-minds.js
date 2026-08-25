/**
 * Minds Behind
 *
 * One rail of portraits with an arrow either side. The rail is a native
 * scroll box — a swipe and a trackpad already move it — so the arrows only
 * have to step it on by a card and say when there is nothing left in that
 * direction.
 */
(function () {
  'use strict';

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function MindsCarousel(root) {
    this.root = root;
    this.rail = root.querySelector('[data-mnd-rail]');
    if (!this.rail) return;

    this.prev = root.querySelector('[data-mnd-arrow="prev"]');
    this.next = root.querySelector('[data-mnd-arrow="next"]');

    this.onScroll = this.updateArrows.bind(this);
    this.onResize = this.updateArrows.bind(this);

    this.bind();
    this.updateArrows();

    // Cards are sized off the laid-out column, so the rail's own width is
    // only final once the page has settled at its real measurements.
    if (document.fonts && document.fonts.ready) {
      var self = this;
      document.fonts.ready.then(function () {
        self.updateArrows();
      });
    }

    this.ready = true;
  }

  MindsCarousel.prototype.bind = function () {
    var self = this;

    [this.prev, this.next].forEach(function (button) {
      if (!button) return;
      button.addEventListener('click', function () {
        self.page(button.dataset.mndArrow === 'next' ? 1 : -1);
      });
    });

    this.rail.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);
  };

  // One card plus the gap between them: the step the row was built on, so a
  // press always lands the next card where the last one started.
  MindsCarousel.prototype.page = function (direction) {
    var card = this.rail.querySelector('[data-mnd-card]');
    var step = card ? card.offsetWidth : this.rail.clientWidth;
    var gap = parseFloat(getComputedStyle(this.rail).columnGap) || 0;

    this.rail.scrollBy({
      left: direction * (step + gap),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  };

  MindsCarousel.prototype.updateArrows = function () {
    if (!this.prev || !this.next) return;

    var max = this.rail.scrollWidth - this.rail.clientWidth;
    this.prev.classList.toggle('is-disabled', this.rail.scrollLeft <= 1);
    this.next.classList.toggle('is-disabled', this.rail.scrollLeft >= max - 1);
  };

  MindsCarousel.prototype.destroy = function () {
    this.rail.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    this.ready = false;
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-mnd]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.mndInstance) return;
      root.mndInstance = new MindsCarousel(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });

  document.addEventListener('shopify:section:unload', function (event) {
    var root = event.target.querySelector('[data-mnd]');
    if (root && root.mndInstance) {
      root.mndInstance.destroy();
      root.mndInstance = null;
    }
  });
})();
