/**
 * The cart drawer's line items, discount field, order note and shipping estimator.
 *
 * Ported from the beyondbeyondskincare theme. The element names differ from that theme's:
 * <cart-items> and <cart-remove-button> are already taken here by the cart page (cart.js),
 * and the drawer is rendered on that page too, so the drawer's own copies are
 * <mini-cart-items> and <mini-cart-remove-button>. Ids are prefixed for the same reason.
 */

// Session storage is unavailable in some privacy modes, and reading it throws rather than
// returning null. The source theme has this in its global.js.
function isCartStorageSupported(type = 'session') {
  const storage = type === 'session' ? window.sessionStorage : window.localStorage;
  const testKey = '__storage_test__';

  try {
    storage.setItem(testKey, testKey);
    storage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

class MiniCartRemoveButton extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('click', (event) => {
      event.preventDefault();
      this.closest('mini-cart-items').updateQuantity(this.dataset.index, 0);
    });
  }
}
customElements.define('mini-cart-remove-button', MiniCartRemoveButton);

class MiniCartItems extends HTMLElement {
  constructor() {
    super();

    this.lineItemStatusElement = document.getElementById('MiniCart-LineItemStatus');
    this.cartErrors = document.getElementById('MiniCart-CartErrors');

    this.currentItemCount = Array.from(this.querySelectorAll('[name="updates[]"]')).reduce(
      (total, quantityInput) => total + parseInt(quantityInput.value),
      0
    );

    this.debouncedOnChange = debounce((event) => {
      this.onChange(event);
    }, 300);

    this.addEventListener('change', this.debouncedOnChange.bind(this));
  }

  onChange(event) {
    // The variant picker's <select> and the gift-note <textarea> are inside a line item too,
    // and their change events bubble here. Only the quantity inputs drive a line update --
    // without this, editing either fires /cart/change.js with no line and a junk quantity.
    if (!event.target?.matches('[name="updates[]"]')) return;

    this.updateQuantity(event.target.dataset.index, event.target.value, document.activeElement.getAttribute('name'));
  }

  getSectionsToRender() {
    // The cart page carries its own line-item table and footer. They are only in the DOM on
    // /cart, and re-rendering them there keeps the page in step with a change made in the
    // drawer; everywhere else the lookups come back undefined and drop out.
    let sections = [
      {
        id: 'mini-cart',
        section: document.getElementById('mini-cart')?.id,
        selector: '.shopify-section',
      },
      {
        id: 'main-cart-items',
        section: document.getElementById('main-cart-items')?.dataset.id,
        selector: '.js-contents',
      },
      {
        id: 'cart-icon-bubble',
        section: 'cart-icon-bubble',
        selector: '.shopify-section',
      },
      {
        id: 'cart-live-region-text',
        section: 'cart-live-region-text',
        selector: '.shopify-section',
      },
      {
        id: 'main-cart-footer',
        section: document.getElementById('main-cart-footer')?.dataset.id,
        selector: '.js-contents',
      },
    ];

    if (document.querySelector('#main-cart-footer .free-shipping')) {
      sections.push({
        id: 'main-cart-footer',
        section: document.getElementById('main-cart-footer')?.dataset.id,
        selector: '.free-shipping',
      });
    }

    return sections;
  }

  updateQuantity(line, quantity, name) {
    this.enableLoading(line);
    const sections = this.getSectionsToRender().map((section) => section.section);

    const body = JSON.stringify({
      line,
      quantity,
      sections: sections,
      sections_url: window.location.pathname,
    });

    fetch(`${routes.cart_change_url}`, { ...fetchConfig(), ...{ body } })
      .then((response) => response.text())
      .then((state) => {
        const parsedState = JSON.parse(state);
        this.classList.toggle('is-empty', parsedState.item_count === 0);

        const miniCartForm = document.getElementById('MiniCartForm');
        if (miniCartForm) miniCartForm.classList.toggle('is-empty', parsedState.item_count === 0);

        const cartDrawer = document.querySelector('cart-drawer');
        if (cartDrawer) cartDrawer.classList.toggle('is-empty', parsedState.item_count === 0);

        const cartFooter = document.getElementById('main-cart-footer');
        if (cartFooter) cartFooter.classList.toggle('is-empty', parsedState.item_count === 0);

        if (parsedState.errors) {
          this.updateErrorLiveRegions(line, parsedState.errors);
        }

        this.getSectionsToRender().forEach((section) => {
          const element = document.getElementById(section.id);
          if (!element) return;

          const elementToReplace = element.querySelector(section.selector) || element;
          if (elementToReplace && parsedState.sections[section.section]) {
            elementToReplace.innerHTML = this.getSectionInnerHTML(
              parsedState.sections[section.section],
              section.selector
            );
          }
        });

        this.updateQuantityLiveRegions(line, parsedState.item_count);

        const lineItem = document.getElementById(`MiniCart-Item-${line}`);
        if (lineItem && name) lineItem.querySelector(`[name="${name}"]`)?.focus();
        this.disableLoading();

        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: state } }));
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'mini-cart-items' });
      })
      .catch(() => {
        this.querySelectorAll('.loading-overlay').forEach((overlay) => overlay.classList.add('hidden'));
        this.disableLoading();
        if (this.cartErrors) {
          this.cartErrors.textContent = window.cartStrings.error;
        }
      });
  }

  updateErrorLiveRegions(line, message) {
    const lineItemError = document.getElementById(`MiniCart-LineItemError-${line}`);
    if (lineItemError) lineItemError.querySelector('.cart-item__error-text').innerHTML = message;

    if (this.lineItemStatusElement) this.lineItemStatusElement.setAttribute('aria-hidden', true);

    const cartStatus = document.getElementById('MiniCart-LiveRegionText');
    if (!cartStatus) return;

    cartStatus.setAttribute('aria-hidden', false);
    setTimeout(() => {
      cartStatus.setAttribute('aria-hidden', true);
    }, 1000);
  }

  updateQuantityLiveRegions(line, itemCount) {
    if (this.currentItemCount === itemCount) {
      const quantityError = document.getElementById(`MiniCart-LineItemError-${line}`);
      if (quantityError) {
        quantityError.querySelector('.cart-item__error-text').innerHTML = window.cartStrings.quantityError.replace(
          '[quantity]',
          document.getElementById(`MiniCart-Quantity-${line}`).value
        );
      }
    }

    this.currentItemCount = itemCount;

    if (this.lineItemStatusElement) this.lineItemStatusElement.setAttribute('aria-hidden', true);

    const cartStatus = document.getElementById('MiniCart-LiveRegionText');
    if (cartStatus) {
      cartStatus.setAttribute('aria-hidden', false);

      setTimeout(() => {
        cartStatus.setAttribute('aria-hidden', true);
      }, 1e3);
    }
  }

  getSectionInnerHTML(html, selector) {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector)?.innerHTML;
  }

  enableLoading(line) {
    const cartItems = document.getElementById('MiniCartItems');
    if (cartItems) cartItems.classList.add('cart__items--disabled');

    const loadingOverlay = this.querySelectorAll('.loading-overlay')[line - 1];
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    document.activeElement.blur();
    if (this.lineItemStatusElement) this.lineItemStatusElement.setAttribute('aria-hidden', false);
  }

  disableLoading() {
    const cartItems = document.getElementById('MiniCartItems');
    if (cartItems) cartItems.classList.remove('cart__items--disabled');
  }

  renderContents(parsedState) {
    this.getSectionsToRender().forEach((section) => {
      const element = document.getElementById(section.id);
      if (!element) return;

      element.innerHTML = this.getSectionInnerHTML(parsedState.sections[section.id], section.selector);
    });
  }
}
customElements.define('mini-cart-items', MiniCartItems);

// cart.js defines the same element for the cart page and only one of the two ever wins the
// race on /cart, where both scripts load. They behave identically, so either is fine.
if (!customElements.get('cart-note')) {
  customElements.define(
    'cart-note',
    class MiniCartNote extends HTMLElement {
      constructor() {
        super();

        this.addEventListener(
          'change',
          debounce((event) => {
            const body = JSON.stringify({ note: event.target.value });
            fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } });
          }, 300)
        );
      }
    }
  );
}

class DiscountCode extends HTMLElement {
  constructor() {
    super();

    this.input = this.querySelector('input[name="discount"]');
    this.message = this.querySelector('.cart-discount__message');
    this.applyButton = this.querySelector('.cart-discount__apply');

    if (isCartStorageSupported('session')) {
      this.setupDiscount();

      this.addEventListener('change', (event) => {
        if (event.target === this.input) {
          window.sessionStorage.setItem('discount', event.target.value);
        }
      });
    }

    this.addEventListener('click', (event) => {
      if (event.target.closest('.cart-discount__apply')) {
        this.applyDiscount(this.input.value);
        return;
      }

      const removeButton = event.target.closest('[data-remove-code]');
      if (removeButton) {
        this.removeDiscount(removeButton.dataset.removeCode);
      }
    });

    this.addEventListener('keydown', (event) => {
      if (event.target === this.input && event.key === 'Enter') {
        event.preventDefault();
        this.applyDiscount(this.input.value);
      }
    });
  }

  setupDiscount() {
    const discount = window.sessionStorage.getItem('discount');
    if (discount !== null && this.input) {
      this.input.value = discount;
    }
  }

  async applyDiscount(code) {
    code = (code || '').trim();
    if (!code || this.loading) return;

    this.setLoading(true);
    this.showMessage(window.discountStrings.applying);

    // The parameter carries the cart's whole set of codes, so adding one means resending the
    // codes already on the cart alongside it.
    const codes = this.appliedCodes().filter((applied) => !this.sameCode(applied, code));
    codes.push(code);

    const state = await this.submitDiscount(codes.join(','));
    if (!state) return;

    // A code Shopify accepts but cannot apply to this cart comes back with the cart unchanged,
    // so the discount applications are the source of truth for success rather than the status.
    const applied = this.isCodeApplied(state, code);

    if (isCartStorageSupported('session')) {
      if (applied) {
        window.sessionStorage.removeItem('discount');
      } else {
        window.sessionStorage.setItem('discount', code);
      }
    }

    const current = this.commit(state);
    if (applied) {
      if (current.input) current.input.value = '';
      current.showMessage(window.discountStrings.applied.replace('[code]', code), 'success');
    } else {
      if (current.input) {
        current.input.value = code;
        current.input.focus();
      }
      current.showMessage(window.discountStrings.invalid.replace('[code]', code), 'error');
    }
  }

  async removeDiscount(code) {
    if (this.loading) return;

    this.setLoading(true);
    this.showMessage(window.discountStrings.removing);

    // Dropping one code means resending the rest; an empty value clears every discount.
    const remaining = this.appliedCodes().filter((applied) => !this.sameCode(applied, code));

    const state = await this.submitDiscount(remaining.join(','));
    if (!state) return;

    if (isCartStorageSupported('session')) window.sessionStorage.removeItem('discount');
    this.commit(state);
  }

  // /cart/update.js takes a `discount` parameter (Cart AJAX API, May 2025), so codes are applied
  // without leaving the page. Asking for sections in the same call returns the cart and the
  // re-rendered drawer together. Resolves to null when the request failed and was reported.
  async submitDiscount(discount) {
    const sections = this.getSectionsToRender();
    const body = JSON.stringify({
      discount,
      sections: sections.map((section) => section.section).filter(Boolean),
      sections_url: window.location.pathname,
    });

    try {
      const response = await fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } });
      const state = await response.json();

      if (!response.ok) {
        this.setLoading(false);
        this.showMessage(state.description || state.message || window.discountStrings.error, 'error');
        return null;
      }

      return state;
    } catch (error) {
      console.error(error);
      this.setLoading(false);
      this.showMessage(window.discountStrings.error, 'error');
      return null;
    }
  }

  // Renders the new cart and returns the element the outcome should be shown on: the section
  // render replaces this one, so messages have to land on its successor.
  commit(state) {
    this.renderSections(this.getSectionsToRender(), state.sections);

    document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: JSON.stringify(state) } }));
    publish(PUB_SUB_EVENTS.cartUpdate, { source: 'discount-code' });

    const current = document.querySelector('discount-code') || this;
    current.setLoading(false);
    return current;
  }

  appliedCodes() {
    return Array.from(this.querySelectorAll('[data-remove-code]')).map((button) => button.dataset.removeCode);
  }

  sameCode(a, b) {
    return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
  }

  // Shopify reports an accepted code as a discount application on the cart or on the lines it
  // touches; a code that is unknown or not applicable to this cart leaves nothing behind.
  isCodeApplied(cart, code) {
    const titles = (cart.cart_level_discount_applications || []).map((discount) => discount.title);

    (cart.items || []).forEach((item) => {
      (item.line_level_discount_allocations || []).forEach((allocation) => {
        titles.push(allocation.discount_application?.title);
      });
      (item.discounts || []).forEach((discount) => titles.push(discount.title));
    });

    return titles.some((title) => this.sameCode(title, code));
  }

  getSectionsToRender() {
    const miniCartItems = document.querySelector('mini-cart-items');
    if (miniCartItems) return miniCartItems.getSectionsToRender();

    return [{ id: 'mini-cart', section: 'mini-cart', selector: '.shopify-section' }];
  }

  renderSections(sections, rendered) {
    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      const html = rendered?.[section.section];
      if (!element || !html) return;

      const parsed = new DOMParser().parseFromString(html, 'text/html').querySelector(section.selector);
      if (parsed) (element.querySelector(section.selector) || element).innerHTML = parsed.innerHTML;
    });
  }

  setLoading(loading) {
    this.loading = loading;
    this.classList.toggle('cart-discount--loading', loading);
    if (this.applyButton) this.applyButton.disabled = loading;
  }

  showMessage(text, status) {
    if (!this.message) return;

    this.message.textContent = text || '';
    this.message.hidden = !text;
    this.message.classList.toggle('cart-discount__message--error', status === 'error');
    this.message.classList.toggle('cart-discount__message--success', status === 'success');
  }
}
customElements.define('discount-code', DiscountCode);

class ShippingCalculator extends HTMLElement {
  constructor() {
    super();

    this.setupCountries();

    this.errors = this.querySelector('#ShippingCalculatorErrors');
    this.success = this.querySelector('#ShippingCalculatorSuccess');
    this.zip = this.querySelector('#ShippingCalculatorZip');
    this.country = this.querySelector('#ShippingCalculatorCountry');
    this.province = this.querySelector('#ShippingCalculatorProvince');
    this.button = this.querySelector('button');
    this.button.addEventListener('click', this.onSubmitHandler.bind(this));
  }

  setupCountries() {
    if (Shopify && Shopify.CountryProvinceSelector) {
      // eslint-disable-next-line no-new
      new Shopify.CountryProvinceSelector('ShippingCalculatorCountry', 'ShippingCalculatorProvince', {
        hideElement: 'ShippingCalculatorProvinceContainer',
      });
    }
  }

  onSubmitHandler(event) {
    event.preventDefault();

    this.errors.classList.add('hidden');
    this.success.classList.add('hidden');
    this.zip.classList.remove('invalid');
    this.country.classList.remove('invalid');
    this.province.classList.remove('invalid');
    this.button.classList.add('loading');
    this.button.setAttribute('disabled', true);

    const body = JSON.stringify({
      shipping_address: {
        zip: this.zip.value,
        country: this.country.value,
        province: this.province.value,
      },
    });
    let sectionUrl = `${routes.cart_url}/shipping_rates.json`;

    // remove double `/` in case shop might have /en or language in URL
    sectionUrl = sectionUrl.replace('//', '/');

    fetch(sectionUrl, { ...fetchConfig('javascript'), body })
      .then((response) => response.json())
      .then((parsedState) => {
        if (parsedState.shipping_rates) {
          this.success.classList.remove('hidden');
          this.success.innerHTML = '';

          parsedState.shipping_rates.forEach((rate) => {
            const child = document.createElement('p');
            child.innerHTML = `${rate.name}: ${rate.price} ${Shopify.currency.active}`;
            this.success.appendChild(child);
          });
        } else {
          let errors = [];
          Object.entries(parsedState).forEach(([attribute, messages]) => {
            errors.push(`${attribute.charAt(0).toUpperCase() + attribute.slice(1)} ${messages[0]}`);
          });

          this.errors.classList.remove('hidden');
          this.errors.querySelector('.errors').innerHTML = errors.join('; ');
        }
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        this.button.classList.remove('loading');
        this.button.removeAttribute('disabled');
      });
  }
}
customElements.define('shipping-calculator', ShippingCalculator);
