/**
 * Gallery
 *
 * A row of images drifting endlessly, grabbable and throwable, where clicking
 * one opens it — not into a copy fading in over the top, but by taking the
 * picture itself from exactly where it sits in the row out to the middle of
 * the window, and putting it back where it came from on the way out. The row
 * is frozen while the viewer is open, so the place it returns to is the place
 * it left.
 *
 * The drift is driven per frame rather than by a tween: a tween owns the value
 * it animates, and a hand on the row has to be able to take it back mid-flight.
 * Each row keeps an offset that wraps at one sequence's width — that wrap is
 * the whole of the endless loop — and a velocity that is only ever eased toward
 * whatever it should be, so the drift, a hover's slow-down and the tail of a
 * throw are all the same arithmetic.
 */
(function () {
  'use strict';

  var HOVER_SCALE = 0.15;
  var SETTLE = 0.62;
  var MAX_FLING = 3200;
  var DRAG_THRESHOLD = 4;
  var CLICK_CANCEL_DISTANCE = 8;
  var MAX_FRAME = 0.05;
  var ZOOM_STEP = 2.2;
  var ZOOM_MAX = 4;

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

  // Keeps the offset inside one sequence, whichever way the row is travelling
  // and however far a throw carried it.
  function wrap(x, width) {
    if (!width) return x;
    return ((x % width) - width) % width;
  }

  function Gallery(root) {
    this.root = root;
    this.row = root.querySelector('[data-gal-row]');
    this.track = root.querySelector('[data-gal-track]');
    this.seq = root.querySelector('[data-gal-seq]');
    if (!this.row || !this.track || !this.seq) return;

    this.gsap = window.gsap || null;
    this.fx = !!this.gsap && !reducedMotion();
    this.speed = parseFloat(root.dataset.speed) || 40;
    this.direction = parseFloat(root.dataset.direction) || -1;
    this.slowOnHover = root.dataset.hoverSlow === 'true';

    this.width = 0;
    this.x = 0;
    this.velocity = 0;
    this.scale = 1;
    this.drag = null;
    this.paused = false;
    this.visible = true;
    this.still = reducedMotion();
    this.swallowClick = false;

    this.viewer = root.querySelector('[data-gal-viewer]');
    this.open = false;
    this.index = 0;
    this.source = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    this.onResize = this.requestBuild.bind(this);
    this.onKey = this.handleKey.bind(this);

    this.bind();
    this.build();
    this.start();
    this.watchImages();
    this.initViewer();

    this.ready = true;
  }

  /* ==================================================================
     The row
     ================================================================== */

  Gallery.prototype.requestBuild = function () {
    var self = this;
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(function () {
      self.resizeFrame = null;
      self.build();
      if (self.open) self.refit();
    });
  };

  Gallery.prototype.refit = function () {
    var item = this.nearestItem(this.index) || this.source;
    var image = item && item.querySelector('img');
    if (!image) return;

    var to = this.targetRect(image);
    this.place(to);
    this.layoutChrome(to);
    this.setZoom(this.zoom, this.panX, this.panY, true);
  };

  // Two printed copies cover the loop itself but not a window wider than the
  // sequence — the track would run out of pictures before it wrapped.
  Gallery.prototype.build = function () {
    var width = this.seq.offsetWidth;
    if (!width) return;

    var needed = Math.ceil((this.row.offsetWidth + width) / width) + 1;
    var have = this.track.querySelectorAll('[data-gal-seq]').length;

    for (var i = have; i < needed; i += 1) {
      var clone = this.seq.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      this.track.appendChild(clone);
    }

    this.width = width;
    this.count = this.seq.children.length;
    this.x = wrap(this.x, width);
    this.render();
  };

  Gallery.prototype.render = function () {
    if (this.gsap) this.gsap.set(this.track, { x: this.x });
    else this.track.style.transform = 'translate3d(' + this.x + 'px, 0, 0)';
  };

  Gallery.prototype.watchImages = function () {
    var self = this;
    var images = Array.prototype.slice.call(this.track.querySelectorAll('img'));
    images.forEach(function (image) {
      if (image.complete) return;
      image.addEventListener('load', self.onResize, { once: true });
      image.addEventListener('error', self.onResize, { once: true });
    });
  };

  Gallery.prototype.start = function () {
    var self = this;

    if (this.gsap && this.gsap.ticker) {
      this.tick = function (time, delta) {
        self.frame(delta / 1000);
      };
      this.gsap.ticker.add(this.tick);
      return;
    }

    var last = 0;
    var loop = function (now) {
      var delta = last ? (now - last) / 1000 : 0;
      last = now;
      self.frame(delta);
      self.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  };

  Gallery.prototype.frame = function (delta) {
    // A backgrounded tab hands back one enormous frame; spending it would
    // teleport the row.
    var step = Math.min(delta || 0, MAX_FRAME);
    if (!step || !this.visible || !this.width) return;
    if (this.drag) {
      this.render();
      return;
    }
    if (this.paused) return;

    // Exponential rather than linear: the further the velocity is from where
    // it belongs, the harder it is pulled back, which is what lets a throw
    // bleed off into the drift instead of stopping dead.
    var pull = 1 - Math.exp(-step / SETTLE);
    var target = this.still ? 0 : this.direction * this.speed * this.scale;

    this.velocity += (target - this.velocity) * pull;
    this.x = wrap(this.x + this.velocity * step, this.width);
    this.render();
  };

  /* ==================================================================
     Grab
     ================================================================== */

  Gallery.prototype.bind = function () {
    var self = this;

    this.row.addEventListener('pointerdown', function (event) {
      self.grab(event);
    });
    this.row.addEventListener('pointermove', function (event) {
      self.move(event);
    });
    this.row.addEventListener('pointerup', function (event) {
      self.release(event);
    });
    this.row.addEventListener('pointercancel', function (event) {
      self.release(event);
    });

    this.row.addEventListener('mouseenter', function () {
      self.scale = self.slowOnHover ? HOVER_SCALE : 1;
    });
    this.row.addEventListener('mouseleave', function () {
      self.scale = 1;
    });

    // A throw that ends on a picture must not also open it.
    this.root.addEventListener(
      'click',
      function (event) {
        if (!self.swallowClick) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );

    this.track.addEventListener('click', function (event) {
      var item = closestFrom(event.target, '[data-gal-item]');
      if (item) self.openItem(item);
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

  Gallery.prototype.grab = function (event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (!this.width || this.open) return;

    this.drag = {
      id: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: event.timeStamp || performance.now(),
      origin: this.x,
      distance: 0,
      velocity: 0,
      captured: false,
    };

    this.velocity = 0;
  };

  Gallery.prototype.move = function (event) {
    var drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;

    var dx = event.clientX - drag.startX;
    drag.distance = Math.abs(dx);

    // Captured only once the pointer has actually travelled. A captured
    // pointer has its click dispatched to the element holding the capture, so
    // capturing on pointerdown would send every click to the row and the
    // picture inside it would never hear the one meant for it.
    if (drag.distance > DRAG_THRESHOLD) {
      this.root.classList.add('is-grabbing');
      if (!drag.captured && this.row.setPointerCapture) {
        this.row.setPointerCapture(drag.id);
        drag.captured = true;
      }
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

    this.x = wrap(drag.origin + dx, this.width);
  };

  Gallery.prototype.release = function (event) {
    var drag = this.drag;
    if (!drag || (event && event.pointerId !== drag.id)) return;

    this.drag = null;
    this.velocity = clamp(drag.velocity, -MAX_FLING, MAX_FLING);
    this.root.classList.remove('is-grabbing');

    if (drag.distance > CLICK_CANCEL_DISTANCE) {
      var self = this;
      this.swallowClick = true;
      setTimeout(function () {
        self.swallowClick = false;
      }, 0);
    }
  };

  /* ==================================================================
     Viewer
     ================================================================== */

  Gallery.prototype.initViewer = function () {
    if (!this.viewer) return;

    var self = this;

    // Away from the section: the track beside it is permanently transformed,
    // and a transformed ancestor becomes the containing block for anything
    // fixed inside it — which would trap the viewer in the sliding row.
    document.body.appendChild(this.viewer);

    this.full = this.viewer.querySelector('[data-gal-full]');
    this.backdrop = this.viewer.querySelector('[data-gal-backdrop]');
    this.caption = this.viewer.querySelector('[data-gal-caption]');
    this.closeButton = this.viewer.querySelector('[data-gal-close]');
    this.chrome = Array.prototype.slice.call(this.viewer.querySelectorAll('[data-gal-close], [data-gal-nav]'));

    this.closeButton.addEventListener('click', function () {
      self.close();
    });

    Array.prototype.forEach.call(this.viewer.querySelectorAll('[data-gal-nav]'), function (button) {
      button.addEventListener('click', function () {
        self.step(parseFloat(button.dataset.galNav) || 1);
      });
    });

    // One listener on the viewer, deciding from where the pointer actually is
    // rather than from what the browser handed the click to. Inside the
    // picture zooms, outside it closes. Asking the picture's own rectangle
    // also means the zoomed-in picture answers over the whole of its enlarged
    // self, which is the part a reader would call "the image".
    this.viewer.addEventListener('click', function (event) {
      if (closestFrom(event.target, '[data-gal-close], [data-gal-nav]')) return;
      if (self.pointInImage(event.clientX, event.clientY)) self.toggleZoom(event);
      else self.close();
    });

    this.full.addEventListener(
      'wheel',
      function (event) {
        self.wheelZoom(event);
      },
      { passive: false }
    );

    this.full.addEventListener('pointerdown', function (event) {
      self.panStart(event);
    });
    this.full.addEventListener('pointermove', function (event) {
      self.panMove(event);
    });
    this.full.addEventListener('pointerup', function (event) {
      self.panEnd(event);
    });
    this.full.addEventListener('pointercancel', function (event) {
      self.panEnd(event);
    });
  };

  Gallery.prototype.viewerRadius = function () {
    return parseFloat(getComputedStyle(this.viewer).getPropertyValue('--gal-viewer-radius')) || 0;
  };

  Gallery.prototype.items = function (index) {
    return Array.prototype.slice.call(
      this.track.querySelectorAll('[data-gal-item][data-index="' + index + '"]')
    );
  };

  // Whichever copy of this picture is nearest the middle of the window — the
  // one the eye would call "the" tile, and so the one to fly out of and back
  // into.
  Gallery.prototype.nearestItem = function (index) {
    var middle = window.innerWidth / 2;
    var best = null;
    var bestDistance = Infinity;

    this.items(index).forEach(function (item) {
      var rect = item.getBoundingClientRect();
      var distance = Math.abs(rect.left + rect.width / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = item;
      }
    });

    return best;
  };

  // The largest rectangle of the picture's own shape that fits the window.
  Gallery.prototype.targetRect = function (image) {
    var pad = parseFloat(getComputedStyle(this.viewer).getPropertyValue('--gal-viewer-pad')) || 64;
    var naturalW = image.naturalWidth || image.offsetWidth || 1;
    var naturalH = image.naturalHeight || image.offsetHeight || 1;
    var maxW = Math.max(window.innerWidth - pad * 2, 80);
    var maxH = Math.max(window.innerHeight - pad * 2, 80);
    var scale = Math.min(maxW / naturalW, maxH / naturalH);
    var width = naturalW * scale;
    var height = naturalH * scale;

    return {
      left: (window.innerWidth - width) / 2,
      top: (window.innerHeight - height) / 2,
      width: width,
      height: height,
    };
  };

  Gallery.prototype.openItem = function (item) {
    if (this.open || !this.viewer) return;

    var image = item.querySelector('img');
    if (!image) return;

    var self = this;
    this.open = true;
    this.paused = true;
    this.index = parseInt(item.dataset.index, 10) || 0;
    this.source = item;
    this.lastFocus = document.activeElement;

    var from = image.getBoundingClientRect();
    var to = this.targetRect(image);

    // The thumbnail is already decoded, so the flight can start this frame;
    // the full-size file is swapped in underneath once it arrives, which is
    // the same picture and so shows no seam.
    this.full.src = image.currentSrc || image.src;
    this.full.alt = image.alt || '';
    this.preload(item.dataset.full);

    this.caption.textContent = item.dataset.caption || '';
    item.classList.add('is-open');

    // Nowhere to step to with a single picture.
    var solo = this.count < 2;
    Array.prototype.forEach.call(this.viewer.querySelectorAll('[data-gal-nav]'), function (button) {
      button.hidden = solo;
    });

    this.viewer.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', this.onKey);

    this.setZoom(1, 0, 0, true);
    this.layoutChrome(to);

    if (!this.fx) {
      this.place(to);
      this.backdrop.style.opacity = '1';
      this.chrome.forEach(function (node) {
        node.style.opacity = '1';
      });
      this.caption.style.opacity = '1';
      this.closeButton.focus();
      return;
    }

    var gsap = this.gsap;
    var radius = parseFloat(getComputedStyle(item).borderRadius) || 0;

    gsap.killTweensOf([this.full, this.backdrop, this.caption].concat(this.chrome));
    gsap.set(this.full, {
      left: from.left,
      top: from.top,
      width: from.width,
      height: from.height,
      borderRadius: radius,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
    });

    this.timeline = gsap
      .timeline({
        onComplete: function () {
          self.closeButton.focus({ preventScroll: true });
        },
      })
      .to(this.backdrop, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0)
      .to(
        this.full,
        {
          left: to.left,
          top: to.top,
          width: to.width,
          height: to.height,
          borderRadius: this.viewerRadius(),
          duration: 0.85,
          ease: 'expo.out',
        },
        0
      )
      .to(this.chrome, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0.25)
      .fromTo(
        this.caption,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' },
        0.3
      );
  };

  Gallery.prototype.layoutChrome = function (rect) {
    var edge = 10;
    var gap = 16;

    this.rect = rect;

    var prev = this.viewer.querySelector('.gal__nav--prev');
    var next = this.viewer.querySelector('.gal__nav--next');
    var size = prev ? prev.offsetWidth || 52 : 52;
    var middle = rect.top + rect.height / 2 - size / 2;

    if (prev) {
      prev.style.top = middle + 'px';
      prev.style.left = Math.max(edge, rect.left - gap - size) + 'px';
    }

    if (next) {
      next.style.top = middle + 'px';
      next.style.left = Math.min(window.innerWidth - size - edge, rect.left + rect.width + gap) + 'px';
    }

    if (this.closeButton) {
      // Straddling the top-right corner rather than sitting in the window's,
      // so it reads as belonging to the picture.
      var closeSize = this.closeButton.offsetWidth || 42;
      this.closeButton.style.top = Math.max(edge, rect.top - closeSize / 2) + 'px';
      this.closeButton.style.left =
        Math.min(window.innerWidth - closeSize - edge, rect.left + rect.width - closeSize / 2) + 'px';
    }

    if (this.caption) {
      this.caption.style.top = Math.min(window.innerHeight - 34, rect.top + rect.height + 20) + 'px';
    }
  };

  Gallery.prototype.place = function (rect) {
    this.full.style.left = rect.left + 'px';
    this.full.style.top = rect.top + 'px';
    this.full.style.width = rect.width + 'px';
    this.full.style.height = rect.height + 'px';
  };

  Gallery.prototype.preload = function (src) {
    if (!src) return;

    var self = this;
    // Stamped per picture: a slow file arriving after the reader has moved on
    // must not land on whatever is showing now.
    var token = (this.token = (this.token || 0) + 1);
    var loader = new Image();

    loader.onload = function () {
      if (self.open && token === self.token) self.full.src = src;
    };
    loader.src = src;
  };

  Gallery.prototype.close = function () {
    if (!this.open) return;

    var self = this;
    var item = this.nearestItem(this.index) || this.source;
    var image = item && item.querySelector('img');

    this.open = false;
    document.removeEventListener('keydown', this.onKey);
    document.documentElement.style.overflow = '';

    var finish = function () {
      self.viewer.hidden = true;
      self.paused = false;
      Array.prototype.forEach.call(self.track.querySelectorAll('.is-open'), function (node) {
        node.classList.remove('is-open');
      });
      if (self.lastFocus && self.lastFocus.focus) self.lastFocus.focus({ preventScroll: true });
    };

    if (!this.fx || !image) {
      finish();
      return;
    }

    var to = image.getBoundingClientRect();
    var radius = parseFloat(getComputedStyle(item).borderRadius) || 0;
    var gsap = this.gsap;

    gsap.killTweensOf([this.full, this.backdrop, this.caption].concat(this.chrome));

    this.timeline = gsap
      .timeline({ onComplete: finish })
      // Any zoom is undone on the way out, so the picture arrives back at the
      // tile's shape rather than snapping to it at the last moment.
      .to(this.full, { x: 0, y: 0, scale: 1, duration: 0.4, ease: 'power2.inOut' }, 0)
      .to(
        this.full,
        {
          left: to.left,
          top: to.top,
          width: to.width,
          height: to.height,
          borderRadius: radius,
          duration: 0.62,
          ease: 'power3.inOut',
        },
        0
      )
      .to([this.backdrop, this.caption].concat(this.chrome), { opacity: 0, duration: 0.35, ease: 'power2.in' }, 0);
  };

  // Moving between pictures without closing: the outgoing one leaves in the
  // direction of travel, the incoming one arrives from the other side.
  Gallery.prototype.step = function (direction) {
    if (!this.open) return;

    var count = this.count || 0;
    if (!count) return;

    var next = (((this.index + direction) % count) + count) % count;
    var item = this.nearestItem(next);
    if (!item) return;

    var image = item.querySelector('img');
    if (!image) return;

    var self = this;
    var to = this.targetRect(image);

    Array.prototype.forEach.call(this.track.querySelectorAll('.is-open'), function (node) {
      node.classList.remove('is-open');
    });
    item.classList.add('is-open');

    this.index = next;
    this.source = item;
    this.caption.textContent = item.dataset.caption || '';
    this.setZoom(1, 0, 0, true);
    this.layoutChrome(to);

    var swap = function () {
      self.full.src = image.currentSrc || image.src;
      self.full.alt = image.alt || '';
      self.preload(item.dataset.full);
      self.place(to);
    };

    if (!this.fx) {
      swap();
      return;
    }

    var gsap = this.gsap;
    gsap.killTweensOf(this.full);

    gsap
      .timeline()
      .to(this.full, { opacity: 0, x: -40 * direction, duration: 0.28, ease: 'power2.in' })
      .call(swap)
      .fromTo(
        this.full,
        { opacity: 0, x: 40 * direction },
        { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out' }
      );
  };

  /* ------------------------------------------------------------------
     Zoom
     ------------------------------------------------------------------ */

  // Pan is clamped to whatever the picture actually overhangs the window by,
  // so it can never be dragged off into empty space.
  Gallery.prototype.setZoom = function (scale, x, y, immediate) {
    var rect = { width: parseFloat(this.full.style.width) || 0, height: parseFloat(this.full.style.height) || 0 };
    var overflowX = Math.max((rect.width * scale - window.innerWidth) / 2, 0);
    var overflowY = Math.max((rect.height * scale - window.innerHeight) / 2, 0);

    this.zoom = clamp(scale, 1, ZOOM_MAX);
    this.panX = clamp(x, -overflowX, overflowX);
    this.panY = clamp(y, -overflowY, overflowY);

    this.viewer.classList.toggle('is-zoomed', this.zoom > 1.01);

    if (!this.gsap) {
      this.full.style.transform =
        'translate3d(' + this.panX + 'px,' + this.panY + 'px,0) scale(' + this.zoom + ')';
      return;
    }

    if (immediate || !this.fx) {
      this.gsap.set(this.full, { x: this.panX, y: this.panY, scale: this.zoom });
      return;
    }

    this.gsap.to(this.full, {
      x: this.panX,
      y: this.panY,
      scale: this.zoom,
      duration: 0.5,
      ease: 'power3.out',
      overwrite: true,
    });
  };

  // Zooming around the pointer rather than the middle: the detail under the
  // cursor is the one being asked for, so it is the one that stays put.
  Gallery.prototype.zoomAt = function (clientX, clientY, scale) {
    var next = clamp(scale, 1, ZOOM_MAX);
    var centerX = window.innerWidth / 2;
    var centerY = window.innerHeight / 2;
    var ratio = next / this.zoom;
    var dx = clientX - centerX;
    var dy = clientY - centerY;

    this.setZoom(next, dx - (dx - this.panX) * ratio, dy - (dy - this.panY) * ratio);
  };

  Gallery.prototype.pointInImage = function (x, y) {
    if (!this.full) return false;
    var rect = this.full.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  Gallery.prototype.toggleZoom = function (event) {
    if (this.panned) return;
    this.zoomAt(event.clientX, event.clientY, this.zoom > 1.01 ? 1 : ZOOM_STEP);
  };

  Gallery.prototype.wheelZoom = function (event) {
    event.preventDefault();
    var factor = Math.exp(-event.deltaY * 0.0015);
    this.zoomAt(event.clientX, event.clientY, this.zoom * factor);
  };

  Gallery.prototype.panStart = function (event) {
    if (this.zoom <= 1.01) return;
    this.pan = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.panX,
      originY: this.panY,
    };
    this.panned = false;
    this.viewer.classList.add('is-panning');
    if (this.full.setPointerCapture) this.full.setPointerCapture(event.pointerId);
  };

  Gallery.prototype.panMove = function (event) {
    if (!this.pan || event.pointerId !== this.pan.id) return;
    var dx = event.clientX - this.pan.startX;
    var dy = event.clientY - this.pan.startY;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) this.panned = true;
    this.setZoom(this.zoom, this.pan.originX + dx, this.pan.originY + dy, true);
  };

  Gallery.prototype.panEnd = function (event) {
    if (!this.pan || (event && event.pointerId !== this.pan.id)) return;
    this.pan = null;
    this.viewer.classList.remove('is-panning');
    // Cleared after the click that ends this drag has been and gone, so a pan
    // does not also toggle the zoom.
    var self = this;
    setTimeout(function () {
      self.panned = false;
    }, 0);
  };

  Gallery.prototype.handleKey = function (event) {
    if (event.key === 'Escape') this.close();
    else if (event.key === 'ArrowRight') this.step(1);
    else if (event.key === 'ArrowLeft') this.step(-1);
  };

  /* ==================================================================
     Teardown
     ================================================================== */

  Gallery.prototype.destroy = function () {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKey);
    document.documentElement.style.overflow = '';
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.gsap && this.tick) this.gsap.ticker.remove(this.tick);
    if (this.observer) this.observer.disconnect();
    // The viewer lives on <body> now, so it does not leave with the section.
    if (this.viewer && this.viewer.parentNode) this.viewer.parentNode.removeChild(this.viewer);
    this.ready = false;
  };

  /* ==================================================================
     Boot
     ================================================================== */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-gal]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.galInstance) return;
      root.galInstance = new Gallery(root);
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
    var root = event.target.querySelector('[data-gal]');
    if (root && root.galInstance) {
      root.galInstance.destroy();
      root.galInstance = null;
    }
  });
})();
