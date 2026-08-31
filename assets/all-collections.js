/**
 * All Collections — swapping the grid without leaving the page.
 *
 * Every tab is already a working link to a collection page, so this script's
 * whole job is to intercept that navigation and fetch the grid instead. It
 * asks the link's own URL for the `all-collections-grid` section, which
 * Shopify renders in that collection's context:
 *
 *     /collections/cleansers?section_id=all-collections-grid
 *
 * Only the list items inside the grid are replaced. The list that holds them
 * belongs to the section and carries its column settings, which is why they
 * survive a swap — see the section's own comments.
 *
 * Anything this script cannot do, the link still can: a failed fetch falls
 * through to the navigation it prevented, so a visitor is never left looking
 * at a tab that is lit up beside somebody else's products.
 */
(function () {
  'use strict';

  var PARAM = 'c';

  function AllCollections(root) {
    this.root = root;
    this.grid = root.querySelector('[data-acl-grid]');
    this.links = Array.prototype.slice.call(root.querySelectorAll('[data-acl-link]'));
    this.endpoint = root.getAttribute('data-acl-endpoint');
    this.controller = null;
    this.cache = {};

    if (!this.grid || !this.links.length) return;

    // The grid drawn into the page is the one tab that never needs fetching.
    var open = this.activeLink();
    if (open) this.cache[open.getAttribute('data-acl-handle')] = this.grid.innerHTML;

    this.onClick = this.onClick.bind(this);
    this.onPopState = this.onPopState.bind(this);
    root.addEventListener('click', this.onClick);
    window.addEventListener('popstate', this.onPopState);

    // A shared link opens on the collection it names rather than on whichever
    // tab the template happens to lead with.
    var asked = new URL(window.location.href).searchParams.get(PARAM);
    if (asked && open && asked !== open.getAttribute('data-acl-handle')) {
      var link = this.linkFor(asked);
      if (link) this.select(link, { history: false });
    }
  }

  AllCollections.prototype.activeLink = function () {
    for (var i = 0; i < this.links.length; i++) {
      if (this.links[i].classList.contains('is-active')) return this.links[i];
    }
    return this.links[0] || null;
  };

  AllCollections.prototype.linkFor = function (handle) {
    for (var i = 0; i < this.links.length; i++) {
      if (this.links[i].getAttribute('data-acl-handle') === handle) return this.links[i];
    }
    return null;
  };

  AllCollections.prototype.onClick = function (event) {
    // Anything the browser would rather handle itself — a new tab, a saved
    // link, a middle click — is left to it.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var link = event.target.closest ? event.target.closest('[data-acl-link]') : null;
    if (!link || !this.root.contains(link)) return;

    event.preventDefault();
    if (link.classList.contains('is-active')) return;
    this.select(link, { history: true });
  };

  AllCollections.prototype.onPopState = function () {
    var handle = new URL(window.location.href).searchParams.get(PARAM);
    var link = handle ? this.linkFor(handle) : this.links[0];
    if (link && !link.classList.contains('is-active')) this.select(link, { history: false });
  };

  AllCollections.prototype.mark = function (link) {
    this.links.forEach(function (other) {
      var on = other === link;
      other.classList.toggle('is-active', on);
      if (on) {
        other.setAttribute('aria-current', 'true');
      } else {
        other.removeAttribute('aria-current');
      }
    });
  };

  AllCollections.prototype.select = function (link, options) {
    var self = this;
    var handle = link.getAttribute('data-acl-handle');

    this.mark(link);

    if (options.history) {
      var url = new URL(window.location.href);
      url.searchParams.set(PARAM, handle);
      window.history.pushState({ aclHandle: handle }, '', url.toString());
    }

    // A tab already visited is redrawn from what came back the first time.
    // Collections do not change between two clicks a second apart, and a
    // visitor comparing two of them should not wait twice.
    if (Object.prototype.hasOwnProperty.call(this.cache, handle)) {
      this.render(this.cache[handle]);
      return;
    }

    if (this.controller) this.controller.abort();
    this.controller = 'AbortController' in window ? new AbortController() : null;

    var target = new URL(link.href, window.location.origin);
    target.searchParams.set('section_id', this.endpoint);

    this.grid.setAttribute('aria-busy', 'true');
    this.root.classList.add('is-loading');

    fetch(target.toString(), {
      signal: this.controller ? this.controller.signal : undefined,
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Section request failed: ' + response.status);
        return response.text();
      })
      .then(function (html) {
        var items = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-acl-items]');
        if (!items) throw new Error('No grid in the response');
        self.cache[handle] = items.innerHTML;
        self.render(items.innerHTML);
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') return;
        // The link was always the fallback. Following it now is both the
        // recovery and the honest outcome: the products the tab promised,
        // on the page that is built to show them.
        window.location.href = link.href;
      });
  };

  AllCollections.prototype.render = function (html) {
    this.grid.innerHTML = html;
    this.grid.setAttribute('aria-busy', 'false');
    this.root.classList.remove('is-loading');
  };

  /**
   * Keeps the held list level with the site header.
   *
   * The header is fixed and hides itself on the way down the page, animating
   * its own `top` up to minus its height and dropping back as soon as you
   * scroll up. A sticky list set to a fixed distance from the top of the
   * screen cannot follow that: it either leaves a band of nothing once the
   * header has gone, or sits underneath it once it comes back.
   *
   * So the distance is measured rather than declared. Where the header's
   * bottom edge actually is, plus the gap, is the list's `top` — which puts
   * the list under a revealed header and near the top of the screen once the
   * header has left, without either state being written down anywhere.
   *
   * The header moves under a CSS transition, so scroll events alone would
   * report its position only at the moment the scroll happened and miss the
   * 150ms it spends travelling. The loop below therefore keeps measuring for
   * a moment after scrolling stops, and stops on its own once it has.
   */
  function StickyRail(root) {
    this.root = root;
    this.list = root.querySelector('.acl__list--sticky');
    if (!this.list) return;

    this.header = document.querySelector('.section-header');
    this.frame = null;
    this.lastScroll = 0;
    this.applied = null;

    // Below this width the list is a row above the products, not a rail
    // beside them, and has nothing to stay clear of.
    this.wide = window.matchMedia('(min-width: 990px)');

    this.tick = this.tick.bind(this);
    this.onScroll = this.onScroll.bind(this);
    this.onWidthChange = this.onWidthChange.bind(this);

    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll, { passive: true });
    if (this.wide.addEventListener) this.wide.addEventListener('change', this.onWidthChange);

    this.onWidthChange();
  }

  StickyRail.prototype.gap = function () {
    var declared = getComputedStyle(this.root).getPropertyValue('--acl-sticky-gap');
    var gap = parseFloat(declared);
    return isNaN(gap) ? 16 : gap;
  };

  StickyRail.prototype.apply = function () {
    var gap = this.gap();
    var bottom = 0;

    // The rect is the header's real position on screen, part-way through its
    // own animation included — which is exactly what has to be cleared.
    if (this.header) bottom = this.header.getBoundingClientRect().bottom;

    // Off the top of the screen entirely: the list has only the screen edge
    // left to keep away from.
    var top = Math.round(Math.max(gap, bottom + gap));
    if (top === this.applied) return;

    this.applied = top;
    this.root.style.setProperty('--acl-sticky-top', top + 'px');
  };

  StickyRail.prototype.tick = function () {
    this.apply();
    // Kept alive past the last scroll so the header is still being measured
    // while it finishes moving.
    if (Date.now() - this.lastScroll < 400) {
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.frame = null;
    }
  };

  StickyRail.prototype.onScroll = function () {
    if (!this.wide.matches) return;
    this.lastScroll = Date.now();

    // Measured here and now, rather than waiting on the frame loop below.
    // The scroll is what moved the header, so this is the earliest the new
    // position can be known — and it means the list is never a frame behind,
    // nor dependent on a callback that may be throttled.
    this.apply();

    // The loop is only for the travel: the header animates its own `top` over
    // 150ms, and those in-between positions arrive after the scroll that
    // caused them.
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  StickyRail.prototype.onWidthChange = function () {
    if (this.wide.matches) {
      this.applied = null;
      this.apply();
      return;
    }

    // Narrow: hand the list back to the stylesheet, which has no use for an
    // offset here and should not be arguing with one left behind.
    this.applied = null;
    this.root.style.removeProperty('--acl-sticky-top');
  };

  function init(scope) {
    (scope || document).querySelectorAll('[data-acl]').forEach(function (root) {
      if (root.aclReady) return;
      root.aclReady = true;
      new AllCollections(root);
      new StickyRail(root);
    });
  }

  init();

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });

  // Selecting a collection in the editor should show that collection, not
  // leave the merchant looking at whichever tab was open when they clicked.
  document.addEventListener('shopify:block:select', function (event) {
    var link = event.target.querySelector ? event.target.querySelector('[data-acl-link]') : null;
    if (link && !link.classList.contains('is-active')) link.click();
  });
})();
