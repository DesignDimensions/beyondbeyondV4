/**
 * Founder's Routine
 *
 * Two routines sharing one heading: choosing one swaps the rail underneath.
 * Both rails are already in the page, so the swap is local — a crossfade, not
 * a fetch — and the mark under the chosen routine is a single element that
 * slides and resizes between the two names rather than a border each name
 * carries for itself. Choosing runs that mark through three phases: it swells
 * from a bar into a filled pill where it stands, carries the choice across,
 * then settles back into a bar under the new name.
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

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function FoundersRoutine(root) {
    this.root = root;
    this.tabs = Array.prototype.slice.call(root.querySelectorAll('[data-fr-tab]'));
    this.panels = Array.prototype.slice.call(root.querySelectorAll('[data-fr-panel]'));
    this.tabsEl = root.querySelector('[data-fr-tabs]');
    this.underline = root.querySelector('[data-fr-underline]');
    if (!this.tabs.length || !this.panels.length) return;

    this.gsap = window.gsap || null;
    this.fx = !!this.gsap && !reducedMotion();
    this.index = 0;
    this.swap = null;
    this.morphTimers = [];
    this.timing = this.readTiming();

    this.onResize = this.remeasure.bind(this);

    this.bind();
    this.markIndicator();

    // The mark has nowhere to animate from until it has been measured once, so
    // its transitions only come on for the frame after the first placement.
    if (this.tabsEl) {
      var el = this.tabsEl;
      requestAnimationFrame(function () {
        el.classList.add('is-ready');
      });
    }

    // The mark is measured from laid-out text, and web fonts landing late
    // change how wide a routine's name is.
    if (document.fonts && document.fonts.ready) {
      var self = this;
      document.fonts.ready.then(function () {
        self.markIndicator();
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
        self.updateDots(panel);
      }, { passive: true });
      self.syncRail(panel);
    });

    window.addEventListener('resize', this.onResize);
  };

  // Both the mark and the dots are measurements of the laid-out row, so a
  // resize has to retake both.
  FoundersRoutine.prototype.remeasure = function () {
    var self = this;
    this.markIndicator();
    this.panels.forEach(function (panel) {
      self.syncRail(panel);
    });
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

  // The phases are sequenced here but timed in the stylesheet, so the two
  // cannot drift apart.
  FoundersRoutine.prototype.readTiming = function () {
    var styles = this.tabsEl ? getComputedStyle(this.tabsEl) : null;

    function ms(name, fallback) {
      var raw = styles && styles.getPropertyValue(name).trim();
      if (!raw) return fallback;
      var value = parseFloat(raw);
      if (isNaN(value)) return fallback;
      return raw.slice(-2) === 'ms' ? value : value * 1000;
    }

    return {
      morph: ms('--fr-morph', 240),
      slide: ms('--fr-slide', 460),
      land: ms('--fr-land', 80),
    };
  };

  // Measured from the label rather than the tab, so the mark is the width of
  // the routine's name and not of the half of the bar it sits in. Only the two
  // edges are published: the stylesheet turns them into the mark's own box and
  // into the window the lit copy of the names is seen through, which is what
  // keeps the two in step while both are moving.
  FoundersRoutine.prototype.markIndicator = function () {
    if (!this.tabsEl) return;

    var tab = this.tabs[this.index];
    var label = tab && tab.querySelector('.fr__tab-label');
    if (!label) return;

    var bar = this.tabsEl.getBoundingClientRect();
    var rect = label.getBoundingClientRect();

    this.tabsEl.style.setProperty('--fr-l', rect.left - bar.left + 'px');
    this.tabsEl.style.setProperty('--fr-r', rect.right - bar.left + 'px');
  };

  FoundersRoutine.prototype.clearMorph = function () {
    this.morphTimers.forEach(clearTimeout);
    this.morphTimers = [];
  };

  // Swell where it stands, carry the choice across, settle back into a bar. A
  // second choice mid-flight restarts from wherever the mark has got to: the
  // edges are transitioned, so they retarget rather than jump, and a mark
  // already swollen skips straight to the travel.
  FoundersRoutine.prototype.moveIndicator = function (direction) {
    var self = this;
    var el = this.tabsEl;
    if (!el) return;

    this.clearMorph();

    if (reducedMotion()) {
      el.classList.remove('is-morphing', 'is-sliding', 'is-reverse');
      this.markIndicator();
      return;
    }

    // Travel is lopsided towards the direction of the change, so the mark
    // stretches ahead of itself rather than sliding rigidly.
    el.classList.toggle('is-reverse', direction < 0);

    var swell = el.classList.contains('is-morphing') ? 0 : this.timing.morph;

    this.morphTimers.push(
      setTimeout(function () {
        el.classList.add('is-sliding');
        self.markIndicator();
      }, swell)
    );

    this.morphTimers.push(
      setTimeout(function () {
        el.classList.remove('is-sliding');
      }, swell + this.timing.slide)
    );

    this.morphTimers.push(
      setTimeout(function () {
        el.classList.remove('is-morphing', 'is-reverse');
      }, swell + this.timing.slide + this.timing.land)
    );

    el.classList.add('is-morphing');
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

    this.moveIndicator(index > previous ? 1 : -1);
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
    // Only now is there a laid-out rail to measure — a hidden panel has no
    // width, so this is the first chance its dots have to be counted.
    this.syncRail(incoming);

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

  FoundersRoutine.prototype.syncRail = function (panel) {
    this.buildDots(panel);
    this.updateArrows(panel);
    this.updateDots(panel);
  };

  /* ------------------------------------------------------------------
     Dots
     ------------------------------------------------------------------ */

  // One dot per railful of cards, so the row of them is as long as the rail
  // has left to go. A hidden panel measures nothing and gets no dots; it is
  // built again when the routine it belongs to is chosen.
  FoundersRoutine.prototype.buildDots = function (panel) {
    var self = this;
    var rail = panel.querySelector('[data-fr-rail]');
    var dots = panel.querySelector('[data-fr-dots]');
    if (!rail || !dots) return;

    var pages = rail.clientWidth ? Math.ceil(rail.scrollWidth / rail.clientWidth) : 0;
    // A rail that fits its cards has nothing to page through, and a lone dot
    // would say nothing.
    if (pages < 2) pages = 0;
    if (dots.childElementCount === pages) return;

    var label = dots.dataset.frDotLabel || '';
    dots.textContent = '';

    for (var i = 0; i < pages; i += 1) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'fr__dot';
      dot.setAttribute('data-fr-dot', '');
      dot.setAttribute('aria-label', label ? label + ' ' + (i + 1) : String(i + 1));
      dots.appendChild(dot);

      (function (index) {
        dot.addEventListener('click', function () {
          self.goToDot(panel, index);
        });
      })(i);
    }
  };

  // Progress, not selection: dragging the rail moves the dots without anything
  // being chosen, the same way a scrollbar does. Mapping the whole scroll onto
  // the dots — rather than counting railfuls off the left — is what makes the
  // last dot light when the rail reaches its end, however short that last page
  // turns out to be.
  FoundersRoutine.prototype.updateDots = function (panel) {
    var rail = panel.querySelector('[data-fr-rail]');
    var dots = panel.querySelector('[data-fr-dots]');
    if (!rail || !dots || !dots.childElementCount) return;

    var count = dots.childElementCount;
    var max = rail.scrollWidth - rail.clientWidth;
    var progress = max > 0 ? clamp(rail.scrollLeft / max, 0, 1) : 0;
    var active = Math.round(progress * (count - 1));

    Array.prototype.forEach.call(dots.children, function (dot, index) {
      var on = index === active;
      dot.classList.toggle('is-active', on);
      if (on) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  FoundersRoutine.prototype.goToDot = function (panel, index) {
    var rail = panel.querySelector('[data-fr-rail]');
    var dots = panel.querySelector('[data-fr-dots]');
    if (!rail || !dots) return;

    var count = dots.childElementCount;
    var max = rail.scrollWidth - rail.clientWidth;

    rail.scrollTo({
      left: count > 1 ? (index / (count - 1)) * max : 0,
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  };

  /* ------------------------------------------------------------------
     Teardown
     ------------------------------------------------------------------ */

  FoundersRoutine.prototype.destroy = function () {
    window.removeEventListener('resize', this.onResize);
    this.clearMorph();
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
