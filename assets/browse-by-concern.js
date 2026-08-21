/**
 * Browse By Concern
 *
 * A draggable rail of concerns sitting over the product grid it filters. Every
 * concern's products are already in the page, so selecting one is a local
 * crossfade — GSAP drives it when the theme has loaded it and CSS transitions
 * cover the case where it has not.
 */
(function () {
  'use strict';

  var MOBILE_QUERY = '(max-width: 749px)';
  var DRAG_THRESHOLD = 6;
  var CLICK_CANCEL_DISTANCE = 10;
  var FIT_TOLERANCE = 2;
  var EASE = 'power3.out';
  // Below this speed (px/ms) a release reads as a deliberate stop, not a
  // flick, so momentum only kicks in once the throw is fast enough to mean it.
  var MOMENTUM_MIN_VELOCITY = 0.15;
  // Converts the release velocity into extra travel distance, so a fast flick
  // keeps gliding past where the finger let go instead of stopping dead there.
  var MOMENTUM_DISTANCE = 200;

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  // Event targets are not always elements (document, text nodes), so never
  // call closest() on them blind.
  function closestFrom(target, selector) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(selector);
  }

  function BrowseByConcern(root) {
    this.ready = false;
    this.root = root;
    this.viewport = root.querySelector('[data-bbc-viewport]');
    this.track = root.querySelector('[data-bbc-track]');
    this.panelsWrap = root.querySelector('[data-bbc-panels]');
    if (!this.viewport || !this.track || !this.panelsWrap) return;

    this.concerns = Array.prototype.slice.call(root.querySelectorAll('[data-bbc-concern]'));
    this.panels = Array.prototype.slice.call(root.querySelectorAll('[data-bbc-panel]'));
    this.dots = Array.prototype.slice.call(root.querySelectorAll('[data-bbc-dot]'));
    if (!this.concerns.length) return;

    this.gsap = window.gsap || null;
    this.loop = root.dataset.loop === 'true';

    this.prevArrow = root.querySelector('[data-bbc-arrow="prev"]');
    this.nextArrow = root.querySelector('[data-bbc-arrow="next"]');

    this.index = 0;
    this.x = 0;
    this.maxScroll = 0;
    this.step = 0;
    this.tween = null;
    this.dragState = null;
    this.swallowClick = false;
    this.swapTimeline = null;

    this.resizeFrame = null;
    this.onResize = this.requestMeasure.bind(this);
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);

    this.bind();
    this.measure();

    // Late-loading concern thumbnails change the track width, and a rail
    // measured before them would leave the last item unreachable.
    this.watchImages();

    this.ready = true;
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  BrowseByConcern.prototype.bind = function () {
    var self = this;

    this.concerns.forEach(function (button, index) {
      button.addEventListener('click', function () {
        // A click that ended a drag is the release, not a choice.
        if (self.swallowClick) return;
        self.select(index);
      });
    });

    this.track.addEventListener('keydown', function (event) {
      self.handleKeydown(event);
    });

    if (this.prevArrow) {
      this.prevArrow.addEventListener('click', function () {
        self.page(-1);
      });
    }

    if (this.nextArrow) {
      this.nextArrow.addEventListener('click', function () {
        self.page(1);
      });
    }

    this.dots.forEach(function (dot, index) {
      dot.addEventListener('click', function () {
        self.goToDot(index);
      });
    });

    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('resize', this.onResize);

  };

  BrowseByConcern.prototype.watchImages = function () {
    var self = this;
    var images = Array.prototype.slice.call(this.track.querySelectorAll('img'));

    images.forEach(function (image) {
      if (image.complete) return;
      image.addEventListener('load', self.onResize, { once: true });
      image.addEventListener('error', self.onResize, { once: true });
    });
  };

  /* ------------------------------------------------------------------
     Rail geometry
     ------------------------------------------------------------------ */

  // measure() forces a layout read, so coalesce the burst of resize events a
  // window drag produces into one measurement per frame.
  BrowseByConcern.prototype.requestMeasure = function () {
    var self = this;
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(function () {
      self.resizeFrame = null;
      self.measure();
    });
  };

  BrowseByConcern.prototype.measure = function () {
    var viewportWidth = this.viewport.clientWidth;
    var trackWidth = this.track.scrollWidth;

    // The thumbnails are sized to fill the row exactly, and rounding a set of
    // percentages back into device pixels can leave a hair of overflow. Read
    // as scrollable, that hair would cost the arrows their real job of
    // stepping the selection, so ignore anything under a pixel or two.
    var overflow = trackWidth - viewportWidth;
    this.maxScroll = overflow > FIT_TOLERANCE ? overflow : 0;

    // One step is one thumbnail plus its gap, taken from the live layout so
    // the section settings never have to be mirrored here.
    var first = this.concerns[0];
    var second = this.concerns[1];
    if (first && second) {
      this.step = second.offsetLeft - first.offsetLeft;
    } else if (first) {
      this.step = first.offsetWidth;
    }
    if (!this.step) this.step = 120;

    // A rail that fits sits centred; only an overflowing one scrolls.
    var fits = this.maxScroll <= 0;
    this.track.style.justifyContent = fits ? '' : 'flex-start';

    this.setX(clamp(this.x, -this.maxScroll, 0), true);
    this.updateArrows();
  };

  BrowseByConcern.prototype.setX = function (value, immediate) {
    this.x = value;

    if (this.tween) {
      this.tween.kill();
      this.tween = null;
    }

    // GSAP caches the transform it wrote, so once it is driving the track it
    // has to keep driving it — a raw style.transform here would desync it.
    if (this.gsap) {
      if (immediate || reducedMotion()) this.gsap.set(this.track, { x: value });
      else {
        this.tween = this.gsap.to(this.track, {
          x: value,
          duration: 0.75,
          ease: EASE,
          overwrite: true,
        });
      }
    } else {
      this.track.style.transition =
        immediate || reducedMotion() ? 'none' : 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
      this.track.style.transform = 'translate3d(' + value + 'px, 0, 0)';
    }

    this.updateArrows();
    this.updateDots();
  };

  // The dots track scroll progress, not selection — dragging the rail moves
  // them without picking a concern, same as a scrollbar. Only once the rail
  // no longer scrolls at all do they fall back to tracking the selected tab,
  // since progress along a rail with nothing to scroll isn't meaningful.
  BrowseByConcern.prototype.updateDots = function () {
    if (!this.dots.length) return;

    var count = this.dots.length;
    var activeIndex;

    if (this.maxScroll > 0) {
      var progress = clamp(-this.x / this.maxScroll, 0, 1);
      activeIndex = Math.round(progress * (count - 1));
    } else {
      activeIndex = this.index;
    }

    this.dots.forEach(function (dot, i) {
      dot.classList.toggle('is-active', i === activeIndex);
    });
  };

  // The inverse of updateDots's progress math, so a tap lands the rail at
  // the same point the dot's position on the row promised.
  BrowseByConcern.prototype.goToDot = function (index) {
    var count = this.dots.length;
    if (!count) return;

    if (this.maxScroll > 0) {
      var progress = count > 1 ? index / (count - 1) : 0;
      this.setX(clamp(-progress * this.maxScroll, -this.maxScroll, 0));
    } else {
      this.select(index);
    }
  };

  BrowseByConcern.prototype.page = function (direction) {
    if (this.maxScroll <= 0) {
      // Nothing to scroll, so the arrows step the selection instead.
      this.select(this.wrapIndex(this.index + direction));
      return;
    }

    var target = this.x - direction * this.step;

    if (this.loop) {
      if (target < -this.maxScroll - 1) target = 0;
      else if (target > 1) target = -this.maxScroll;
    }

    this.setX(clamp(target, -this.maxScroll, 0));
  };

  BrowseByConcern.prototype.wrapIndex = function (index) {
    var count = this.concerns.length;
    return ((index % count) + count) % count;
  };

  BrowseByConcern.prototype.updateArrows = function () {
    if (this.loop || !this.prevArrow || !this.nextArrow) return;

    var atStart = this.x >= -1;
    var atEnd = this.x <= -this.maxScroll + 1;
    var fits = this.maxScroll <= 0.5;

    this.prevArrow.classList.toggle('is-disabled', fits ? this.index === 0 : atStart);
    this.nextArrow.classList.toggle('is-disabled', fits ? this.index === this.concerns.length - 1 : atEnd);
  };

  // Keeps a chosen concern fully inside the viewport, nudging by the smallest
  // amount that clears the edge rather than recentring the whole rail.
  BrowseByConcern.prototype.reveal = function (index) {
    if (this.maxScroll <= 0) return;

    var button = this.concerns[index];
    if (!button) return;

    var pad = this.step * 0.5;
    var left = button.offsetLeft;
    var right = left + button.offsetWidth;
    var railWidth = this.viewport.clientWidth;
    var viewLeft = -this.x;
    var viewRight = viewLeft + railWidth;
    var target = this.x;

    if (left - pad < viewLeft) target = -(left - pad);
    else if (right + pad > viewRight) target = -(right + pad - railWidth);

    if (target === this.x) return;
    this.setX(clamp(target, -this.maxScroll, 0));
  };

  /* ------------------------------------------------------------------
     Drag
     ------------------------------------------------------------------ */

  BrowseByConcern.prototype.handlePointerDown = function (event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (this.maxScroll <= 0) return;

    this.dragState = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.x,
      active: false,
      distance: 0,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
    };

    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  };

  BrowseByConcern.prototype.handlePointerMove = function (event) {
    var state = this.dragState;
    if (!state || event.pointerId !== state.id) return;

    var dx = event.clientX - state.startX;
    var dy = event.clientY - state.startY;
    state.distance = Math.abs(dx);

    if (!state.active) {
      // Vertical intent belongs to the page, so only claim clearly sideways
      // movement — otherwise scrolling past the rail would snag on it.
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        this.endDrag();
        return;
      }
      state.active = true;
      this.root.classList.add('bbc--dragging');
    }

    if (event.cancelable) event.preventDefault();

    // Instantaneous speed from the most recent sample, not the average over
    // the whole drag — a release right after a fast flick should carry the
    // flick's speed even if the drag started slowly.
    var dt = event.timeStamp - state.lastTime;
    if (dt > 0) state.velocity = (event.clientX - state.lastX) / dt;
    state.lastX = event.clientX;
    state.lastTime = event.timeStamp;

    // Past either end the rail follows at a third speed, which reads as
    // resistance instead of a dead stop.
    var next = state.originX + dx;
    if (next > 0) next = next / 3;
    else if (next < -this.maxScroll) next = -this.maxScroll + (next + this.maxScroll) / 3;

    this.setX(next, true);
  };

  BrowseByConcern.prototype.handlePointerUp = function () {
    var state = this.dragState;
    if (!state) return;

    var dragged = state.active;
    var distance = state.distance;
    var velocity = state.velocity;

    this.endDrag();

    if (!dragged) return;

    // A fast flick keeps gliding past the release point and decelerates into
    // place, rather than always stopping exactly where the finger lifted.
    var target = this.x;
    if (Math.abs(velocity) > MOMENTUM_MIN_VELOCITY) {
      target = this.x + velocity * MOMENTUM_DISTANCE;
    }

    this.setX(clamp(target, -this.maxScroll, 0));

    if (distance > CLICK_CANCEL_DISTANCE) {
      this.swallowClick = true;
      var self = this;
      setTimeout(function () {
        self.swallowClick = false;
      }, 0);
    }
  };

  BrowseByConcern.prototype.endDrag = function () {
    this.dragState = null;
    this.root.classList.remove('bbc--dragging');
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  };

  /* ------------------------------------------------------------------
     Selection
     ------------------------------------------------------------------ */

  BrowseByConcern.prototype.handleKeydown = function (event) {
    var key = event.key;
    var next = null;

    if (key === 'ArrowRight') next = this.wrapIndex(this.index + 1);
    else if (key === 'ArrowLeft') next = this.wrapIndex(this.index - 1);
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = this.concerns.length - 1;
    else return;

    event.preventDefault();
    this.select(next);
    this.concerns[next].focus();
  };

  BrowseByConcern.prototype.select = function (index) {
    if (index === this.index || index < 0 || index >= this.concerns.length) {
      this.reveal(index);
      return;
    }

    var previous = this.index;
    this.index = index;

    this.concerns.forEach(function (button, i) {
      var active = i === index;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });

    this.reveal(index);
    this.swapPanels(previous, index);
    this.updateArrows();
    this.updateDots();
  };

  BrowseByConcern.prototype.swapPanels = function (from, to) {
    var self = this;
    var incoming = this.panels[to];
    if (!incoming) return;

    // A swap already running owns the panels' inline state; hand it the new
    // destination rather than layering a second timeline on top.
    if (this.swapTimeline) {
      this.swapTimeline.kill();
      this.swapTimeline = null;
    }

    var animate = this.gsap && !reducedMotion();

    // Read the outgoing height before anything is hidden — a panel that is
    // already display:none measures zero and the wrapper would jump.
    var startHeight = animate ? this.panelsWrap.offsetHeight : 0;

    this.panels.forEach(function (panel) {
      if (panel === incoming) return;
      panel.hidden = true;
      panel.classList.remove('is-active');
      if (self.gsap) self.gsap.set(panel.querySelectorAll('.pcard'), { clearProps: 'all' });
    });

    incoming.hidden = false;
    incoming.classList.add('is-active');

    if (!animate) {
      this.panelsWrap.classList.remove('is-swapping');
      this.panelsWrap.style.height = '';
      return;
    }

    var cards = incoming.querySelectorAll('.pcard');
    var endHeight = incoming.offsetHeight;

    this.panelsWrap.classList.add('is-swapping');

    // Direction of travel matches the rail, so the grid reads as sliding in
    // from the side the shopper moved towards.
    var direction = to > from ? 1 : -1;

    this.swapTimeline = this.gsap.timeline({
      onComplete: function () {
        self.swapTimeline = null;
        self.panelsWrap.classList.remove('is-swapping');
        self.panelsWrap.style.height = '';
        self.gsap.set(cards, { clearProps: 'all' });
      },
    });

    if (Math.abs(endHeight - startHeight) > 1) {
      this.swapTimeline.fromTo(
        this.panelsWrap,
        { height: startHeight },
        { height: endHeight, duration: 0.55, ease: 'power2.inOut' },
        0
      );
    }

    this.swapTimeline.fromTo(
      cards,
      { opacity: 0, y: 26, x: direction * 22 },
      {
        opacity: 1,
        y: 0,
        x: 0,
        duration: 0.6,
        ease: EASE,
        stagger: { each: 0.055, from: 'start' },
      },
      0
    );
  };

  /* ------------------------------------------------------------------
     Teardown
     ------------------------------------------------------------------ */

  BrowseByConcern.prototype.destroy = function () {
    this.endDrag();
    window.removeEventListener('resize', this.onResize);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.tween) this.tween.kill();
    if (this.swapTimeline) this.swapTimeline.kill();
    this.ready = false;
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-bbc]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.bbcInstance) return;
      root.bbcInstance = new BrowseByConcern(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }

  // The rail is measured from laid-out thumbnails, and web fonts landing late
  // reflow the labels underneath them.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-bbc]'), function (root) {
        if (root.bbcInstance && root.bbcInstance.ready) root.bbcInstance.measure();
      });
    });
  }

  /* Theme editor */

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });

  document.addEventListener('shopify:section:unload', function (event) {
    var root = event.target.querySelector('[data-bbc]');
    if (root && root.bbcInstance) {
      root.bbcInstance.destroy();
      root.bbcInstance = null;
    }
  });

  document.addEventListener('shopify:block:select', function (event) {
    var root = closestFrom(event.target, '[data-bbc]');
    var instance = root && root.bbcInstance;
    if (!instance || !instance.ready) return;

    instance.select(parseInt(event.target.dataset.index, 10) || 0);
  });
})();
