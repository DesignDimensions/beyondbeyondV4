/**
 * Founder's Routine
 *
 * Two routines sharing one heading: choosing one swaps the rail underneath.
 * Both rails are already in the page, so the swap is local — a crossfade, not
 * a fetch — and the mark under the chosen routine is a single element that
 * slides and resizes between the two names rather than a border each name
 * carries for itself.
 */
(function () {
  'use strict';

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function closestFrom(target, selector) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(selector);
  }

  function FoundersRoutine(root) {
    this.root = root;
    this.tabs = Array.prototype.slice.call(root.querySelectorAll('[data-fr-tab]'));
    this.panels = Array.prototype.slice.call(root.querySelectorAll('[data-fr-panel]'));
    this.underline = root.querySelector('[data-fr-underline]');
    if (!this.tabs.length || !this.panels.length) return;

    this.gsap = window.gsap || null;
    this.fx = !!this.gsap && !reducedMotion();
    this.index = 0;
    this.swap = null;

    this.onResize = this.markUnderline.bind(this);

    this.bind();
    this.markUnderline();

    // The mark is measured from laid-out text, and web fonts landing late
    // change how wide a routine's name is.
    if (document.fonts && document.fonts.ready) {
      var self = this;
      document.fonts.ready.then(function () {
        self.markUnderline();
      });
    }

    this.ready = true;
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  FoundersRoutine.prototype.bind = function () {
    var self = this;

    this.tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        self.select(index);
      });
    });

    this.root.addEventListener('keydown', function (event) {
      if (!closestFrom(event.target, '[data-fr-tab]')) return;
      self.handleKeydown(event);
    });

    Array.prototype.forEach.call(this.root.querySelectorAll('[data-fr-arrow]'), function (button) {
      button.addEventListener('click', function () {
        self.page(button, button.dataset.frArrow === 'next' ? 1 : -1);
      });
    });

    this.panels.forEach(function (panel) {
      var rail = panel.querySelector('[data-fr-rail]');
      if (!rail) return;
      rail.addEventListener('scroll', function () {
        self.updateArrows(panel);
      }, { passive: true });
      self.updateArrows(panel);
    });

    window.addEventListener('resize', this.onResize);
  };

  FoundersRoutine.prototype.handleKeydown = function (event) {
    var next = null;
    var count = this.tabs.length;

    if (event.key === 'ArrowRight') next = (this.index + 1) % count;
    else if (event.key === 'ArrowLeft') next = (this.index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;

    event.preventDefault();
    this.select(next);
    this.tabs[next].focus();
  };

  /* ------------------------------------------------------------------
     The mark
     ------------------------------------------------------------------ */

  // Measured from the label rather than the tab, so it is the width of the
  // routine's name and not of the half of the bar it sits in.
  FoundersRoutine.prototype.markUnderline = function () {
    if (!this.underline) return;

    var tab = this.tabs[this.index];
    var label = tab && tab.querySelector('.fr__tab-label');
    if (!label) return;

    var bar = this.underline.parentNode.getBoundingClientRect();
    var rect = label.getBoundingClientRect();
    var pad = 10;

    this.underline.style.width = rect.width + pad * 2 + 'px';
    this.underline.style.transform = 'translate3d(' + (rect.left - bar.left - pad) + 'px, 0, 0)';
  };

  /* ------------------------------------------------------------------
     Selection
     ------------------------------------------------------------------ */

  FoundersRoutine.prototype.select = function (index) {
    if (index === this.index || index < 0 || index >= this.tabs.length) return;

    var previous = this.index;
    this.index = index;

    this.tabs.forEach(function (tab, i) {
      var active = i === index;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });

    this.markUnderline();
    this.swapPanels(previous, index);
  };

  FoundersRoutine.prototype.swapPanels = function (from, to) {
    var self = this;
    var incoming = this.panels[to];
    if (!incoming) return;

    // A swap already running owns the panels' inline state; hand it the new
    // destination rather than layering a second timeline on top.
    if (this.swap) {
      this.swap.kill();
      this.swap = null;
    }

    this.panels.forEach(function (panel) {
      if (panel === incoming) return;
      panel.hidden = true;
      panel.classList.remove('is-active');
      if (self.gsap) self.gsap.set(panel.querySelectorAll('.fr__card'), { clearProps: 'all' });
    });

    incoming.hidden = false;
    incoming.classList.add('is-active');
    this.updateArrows(incoming);

    if (!this.fx) return;

    var cards = incoming.querySelectorAll('.fr__card');
    // Direction of travel matches the switcher, so the rail reads as arriving
    // from the side the routine was chosen on.
    var direction = to > from ? 1 : -1;

    this.swap = this.gsap.fromTo(
      cards,
      { opacity: 0, y: 22, x: direction * 24 },
      {
        opacity: 1,
        y: 0,
        x: 0,
        duration: 0.6,
        ease: 'power3.out',
        stagger: { each: 0.06, from: 'start' },
        onComplete: function () {
          self.swap = null;
          self.gsap.set(cards, { clearProps: 'all' });
        },
      }
    );
  };

  /* ------------------------------------------------------------------
     Rails
     ------------------------------------------------------------------ */

  FoundersRoutine.prototype.page = function (button, direction) {
    var panel = closestFrom(button, '[data-fr-panel]');
    var rail = panel && panel.querySelector('[data-fr-rail]');
    if (!rail) return;

    var card = rail.querySelector('.fr__card');
    var step = card ? card.offsetWidth : rail.clientWidth;
    var gap = parseFloat(getComputedStyle(rail).columnGap) || 0;

    rail.scrollBy({
      left: direction * (step + gap),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  };

  FoundersRoutine.prototype.updateArrows = function (panel) {
    var rail = panel.querySelector('[data-fr-rail]');
    var prev = panel.querySelector('[data-fr-arrow="prev"]');
    var next = panel.querySelector('[data-fr-arrow="next"]');
    if (!rail || !prev || !next) return;

    var max = rail.scrollWidth - rail.clientWidth;
    prev.classList.toggle('is-disabled', rail.scrollLeft <= 1);
    next.classList.toggle('is-disabled', rail.scrollLeft >= max - 1);
  };

  /* ------------------------------------------------------------------
     Teardown
     ------------------------------------------------------------------ */

  FoundersRoutine.prototype.destroy = function () {
    window.removeEventListener('resize', this.onResize);
    if (this.swap) this.swap.kill();
    this.ready = false;
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-fr]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.frInstance) return;
      root.frInstance = new FoundersRoutine(root);
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
    var root = event.target.querySelector('[data-fr]');
    if (root && root.frInstance) {
      root.frInstance.destroy();
      root.frInstance = null;
    }
  });

  document.addEventListener('shopify:block:select', function (event) {
    var root = closestFrom(event.target, '[data-fr]');
    var instance = root && root.frInstance;
    if (!instance || !instance.ready) return;
    instance.select(parseInt(event.target.dataset.index, 10) || 0);
  });
})();
