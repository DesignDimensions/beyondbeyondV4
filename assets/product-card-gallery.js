/**
 * Product card gallery — a tap-through carousel of a card's own photos,
 * mobile only. Desktop keeps the card's original image (or hover-swapped
 * pair); the extra photos and arrows exist in the DOM everywhere, but
 * product-card.css hides all of it above 749px, so there's nothing to
 * reconcile with the desktop hover behaviour here.
 */
(function () {
  'use strict';

  var CARD_SELECTOR = '.card-wrapper';
  var SWIPE_DRAG_THRESHOLD = 6;
  var SWIPE_MIN_DISTANCE = 30;

  function setupCard(card) {
    if (card.cardGalleryBound) return;

    var images = Array.prototype.slice.call(card.querySelectorAll('[data-card-gallery-image]'));
    var prev = card.querySelector('[data-card-gallery-prev]');
    var next = card.querySelector('[data-card-gallery-next]');

    if (images.length < 2 || !prev || !next) return;
    card.cardGalleryBound = true;

    var index = 0;
    var startIndex = images.findIndex(function (image) {
      return image.classList.contains('is-active');
    });
    if (startIndex > 0) index = startIndex;

    // Set once a swipe crosses the distance threshold, so the click the
    // pointer's release also fires doesn't navigate to the product — a swipe
    // is browsing the photos, not choosing one.
    var swallowClick = false;

    function show(nextIndex) {
      index = ((nextIndex % images.length) + images.length) % images.length;
      images.forEach(function (image, i) {
        var active = i === index;
        image.classList.toggle('is-active', active);
        image.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
    }

    function step(delta) {
      return function (event) {
        // These arrows sit inside the card's own link overlay; without this
        // a tap would both change photo and navigate to the product.
        event.preventDefault();
        event.stopPropagation();
        show(index + delta);
      };
    }

    prev.addEventListener('click', step(-1));
    next.addEventListener('click', step(1));

    var mediaBox = card.querySelector('.card__media');
    if (!mediaBox) return;

    var drag = null;

    mediaBox.addEventListener(
      'pointerdown',
      function (event) {
        if (event.pointerType === 'mouse') return;
        drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
      },
      { passive: true }
    );

    mediaBox.addEventListener(
      'pointermove',
      function (event) {
        if (!drag || event.pointerId !== drag.id) return;

        var dx = event.clientX - drag.startX;
        var dy = event.clientY - drag.startY;

        if (!drag.active) {
          // Vertical intent belongs to the page scrolling past the card.
          if (Math.abs(dx) < SWIPE_DRAG_THRESHOLD) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            drag = null;
            return;
          }
          drag.active = true;
        }

        if (event.cancelable) event.preventDefault();
      },
      { passive: false }
    );

    function endDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;

      var dx = event.clientX - drag.startX;
      var wasSwipe = drag.active && Math.abs(dx) > SWIPE_MIN_DISTANCE;
      drag = null;
      if (!wasSwipe) return;

      show(dx < 0 ? index + 1 : index - 1);
      swallowClick = true;
      setTimeout(function () {
        swallowClick = false;
      }, 0);
    }

    mediaBox.addEventListener('pointerup', endDrag);
    mediaBox.addEventListener('pointercancel', function () {
      drag = null;
    });

    // Capture phase, so this runs before the card's own link.
    mediaBox.addEventListener(
      'click',
      function (event) {
        if (!swallowClick) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );
  }

  function init(scope) {
    var cards = (scope || document).querySelectorAll(CARD_SELECTOR);
    Array.prototype.forEach.call(cards, setupCard);
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
})();
