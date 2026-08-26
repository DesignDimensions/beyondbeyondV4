/**
 * Cart drawer.
 *
 * <cart-drawer> is the shell: the backdrop, the slide transition, the focus trap and the
 * body scroll lock. <mini-cart> is the panel inside it and owns the content, which is
 * fetched from the `mini-cart` section the first time the drawer opens rather than being
 * rendered into every page -- the drawer's cross-sell rail costs a run of all_products
 * lookups, and most page views never open it.
 *
 * Both elements expose getSectionsToRender() and renderContents(), because the theme's
 * add-to-cart paths (product-form.js, quick-add.js, upselling-image-slider.js) look up
 * <cart-drawer> while the drawer's own components look up <mini-cart>.
 */
class MiniCart extends HTMLElement {
  connectedCallback() {
    // Set here rather than in a constructor: renderContents() replaces this element's
    // innerHTML, not the element, so an instance is reused across cart updates.
    this.loaded = this.loaded || false;
    this.loading = null;
  }

  get drawer() {
    return this.closest('cart-drawer');
  }

  /**
   * Fetches the drawer's markup, once. Concurrent callers share the in-flight request, and
   * a load that has already happened resolves immediately.
   */
  load() {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;

    this.loading = fetch(this.dataset.url)
      .then((response) => response.text())
      .then((html) => {
        this.innerHTML = this.getSectionInnerHTML(html, '.shopify-section');
        this.loaded = true;
        document.dispatchEvent(new CustomEvent('cartdrawer:opened'));
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        this.loading = null;
      });

    return this.loading;
  }

  open() {
    this.drawer?.open();
  }

  renderContents(parsedState) {
    this.productId = parsedState.id;
    this.getSectionsToRender().forEach((section) => {
      const element = document.getElementById(section.id);
      const html = parsedState.sections?.[section.id];
      if (!element || !html) return;

      element.innerHTML = this.getSectionInnerHTML(html, section.selector);
      if (section.id === 'mini-cart') this.loaded = true;
    });

    // GoKwik's side-cart owns the add-to-cart drawer once it's active; opening the native
    // drawer too would stack both on top of each other.
    if (!window.kwikCartActive) {
      this.open();
    }
  }

  getSectionsToRender() {
    return [
      {
        id: 'mini-cart',
        section: 'mini-cart',
        selector: '.shopify-section',
      },
      {
        id: 'cart-icon-bubble',
        section: 'cart-icon-bubble',
        selector: '.shopify-section',
      },
    ];
  }

  getSectionInnerHTML(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector)?.innerHTML;
  }

  setActiveElement(element) {
    this.drawer?.setActiveElement(element);
  }
}

customElements.define('mini-cart', MiniCart);

// iOS Safari needs a different scroll lock from every other browser -- see lockScroll().
const CART_DRAWER_IS_IOS = /iP(ad|hone|od)/.test(navigator.platform) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

class CartDrawer extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('keyup', (event) => event.code === 'Escape' && this.close());
    this.querySelector('#CartDrawer-Overlay')?.addEventListener('click', this.close.bind(this));
    this.setHeaderCartIconAccessibility();

    this.onCartRefreshListener = this.onCartRefresh.bind(this);
    this.onPageShowListener = this.onPageShow.bind(this);
  }

  connectedCallback() {
    document.addEventListener('cart:refresh', this.onCartRefreshListener);
    window.addEventListener('pageshow', this.onPageShowListener);
  }

  disconnectedCallback() {
    document.removeEventListener('cart:refresh', this.onCartRefreshListener);
    window.removeEventListener('pageshow', this.onPageShowListener);
  }

  // Leaving the page with the drawer open leaves the body pinned, and Safari's back button
  // restores that state from the bfcache -- the page would come back unscrollable.
  onPageShow(event) {
    if (event.persisted) this.unlockScroll();
  }

  /**
   * `cart:refresh` is how apps and other scripts ask the theme to re-read the cart without
   * having a section-rendered response of their own. Pass `{ detail: { open: true } }` to
   * pop the drawer once it has caught up.
   */
  async onCartRefresh(event) {
    const miniCart = this.miniCart;
    if (!miniCart) return;

    try {
      // Derived from the drawer's own URL so the locale root stays whatever Liquid rendered.
      const bubbleUrl = miniCart.dataset.url.replace('section_id=mini-cart', 'section_id=cart-icon-bubble');

      const [drawerResponse, bubbleResponse] = await Promise.all([
        fetch(miniCart.dataset.url),
        fetch(bubbleUrl),
      ]);

      if (!drawerResponse.ok || !bubbleResponse.ok) throw new Error('Failed to fetch cart sections');

      const [drawerText, bubbleText] = await Promise.all([drawerResponse.text(), bubbleResponse.text()]);

      const drawerHTML = this.getSectionInnerHTML(drawerText);
      if (drawerHTML !== undefined) {
        miniCart.innerHTML = drawerHTML;
        miniCart.loaded = true;
      }

      const bubble = document.getElementById('cart-icon-bubble');
      const bubbleHTML = this.getSectionInnerHTML(bubbleText);
      if (bubble && bubbleHTML !== undefined) bubble.innerHTML = bubbleHTML;

      if (event?.detail?.open === true) this.open();
    } catch (error) {
      console.error('Error refreshing cart:', error);
    }
  }

  get miniCart() {
    return this.querySelector('mini-cart');
  }

  setHeaderCartIconAccessibility() {
    const cartLink = document.querySelector('#cart-icon-bubble');
    if (!cartLink) return;

    cartLink.setAttribute('role', 'button');
    cartLink.setAttribute('aria-haspopup', 'dialog');
    cartLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.open(cartLink);
    });
    cartLink.addEventListener('keydown', (event) => {
      if (event.code.toUpperCase() === 'SPACE') {
        event.preventDefault();
        this.open(cartLink);
      }
    });
  }

  open(triggeredBy) {
    if (this.classList.contains('active')) return;
    if (triggeredBy) this.setActiveElement(triggeredBy);

    this.miniCart?.load();

    // The transition doesn't always fire off the same frame the element becomes visible.
    setTimeout(() => {
      this.classList.add('active');
    });

    this.addEventListener(
      'transitionend',
      () => {
        trapFocus(this, this.querySelector('.mini-cart__close') || this.miniCart);
      },
      { once: true }
    );

    this.lockScroll();
  }

  close() {
    if (!this.classList.contains('active')) return;

    // The host's own `visibility` transition holds it on screen for the length of the
    // panel's slide-out, so there is no closing state to clean up afterwards.
    this.classList.remove('active');

    removeTrapFocus(this.activeElement);
    this.unlockScroll();
  }

  /**
   * iOS Safari treats `overflow: hidden` on the body as a suggestion -- the page carries on
   * scrolling under the drawer, and that scroll is also what collapses Safari's toolbars and
   * resizes the viewport out from under it. Pinning the body at its current offset is the only
   * lock that holds there, so it is applied on iOS alone: every other browser is served by the
   * `overflow: hidden`, and pinning them would reflow the page behind for nothing.
   */
  lockScroll() {
    // Locking the page removes its scrollbar, and everything behind the drawer reflows a few
    // pixels wider as the gutter is handed back. Measure it first and hold it open. Overlay
    // scrollbars (all of iOS, most of macOS) measure 0 and are skipped.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    document.body.classList.add('overflow-hidden');
    if (!CART_DRAWER_IS_IOS || this.scrollLocked) return;

    this.scrollLocked = true;
    this.lockedScrollTop = window.scrollY;
    document.body.style.top = `-${this.lockedScrollTop}px`;
    document.body.classList.add('cart-drawer--scroll-locked');
  }

  unlockScroll() {
    document.body.classList.remove('overflow-hidden');
    document.body.style.paddingRight = '';
    if (!this.scrollLocked) return;

    this.scrollLocked = false;
    document.body.classList.remove('cart-drawer--scroll-locked');
    document.body.style.top = '';
    window.scrollTo(0, this.lockedScrollTop);
  }

  renderContents(parsedState) {
    this.miniCart?.renderContents(parsedState);
  }

  getSectionsToRender() {
    return this.miniCart ? this.miniCart.getSectionsToRender() : [];
  }

  getSectionInnerHTML(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector)?.innerHTML;
  }

  setActiveElement(element) {
    this.activeElement = element;
  }
}

customElements.define('cart-drawer', CartDrawer);
