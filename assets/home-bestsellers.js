/**
 * Home Bestsellers — rows scroll normally, one card hops between them.
 *
 * The product rows are ordinary content and scroll with the page. The card is
 * parked on one row at a time and scrolls with it, so it never drifts free
 * between two rows. Once its row falls below the visibility threshold, the card
 * springs to whichever neighbour is more visible — up or down, following the
 * scroll.
 *
 * When the card moves to a new row:
 *   - the copy rolls out upward, changes, and rolls back in from below
 *   - the artwork leaves by the edge it lives on and the next set arrives
 *   - the card springs a whole row up or down to its new home
 *
 * That move is a spring integrated per frame rather than a CSS easing curve, so
 * it stays smooth when a fast scroll interrupts it mid-flight and retargets. It
 * is tuned close to critically damped: the card glides to the new row and stops
 * there, with only a few pixels of give at the end.
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

  // Spring constants. Damping ratio lands near 0.75, which is about 1% overshoot
  // on a full row — enough to read as settling rather than stopping dead, but
  // not a visible bounce. Lower DAMPING is *more* friction; it scales velocity.
  var STIFFNESS = 0.095;
  var DAMPING = 0.66;
  // Terminal velocity. Without it the overshoot would scale with the distance
  // travelled, and a full row jump would fling the card far past its target.
  // Set just under the spring's natural peak so it trims the fling without
  // flattening the whole journey into a constant-speed slide.
  var MAX_VELOCITY = 30; // px per step
  var STEP = 1 / 60; // fixed integration step, so the spring is frame-rate independent
  var MAX_FRAME = 0.05;
  var REST_POSITION = 0.05;
  var REST_VELOCITY = 0.05;
  var DEFAULT_THRESHOLD = 0.6; // hand over once the current row is less visible than this
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
    this.slot = root.querySelector('[data-hb-slot]');
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
    this.offsets = [];
    this.y = 0;
    this.target = 0;
    this.velocity = 0;
    this.accumulator = 0;
    this.last = 0;
    this.raf = null;
    this.inView = false;

    this.tick = this.tick.bind(this);

    // measure() first: apply() derives the spring target from these offsets.
    this.measure();
    this.apply(this.mostVisible(), false);
    this.y = this.target;
    this.render();
    this.bindEvents();
    this.observe();

    this.ready = true;
  }

  /* ----------------------------------------------------------------------
     Geometry
     ---------------------------------------------------------------------- */

  // Where each row sits relative to the first. The card is translated by these,
  // so it lands exactly on a row rather than anywhere between two.
  HomeBestsellers.prototype.measure = function () {
    var base = this.rows[0].offsetTop;
    this.offsets = this.rows.map(function (row) {
      return row.offsetTop - base;
    });
  };

  /**
   * How much of a row is on screen, 0 to 1. Measured against the smaller of the
   * row and the viewport so a row taller than the screen can still read as 1.
   */
  HomeBestsellers.prototype.visibility = function (index) {
    var rect = this.rows[index].getBoundingClientRect();
    var height = window.innerHeight;
    var shown = Math.min(rect.bottom, height) - Math.max(rect.top, 0);
    var reference = Math.min(rect.height, height);
    if (reference <= 0) return 0;
    return clamp(shown / reference, 0, 1);
  };

  HomeBestsellers.prototype.mostVisible = function () {
    var best = 0;
    var bestValue = -1;
    for (var i = 0; i < this.rows.length; i++) {
      var value = this.visibility(i);
      if (value > bestValue) {
        bestValue = value;
        best = i;
      }
    }
    return best;
  };

  /**
   * Hand the card over only when its row has dropped below the threshold AND a
   * neighbour is genuinely more visible. Requiring both is what stops the card
   * flapping between two rows around the boundary.
   */
  HomeBestsellers.prototype.handover = function () {
    if (this.index < 0) return;

    var current = this.visibility(this.index);
    if (current >= this.threshold) return;

    var best = this.index;
    var bestValue = current;

    [this.index - 1, this.index + 1].forEach(function (candidate) {
      if (candidate < 0 || candidate >= this.rows.length) return;
      var value = this.visibility(candidate);
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }, this);

    if (best !== this.index) this.apply(best, true);
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
    this.target = this.offsets[index] || 0;

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

    if (animate) this.wake();

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
     Spring
     ---------------------------------------------------------------------- */

  HomeBestsellers.prototype.render = function () {
    if (!this.slot) return;
    this.slot.style.transform = 'translate3d(0, ' + this.y.toFixed(2) + 'px, 0)';
  };

  HomeBestsellers.prototype.settled = function () {
    return Math.abs(this.target - this.y) < REST_POSITION && Math.abs(this.velocity) < REST_VELOCITY;
  };

  /* ----------------------------------------------------------------------
     Frame loop
     ---------------------------------------------------------------------- */

  HomeBestsellers.prototype.tick = function (now) {
    if (!this.raf) return;

    var dt = this.last ? Math.min((now - this.last) / 1000, MAX_FRAME) : STEP;
    this.last = now;

    if (isDesktop()) this.handover();

    if (reducedMotion() || !isDesktop()) {
      this.y = this.target;
      this.velocity = 0;
    } else {
      // Fixed-step integration: the spring behaves identically at 60Hz and 144Hz.
      this.accumulator += dt;
      var guard = 0;
      while (this.accumulator >= STEP && guard < 8) {
        this.velocity += (this.target - this.y) * STIFFNESS;
        this.velocity *= DAMPING;
        this.velocity = clamp(this.velocity, -MAX_VELOCITY, MAX_VELOCITY);
        this.y += this.velocity;
        this.accumulator -= STEP;
        guard++;
      }

      if (this.settled()) {
        this.y = this.target;
        this.velocity = 0;
      }
    }

    this.render();
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
    this.last = 0;
    this.accumulator = 0;
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

    this.handlers = {
      visibility: function () {
        if (document.hidden) self.sleep();
        else if (self.inView) self.wake();
      },

      resize: function () {
        cancelAnimationFrame(self.resizeFrame);
        self.resizeFrame = requestAnimationFrame(function () {
          self.measure();
          self.target = self.offsets[self.index] || 0;
          if (!isDesktop()) {
            self.y = self.target;
            self.velocity = 0;
            self.slot.style.transform = '';
            return;
          }
          self.wake();
        });
      },
    };

    document.addEventListener('visibilitychange', this.handlers.visibility);

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.handlers.resize);
      this.resizeObserver.observe(this.root);
    } else {
      window.addEventListener('resize', this.handlers.resize);
    }
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
    cancelAnimationFrame(this.resizeFrame);

    if (this.viewObserver) this.viewObserver.disconnect();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else window.removeEventListener('resize', this.handlers.resize);
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
