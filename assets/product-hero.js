/**
 * Product hero — the product page's first fold.
 *
 * Two small jobs, both local to the section:
 *
 *  - the gallery: a thumbnail strip that cross-fades the picture above it,
 *    with arrows that page the strip when there are more photos than fit.
 *
 *  - the sizes: picking one re-prices the fold, re-points the add-to-cart at
 *    that variant, moves the gallery to the photo that variant carries and
 *    rewrites the address bar. Every price the fold can show is already in
 *    the markup as a data attribute, so a size change is a swap rather than
 *    a fetch — nothing to wait for, and nothing to re-render.
 *
 * Without JavaScript the chips are still links to the product page with the
 * variant preselected, and the form still posts to the cart, so the fold
 * does its job either way.
 */
(function () {
  'use strict';

  var ROOT_SELECTOR = '[data-ph]';

  /* ----------------------------------------------------------------------
     Gallery
     ---------------------------------------------------------------------- */

  function setupGallery(root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll('[data-ph-slide]'));
    var thumbs = Array.prototype.slice.call(root.querySelectorAll('[data-ph-thumb]'));
    var viewport = root.querySelector('[data-ph-thumb-viewport]');
    var prev = root.querySelector('[data-ph-arrow="prev"]');
    var next = root.querySelector('[data-ph-arrow="next"]');

    if (!slides.length) return null;

    function show(index) {
      if (index < 0 || index >= slides.length) return;

      slides.forEach(function (slide, i) {
        slide.classList.toggle('is-active', i === index);
        slide.setAttribute('aria-hidden', i === index ? 'false' : 'true');
      });

      thumbs.forEach(function (thumb, i) {
        thumb.classList.toggle('is-active', i === index);
        thumb.setAttribute('aria-current', i === index ? 'true' : 'false');
      });

      scrollThumbIntoView(index);
    }

    // Only nudges the strip when the thumbnail is actually outside it — a
    // strip that re-centres on every pick fidgets under the pointer.
    function scrollThumbIntoView(index) {
      if (!viewport || !thumbs[index]) return;

      var thumb = thumbs[index];
      var left = thumb.offsetLeft;
      var right = left + thumb.offsetWidth;

      if (left < viewport.scrollLeft) {
        viewport.scrollLeft = left;
      } else if (right > viewport.scrollLeft + viewport.clientWidth) {
        viewport.scrollLeft = right - viewport.clientWidth;
      }
    }

    // An arrow is spent once the strip cannot travel any further that way.
    // The one-pixel slack keeps a fractional scroll width from leaving the
    // last press looking available when it is not.
    function syncArrows() {
      if (!viewport || !prev || !next) return;

      var max = viewport.scrollWidth - viewport.clientWidth;
      var scrollable = max > 1;

      var atStart = !scrollable || viewport.scrollLeft <= 1;
      var atEnd = !scrollable || viewport.scrollLeft >= max - 1;

      prev.classList.toggle('is-disabled', atStart);
      next.classList.toggle('is-disabled', atEnd);
      prev.disabled = atStart;
      next.disabled = atEnd;
    }

    function page(direction) {
      if (!viewport) return;
      viewport.scrollLeft += direction * Math.round(viewport.clientWidth * 0.8);
    }

    thumbs.forEach(function (thumb, index) {
      thumb.addEventListener('click', function () {
        show(index);
      });
    });

    if (prev) {
      prev.addEventListener('click', function () {
        page(-1);
      });
    }

    if (next) {
      next.addEventListener('click', function () {
        page(1);
      });
    }

    if (viewport) {
      viewport.addEventListener('scroll', syncArrows, { passive: true });
      window.addEventListener('resize', syncArrows);
      syncArrows();
    }

    return { show: show };
  }

  /* ----------------------------------------------------------------------
     Sizes
     ---------------------------------------------------------------------- */

  function setupVariants(root, gallery) {
    var chips = Array.prototype.slice.call(root.querySelectorAll('[data-ph-variant]'));
    if (!chips.length) return;

    var input = root.querySelector('[data-ph-variant-input]');
    var priceEl = root.querySelector('[data-ph-price]');
    var mrpEl = root.querySelector('[data-ph-mrp]');
    var mrpValueEl = root.querySelector('[data-ph-mrp-value]');
    var badgeEl = root.querySelector('[data-ph-badge]');
    var atc = root.querySelector('[data-ph-atc]');
    var atcLabel = root.querySelector('[data-ph-atc-label]');
    var soldOutText = atc ? atc.getAttribute('data-sold-out-label') : '';
    var addText = atc ? atc.getAttribute('data-add-label') : '';

    function select(chip) {
      var available = chip.getAttribute('data-available') === 'true';

      chips.forEach(function (other) {
        var isChosen = other === chip;
        other.classList.toggle('is-selected', isChosen);
        other.setAttribute('aria-pressed', isChosen ? 'true' : 'false');
      });

      if (input) {
        input.value = chip.getAttribute('data-variant-id');
        input.disabled = !available;
      }

      if (priceEl) priceEl.innerHTML = chip.getAttribute('data-price') || '';

      // The struck price and the saving next to it are the same fact stated
      // twice, so a variant that is not on sale drops both together.
      var compare = chip.getAttribute('data-compare') || '';
      if (mrpEl) mrpEl.hidden = !compare;
      if (mrpValueEl && compare) mrpValueEl.innerHTML = compare;

      var discount = chip.getAttribute('data-discount') || '';
      if (badgeEl) {
        badgeEl.hidden = !discount;
        if (discount) badgeEl.textContent = '-' + discount + '% OFF';
      }

      if (atc) {
        atc.disabled = !available;
        atc.setAttribute('aria-disabled', available ? 'false' : 'true');
        if (atcLabel) atcLabel.textContent = available ? addText : soldOutText;
      }

      var mediaIndex = parseInt(chip.getAttribute('data-media-index'), 10);
      if (gallery && !isNaN(mediaIndex) && mediaIndex >= 0) gallery.show(mediaIndex);

      // The chip is a real link, so the address it already carries is the
      // one to put in the bar — replaced rather than pushed, since picking a
      // size is refining the same page rather than moving to a new one.
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', chip.getAttribute('href'));
      }
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function (event) {
        event.preventDefault();
        select(chip);
      });
    });
  }

  /* ----------------------------------------------------------------------
     Quantity
     ---------------------------------------------------------------------- */

  function setupQuantity(root) {
    var input = root.querySelector('[data-ph-qty-input]');
    if (!input) return;

    var steppers = Array.prototype.slice.call(root.querySelectorAll('[data-ph-qty-step]'));

    function clamp(value) {
      var min = parseInt(input.getAttribute('min'), 10) || 1;
      var max = parseInt(input.getAttribute('max'), 10);
      if (isNaN(value) || value < min) value = min;
      if (!isNaN(max) && value > max) value = max;
      return value;
    }

    function sync() {
      var value = clamp(parseInt(input.value, 10));
      input.value = value;

      var min = parseInt(input.getAttribute('min'), 10) || 1;
      steppers.forEach(function (button) {
        if (parseInt(button.getAttribute('data-ph-qty-step'), 10) < 0) {
          button.disabled = value <= min;
        }
      });
    }

    steppers.forEach(function (button) {
      button.addEventListener('click', function () {
        var step = parseInt(input.getAttribute('step'), 10) || 1;
        var delta = parseInt(button.getAttribute('data-ph-qty-step'), 10) * step;
        input.value = clamp((parseInt(input.value, 10) || 0) + delta);
        sync();
      });
    });

    input.addEventListener('change', sync);
    sync();
  }

  function setup(root) {
    if (root.phBound) return;
    root.phBound = true;

    setupVariants(root, setupGallery(root));
    setupQuantity(root);
  }

  function setupAll(scope) {
    Array.prototype.slice.call((scope || document).querySelectorAll(ROOT_SELECTOR)).forEach(setup);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setupAll();
    });
  } else {
    setupAll();
  }

  // The theme editor rebuilds the section's markup on every settings change,
  // which leaves the new copy unbound.
  document.addEventListener('shopify:section:load', function (event) {
    setupAll(event.target);
  });
})();
