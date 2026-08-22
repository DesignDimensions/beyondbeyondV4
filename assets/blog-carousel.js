/**
 * Blog Carousel
 *
 * A rail of posts beside the copy that introduces them. Scrolling is the
 * browser's own — a touch swipe and a trackpad both already do it — so this
 * file only adds what a scroll box cannot say for itself: a row of dots
 * reading how far along the rail is, and a drag for the pointers that have no
 * swipe of their own.
 */
(function () {
  'use strict';

  // Below this the pointer has not committed to anything yet; past it the
  // movement is a drag and the click it ends with is not a choice.
  var DRAG_THRESHOLD = 6;
  var CLICK_CANCEL_DISTANCE = 10;

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

  function BlogCarousel(root) {
    this.ready = false;
    this.root = root;
    this.rail = root.querySelector('[data-bc-rail]');
    this.dots = root.querySelector('[data-bc-dots]');
    if (!this.rail) return;

    this.dragState = null;
    this.swallowClick = false;

    this.onResize = this.sync.bind(this);
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);

    this.bind();
    this.sync();

    // Late-loading post images change how wide the rail's contents are, and a
    // row of dots counted before them would be short.
    this.watchImages();

    this.ready = true;
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  BlogCarousel.prototype.bind = function () {
    var self = this;

    this.rail.addEventListener('scroll', function () {
      self.updateDots();
    }, { passive: true });

    this.rail.addEventListener('pointerdown', this.onPointerDown);

    // The pictures and the links inside the rail each come with a drag of
    // their own, and whichever one the pointer happens to land on would take
    // the gesture over. Refusing every native drag inside the rail leaves the
    // one below as the only thing a grab can start.
    this.rail.addEventListener('dragstart', function (event) {
      event.preventDefault();
    });

    // A drag that ended over a card is the release, not a click on the post.
    this.rail.addEventListener('click', function (event) {
      if (!self.swallowClick) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);

    window.addEventListener('resize', this.onResize);
  };

  BlogCarousel.prototype.watchImages = function () {
    var self = this;
    var images = Array.prototype.slice.call(this.rail.querySelectorAll('img'));

    images.forEach(function (image) {
      if (image.complete) return;
      image.addEventListener('load', self.onResize, { once: true });
      image.addEventListener('error', self.onResize, { once: true });
    });
  };

  BlogCarousel.prototype.sync = function () {
    this.buildDots();
    this.updateDots();
  };

  /* ------------------------------------------------------------------
     Drag
     ------------------------------------------------------------------
     A mouse has no swipe, so the rail follows the pointer directly. Touch is
     left to the browser: it already scrolls this box, and taking the events
     over would only take away its momentum and its rubber banding.
     ------------------------------------------------------------------ */

  BlogCarousel.prototype.handlePointerDown = function (event) {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    if (this.rail.scrollWidth - this.rail.clientWidth <= 1) return;

    this.dragState = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originScroll: this.rail.scrollLeft,
      active: false,
      distance: 0,
    };

    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  };

  BlogCarousel.prototype.handlePointerMove = function (event) {
    var state = this.dragState;
    if (!state || event.pointerId !== state.id) return;

    var dx = event.clientX - state.startX;
    var dy = event.clientY - state.startY;
    state.distance = Math.abs(dx);

    if (!state.active) {
      // Vertical intent belongs to the page, so only clearly sideways movement
      // is claimed — otherwise scrolling past the rail would snag on it.
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        this.endDrag();
        return;
      }
      state.active = true;
      this.rail.classList.add('is-dragging');
    }

    if (event.cancelable) event.preventDefault();
    this.rail.scrollLeft = state.originScroll - dx;
  };

  BlogCarousel.prototype.handlePointerUp = function () {
    var state = this.dragState;
    if (!state) return;

    var distance = state.active ? state.distance : 0;
    this.endDrag();

    if (distance <= CLICK_CANCEL_DISTANCE) return;

    // The click lands after this handler, so the flag has to outlive the
    // release by exactly one turn of the event loop.
    this.swallowClick = true;
    var self = this;
    setTimeout(function () {
      self.swallowClick = false;
    }, 0);
  };

  BlogCarousel.prototype.endDrag = function () {
    this.dragState = null;
    this.rail.classList.remove('is-dragging');
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  };

  /* ------------------------------------------------------------------
     Dots
     ------------------------------------------------------------------ */

  // One dot per railful of cards, so the row of them is as long as the rail
  // has left to go.
  BlogCarousel.prototype.buildDots = function () {
    var self = this;
    var dots = this.dots;
    if (!dots) return;

    var pages = this.rail.clientWidth ? Math.ceil(this.rail.scrollWidth / this.rail.clientWidth) : 0;
    // A rail that fits its cards has nothing to page through, and a lone dot
    // would say nothing.
    if (pages < 2) pages = 0;
    if (dots.childElementCount === pages) return;

    var label = dots.dataset.bcDotLabel || '';
    dots.textContent = '';

    for (var i = 0; i < pages; i += 1) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'bc__dot';
      dot.setAttribute('data-bc-dot', '');
      dot.setAttribute('aria-label', label ? label + ' ' + (i + 1) : String(i + 1));
      dots.appendChild(dot);

      (function (index) {
        dot.addEventListener('click', function () {
          self.goToDot(index);
        });
      })(i);
    }
  };

  // Progress, not selection: dragging the rail moves the dots without anything
  // being chosen, the same way a scrollbar does. Mapping the whole scroll onto
  // the dots — rather than counting railfuls off the left — is what makes the
  // last dot light when the rail reaches its end, however short that last page
  // turns out to be.
  BlogCarousel.prototype.updateDots = function () {
    var dots = this.dots;
    if (!dots || !dots.childElementCount) return;

    var count = dots.childElementCount;
    var max = this.rail.scrollWidth - this.rail.clientWidth;
    var progress = max > 0 ? clamp(this.rail.scrollLeft / max, 0, 1) : 0;
    var active = Math.round(progress * (count - 1));

    Array.prototype.forEach.call(dots.children, function (dot, index) {
      var on = index === active;
      dot.classList.toggle('is-active', on);
      if (on) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  // The inverse of updateDots's progress math, so a tap lands the rail at the
  // same point the dot's position in the row promised.
  BlogCarousel.prototype.goToDot = function (index) {
    var dots = this.dots;
    if (!dots) return;

    var count = dots.childElementCount;
    var max = this.rail.scrollWidth - this.rail.clientWidth;

    this.rail.scrollTo({
      left: count > 1 ? (index / (count - 1)) * max : 0,
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  };

  /* ------------------------------------------------------------------
     Teardown
     ------------------------------------------------------------------ */

  BlogCarousel.prototype.destroy = function () {
    this.endDrag();
    window.removeEventListener('resize', this.onResize);
    this.ready = false;
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-bc]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.bcInstance) return;
      root.bcInstance = new BlogCarousel(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }

  // The dots are counted from a laid-out rail, and web fonts landing late
  // reflow the titles under the pictures.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-bc]'), function (root) {
        if (root.bcInstance && root.bcInstance.ready) root.bcInstance.sync();
      });
    });
  }

  /* Theme editor */

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });

  document.addEventListener('shopify:section:unload', function (event) {
    var root = event.target.querySelector('[data-bc]');
    if (root && root.bcInstance) {
      root.bcInstance.destroy();
      root.bcInstance = null;
    }
  });

  document.addEventListener('shopify:section:select', function (event) {
    var root = closestFrom(event.target, '[data-bc]') || event.target.querySelector('[data-bc]');
    if (root && root.bcInstance && root.bcInstance.ready) root.bcInstance.sync();
  });
})();
