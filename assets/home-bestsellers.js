/**
 * Home Bestsellers — rows scroll normally, one card holds the viewport centre.
 *
 * The product rows are ordinary content and scroll with the page. The card is
 * sticky: it rides the scroll with the section and stays vertically centred in
 * the viewport for the whole run, clamped to the rows so it never escapes the
 * first or last one. That positioning is CSS (`position: sticky` on .hb-pin) —
 * this file only decides *what* the card shows.
 *
 * As the card moves off one row and onto the next:
 *   - the copy rolls out upward, changes, and rolls back in from below
 *   - the artwork leaves by the edge it lives on and the next set arrives
 *
 * The hand-over point is geometric rather than a scroll offset: card and rows
 * are the same height, so whichever row the card covers most is the row it is
 * on. Measured from live rects each frame, so it is right at any scroll speed
 * and survives a resize with nothing to re-measure.
 */
(function () {
  'use strict';

  var DESKTOP_QUERY = '(min-width: 990px)';
  var FIELDS = ['caption', 'title', 'preprice', 'price', 'cta'];
  // The stagger is what sets how long the card reads as empty: the last line to
  // leave is also the last to come back, so it is kept tight on the way out.
  var STAGGER = { caption: 0, title: 35, preprice: 70, price: 70, cta: 105 };
  var OUT_MS = 220;
  var IN_MS = 380;

  // Share of the card the incoming row has to cover before the content changes.
  // At 0.5 that is the moment the card is more on the new row than the old one;
  // higher holds the current product past halfway.
  var DEFAULT_THRESHOLD = 0.5;
  var PARALLAX = 60; // px of counter-drift at the extremes of the viewport

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isDesktop() {
    return window.matchMedia(DESKTOP_QUERY).matches;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function HomeBestsellers(root) {
    this.ready = false;
    this.root = root;
    this.rows = Array.prototype.slice.call(root.querySelectorAll('[data-hb-row]'));
    if (!this.rows.length) return;

    this.card = root.querySelector('[data-hb-card]');
    this.faces = Array.prototype.slice.call(root.querySelectorAll('[data-hb-face]'));
    this.parallax = Array.prototype.slice.call(root.querySelectorAll('[data-hb-parallax]'));

    this.fields = {};
    for (var i = 0; i < FIELDS.length; i++) {
      this.fields[FIELDS[i]] = root.querySelector('[data-hb-field="' + FIELDS[i] + '"]');
    }

    var threshold = parseFloat(root.dataset.threshold);
    this.threshold = isNaN(threshold) ? DEFAULT_THRESHOLD : threshold / 100;

    this.index = -1;
    this.animations = {};
    this.raf = null;
    this.inView = false;

    this.tick = this.tick.bind(this);

    this.apply(this.rowUnderCard(), false);
    this.bindEvents();
    this.observe();

    this.ready = true;
  }

  /* ----------------------------------------------------------------------
     Geometry
     ---------------------------------------------------------------------- */

  HomeBestsellers.prototype.cardRect = function () {
    // Zero height means the card is not laid out — mobile hides the pin layer.
    if (!this.card) return { top: 0, bottom: 0, height: 0 };
    return this.card.getBoundingClientRect();
  };

  /**
   * How much of the card a row is under, 0 to 1. Measured as a share of the
   * card, not the row, so the threshold means the same thing whatever height
   * the merchant picks.
   */
  HomeBestsellers.prototype.coverage = function (index, rect) {
    if (rect.height <= 0) return 0;
    var row = this.rows[index].getBoundingClientRect();
    var shared = Math.min(rect.bottom, row.bottom) - Math.max(rect.top, row.top);
    return clamp(shared / rect.height, 0, 1);
  };

  /**
   * The row the card is sitting on: the one it covers most. If it covers none
   * of them — parked in a gap, or measured before layout — fall back to the
   * nearest centre so there is always an answer.
   */
  HomeBestsellers.prototype.rowUnderCard = function (rect) {
    rect = rect || this.cardRect();

    var best = 0;
    var bestValue = 0;

    for (var i = 0; i < this.rows.length; i++) {
      var value = this.coverage(i, rect);
      if (value > bestValue) {
        bestValue = value;
        best = i;
      }
    }

    if (bestValue > 0) return best;

    var centre = rect.top + rect.height / 2;
    var nearest = 0;
    var shortest = Infinity;

    for (var j = 0; j < this.rows.length; j++) {
      var box = this.rows[j].getBoundingClientRect();
      var distance = Math.abs(box.top + box.height / 2 - centre);
      if (distance < shortest) {
        shortest = distance;
        nearest = j;
      }
    }

    return nearest;
  };

  /**
   * Hand the card over once it is more on another row than on its own, and that
   * row covers at least the threshold. Requiring the coverage as well as the
   * lead is what keeps the copy from changing the instant the card's edge
   * crosses the gap between two rows.
   */
  HomeBestsellers.prototype.handover = function () {
    var rect = this.cardRect();
    if (rect.height <= 0) return;

    var next = this.rowUnderCard(rect);
    if (next === this.index) return;
    if (this.coverage(next, rect) < this.threshold) return;

    this.apply(next, true);
  };

  /* ----------------------------------------------------------------------
     Content
     ---------------------------------------------------------------------- */

  HomeBestsellers.prototype.valueFor = function (row, field) {
    return row.getAttribute('data-hb-' + field) || '';
  };

  HomeBestsellers.prototype.apply = function (index, animate) {
    if (index === this.index) return;
    if (index < 0 || index >= this.rows.length) return;

    this.index = index;

    var row = this.rows[index];

    if (this.card) {
      var url = row.getAttribute('data-hb-url');
      if (url) this.card.setAttribute('href', url);

      // Marks the window in which the incoming artwork should hold back for the
      // outgoing set. Hover uses the same away transforms but must snap back
      // without that delay, and CSS alone cannot tell the two apart.
      if (animate) {
        var card = this.card;
        card.classList.add('is-swapping');
        clearTimeout(this.swapTimer);
        this.swapTimer = setTimeout(function () {
          card.classList.remove('is-swapping');
        }, 1500);
      }
    }

    this.faces.forEach(function (face, i) {
      face.classList.toggle('is-active', i === index);
    });

    var self = this;
    FIELDS.forEach(function (field) {
      var el = self.fields[field];
      if (!el) return;

      var value = self.valueFor(row, field);
      if (animate && !reducedMotion()) self.roll(field, el, value);
      else el.textContent = value;
    });
  };

  // Roll the old line out upward, replace it, then bring the new one up from
  // below — the two halves are separate animations so the text only changes
  // while the line is invisible.
  HomeBestsellers.prototype.roll = function (field, el, value) {
    var self = this;

    if (this.animations[field]) this.animations[field].cancel();

    var out = el.animate(
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-0.55em)' },
      ],
      { duration: OUT_MS, delay: STAGGER[field] || 0, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' }
    );

    this.animations[field] = out;

    out.finished
      .then(function () {
        el.textContent = value;

        var incoming = el.animate(
          [
            { opacity: 0, transform: 'translateY(0.55em)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: IN_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' }
        );

        self.animations[field] = incoming;

        return incoming.finished;
      })
      .then(function () {
        // Drop the fill so the element goes back to being governed by CSS.
        if (self.animations[field]) self.animations[field].cancel();
        self.animations[field] = null;
      })
      .catch(function () {
        /* superseded by a faster scroll — the newer roll owns the element */
      });
  };

  /* ----------------------------------------------------------------------
     Frame loop — runs only while the section is on screen
     ---------------------------------------------------------------------- */

  HomeBestsellers.prototype.tick = function () {
    if (!this.raf) return;

    if (isDesktop()) this.handover();
    this.drift();

    this.raf = requestAnimationFrame(this.tick);
  };

  // Secondary image drifts against the scroll for depth.
  HomeBestsellers.prototype.drift = function () {
    if (!this.parallax.length || reducedMotion()) return;

    var height = window.innerHeight;
    var desktop = isDesktop();

    for (var i = 0; i < this.rows.length; i++) {
      var image = this.rows[i].querySelector('[data-hb-parallax]');
      if (!image) continue;

      if (!desktop) {
        if (image.style.transform) image.style.transform = '';
        continue;
      }

      var rect = this.rows[i].getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > height + 200) continue;

      var progress = clamp((rect.top + rect.height / 2 - height / 2) / height, -1, 1);
      image.style.transform = 'translate3d(0, ' + (progress * PARALLAX).toFixed(2) + 'px, 0)';
    }
  };

  HomeBestsellers.prototype.wake = function () {
    if (this.raf || !this.inView) return;
    this.raf = requestAnimationFrame(this.tick);
  };

  HomeBestsellers.prototype.sleep = function () {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = null;
  };

  /* ----------------------------------------------------------------------
     Events
     ---------------------------------------------------------------------- */

  HomeBestsellers.prototype.bindEvents = function () {
    var self = this;

    // No resize handling: every measurement is taken from a live rect inside
    // the frame loop, and the card's position is the browser's own sticky.
    this.handlers = {
      visibility: function () {
        if (document.hidden) self.sleep();
        else if (self.inView) self.wake();
      },
    };

    document.addEventListener('visibilitychange', this.handlers.visibility);
  };

  HomeBestsellers.prototype.observe = function () {
    var self = this;

    if (!('IntersectionObserver' in window)) {
      this.inView = true;
      this.wake();
      return;
    }

    this.viewObserver = new IntersectionObserver(
      function (entries) {
        self.inView = entries[0].isIntersecting;
        if (self.inView) self.wake();
        else self.sleep();
      },
      { threshold: 0 }
    );
    this.viewObserver.observe(this.root);
  };

  HomeBestsellers.prototype.destroy = function () {
    this.sleep();
    clearTimeout(this.swapTimer);

    if (this.viewObserver) this.viewObserver.disconnect();
    document.removeEventListener('visibilitychange', this.handlers.visibility);

    var self = this;
    FIELDS.forEach(function (field) {
      if (self.animations[field]) self.animations[field].cancel();
    });
  };

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-hb]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.hbInstance) return;
      root.hbInstance = new HomeBestsellers(root);
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
    var root = event.target.querySelector('[data-hb]');
    if (root && root.hbInstance) {
      root.hbInstance.destroy();
      root.hbInstance = null;
    }
  });

  document.addEventListener('shopify:block:select', function (event) {
    var root = event.target.closest('[data-hb]');
    var instance = root && root.hbInstance;
    if (!instance || !instance.ready) return;

    event.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();
