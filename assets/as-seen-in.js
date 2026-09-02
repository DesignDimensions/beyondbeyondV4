/**
 * As Seen In
 *
 * Two rows of press logos drifting endlessly, and grabbable — you can catch a
 * row, throw it, and watch it settle back into its drift. The whole row is
 * one link to the press page: a pointer tag rides the cursor over it saying
 * so, and a plain click (not a throw) follows it.
 *
 * Position is driven per frame rather than by a tween, because a tween owns the
 * value it animates and a hand on the row has to be able to take it back
 * mid-flight. Each row keeps an offset and a velocity: the offset wraps at one
 * sequence's width, which is what makes the loop endless with no seam to hide,
 * and the velocity is only ever eased toward whatever it should be — the drift,
 * or the speed of a throw. Nothing is ever set hard, so every change of state
 * arrives as a settle rather than a jump.
 *
 * GSAP drives the clock and the writes where the theme has loaded it; without
 * it the same arithmetic runs on requestAnimationFrame.
 *
 * The pointer tag is the same one the testimonials rail and the bikaneri
 * kitchen banner use: a pill that rides beside the cursor, flips in and out,
 * and tilts with the direction the pointer is moving. Split in two — the
 * outer element only translates, the inner only rotates — because combining a
 * percentage translation with a 3D rotation on one element shears it into a
 * parallelogram instead of flipping. It is re-parented to <body>: any
 * transform on an ancestor, even an identity one left behind by a finished
 * tween, would make that ancestor the containing block for a fixed element
 * and strand the tag far from the pointer. Unlike the testimonials tag, the
 * label here never changes — the whole row is one link, so there is only ever
 * one thing for it to say.
 */
(function () {
  'use strict';

  /* Seconds for a row to give up a throw and be drifting again. Long enough to
     read as momentum, short enough that the row never feels lost. */
  var SETTLE = 0.62;
  var MAX_FLING = 3200;
  var DRAG_THRESHOLD = 4;
  var CLICK_CANCEL_DISTANCE = 8;
  var MAX_FRAME = 0.05;

  var CURSOR_OFFSET_X = 22;
  var TILT_MAX = 28;
  var TILT_FACTOR = 0.85;
  var TILT_VERTICAL_BOOST = 1.6;
  var TILT_SMOOTHING = 0.35;
  /* The row is a thin strip and the section's padding around it is where the
     eye naturally drifts while reading the heading or just arriving from
     elsewhere on the page, so the pointer clips outside `:hover` for a frame
     or two on nearly every pass. Closing on the spot reads as the tag
     breaking; holding it open for a beat and only closing if the pointer
     really has left lets it keep gliding with the cursor through that
     instead. */
  var CLOSE_DELAY = 180;

  // Shared live pointer position. Only ever used to place the tag — whether it
  // counts as hovering the row is decided from the browser's own :hover state,
  // which is the only thing that knows what is painted on top of what.
  var mouseX = -Infinity;
  var mouseY = -Infinity;
  var hasMouse = false;

  document.addEventListener('pointermove', function (event) {
    if (event.pointerType !== 'mouse') return;
    mouseX = event.clientX;
    mouseY = event.clientY;
    hasMouse = true;
  });

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
    this.fx = !!this.gsap && !reducedMotion();
    this.speed = parseFloat(root.dataset.speed) || 45;
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
    this.initCursor();

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

      var target = self.still ? 0 : row.direction * self.speed;
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

    // The row itself is a real link and navigates on its own; everywhere
    // else in the section — the heading, the padding, the glow — is not,
    // so a plain click there is sent to the same place by hand. Either way,
    // a throw that ends over the link must not also follow it.
    var rowsLink = this.root.querySelector('[data-asi-rows]');
    this.viewAllHref = rowsLink && rowsLink.getAttribute('href');

    this.root.addEventListener(
      'click',
      function (event) {
        if (self.swallowClick) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!self.viewAllHref || closestFrom(event.target, '[data-asi-rows]')) return;
        window.location.assign(self.viewAllHref);
      },
      true
    );

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
      // every plain click away from the row's own link before it could
      // navigate.
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
     Pointer tag
     ------------------------------------------------------------------ */

  AsSeenIn.prototype.initCursor = function () {
    var self = this;
    var root = this.root;
    var tag = root.querySelector('[data-asi-cursor]');
    var flip = tag && tag.querySelector('[data-asi-cursor-flip]');

    var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!tag || !flip || !this.fx || !fine) return;

    document.body.appendChild(tag);
    tag.classList.add('is-enabled');
    this.cursorTag = tag;

    var gsap = this.gsap;
    gsap.set(tag, { xPercent: 0, yPercent: -50 });
    gsap.set(flip, {
      transformOrigin: 'center center',
      transformPerspective: 200,
      rotationX: -100,
      opacity: 0,
    });

    var moveX = gsap.quickTo(tag, 'x', { duration: 0.55, ease: 'power3' });
    var moveY = gsap.quickTo(tag, 'y', { duration: 0.55, ease: 'power3' });
    var setTilt = gsap.quickTo(flip, 'rotation', { duration: 0.3, ease: 'power2' });

    var isOpen = false;
    var isFlipping = false;
    var prevX = 0;
    var prevY = 0;
    // Eased rather than the raw per-frame delta: a short, slow movement's
    // real signal is only a pixel or two, so on its own it is mostly the
    // noise of pointer coalescing landing unevenly across frames — some
    // frames get no delta and the next one gets it all. Chasing that raw
    // value tilts in jerks; easing it lets a real stop decay out instead of
    // snapping flat.
    var tiltDeltaX = 0;
    var tiltDeltaY = 0;

    var open = function () {
      if (isOpen) return;
      isOpen = true;
      isFlipping = true;
      gsap.killTweensOf(flip, 'rotationX,opacity');
      gsap.set(flip, { rotation: 0 });
      gsap.to(flip, {
        rotationX: 0,
        opacity: 1,
        duration: 0.6,
        ease: 'back.out(1.15)',
        onComplete: function () {
          isFlipping = false;
        },
      });
    };

    var close = function () {
      if (!isOpen) return;
      isOpen = false;
      isFlipping = true;
      gsap.killTweensOf(flip, 'rotationX,opacity');
      gsap.set(flip, { rotation: 0 });
      gsap.to(flip, {
        rotationX: -100,
        opacity: 0,
        duration: 0.4,
        ease: 'power2.inOut',
        onComplete: function () {
          isFlipping = false;
        },
      });
    };

    // The whole section, not just the row's own link: the heading and the
    // padding around the rows are part of "view all" too now, and hovering
    // on and off just the logos as they drift past would flip the tag open
    // and shut between them instead of holding it through the section.
    var hovering = function () {
      return root.matches(':hover');
    };

    this.cursorTick = function () {
      if (!hasMouse) return;

      var over = hovering();

      if (over) {
        // Back over the section before the grace period ran out: the tag
        // was never really left, so there is nothing to cancel back out of.
        if (self.cursorCloseTimer) {
          clearTimeout(self.cursorCloseTimer);
          self.cursorCloseTimer = null;
        }

        if (!isOpen) {
          // Entering the row: place the tag before showing it, or it would
          // fly in from wherever it was last left.
          gsap.set(tag, { x: mouseX + CURSOR_OFFSET_X, y: mouseY });
          prevX = mouseX;
          prevY = mouseY;
          open();
        }
      } else if (isOpen && !self.cursorCloseTimer) {
        self.cursorCloseTimer = setTimeout(function () {
          self.cursorCloseTimer = null;
          close();
        }, CLOSE_DELAY);
      }

      if (!isOpen) return;

      moveX(mouseX + CURSOR_OFFSET_X);
      moveY(mouseY);

      if (!isFlipping) {
        var deltaX = mouseX - prevX;
        var deltaY = mouseY - prevY;
        tiltDeltaX += (deltaX - tiltDeltaX) * TILT_SMOOTHING;
        tiltDeltaY += (deltaY - tiltDeltaY) * TILT_SMOOTHING;
        var raw = -tiltDeltaX + tiltDeltaY * TILT_VERTICAL_BOOST;
        setTilt(gsap.utils.clamp(-TILT_MAX, TILT_MAX, raw * TILT_FACTOR));
      }

      prevX = mouseX;
      prevY = mouseY;
    };

    gsap.ticker.add(this.cursorTick);
  };

  /* ------------------------------------------------------------------
     Teardown
     ------------------------------------------------------------------ */

  AsSeenIn.prototype.destroy = function () {
    window.removeEventListener('resize', this.onResize);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.gsap && this.tick) this.gsap.ticker.remove(this.tick);
    if (this.gsap && this.cursorTick) this.gsap.ticker.remove(this.cursorTick);
    if (this.cursorCloseTimer) clearTimeout(this.cursorCloseTimer);
    // The tag lives on <body> now, so it does not leave with the section.
    if (this.cursorTag && this.cursorTag.parentNode) this.cursorTag.parentNode.removeChild(this.cursorTag);
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
