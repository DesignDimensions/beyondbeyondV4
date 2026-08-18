/**
 * Testimonials
 *
 * A rail of vertical videos, each with the product it speaks about laid over
 * its foot. The videos play muted — autoplay policy allows nothing else — and
 * a click anywhere on one fades its sound up. Only ever one at a time: turning
 * a video on turns the rest off, because two people talking over each other is
 * nobody's idea of a testimonial.
 *
 * The pointer tag is the same one the bikaneri kitchen banner uses: a pill that
 * rides beside the cursor over a video, says what a click will do, flips in and
 * out, and tilts with the direction the pointer is moving. It is split in two —
 * the outer element only translates, the inner only rotates — because combining
 * a percentage translation with a 3D rotation on one element shears it into a
 * parallelogram instead of flipping. It is also re-parented to <body>: any
 * transform on an ancestor, even an identity one left behind by a finished
 * tween, would make that ancestor the containing block for a fixed element and
 * strand the tag far from the pointer.
 */
(function () {
  'use strict';

  var CURSOR_OFFSET_X = 22;
  var TILT_MAX = 28;
  var TILT_FACTOR = 0.85;
  var TILT_VERTICAL_BOOST = 1.6;
  var FADE = 0.5;

  // Shared live pointer position. Only ever used to place the tag — whether it
  // counts as hovering a video is decided from the browser's own :hover state,
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

  function Testimonials(root) {
    this.root = root;
    this.rail = root.querySelector('[data-tst-rail]');
    if (!this.rail) return;

    this.gsap = window.gsap || null;
    this.fx = !!this.gsap && !reducedMotion();
    this.muteLabel = root.dataset.muteLabel || 'Mute Video';
    this.unmuteLabel = root.dataset.unmuteLabel || 'Unmute Video';

    var self = this;
    this.cards = Array.prototype.slice.call(root.querySelectorAll('[data-tst-card]')).map(function (element) {
      return {
        element: element,
        media: element.querySelector('[data-tst-media]'),
        video: element.querySelector('video'),
        button: element.querySelector('[data-tst-mute]'),
        muted: true,
      };
    }).filter(function (card) {
      return card.media && card.video;
    });

    this.prevArrow = root.querySelector('[data-tst-arrow="prev"]');
    this.nextArrow = root.querySelector('[data-tst-arrow="next"]');

    this.onScroll = this.updateArrows.bind(this);
    this.onResize = this.updateArrows.bind(this);

    this.bind();
    this.observe();
    this.initCursor();
    this.updateArrows();

    this.ready = true;
  }

  /* ------------------------------------------------------------------
     Sound
     ------------------------------------------------------------------ */

  // Muting fades the volume down and only cuts the audio once it is already
  // silent — setting muted up front would make the fade inaudible. Unmuting
  // flips muted off immediately, which the autoplay policy allows because
  // every caller is a click, and fades the volume up from nothing.
  Testimonials.prototype.setMuted = function (card, muted) {
    if (muted === card.muted) return;
    card.muted = muted;

    if (card.button) {
      card.button.classList.toggle('is-unmuted', !muted);
      card.button.setAttribute('aria-pressed', muted ? 'true' : 'false');
      card.button.setAttribute('aria-label', muted ? this.unmuteLabel : this.muteLabel);
    }

    var video = card.video;

    if (!this.fx) {
      video.muted = muted;
      video.volume = muted ? 0 : 1;
      return;
    }

    this.gsap.killTweensOf(video);

    if (muted) {
      this.gsap.to(video, {
        volume: 0,
        duration: FADE,
        ease: 'power2.out',
        onComplete: function () {
          video.muted = true;
        },
      });
    } else {
      video.muted = false;
      this.gsap.fromTo(video, { volume: 0 }, { volume: 1, duration: FADE, ease: 'power2.out' });
    }
  };

  Testimonials.prototype.toggle = function (card) {
    var self = this;
    var next = !card.muted;

    if (!next) {
      // Turning one on turns the others off.
      this.cards.forEach(function (other) {
        if (other !== card) self.setMuted(other, true);
      });
    }

    this.setMuted(card, next);
    this.bump(card.button);
    this.setTagLabel(card.muted ? this.unmuteLabel : this.muteLabel);
  };

  Testimonials.prototype.bump = function (button) {
    if (!this.fx || !button) return;
    this.gsap.killTweensOf(button);
    this.gsap.fromTo(button, { scale: 0.86 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.55)' });
  };

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  Testimonials.prototype.bind = function () {
    var self = this;

    this.cards.forEach(function (card) {
      card.media.addEventListener('click', function () {
        self.toggle(card);
      });

      if (card.button) {
        card.button.addEventListener('click', function () {
          self.toggle(card);
        });
      }

      // A video that will not autoplay leaves a still frame rather than a
      // broken card, so there is nothing to handle beyond letting it be.
      var playing = card.video.play();
      if (playing && typeof playing.catch === 'function') playing.catch(function () {});
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

    this.rail.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);
  };

  Testimonials.prototype.page = function (direction) {
    var card = this.cards[0];
    var step = card ? card.element.offsetWidth : this.rail.clientWidth;
    var gap = parseFloat(getComputedStyle(this.rail).columnGap) || 0;

    this.rail.scrollBy({
      left: direction * (step + gap),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  };

  Testimonials.prototype.updateArrows = function () {
    if (!this.prevArrow || !this.nextArrow) return;

    var max = this.rail.scrollWidth - this.rail.clientWidth;
    this.prevArrow.classList.toggle('is-disabled', this.rail.scrollLeft <= 1);
    this.nextArrow.classList.toggle('is-disabled', this.rail.scrollLeft >= max - 1);
  };

  /* ------------------------------------------------------------------
     Playback
     ------------------------------------------------------------------ */

  // Eight videos all decoding at once is work nobody asked for, so a card only
  // plays while it is on screen. Sound is dropped on the way out too: it can be
  // turned back on with a click, and only a click, since browsers will not let
  // a scroll callback start audible playback anyway.
  Testimonials.prototype.observe = function () {
    if (!('IntersectionObserver' in window)) return;

    var self = this;
    this.observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var card = self.cards.filter(function (item) {
            return item.element === entry.target;
          })[0];
          if (!card) return;

          if (entry.isIntersecting) {
            var playing = card.video.play();
            if (playing && typeof playing.catch === 'function') playing.catch(function () {});
          } else {
            self.setMuted(card, true);
            card.video.pause();
          }
        });
      },
      { threshold: 0.25 }
    );

    this.cards.forEach(function (card) {
      self.observer.observe(card.element);
    });
  };

  /* ------------------------------------------------------------------
     Pointer tag
     ------------------------------------------------------------------ */

  Testimonials.prototype.setTagLabel = function (text) {
    var label = this.cursorText;
    if (!label || label.textContent === text) return;

    if (!this.fx) {
      label.textContent = text;
      return;
    }

    // The mask clips while the old word leaves upward and the new one rises
    // into its place.
    this.gsap
      .timeline()
      .to(label, { yPercent: -120, duration: 0.3, ease: 'power3.in' })
      .call(function () {
        label.textContent = text;
      })
      .set(label, { yPercent: 120 })
      .to(label, { yPercent: 0, duration: 0.5, ease: 'power4.out' });
  };

  Testimonials.prototype.initCursor = function () {
    var self = this;
    var tag = this.root.querySelector('[data-tst-cursor]');
    var flip = tag && tag.querySelector('[data-tst-cursor-flip]');
    this.cursorText = tag && tag.querySelector('[data-tst-cursor-text]');

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
    var current = null;
    var prevX = 0;
    var prevY = 0;

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

    // :hover rather than hit-testing the coordinates: the product card and the
    // sound button are painted over the video, and only the browser knows the
    // pointer is on them and not on it.
    var hovered = function () {
      var media = self.rail.querySelector('[data-tst-media]:hover');
      if (!media) return null;
      return self.cards.filter(function (card) {
        return card.media === media;
      })[0] || null;
    };

    this.tick = function () {
      if (!hasMouse) return;

      var card = hovered();

      if (card && card !== current) {
        // Entering a different video: place the tag before showing it, or it
        // would fly in from wherever it was last left.
        if (!current) gsap.set(tag, { x: mouseX + CURSOR_OFFSET_X, y: mouseY });
        current = card;
        prevX = mouseX;
        prevY = mouseY;
        self.setTagLabel(card.muted ? self.unmuteLabel : self.muteLabel);
        open();
      } else if (!card && current) {
        current = null;
        close();
      }

      if (!current) return;

      moveX(mouseX + CURSOR_OFFSET_X);
      moveY(mouseY);

      if (!isFlipping) {
        var deltaX = mouseX - prevX;
        var deltaY = mouseY - prevY;
        var raw = -deltaX + deltaY * TILT_VERTICAL_BOOST;
        setTilt(gsap.utils.clamp(-TILT_MAX, TILT_MAX, raw * TILT_FACTOR));
      }

      prevX = mouseX;
      prevY = mouseY;
    };

    gsap.ticker.add(this.tick);
  };

  /* ------------------------------------------------------------------
     Teardown
     ------------------------------------------------------------------ */

  Testimonials.prototype.destroy = function () {
    window.removeEventListener('resize', this.onResize);
    if (this.observer) this.observer.disconnect();
    if (this.gsap && this.tick) this.gsap.ticker.remove(this.tick);
    // The tag lives on <body> now, so it does not leave with the section.
    if (this.cursorTag && this.cursorTag.parentNode) this.cursorTag.parentNode.removeChild(this.cursorTag);
    this.ready = false;
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-tst]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.tstInstance) return;
      root.tstInstance = new Testimonials(root);
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
    var root = event.target.querySelector('[data-tst]');
    if (root && root.tstInstance) {
      root.tstInstance.destroy();
      root.tstInstance = null;
    }
  });

  document.addEventListener('shopify:block:select', function (event) {
    var root = closestFrom(event.target, '[data-tst]');
    if (!root || !root.tstInstance) return;
    event.target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });
})();
