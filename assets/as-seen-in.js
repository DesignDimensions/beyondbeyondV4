/**
 * As Seen In
 *
 * Two rows of press logos drifting endlessly, and grabbable — you can catch a
 * row, throw it, and watch it settle back into its drift.
 *
 * Position is driven per frame rather than by a tween, because a tween owns the
 * value it animates and a hand on the row has to be able to take it back
 * mid-flight. Each row keeps an offset and a velocity: the offset wraps at one
 * sequence's width, which is what makes the loop endless with no seam to hide,
 * and the velocity is only ever eased toward whatever it should be — the drift,
 * a hover's slow-down, or the speed of a throw. Nothing is ever set hard, so
 * every change of state arrives as a settle rather than a jump.
 *
 * GSAP drives the clock and the writes where the theme has loaded it; without
 * it the same arithmetic runs on requestAnimationFrame.
 */
(function () {
  'use strict';

  var HOVER_SCALE = 0.12;
  /* Seconds for a row to give up a throw and be drifting again. Long enough to
     read as momentum, short enough that the row never feels lost. */
  var SETTLE = 0.62;
  var MAX_FLING = 3200;
  var DRAG_THRESHOLD = 4;
  var CLICK_CANCEL_DISTANCE = 8;
  var MAX_FRAME = 0.05;

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function closestFrom(target, selector) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(selector);
  }

  function clamp(value, limit) {
    return Math.min(Math.max(value, -limit), limit);
  }

  // Keeps the offset inside one sequence, whichever way the row is travelling
  // and however far a throw carried it.
  function wrap(x, width) {
    if (!width) return x;
    return (((x % width) - width) % width);
  }

  function AsSeenIn(root) {
    this.root = root;
    var elements = Array.prototype.slice.call(root.querySelectorAll('[data-asi-row]'));
    if (!elements.length) return;

    this.gsap = window.gsap || null;
    this.speed = parseFloat(root.dataset.speed) || 45;
    this.slowOnHover = root.dataset.hoverSlow === 'true';
    this.scale = 1;
    this.hovered = null;
    this.swallowClick = false;
    this.frameId = null;
    this.lastTime = 0;

    var self = this;
    this.rows = elements.map(function (element) {
      return {
        element: element,
        track: element.querySelector('[data-asi-track]'),
        seq: element.querySelector('[data-asi-seq]'),
        direction: parseFloat(element.dataset.direction) || -1,
        width: 0,
        x: 0,
        velocity: 0,
        drag: null,
      };
    }).filter(function (row) {
      return row.track && row.seq;
    });

    this.visible = true;
    this.still = reducedMotion();
    this.onResize = this.requestBuild.bind(this);
    this.onFrame = this.frame.bind(this);

    this.bind();
    this.build();
    this.start();

    // A logo that arrives late changes the width the loop turns on, and a row
    // measured before it would drift out of step with itself.
    this.watchImages();

    this.ready = true;
  }

  /* ------------------------------------------------------------------
     Geometry
     ------------------------------------------------------------------ */

  AsSeenIn.prototype.requestBuild = function () {
    var self = this;
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(function () {
      self.resizeFrame = null;
      self.build();
    });
  };

  // Two printed copies are enough to cover the loop itself, but not enough to
  // fill a window wider than the sequence — the track would run out of logos
  // before it wrapped. Clone until it cannot.
  AsSeenIn.prototype.fill = function (row) {
    var width = row.seq.offsetWidth;
    if (!width) return 0;

    var needed = Math.ceil((row.element.offsetWidth + width) / width) + 1;
    var have = row.track.querySelectorAll('[data-asi-seq]').length;

    for (var i = have; i < needed; i += 1) {
      var clone = row.seq.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      row.track.appendChild(clone);
    }

    return width;
  };

  AsSeenIn.prototype.build = function () {
    var self = this;

    this.rows.forEach(function (row) {
      row.width = self.fill(row);
      row.x = wrap(row.x, row.width);
      self.render(row);
    });
  };

  AsSeenIn.prototype.render = function (row) {
    if (this.gsap) this.gsap.set(row.track, { x: row.x });
    else row.track.style.transform = 'translate3d(' + row.x + 'px, 0, 0)';
  };

  AsSeenIn.prototype.watchImages = function () {
    var self = this;
    var images = Array.prototype.slice.call(this.root.querySelectorAll('img'));

    images.forEach(function (image) {
      if (image.complete) return;
      image.addEventListener('load', self.onResize, { once: true });
      image.addEventListener('error', self.onResize, { once: true });
    });
  };

  /* ------------------------------------------------------------------
     The clock
     ------------------------------------------------------------------ */

  AsSeenIn.prototype.start = function () {
    var self = this;

    if (this.gsap && this.gsap.ticker) {
      this.tick = function (time, delta) {
        self.onFrame(delta / 1000);
      };
      this.gsap.ticker.add(this.tick);
      return;
    }

    var loop = function (now) {
      var delta = self.lastTime ? (now - self.lastTime) / 1000 : 0;
      self.lastTime = now;
      self.onFrame(delta);
      self.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  };

  AsSeenIn.prototype.frame = function (delta) {
    var self = this;
    // A backgrounded tab hands back one enormous frame; spending it would
    // teleport the rows.
    var step = Math.min(delta || 0, MAX_FRAME);
    if (!step || !this.visible) return;

    // Exponential rather than linear: the further the velocity is from where
    // it belongs, the harder it is pulled back, which is what makes a throw
    // bleed off instead of stopping.
    var pull = 1 - Math.exp(-step / SETTLE);

    this.rows.forEach(function (row) {
      if (!row.width) return;

      if (row.drag) {
        self.render(row);
        return;
      }

      var target = self.still ? 0 : row.direction * self.speed * self.scale;
      row.velocity += (target - row.velocity) * pull;
      row.x = wrap(row.x + row.velocity * step, row.width);
      self.render(row);
    });
  };

  /* ------------------------------------------------------------------
     Grab
     ------------------------------------------------------------------ */

  AsSeenIn.prototype.bind = function () {
    var self = this;

    this.rows.forEach(function (row) {
      row.element.addEventListener('pointerdown', function (event) {
        self.grab(row, event);
      });
      row.element.addEventListener('pointermove', function (event) {
        self.move(row, event);
      });
      row.element.addEventListener('pointerup', function (event) {
        self.release(row, event);
      });
      row.element.addEventListener('pointercancel', function (event) {
        self.release(row, event);
      });
    });

    // A throw that ends over a link must not also follow it.
    this.root.addEventListener(
      'click',
      function (event) {
        if (!self.swallowClick) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    // Delegated: the logo under the pointer belongs to whichever copy of the
    // sequence is passing, and clones arrive after this runs.
    this.root.addEventListener('pointerover', function (event) {
      var logo = closestFrom(event.target, '[data-asi-logo]');
      if (!logo || logo === self.hovered) return;
      self.focus(logo);
    });

    this.root.addEventListener('pointerout', function (event) {
      var logo = closestFrom(event.target, '[data-asi-logo]');
      if (!logo) return;
      // Moving between two children of the same logo is not leaving it.
      if (closestFrom(event.relatedTarget, '[data-asi-logo]') === logo) return;
      self.blur();
    });

    this.root.addEventListener('focusin', function (event) {
      var logo = closestFrom(event.target, '[data-asi-logo]');
      if (logo) self.focus(logo);
    });

    this.root.addEventListener('focusout', function () {
      self.blur();
    });

    window.addEventListener('resize', this.onResize);

    var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var onMotion = function (event) {
      self.still = event.matches;
    };
    if (motion.addEventListener) motion.addEventListener('change', onMotion);
    else if (motion.addListener) motion.addListener(onMotion);

    // Nothing to move while the section is somewhere else on the page.
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(function (entries) {
        self.visible = entries[0].isIntersecting;
      });
      this.observer.observe(this.root);
    }
  };

  AsSeenIn.prototype.grab = function (row, event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (!row.width) return;

    row.drag = {
      id: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: event.timeStamp || performance.now(),
      origin: row.x,
      distance: 0,
      velocity: 0,
      active: false,
    };

    // Whatever the row was doing is the hand's business now; the drift picks
    // up again from the speed of the throw.
    row.velocity = 0;
  };

  AsSeenIn.prototype.move = function (row, event) {
    var drag = row.drag;
    if (!drag || event.pointerId !== drag.id) return;

    var dx = event.clientX - drag.startX;
    drag.distance = Math.abs(dx);

    if (!drag.active) {
      if (drag.distance < DRAG_THRESHOLD) return;
      drag.active = true;
      this.root.classList.add('is-grabbing');
      // Not before now: a captured pointer has its click dispatched to the
      // element holding the capture, so capturing on pointerdown would take
      // every click away from the logo links inside the row.
      if (row.element.setPointerCapture) row.element.setPointerCapture(drag.id);
    }

    var now = event.timeStamp || performance.now();
    var elapsed = now - drag.lastTime;
    if (elapsed > 0) {
      var instant = ((event.clientX - drag.lastX) / elapsed) * 1000;
      // Smoothed, so one stuttering frame at the moment of release cannot
      // decide how hard the row was thrown.
      drag.velocity = drag.velocity * 0.7 + instant * 0.3;
      drag.lastX = event.clientX;
      drag.lastTime = now;
    }

    row.x = wrap(drag.origin + dx, row.width);
  };

  AsSeenIn.prototype.release = function (row, event) {
    var drag = row.drag;
    if (!drag || (event && event.pointerId !== drag.id)) return;

    row.drag = null;
    row.velocity = clamp(drag.velocity, MAX_FLING);
    this.root.classList.remove('is-grabbing');

    if (drag.distance > CLICK_CANCEL_DISTANCE) {
      var self = this;
      this.swallowClick = true;
      setTimeout(function () {
        self.swallowClick = false;
      }, 0);
    }
  };

  /* ------------------------------------------------------------------
     Hover
     ------------------------------------------------------------------ */

  AsSeenIn.prototype.focus = function (logo) {
    if (this.hovered) this.hovered.classList.remove('is-hovered');
    this.hovered = logo;
    logo.classList.add('is-hovered');
    this.root.classList.add('is-focusing');
    // Eased by the same pull as everything else: the row leans into the slower
    // speed rather than dropping to it.
    this.scale = this.slowOnHover ? HOVER_SCALE : 1;
  };

  AsSeenIn.prototype.blur = function () {
    if (this.hovered) this.hovered.classList.remove('is-hovered');
    this.hovered = null;
    this.root.classList.remove('is-focusing');
    this.scale = 1;
  };

  /* ------------------------------------------------------------------
     Teardown
     ------------------------------------------------------------------ */

  AsSeenIn.prototype.destroy = function () {
    window.removeEventListener('resize', this.onResize);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.gsap && this.tick) this.gsap.ticker.remove(this.tick);
    if (this.observer) this.observer.disconnect();
    this.ready = false;
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-asi]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.asiInstance) return;
      root.asiInstance = new AsSeenIn(root);
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
    var root = event.target.querySelector('[data-asi]');
    if (root && root.asiInstance) {
      root.asiInstance.destroy();
      root.asiInstance = null;
    }
  });
})();
