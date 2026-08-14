/**
 * Upselling Image Slider
 *
 * Looping image slider with per-slide product hotspots. Uses GSAP when the
 * theme has loaded it and falls back to CSS transitions when it has not, so
 * the section never depends on the intro-animation setting being on.
 */
(function () {
  'use strict';

  var MOBILE_QUERY = '(max-width: 749px)';
  var DRAG_THRESHOLD = 6;
  var CLICK_CANCEL_DISTANCE = 10;
  var SWIPE_DISTANCE_RATIO = 0.14;
  var SWIPE_VELOCITY = 0.45;
  var CARD_GAP = 18;
  var EDGE_PAD_DESKTOP = 14;
  var EDGE_PAD_MOBILE = 10;

  // Holds the first auto-open until the full-screen intro has handed the page
  // over. Runs the callback straight away when there is no intro to wait for.
  function introReady(callback) {
    if (typeof window.bbIntroReady === 'function') window.bbIntroReady(callback);
    else callback();
  }

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

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

  function UpsellingImageSlider(root) {
    this.ready = false;
    this.root = root;
    this.viewport = root.querySelector('[data-uis-viewport]');
    this.track = root.querySelector('[data-uis-track]');
    if (!this.viewport || !this.track) return;

    this.slides = Array.prototype.slice.call(this.track.querySelectorAll('[data-uis-slide]'));
    this.count = this.slides.length;
    if (!this.count) return;

    this.gsap = window.gsap || null;
    if (this.gsap) root.classList.add('uis--gsap');

    this.pips = Array.prototype.slice.call(root.querySelectorAll('[data-uis-pip]'));
    this.loop = this.count > 1;
    this.pos = 0;
    this.index = 0;
    this.width = 0;
    this.x = 0;
    this.tween = null;
    this.transitionDone = null;
    this.transitionTimer = null;
    this.openHotspot = null;
    this.hovering = false;
    this.inView = true;
    this.dragState = null;
    this.swallowClick = false;
    this.autoplayTimer = null;

    // Cards the shopper has dismissed, by slide index. An auto-open is a
    // suggestion, so a slide that has been waved away is not offered again.
    this.dismissed = {};
    this.autoOpenTimer = null;
    this.autoOpened = false;

    this.autoplayEnabled = root.dataset.autoplay === 'true';
    this.autoplaySpeed = (parseInt(root.dataset.autoplaySpeed, 10) || 6) * 1000;

    var autoOpen = parseFloat(root.dataset.autoOpen);
    this.autoOpenDelay = isNaN(autoOpen) ? 0 : autoOpen * 1000;

    this.buildLoop();
    this.bindEvents();
    this.measure();
    this.applyX(-this.pos * this.width, true);
    this.updateActiveIndex();
    this.observe();

    // Both held back for the intro. Rotating behind the curtain means the
    // visitor can meet the slider already on slide two, having never seen the
    // first one — the same class of problem as a reveal playing unwatched.
    var self = this;
    introReady(function () {
      self.startAutoplay();
      self.scheduleAutoOpen();
    });

    if (this.loop) root.classList.add('is-draggable');
    this.ready = true;
  }

  /* ----------------------------------------------------------------------
     Loop setup
     ---------------------------------------------------------------------- */

  UpsellingImageSlider.prototype.buildLoop = function () {
    if (!this.loop) return;

    var head = this.cloneSlide(this.slides[this.count - 1]);
    var tail = this.cloneSlide(this.slides[0]);

    this.track.appendChild(tail);
    this.track.insertBefore(head, this.track.firstChild);

    // Real slide N now sits at track position N + 1.
    this.pos = 1;
  };

  // Clones are decorative duplicates: keep them out of the a11y tree and the
  // tab order, and never let a clone claim the eager/high-priority image load.
  UpsellingImageSlider.prototype.cloneSlide = function (slide) {
    var clone = slide.cloneNode(true);

    clone.setAttribute('data-uis-clone', '');
    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('data-shopify-editor-block');

    Array.prototype.forEach.call(clone.querySelectorAll('[data-shopify-editor-block]'), function (el) {
      el.removeAttribute('data-shopify-editor-block');
    });

    Array.prototype.forEach.call(clone.querySelectorAll('img'), function (img) {
      img.setAttribute('loading', 'lazy');
      img.removeAttribute('fetchpriority');
    });

    Array.prototype.forEach.call(clone.querySelectorAll('a, button, input, [tabindex]'), function (el) {
      el.setAttribute('tabindex', '-1');
    });

    return clone;
  };

  /* ----------------------------------------------------------------------
     Transform helpers
     ---------------------------------------------------------------------- */

  UpsellingImageSlider.prototype.measure = function () {
    this.width = this.viewport.clientWidth;
  };

  /**
   * @param {number} x        Track translation in px.
   * @param {boolean} instant Commit without the CSS transition. Needed for the
   *                          silent jump between a clone and its real slide.
   */
  UpsellingImageSlider.prototype.applyX = function (x, instant) {
    this.x = x;

    if (this.gsap) {
      this.gsap.set(this.track, { x: x });
      return;
    }

    if (instant) {
      this.track.classList.add('uis__track--instant');
      this.track.style.transform = 'translate3d(' + x + 'px, 0, 0)';
      void this.track.offsetWidth; // flush the transition-less paint
      this.track.classList.remove('uis__track--instant');
      return;
    }

    this.track.style.transform = 'translate3d(' + x + 'px, 0, 0)';
  };

  // Where the track actually is right now, which is not this.x mid-transition.
  UpsellingImageSlider.prototype.currentX = function () {
    if (this.gsap) return this.gsap.getProperty(this.track, 'x') || 0;

    var transform = window.getComputedStyle(this.track).transform;
    if (!transform || transform === 'none') return 0;

    try {
      return new DOMMatrixReadOnly(transform).m41;
    } catch (error) {
      var values = transform.match(/matrix.*\((.+)\)/);
      if (!values) return this.x;
      var parts = values[1].split(', ');
      return parseFloat(parts.length > 6 ? parts[12] : parts[4]) || 0;
    }
  };

  UpsellingImageSlider.prototype.killTween = function () {
    if (this.tween) {
      this.tween.kill();
      this.tween = null;
    }
    if (this.transitionDone) {
      this.track.removeEventListener('transitionend', this.transitionDone);
      this.transitionDone = null;
    }
    clearTimeout(this.transitionTimer);
  };

  UpsellingImageSlider.prototype.animateTo = function (x, onDone) {
    var self = this;
    this.killTween();

    if (reducedMotion()) {
      this.applyX(x, true);
      if (onDone) onDone();
      return;
    }

    if (this.gsap) {
      this.tween = this.gsap.to(this.track, {
        x: x,
        duration: 0.72,
        ease: 'power3.out',
        overwrite: 'auto',
        onComplete: function () {
          self.tween = null;
          self.x = x;
          if (onDone) onDone();
        },
      });
      return;
    }

    // CSS-transition fallback. `transitionend` can be missed (interrupted
    // transitions, background tabs), so a timer backstops the callback.
    var settle = function (event) {
      if (event && event.target !== self.track) return;
      self.track.removeEventListener('transitionend', settle);
      clearTimeout(self.transitionTimer);
      self.transitionDone = null;
      self.x = x;
      if (onDone) onDone();
    };

    this.transitionDone = settle;
    this.track.addEventListener('transitionend', settle);
    this.transitionTimer = setTimeout(settle, 900);
    this.applyX(x);
  };

  /* ----------------------------------------------------------------------
     Navigation
     ---------------------------------------------------------------------- */

  UpsellingImageSlider.prototype.slideTo = function (pos, immediate) {
    var self = this;

    if (!this.loop) pos = clamp(pos, 0, this.count - 1);

    this.pos = pos;
    this.closeCard(true);
    this.updateActiveIndex();

    var target = -pos * this.width;

    if (immediate) {
      this.killTween();
      this.applyX(target, true);
      this.normalize();
      this.scheduleAutoOpen();
      return;
    }

    this.animateTo(target, function () {
      self.normalize();
      // Armed once the slide has landed, so the countdown is time spent looking
      // at the slide rather than time spent travelling to it.
      self.scheduleAutoOpen();
    });
  };

  UpsellingImageSlider.prototype.next = function () {
    this.slideTo(this.pos + 1);
  };

  UpsellingImageSlider.prototype.prev = function () {
    this.slideTo(this.pos - 1);
  };

  UpsellingImageSlider.prototype.goToIndex = function (index, immediate) {
    this.slideTo(this.loop ? index + 1 : index, immediate);
  };

  // Jump off a clone onto its real counterpart once the tween has landed.
  UpsellingImageSlider.prototype.normalize = function () {
    if (!this.loop) return;

    if (this.pos === 0) {
      this.pos = this.count;
    } else if (this.pos === this.count + 1) {
      this.pos = 1;
    } else {
      return;
    }

    this.killTween();
    this.applyX(-this.pos * this.width, true);
  };

  UpsellingImageSlider.prototype.updateActiveIndex = function () {
    if (this.loop) {
      this.index = (((this.pos - 1) % this.count) + this.count) % this.count;
    } else {
      this.index = clamp(this.pos, 0, this.count - 1);
    }

    var index = this.index;
    this.pips.forEach(function (pip, i) {
      var active = i === index;
      pip.classList.toggle('is-active', active);
      pip.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    this.applyBackground();
  };

  // Each slide owns the full-bleed colour behind it. Setting it here — before
  // the tween starts — lets the CSS transition cross-fade it as the slide moves.
  UpsellingImageSlider.prototype.applyBackground = function () {
    var slide = this.slides[this.index];
    if (!slide) return;

    var color = slide.getAttribute('data-uis-bg');
    if (color) this.root.style.setProperty('--uis-bg', color);
  };

  /* ----------------------------------------------------------------------
     Product card
     ---------------------------------------------------------------------- */

  UpsellingImageSlider.prototype.positionCard = function (hotspot) {
    var anchor = hotspot.querySelector('[data-uis-card]');
    var dot = hotspot.querySelector('[data-uis-dot]');
    var slide = hotspot.closest('[data-uis-slide]');
    if (!anchor || !dot || !slide) return;

    var slideRect = slide.getBoundingClientRect();
    var dotRect = dot.getBoundingClientRect();

    // Hotspot anchor point, in slide-local coordinates.
    var anchorX = dotRect.left + dotRect.width / 2 - slideRect.left;
    var anchorY = dotRect.top + dotRect.height / 2 - slideRect.top;

    var mobile = isMobile();
    var pad = mobile ? EDGE_PAD_MOBILE : EDGE_PAD_DESKTOP;

    if (mobile) {
      anchor.style.width = Math.min(slideRect.width - pad * 2, 360) + 'px';
    } else {
      anchor.style.width = '';
    }

    var cardWidth = anchor.offsetWidth;
    var cardHeight = anchor.offsetHeight;
    var left;
    var top;
    var origin;

    if (mobile) {
      // Dock to the bottom of the image so a short slide never clips the card.
      left = (slideRect.width - cardWidth) / 2;
      top = slideRect.height - cardHeight - pad;
      origin = 'center bottom';
    } else {
      left = anchorX + CARD_GAP;
      origin = 'left center';

      // Flip to the other side of the hotspot rather than overflow the slide.
      if (left + cardWidth > slideRect.width - pad) {
        left = anchorX - CARD_GAP - cardWidth;
        origin = 'right center';
      }

      left = clamp(left, pad, slideRect.width - cardWidth - pad);
      top = clamp(anchorY - cardHeight / 2, pad, slideRect.height - cardHeight - pad);
    }

    anchor.style.setProperty('--uis-card-tx', left - anchorX + 'px');
    anchor.style.setProperty('--uis-card-ty', top - anchorY + 'px');
    anchor.style.setProperty('--uis-card-origin', origin);
  };

  /**
   * @param {Element} hotspot
   * @param {boolean} auto Opened by the timer rather than by the shopper. An
   *                       auto-opened card is a passive suggestion, so it does
   *                       not hold the slider the way a deliberate one does.
   */
  UpsellingImageSlider.prototype.openCard = function (hotspot, auto) {
    if (!hotspot || this.openHotspot === hotspot) return;
    if (this.openHotspot) this.closeCard(true);

    var anchor = hotspot.querySelector('[data-uis-card]');
    var dot = hotspot.querySelector('[data-uis-dot]');
    if (!anchor) return;

    clearTimeout(this.autoOpenTimer);
    this.autoOpened = !!auto;
    this.openHotspot = hotspot;
    hotspot.classList.add('is-open');
    if (dot) dot.setAttribute('aria-expanded', 'true');

    this.positionCard(hotspot);
    anchor.classList.add('is-open');

    var card = anchor.querySelector('.uis__card');
    if (card && this.gsap && !reducedMotion()) {
      this.gsap.killTweensOf(card);
      this.gsap.fromTo(
        card,
        { opacity: 0, scale: 0.9, y: 6 },
        { opacity: 1, scale: 1, y: 0, duration: 0.38, ease: 'back.out(1.7)' }
      );
    }

    if (!auto) this.pauseAutoplay();
  };

  UpsellingImageSlider.prototype.closeCard = function (immediate) {
    var hotspot = this.openHotspot;
    if (!hotspot) return;

    var anchor = hotspot.querySelector('[data-uis-card]');
    var dot = hotspot.querySelector('[data-uis-dot]');

    this.openHotspot = null;
    this.autoOpened = false;
    hotspot.classList.remove('is-open');
    if (dot) dot.setAttribute('aria-expanded', 'false');

    var card = anchor ? anchor.querySelector('.uis__card') : null;
    var finish = function () {
      if (anchor) anchor.classList.remove('is-open');
    };

    if (card && this.gsap && !reducedMotion() && !immediate) {
      this.gsap.killTweensOf(card);
      this.gsap.to(card, {
        opacity: 0,
        scale: 0.94,
        y: 4,
        duration: 0.22,
        ease: 'power2.in',
        onComplete: finish,
      });
    } else {
      if (card && this.gsap) {
        this.gsap.killTweensOf(card);
        this.gsap.set(card, { opacity: 0, scale: 0.94, y: 0 });
      }
      finish();
    }

    this.resumeAutoplay();
  };

  // Closing the card by hand also cancels the standing offer for that slide,
  // so the shopper is not talked over by a card they just dismissed.
  UpsellingImageSlider.prototype.dismissCard = function () {
    clearTimeout(this.autoOpenTimer);
    this.dismissed[this.index] = true;
    this.closeCard();
  };

  /* ----------------------------------------------------------------------
     Auto-open
     ---------------------------------------------------------------------- */

  // The slide sitting at the current track position, or null when that is one
  // of the loop clones — a clone is aria-hidden and out of the tab order, so
  // its card must never be the one presented.
  UpsellingImageSlider.prototype.currentHotspot = function () {
    var slides = this.track.querySelectorAll('[data-uis-slide]');
    var slide = slides[this.pos];
    if (!slide || slide.hasAttribute('data-uis-clone')) return null;
    return slide.querySelector('[data-uis-hotspot]');
  };

  // Show the current slide's product card unprompted, once the slide has been
  // on screen long enough to have been looked at.
  UpsellingImageSlider.prototype.scheduleAutoOpen = function () {
    var self = this;

    clearTimeout(this.autoOpenTimer);
    if (!this.autoOpenDelay) return;

    var index = this.index;
    if (this.dismissed[index]) return;

    this.autoOpenTimer = setTimeout(function () {
      // Every one of these can change during the wait.
      if (self.index !== index) return;
      if (self.openHotspot || self.dragState) return;
      if (!self.inView || document.hidden) return;
      if (self.dismissed[index]) return;

      var hotspot = self.currentHotspot();
      if (hotspot) self.openCard(hotspot, true);
    }, this.autoOpenDelay);
  };

  /* ----------------------------------------------------------------------
     Add to cart
     ---------------------------------------------------------------------- */

  UpsellingImageSlider.prototype.addToCart = function (form) {
    var self = this;
    var button = form.querySelector('[data-uis-add]');
    if (!button || button.disabled || button.classList.contains('is-loading')) return;

    var hotspot = form.closest('[data-uis-hotspot]');
    var cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');

    button.classList.add('is-loading');
    button.setAttribute('aria-disabled', 'true');

    var config =
      typeof window.fetchConfig === 'function'
        ? window.fetchConfig('javascript')
        : { method: 'POST', headers: { Accept: 'application/javascript' } };

    config.headers['X-Requested-With'] = 'XMLHttpRequest';
    delete config.headers['Content-Type'];

    var formData = new FormData(form);

    if (cart && typeof cart.getSectionsToRender === 'function') {
      formData.append(
        'sections',
        cart.getSectionsToRender().map(function (section) {
          return section.id;
        })
      );
      formData.append('sections_url', window.location.pathname);
      if (typeof cart.setActiveElement === 'function') cart.setActiveElement(document.activeElement);
    }

    config.body = formData;

    var url = (window.routes && window.routes.cart_add_url) || '/cart/add';

    fetch(url, config)
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data.status) {
          self.reportError(button, data.description || data.message);
          return;
        }

        if (cart && typeof cart.renderContents === 'function') cart.renderContents(data);

        if (typeof window.publish === 'function' && window.PUB_SUB_EVENTS) {
          window.publish(window.PUB_SUB_EVENTS.cartUpdate, {
            source: 'upselling-image-slider',
            productVariantId: formData.get('id'),
            cartData: data,
          });
        }

        self.confirmAdded(button, hotspot);
      })
      .catch(function () {
        self.reportError(button, window.cartStrings ? window.cartStrings.error : null);
      })
      .finally(function () {
        button.classList.remove('is-loading');
        button.removeAttribute('aria-disabled');
      });
  };

  UpsellingImageSlider.prototype.confirmAdded = function (button, hotspot) {
    var self = this;
    var label = button.querySelector('.uis__add-label');
    var added = this.root.dataset.addedLabel || 'Added';
    var original = button.dataset.uisLabel || (label ? label.textContent : '');

    button.dataset.uisLabel = original;
    button.classList.add('is-added');
    if (label) label.textContent = added;

    clearTimeout(button.uisResetTimer);
    button.uisResetTimer = setTimeout(function () {
      button.classList.remove('is-added');
      if (label) label.textContent = original;
      // Only dismiss the card if the shopper has not opened a different one.
      if (self.openHotspot === hotspot) self.closeCard();
    }, 1300);
  };

  UpsellingImageSlider.prototype.reportError = function (button, message) {
    button.classList.remove('is-error');
    void button.offsetWidth; // restart the shake
    button.classList.add('is-error');
    if (message) button.setAttribute('title', message);

    clearTimeout(button.uisErrorTimer);
    button.uisErrorTimer = setTimeout(function () {
      button.classList.remove('is-error');
      button.removeAttribute('title');
    }, 2400);
  };

  /* ----------------------------------------------------------------------
     Autoplay
     ---------------------------------------------------------------------- */

  UpsellingImageSlider.prototype.startAutoplay = function () {
    var self = this;
    this.stopAutoplay();
    if (!this.autoplayEnabled || !this.loop || reducedMotion()) return;

    this.autoplayTimer = setInterval(function () {
      if (self.hovering || !self.inView || document.hidden || self.dragState) return;
      // A card the shopper opened holds the slider; one that opened itself must
      // not, or the slider would stop on the first slide and never move again.
      if (self.openHotspot && !self.autoOpened) return;
      // Hold for keyboard users only. A plain mouse click leaves :focus on the
      // arrow but not :focus-visible, so clicking an arrow must not stop
      // autoplay for the rest of the session.
      if (self.hasVisibleFocus()) return;
      self.next();
    }, this.autoplaySpeed);
  };

  UpsellingImageSlider.prototype.hasVisibleFocus = function () {
    try {
      return !!this.root.querySelector(':focus-visible');
    } catch (error) {
      return this.root.contains(document.activeElement) && document.activeElement !== document.body;
    }
  };

  UpsellingImageSlider.prototype.stopAutoplay = function () {
    if (this.autoplayTimer) {
      clearInterval(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  };

  UpsellingImageSlider.prototype.pauseAutoplay = function () {
    this.stopAutoplay();
  };

  // Restarting rather than un-pausing resets the countdown, so a slide never
  // flips immediately after an interaction.
  UpsellingImageSlider.prototype.resumeAutoplay = function () {
    this.startAutoplay();
  };

  /* ----------------------------------------------------------------------
     Dragging
     ---------------------------------------------------------------------- */

  UpsellingImageSlider.prototype.onPointerDown = function (event) {
    if (!this.loop || this.dragState) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (closestFrom(event.target, '[data-uis-card], [data-uis-dot], .uis__arrow')) return;

    this.dragState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: event.clientX,
      startTranslate: this.x,
      startTime: performance.now(),
      axis: null,
      dx: 0,
      moved: 0,
    };

    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  };

  UpsellingImageSlider.prototype.onPointerMove = function (event) {
    var drag = this.dragState;
    if (!drag) return;

    var totalX = event.clientX - drag.startX;
    var totalY = event.clientY - drag.startY;
    drag.moved = Math.max(drag.moved, Math.abs(totalX), Math.abs(totalY));

    if (drag.axis === null) {
      if (Math.abs(totalX) < DRAG_THRESHOLD && Math.abs(totalY) < DRAG_THRESHOLD) return;

      // A vertical gesture belongs to the page, not the slider. Keep the
      // pointer tracked anyway so the trailing click can still be suppressed.
      if (Math.abs(totalY) >= Math.abs(totalX)) {
        drag.axis = 'y';
        return;
      }

      drag.axis = 'x';
      // Take the reference point at lock time so an in-flight tween is picked
      // up exactly where it is instead of snapping to its target.
      drag.startTranslate = this.currentX();
      drag.originX = event.clientX;
      drag.startTime = performance.now();

      this.killTween();
      this.pauseAutoplay();
      this.closeCard(true);
      this.root.classList.add('is-dragging');
    }

    if (drag.axis !== 'x') return;

    event.preventDefault();
    drag.dx = event.clientX - drag.originX;
    this.applyX(drag.startTranslate + drag.dx);
  };

  UpsellingImageSlider.prototype.onPointerUp = function () {
    this.endDrag();
  };

  UpsellingImageSlider.prototype.endDrag = function () {
    var drag = this.dragState;
    if (!drag) return;

    this.dragState = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.root.classList.remove('is-dragging');

    // Native link dragging is disabled on the artwork, so a scroll-drag that
    // starts on the image would otherwise end in a click that follows the
    // slide's link. Any real gesture cancels that click, in either axis.
    if (drag.moved > CLICK_CANCEL_DISTANCE) this.swallowNextClick();

    if (drag.axis !== 'x') return;

    var elapsed = Math.max(performance.now() - drag.startTime, 1);
    var velocity = drag.dx / elapsed;
    var target = this.pos;

    if (Math.abs(drag.dx) > this.width * SWIPE_DISTANCE_RATIO || Math.abs(velocity) > SWIPE_VELOCITY) {
      target = drag.dx < 0 ? this.pos + 1 : this.pos - 1;
    }

    this.slideTo(target);
    this.resumeAutoplay();
  };

  UpsellingImageSlider.prototype.swallowNextClick = function () {
    var self = this;
    this.swallowClick = true;
    clearTimeout(this.swallowTimer);
    this.swallowTimer = setTimeout(function () {
      self.swallowClick = false;
    }, 150);
  };

  /* ----------------------------------------------------------------------
     Events
     ---------------------------------------------------------------------- */

  UpsellingImageSlider.prototype.bindEvents = function () {
    var self = this;

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.handlers = {
      pointerDown: this.onPointerDown.bind(this),

      dragStart: function (event) {
        event.preventDefault();
      },

      clickCapture: function (event) {
        if (!self.swallowClick) return;
        self.swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
      },

      click: function (event) {
        if (closestFrom(event.target, '[data-uis-close]')) {
          event.preventDefault();
          event.stopPropagation();
          var openDot = self.openHotspot && self.openHotspot.querySelector('[data-uis-dot]');
          self.dismissCard();
          if (openDot) openDot.focus();
          return;
        }

        var dot = closestFrom(event.target, '[data-uis-dot]');
        if (dot) {
          event.preventDefault();
          event.stopPropagation();
          var hotspot = dot.closest('[data-uis-hotspot]');
          if (self.openHotspot === hotspot) self.dismissCard();
          else self.openCard(hotspot);
          return;
        }

        if (closestFrom(event.target, '[data-uis-prev]')) {
          self.prev();
          self.resumeAutoplay();
          return;
        }

        if (closestFrom(event.target, '[data-uis-next]')) {
          self.next();
          self.resumeAutoplay();
          return;
        }

        var pip = closestFrom(event.target, '[data-uis-pip]');
        if (pip) {
          self.goToIndex(parseInt(pip.dataset.index, 10) || 0);
          self.resumeAutoplay();
        }
      },

      submit: function (event) {
        var form = closestFrom(event.target, '[data-uis-form]');
        if (!form) return;
        event.preventDefault();
        self.addToCart(form);
      },

      keydown: function (event) {
        if (event.key === 'Escape' && self.openHotspot) {
          var dot = self.openHotspot.querySelector('[data-uis-dot]');
          self.dismissCard();
          if (dot) dot.focus();
          return;
        }

        if (!self.root.contains(event.target)) return;
        if (closestFrom(event.target, '[data-uis-card]')) return;

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          self.prev();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          self.next();
        }
      },

      documentPointerDown: function (event) {
        if (!self.openHotspot) return;
        if (closestFrom(event.target, '[data-uis-hotspot]') === self.openHotspot) return;

        // Dismissing the card should not also follow the slide's link.
        if (self.root.contains(event.target)) self.swallowNextClick();
        self.dismissCard();
      },

      enter: function () {
        self.hovering = true;
      },

      leave: function () {
        self.hovering = false;
      },

      visibility: function () {
        if (document.hidden) self.pauseAutoplay();
        else self.resumeAutoplay();
      },
    };

    this.viewport.addEventListener('pointerdown', this.handlers.pointerDown, { passive: true });
    this.viewport.addEventListener('dragstart', this.handlers.dragStart);
    this.root.addEventListener('click', this.handlers.clickCapture, true);
    this.root.addEventListener('click', this.handlers.click);
    this.root.addEventListener('submit', this.handlers.submit);
    this.root.addEventListener('mouseenter', this.handlers.enter);
    this.root.addEventListener('mouseleave', this.handlers.leave);
    document.addEventListener('keydown', this.handlers.keydown);
    document.addEventListener('pointerdown', this.handlers.documentPointerDown);
    document.addEventListener('visibilitychange', this.handlers.visibility);
  };

  UpsellingImageSlider.prototype.observe = function () {
    var self = this;

    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(
        function (entries) {
          var was = self.inView;
          self.inView = entries[0].isIntersecting;
          // A countdown that ran out while the section was scrolled past is
          // dropped rather than fired late, so re-arm it on the way back in.
          if (self.inView && !was) self.scheduleAutoOpen();
        },
        { threshold: 0.15 }
      );
      this.intersectionObserver.observe(this.root);
    }

    this.onResize = function () {
      cancelAnimationFrame(self.resizeFrame);
      self.resizeFrame = requestAnimationFrame(function () {
        var previous = self.width;
        self.measure();

        if (previous !== self.width) {
          self.killTween();
          self.applyX(-self.pos * self.width, true);
        }

        if (self.openHotspot) self.positionCard(self.openHotspot);
      });
    };

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.viewport);
    } else {
      window.addEventListener('resize', this.onResize);
    }
  };

  UpsellingImageSlider.prototype.destroy = function () {
    if (!this.handlers) return;

    this.stopAutoplay();
    this.killTween();
    this.endDrag();

    clearTimeout(this.autoOpenTimer);
    cancelAnimationFrame(this.resizeFrame);
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else if (this.onResize) window.removeEventListener('resize', this.onResize);

    this.viewport.removeEventListener('pointerdown', this.handlers.pointerDown);
    this.viewport.removeEventListener('dragstart', this.handlers.dragStart);
    this.root.removeEventListener('click', this.handlers.clickCapture, true);
    this.root.removeEventListener('click', this.handlers.click);
    this.root.removeEventListener('submit', this.handlers.submit);
    this.root.removeEventListener('mouseenter', this.handlers.enter);
    this.root.removeEventListener('mouseleave', this.handlers.leave);
    document.removeEventListener('keydown', this.handlers.keydown);
    document.removeEventListener('pointerdown', this.handlers.documentPointerDown);
    document.removeEventListener('visibilitychange', this.handlers.visibility);

    this.handlers = null;
  };

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-uis]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.uisInstance) return;
      root.uisInstance = new UpsellingImageSlider(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }

  /* Theme editor */

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });

  document.addEventListener('shopify:section:unload', function (event) {
    var root = event.target.querySelector('[data-uis]');
    if (root && root.uisInstance) {
      root.uisInstance.destroy();
      root.uisInstance = null;
    }
  });

  document.addEventListener('shopify:block:select', function (event) {
    var root = closestFrom(event.target, '[data-uis]');
    var instance = root && root.uisInstance;
    if (!instance || !instance.ready) return;

    instance.goToIndex(parseInt(event.target.dataset.index, 10) || 0);
    instance.pauseAutoplay();

    var hotspot = event.target.querySelector('[data-uis-hotspot]');
    if (hotspot) {
      // Wait out the slide tween so the card is measured where it lands.
      clearTimeout(instance.editorCardTimer);
      instance.editorCardTimer = setTimeout(function () {
        instance.openCard(hotspot);
      }, 800);
    }
  });

  document.addEventListener('shopify:block:deselect', function (event) {
    var root = closestFrom(event.target, '[data-uis]');
    var instance = root && root.uisInstance;
    if (!instance || !instance.ready) return;

    clearTimeout(instance.editorCardTimer);
    instance.closeCard();
    instance.resumeAutoplay();
  });
})();
