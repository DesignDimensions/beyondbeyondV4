/**
 * Product card — add to cart
 *
 * The button on the brand card posts to the cart without leaving the page, and
 * hands the cart drawer the sections it asked for so it re-renders with the
 * new line in it.
 *
 * One delegated listener on the document covers every card anywhere: cards
 * arrive from section renders, panel swaps and cloned rails, and none of them
 * have to announce themselves to be wired up.
 */
(function () {
  'use strict';

  var ADDED_MS = 1400;
  var ERROR_MS = 2400;

  function closestFrom(target, selector) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(selector);
  }

  function addedLabel(form) {
    var owner = closestFrom(form, '[data-card-added-label]');
    return (owner && owner.getAttribute('data-card-added-label')) || 'Added';
  }

  function confirmAdded(button, label) {
    var text = button.querySelector('.pcard__atc-label');
    if (!text) return;

    var original = button.dataset.cardLabel || text.textContent;
    button.dataset.cardLabel = original;
    button.classList.add('is-added');
    text.textContent = label;

    clearTimeout(button.cardResetTimer);
    button.cardResetTimer = setTimeout(function () {
      button.classList.remove('is-added');
      text.textContent = original;
    }, ADDED_MS);
  }

  function reportError(button, message) {
    button.classList.remove('is-error');
    void button.offsetWidth; // restart the shake
    button.classList.add('is-error');
    if (message) button.setAttribute('title', message);

    clearTimeout(button.cardErrorTimer);
    button.cardErrorTimer = setTimeout(function () {
      button.classList.remove('is-error');
      button.removeAttribute('title');
    }, ERROR_MS);
  }

  function addToCart(form) {
    var button = form.querySelector('[data-card-add]');
    if (!button || button.disabled || button.classList.contains('is-loading')) return;

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
          reportError(button, data.description || data.message);
          return;
        }

        if (cart && typeof cart.renderContents === 'function') cart.renderContents(data);

        if (typeof window.publish === 'function' && window.PUB_SUB_EVENTS) {
          window.publish(window.PUB_SUB_EVENTS.cartUpdate, {
            source: 'product-card',
            productVariantId: formData.get('id'),
            cartData: data,
          });
        }

        confirmAdded(button, addedLabel(form));
      })
      .catch(function () {
        reportError(button, window.cartStrings ? window.cartStrings.error : null);
      })
      .finally(function () {
        button.classList.remove('is-loading');
        button.removeAttribute('aria-disabled');
      });
  }

  document.addEventListener('submit', function (event) {
    var form = closestFrom(event.target, '[data-card-form]');
    if (!form) return;
    event.preventDefault();
    addToCart(form);
  });
})();
