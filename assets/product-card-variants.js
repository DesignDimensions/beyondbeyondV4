/**
 * Product card variants
 *
 * The sizes on a card's type line are controls: picking one points that card's
 * add-to-cart at the chosen variant and re-prices the card, without leaving the
 * grid. Every card in the theme is handled by this one delegated listener —
 * cards arrive from section renders, quick-add markup and the Browse By Concern
 * panels, and none of them have to announce themselves.
 *
 * The chips are links to the product page with the variant preselected, so a
 * card with no form to point at — or a page where this script never ran — still
 * does something sensible when one is clicked.
 */
(function () {
  'use strict';

  var CARD_SELECTOR = '.pcard, .card-wrapper';

  function closestFrom(target, selector) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(selector);
  }

  function priceMarkup(chip) {
    var price = chip.getAttribute('data-variant-price') || '';
    var compare = chip.getAttribute('data-variant-compare') || '';
    if (!price) return null;
    if (!compare) return '<span class="card__price-now">' + price + '</span>';
    return (
      '<span class="card__price-sale">' + price + '</span>' +
      '<s class="card__price-was">' + compare + '</s>'
    );
  }

  // Dawn's price element carries its own structure; ours carries the hook. The
  // markup written back is the same either way, and both are styled for it.
  function repriceCard(card, chip) {
    var target = card.querySelector('[data-card-price]') || card.querySelector('.price');
    if (!target) return;

    var markup = priceMarkup(chip);
    if (!markup) return;

    target.innerHTML = markup;
    target.classList.toggle('price--on-sale', !!chip.getAttribute('data-variant-compare'));
  }

  // A variant that cannot be bought should say so on the button rather than
  // leaving a live add-to-cart pointed at it.
  function setAvailability(card, chip) {
    var available = chip.getAttribute('data-variant-available') !== 'false';
    var input = card.querySelector('input[name="id"]');
    var button = card.querySelector('[data-card-add], .quick-add__submit, button[type="submit"]');

    if (input) {
      if (available) input.removeAttribute('disabled');
      else input.setAttribute('disabled', 'disabled');
    }

    if (!button) return;

    var label = button.querySelector('.pcard__atc-label') || button.querySelector('span') || button;
    if (!label.dataset.cardLabel) label.dataset.cardLabel = label.textContent.trim();

    button.disabled = !available;
    button.classList.toggle('is-unavailable', !available);

    var soldOut = closestFrom(chip, '.card__meta');
    label.textContent = available
      ? label.dataset.cardLabel
      : (soldOut && soldOut.getAttribute('data-soldout-label')) || label.dataset.cardLabel;
  }

  function select(card, chip) {
    var input = card.querySelector('input[name="id"]');
    if (input) input.value = chip.getAttribute('data-variant-id');

    var chips = card.querySelectorAll('[data-card-variant]');
    Array.prototype.forEach.call(chips, function (other) {
      var on = other === chip;
      other.classList.toggle('is-selected', on);
      other.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    repriceCard(card, chip);
    setAvailability(card, chip);
  }

  document.addEventListener('click', function (event) {
    var chip = closestFrom(event.target, '[data-card-variant]');
    if (!chip) return;

    var card = closestFrom(chip, CARD_SELECTOR);
    // With nothing on the card to add, the link to the product page is the
    // only thing left that can honour the click.
    if (!card || !card.querySelector('input[name="id"]')) return;

    event.preventDefault();
    select(card, chip);
  });
})();
