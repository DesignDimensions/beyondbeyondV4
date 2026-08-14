/**
 * USP Carousal — velocity-driven marquee.
 *
 * A single rAF loop owns one number: `speed`, in px/s. Everything the strip
 * does — drifting, slowing under the cursor, surging with the page scroll,
 * carrying a flick — is a change to the value `speed` is easing toward. The
 * lean (skewX) is derived from how far `speed` currently sits from its
 * resting rate, so the strip visibly reacts to its own motion.
 *
 * Deliberately GSAP-free: nothing here should depend on another library having
 * loaded, so the strip cannot freeze because a dependency went missing.
 */
(function () {
  'use strict';

  // Holds the entry reveal until the full-screen intro has handed the page over.
  // Runs the callback straight away when there is no intro to wait for.
  function introReady(callback) {
    if (typeof window.bbIntroReady === 'function') window.bbIntroReady(callback);
    else callback();
  }

  var SPEED_TAU = 0.55; // seconds for speed to close most of the gap to target
  var SKEW_TAU = 0.14;
  var MAX_SKEW = 3.5; // degrees
  var SKEW_PER_SPEED = 0.011;
  var SCROLL_GAIN = 2.4;
  var SCROLL_MAX = 900;
  var SCROLL_TAU = 0.28;
  var HOVER_FACTOR = 0.12;
  var MAX_FLICK = 2000; // ~1.5 screen widths/s — punchy, still readable
  var DRAG_THRESHOLD = 4;
  var MAX_FRAME = 0.05; // clamp dt so a backgrounded tab cannot jump the strip

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function UspCarousal(root) {
    this.ready = false;
    this.root = root;
    this.viewport = root.querySelector('[data-usp-viewport]');
    this.track = root.querySelector('[data-usp-track]');
    if (!this.viewport || !this.track) return;

    this.originals = Array.prototype.slice.call(this.track.children);
    this.originalCount = this.originals.length;
    if (!this.originalCount) return;

    this.base = parseFloat(root.dataset.speed) || 70;
    if (root.dataset.direction === 'right') this.base = -this.base;

    this.pauseOnHover = root.dataset.pauseOnHover !== 'false';
    this.scrollEffect = root.dataset.scrollEffect !== 'false';

    this.x = 0;
    this.speed = 0;
    this.skew = 0;
    this.scrollBoost = 0;
    this.setWidth = 0;
    this.hovering = false;
    this.drag = null;
    this.running = false;
    this.last = 0;
    this.lastScrollY = window.scrollY || window.pageYOffset || 0;

    this.tick = this.tick.bind(this);

    this.build();
    this.bindEvents();
    this.observe();

    root.classList.add('is-draggable');
    this.ready = true;
  }

  /* ----------------------------------------------------------------------
     Layout
     ---------------------------------------------------------------------- */

  UspCarousal.prototype.gap = function () {
    var gap = parseFloat(window.getComputedStyle(this.track).columnGap);
    return isNaN(gap) ? 0 : gap;
  };

  // Repeat the original items until the strip is at least one full set wider
  // than the viewport, which is what lets the wrap below be invisible.
  UspCarousal.prototype.build = function () {
    var self = this;

    Array.prototype.forEach.call(this.track.querySelectorAll('[data-usp-clone]'), function (clone) {
      clone.parentNode.removeChild(clone);
    });

    this.originals.forEach(function (item, i) {
      item.style.setProperty('--usp-i', i);
    });

    var singleSet = this.track.scrollWidth + this.gap();
    if (singleSet <= 0) return;

    var needed = this.viewport.clientWidth + singleSet;
    var copies = Math.max(1, Math.ceil(needed / singleSet));

    for (var c = 0; c < copies; c++) {
      this.originals.forEach(function (item) {
        var clone = item.cloneNode(true);
        clone.setAttribute('data-usp-clone', '');
        // Duplicates are visual filler; screen readers should hear the copy once.
        clone.setAttribute('aria-hidden', 'true');
        clone.removeAttribute('data-shopify-editor-block');
        Array.prototype.forEach.call(clone.querySelectorAll('a, button, [tabindex]'), function (el) {
          el.setAttribute('tabindex', '-1');
        });
        self.track.appendChild(clone);
      });
    }

    this.measure();
  };

  // The repeat distance is the offset between an item and its first copy, which
  // stays exact regardless of gaps, padding or fractional widths.
  UspCarousal.prototype.measure = function () {
    var children = this.track.children;
    if (children.length > this.originalCount) {
      this.setWidth = children[this.originalCount].offsetLeft - children[0].offsetLeft;
    } else {
      this.setWidth = this.track.scrollWidth;
    }
  };

  UspCarousal.prototype.wrap = function () {
    if (this.setWidth <= 0) return;
    this.x = this.x % this.setWidth;
    if (this.x > 0) this.x -= this.setWidth;
  };

  UspCarousal.prototype.render = function () {
    this.track.style.transform =
      'translate3d(' + this.x.toFixed(2) + 'px, 0, 0) skewX(' + this.skew.toFixed(3) + 'deg)';
  };

  /* ----------------------------------------------------------------------
     Frame loop
     ---------------------------------------------------------------------- */

  UspCarousal.prototype.restingSpeed = function () {
    if (reducedMotion()) return 0;
    if (this.hovering && this.pauseOnHover) return this.base * HOVER_FACTOR;
    return this.base;
  };

  UspCarousal.prototype.tick = function (now) {
    if (!this.running) return;

    var dt = this.last ? Math.min((now - this.last) / 1000, MAX_FRAME) : 1 / 60;
    this.last = now;

    if (this.drag && this.drag.axis === 'x') {
      // While dragging, the pointer owns x directly; speed is only sampled so
      // the lean keeps reacting.
      this.speed = this.drag.speed;
    } else {
      var target = this.restingSpeed() + this.scrollBoost;
      // Frame-rate independent easing: same curve at 60Hz and 144Hz.
      this.speed += (target - this.speed) * (1 - Math.exp(-dt / SPEED_TAU));
      this.x -= this.speed * dt;
      this.wrap();
    }

    this.scrollBoost *= Math.exp(-dt / SCROLL_TAU);
    if (Math.abs(this.scrollBoost) < 0.5) this.scrollBoost = 0;

    // Lean is driven by departure from the resting rate, so a steady drift sits
    // upright and only surges, flicks and drags tilt the strip.
    var targetSkew = reducedMotion()
      ? 0
      : clamp(-(this.speed - this.restingSpeed()) * SKEW_PER_SPEED, -MAX_SKEW, MAX_SKEW);
    this.skew += (targetSkew - this.skew) * (1 - Math.exp(-dt / SKEW_TAU));

    this.render();
    this.raf = requestAnimationFrame(this.tick);
  };

  UspCarousal.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  };

  UspCarousal.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    // Transient momentum should not survive a pause and fire on resume.
    this.scrollBoost = 0;
  };

  /* ----------------------------------------------------------------------
     Pointer
     ---------------------------------------------------------------------- */

  UspCarousal.prototype.onPointerDown = function (event) {
    if (this.drag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    this.drag = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: performance.now(),
      axis: null,
      speed: 0,
      moved: 0,
    };

    window.addEventListener('pointermove', this.handlers.pointerMove, { passive: false });
    window.addEventListener('pointerup', this.handlers.pointerUp);
    window.addEventListener('pointercancel', this.handlers.pointerUp);
  };

  UspCarousal.prototype.onPointerMove = function (event) {
    var drag = this.drag;
    if (!drag) return;

    var totalX = event.clientX - drag.startX;
    var totalY = event.clientY - drag.startY;
    drag.moved = Math.max(drag.moved, Math.abs(totalX), Math.abs(totalY));

    if (drag.axis === null) {
      if (Math.abs(totalX) < DRAG_THRESHOLD && Math.abs(totalY) < DRAG_THRESHOLD) return;

      // A vertical gesture belongs to the page.
      if (Math.abs(totalY) >= Math.abs(totalX)) {
        drag.axis = 'y';
        this.endDrag();
        return;
      }

      drag.axis = 'x';
      drag.lastX = event.clientX;
      drag.lastTime = performance.now();
      this.root.classList.add('is-dragging');
    }

    if (drag.axis !== 'x') return;

    event.preventDefault();

    var now = performance.now();
    var dt = Math.max(now - drag.lastTime, 1) / 1000;
    var dx = event.clientX - drag.lastX;

    // Smoothed so a single jittery pointer sample cannot spike the flick.
    drag.speed = drag.speed * 0.7 + (-dx / dt) * 0.3;
    drag.lastX = event.clientX;
    drag.lastTime = now;

    this.x += dx;
    this.wrap();
  };

  UspCarousal.prototype.onPointerUp = function () {
    var drag = this.drag;
    if (!drag) return;

    // Hand the flick to the frame loop as raw momentum; the easing toward the
    // resting rate is what decays it, so a backward flick sweeps back naturally.
    if (drag.axis === 'x') this.speed = clamp(drag.speed, -MAX_FLICK, MAX_FLICK);

    this.endDrag();
  };

  UspCarousal.prototype.endDrag = function () {
    if (!this.drag) return;

    this.drag = null;
    window.removeEventListener('pointermove', this.handlers.pointerMove);
    window.removeEventListener('pointerup', this.handlers.pointerUp);
    window.removeEventListener('pointercancel', this.handlers.pointerUp);
    this.root.classList.remove('is-dragging');
  };

  /* ----------------------------------------------------------------------
     Events
     ---------------------------------------------------------------------- */

  UspCarousal.prototype.bindEvents = function () {
    var self = this;

    this.handlers = {
      pointerDown: this.onPointerDown.bind(this),
      pointerMove: this.onPointerMove.bind(this),
      pointerUp: this.onPointerUp.bind(this),

      dragStart: function (event) {
        event.preventDefault();
      },

      enter: function () {
        self.hovering = true;
      },

      leave: function () {
        self.hovering = false;
      },

      scroll: function () {
        // Track the position even while parked, so re-entering the viewport
        // never sees one enormous delta.
        var y = window.scrollY || window.pageYOffset || 0;
        var dy = y - self.lastScrollY;
        self.lastScrollY = y;

        // Only bank a surge while the loop is live — nothing decays it when the
        // strip is off-screen, and stale boost would lurch on the way back in.
        if (!self.running || !self.scrollEffect || reducedMotion()) return;

        self.scrollBoost = clamp(self.scrollBoost + dy * SCROLL_GAIN, -SCROLL_MAX, SCROLL_MAX);
      },

      visibility: function () {
        if (document.hidden) self.stop();
        else if (self.inView) self.start();
      },
    };

    this.viewport.addEventListener('pointerdown', this.handlers.pointerDown, { passive: true });
    this.viewport.addEventListener('dragstart', this.handlers.dragStart);
    this.root.addEventListener('mouseenter', this.handlers.enter);
    this.root.addEventListener('mouseleave', this.handlers.leave);
    window.addEventListener('scroll', this.handlers.scroll, { passive: true });
    document.addEventListener('visibilitychange', this.handlers.visibility);
  };

  UspCarousal.prototype.observe = function () {
    var self = this;

    this.inView = true;

    if ('IntersectionObserver' in window) {
      this.inView = false;
      this.intersectionObserver = new IntersectionObserver(
        function (entries) {
          self.inView = entries[0].isIntersecting;

          if (self.inView) {
            introReady(function () {
              // The strip may well have scrolled back out during the intro.
              if (!self.inView) return;
              self.root.classList.add('is-revealed');
              if (!document.hidden) self.start();
            });
          } else {
            self.stop();
          }
        },
        { threshold: 0 }
      );
      this.intersectionObserver.observe(this.root);
    } else {
      this.root.classList.add('is-revealed');
      this.start();
    }

    this.onResize = function () {
      cancelAnimationFrame(self.resizeFrame);
      self.resizeFrame = requestAnimationFrame(function () {
        var width = self.viewport.clientWidth;
        if (width === self.lastWidth) return;
        self.lastWidth = width;

        self.build();
        self.wrap();
        self.render();
      });
    };

    this.lastWidth = this.viewport.clientWidth;

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.viewport);
    } else {
      window.addEventListener('resize', this.onResize);
    }
  };

  UspCarousal.prototype.destroy = function () {
    if (!this.handlers) return;

    this.stop();
    this.endDrag();
    cancelAnimationFrame(this.resizeFrame);

    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else if (this.onResize) window.removeEventListener('resize', this.onResize);

    this.viewport.removeEventListener('pointerdown', this.handlers.pointerDown);
    this.viewport.removeEventListener('dragstart', this.handlers.dragStart);
    this.root.removeEventListener('mouseenter', this.handlers.enter);
    this.root.removeEventListener('mouseleave', this.handlers.leave);
    window.removeEventListener('scroll', this.handlers.scroll);
    document.removeEventListener('visibilitychange', this.handlers.visibility);

    this.handlers = null;
  };

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-usp]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.uspInstance) return;
      root.uspInstance = new UspCarousal(root);
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
    var root = event.target.querySelector('[data-usp]');
    if (root && root.uspInstance) {
      root.uspInstance.destroy();
      root.uspInstance = null;
    }
  });
})();
