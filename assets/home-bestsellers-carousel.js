/**
 * Bestsellers Carousel
 *
 * One rail of product cards with an arrow either side. The rail is a native
 * scroll box — a swipe on a phone and a trackpad on a desktop already move
 * it — so the arrows only have to step it on by a card and say when there is
 * nothing left in that direction.
 */
(function () {
  'use strict';

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function BestsellersCarousel(root) {
    this.root = root;
    this.rail = root.querySelector('[data-hbc-rail]');
    if (!this.rail) return;

    this.prev = root.querySelector('[data-hbc-arrow="prev"]');
    this.next = root.querySelector('[data-hbc-arrow="next"]');

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

  BestsellersCarousel.prototype.bind = function () {
    var self = this;

    [this.prev, this.next].forEach(function (button) {
      if (!button) return;
      button.addEventListener('click', function () {
        self.page(button.dataset.hbcArrow === 'next' ? 1 : -1);
      });
    });

    this.rail.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);
  };

  // One card plus the gap between them: the step the row was built on, so a
  // press always lands the next card where the last one started.
  BestsellersCarousel.prototype.page = function (direction) {
    var card = this.rail.querySelector('.hbc__card');
    var step = card ? card.offsetWidth : this.rail.clientWidth;
    var gap = parseFloat(getComputedStyle(this.rail).columnGap) || 0;

    this.rail.scrollBy({
      left: direction * (step + gap),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  };

  BestsellersCarousel.prototype.updateArrows = function () {
    if (!this.prev || !this.next) return;

    var max = this.rail.scrollWidth - this.rail.clientWidth;
    this.prev.classList.toggle('is-disabled', this.rail.scrollLeft <= 1);
    this.next.classList.toggle('is-disabled', this.rail.scrollLeft >= max - 1);
  };

  BestsellersCarousel.prototype.destroy = function () {
    this.rail.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    this.ready = false;
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-hbc]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.hbcInstance) return;
      root.hbcInstance = new BestsellersCarousel(root);
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
    var root = event.target.querySelector('[data-hbc]');
    if (root && root.hbcInstance) {
      root.hbcInstance.destroy();
      root.hbcInstance = null;
    }
  });
})();
