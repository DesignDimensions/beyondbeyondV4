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

  /* Shopify's own names. The filter one is what the storefront reads, and the
     Section Rendering API honours both — which is the whole reason the grid can
     be swapped rather than the page reloaded. */
  var AVAIL = 'filter.v.availability';
  var SORT = 'sort_by';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * GSAP if the page has it and the visitor wants motion, otherwise nothing.
   *
   * Read each time rather than captured once: `gsap.min.js` is deferred, and a
   * visitor can turn motion off without reloading. Everything below has to work
   * when this returns null — the animation is the decoration, never the
   * mechanism.
   */
  function motion() {
    return !REDUCED.matches && window.gsap ? window.gsap : null;
  }

  function AllCollections(root) {
    this.root = root;
    this.grid = root.querySelector('[data-acl-grid]');
    this.links = Array.prototype.slice.call(root.querySelectorAll('[data-acl-link]'));
    this.endpoint = root.getAttribute('data-acl-endpoint');
    this.controller = null;
    this.cache = {};

    if (!this.grid || !this.links.length) return;

    this.facetLinks = Array.prototype.slice.call(root.querySelectorAll('[data-acl-facet]'));

    // What is showing, as three answers rather than one. Read off the URL so a
    // shared or reloaded link opens on exactly what it names.
    var open = this.activeLink();
    var params = new URL(window.location.href).searchParams;
    this.state = {
      collection: params.get(PARAM) || (open ? open.getAttribute('data-acl-handle') : null),
      availability: params.get(AVAIL) || '',
      sort: params.get(SORT) || '',
    };
    this.state.collection = this.knownHandle(this.state.collection);

    // The grid drawn into the page is the one combination that never needs
    // fetching — but only if the URL asked for what was drawn. Keyed on the
    // whole state, because a cache that remembers a collection and forgets the
    // filter on it will hand back the wrong products.
    if (open && this.state.collection === open.getAttribute('data-acl-handle')) {
      this.cache[this.key(this.state)] = this.grid.innerHTML;
    }

    this.onClick = this.onClick.bind(this);
    this.onPopState = this.onPopState.bind(this);
    root.addEventListener('click', this.onClick);
    window.addEventListener('popstate', this.onPopState);

    this.mark();

    // A shared link opens on the collection it names rather than on whichever
    // tab the template happens to lead with.
    if (open && this.state.collection !== open.getAttribute('data-acl-handle')) {
      this.apply(this.state, { history: false });
    }
  }

  /** One string for one combination — the cache's key and its whole memory. */
  AllCollections.prototype.key = function (state) {
    return [state.collection || '', state.availability || '', state.sort || ''].join('|');
  };

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

  /**
   * The collection a URL is asking for, but only if there is a tab for it.
   *
   * `c` can name something the rail has no tab for — a link shared from before
   * a tab was renamed or removed, or one built elsewhere in the theme. Left
   * alone, that state showed the first tab's products with no tab lit, which
   * reads as a page that has failed rather than one showing everything. Falling
   * back to the first tab is the honest answer: it is what is on screen.
   */
  AllCollections.prototype.knownHandle = function (handle) {
    if (handle && this.linkFor(handle)) return handle;
    return this.links[0] ? this.links[0].getAttribute('data-acl-handle') : null;
  };

  AllCollections.prototype.onClick = function (event) {
    // Anything the browser would rather handle itself — a new tab, a saved
    // link, a middle click — is left to it.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var target = event.target.closest ? event.target.closest('[data-acl-link], [data-acl-facet]') : null;
    if (!target || !this.root.contains(target)) return;

    event.preventDefault();

    var next = {
      collection: this.state.collection,
      availability: this.state.availability,
      sort: this.state.sort,
    };

    if (target.hasAttribute('data-acl-facet')) {
      var facet = target.getAttribute('data-acl-facet');
      var value = target.getAttribute('data-acl-value');
      // Clicking what is already on turns it off. A filter you cannot remove
      // without hunting for a reset is a trap.
      if (facet === 'availability') next.availability = next.availability === value ? '' : value;
      else if (facet === 'sort') next.sort = next.sort === value ? '' : value;
      else if (facet === 'collection') next.collection = value;
    } else {
      next.collection = target.getAttribute('data-acl-handle');
    }

    if (this.key(next) === this.key(this.state)) return;
    this.apply(next, { history: true });
  };

  AllCollections.prototype.onPopState = function () {
    var params = new URL(window.location.href).searchParams;
    var next = {
      collection: this.knownHandle(params.get(PARAM)),
      availability: params.get(AVAIL) || '',
      sort: params.get(SORT) || '',
    };
    if (this.key(next) !== this.key(this.state)) this.apply(next, { history: false });
  };

  /** Everything selectable, lit from the one state. */
  AllCollections.prototype.mark = function () {
    var state = this.state;

    function set(el, on) {
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    }

    this.links.forEach(function (el) {
      set(el, el.getAttribute('data-acl-handle') === state.collection);
    });

    this.facetLinks.forEach(function (el) {
      var facet = el.getAttribute('data-acl-facet');
      var value = el.getAttribute('data-acl-value');
      if (facet === 'availability') set(el, state.availability === value);
      else if (facet === 'sort') set(el, state.sort === value);
      else if (facet === 'collection') set(el, state.collection === value);
    });

    /* Every group starts closed, so a selection made from somewhere else — a
       `?c=` link, the phone drawer — can land inside one that is shut. Opening
       it is not a preference, it is the same rule the whole rail follows: a
       dropdown must never be hiding the thing the page is currently showing.

       Only ever opened, never closed. A visitor who shuts a group with a
       selection still inside it meant to, and this runs on selection rather
       than on every frame, so nothing fights them for it. */
    var lit = this.root.querySelector('.acl__childlink.is-active');
    if (lit && lit.closest) {
      var holder = lit.closest('details');
      if (holder && !holder.open) holder.open = true;
    }

    // The rail's own links are the no-script fallback, so they have to keep
    // naming the state they would land on rather than the one they were built
    // with.
    var self = this;
    this.facetLinks.forEach(function (el) {
      if (!el.href) return;
      var link = self.linkFor(state.collection);
      if (!link) return;
      var url = new URL(link.href, window.location.origin);
      var facet = el.getAttribute('data-acl-facet');
      if (facet === 'availability') url.searchParams.set(AVAIL, el.getAttribute('data-acl-value'));
      else if (facet === 'sort') url.searchParams.set(SORT, el.getAttribute('data-acl-value'));
      el.href = url.toString();
    });
  };

  /**
   * Show one combination of collection, availability and sort.
   *
   * Always the same shape of request: the chosen collection's own URL, with
   * `section_id` so Shopify renders just the grid, and whichever of the two
   * filters are set. The storefront does the filtering and the sorting — this
   * only asks the question.
   */
  AllCollections.prototype.apply = function (state, options) {
    var self = this;
    var link = this.linkFor(state.collection) || this.links[0];
    if (!link) return;

    this.state = state;
    this.mark();

    var cacheKey = this.key(state);

    if (options.history) {
      var url = new URL(window.location.href);
      url.searchParams.set(PARAM, state.collection);
      if (state.availability) url.searchParams.set(AVAIL, state.availability);
      else url.searchParams.delete(AVAIL);
      if (state.sort) url.searchParams.set(SORT, state.sort);
      else url.searchParams.delete(SORT);
      window.history.pushState({ aclKey: cacheKey }, '', url.toString());
    }

    // A combination already seen is redrawn from what came back the first time.
    if (Object.prototype.hasOwnProperty.call(this.cache, cacheKey)) {
      this.render(this.cache[cacheKey]);
      return;
    }

    if (this.controller) this.controller.abort();
    this.controller = 'AbortController' in window ? new AbortController() : null;

    var target = new URL(link.href, window.location.origin);
    target.search = '';
    target.searchParams.set('section_id', this.endpoint);
    if (state.availability) target.searchParams.set(AVAIL, state.availability);
    if (state.sort) target.searchParams.set(SORT, state.sort);

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
        self.cache[cacheKey] = items.innerHTML;
        self.render(items.innerHTML);
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') return;
        // The link was always the fallback. Following it now is both the
        // recovery and the honest outcome: the products the rail promised, on
        // the page that is built to show them — filters and all.
        var fallback = new URL(link.href, window.location.origin);
        if (state.availability) fallback.searchParams.set(AVAIL, state.availability);
        if (state.sort) fallback.searchParams.set(SORT, state.sort);
        window.location.href = fallback.toString();
      });
  };

  /**
   * Put a set of cards in the grid.
   *
   * The swap itself is one assignment; the rest is covering it. Cards leave
   * together and arrive one after another, because a grid that fades in as a
   * single block reads as a page load, and a grid that arrives in sequence
   * reads as the same page answering. The stagger is capped so a collection of
   * forty does not take four seconds to finish arriving.
   */
  AllCollections.prototype.render = function (html) {
    var g = motion();

    this.grid.innerHTML = html;
    this.grid.setAttribute('aria-busy', 'false');
    this.root.classList.remove('is-loading');

    if (!g) return;

    /* The swap is done before anything is animated, deliberately.
     *
     * Fading the old cards out first and swapping in the callback reads better
     * for about a hundred milliseconds and then strands the section: a second
     * click kills that tween, the callback never runs, and `aria-busy` and the
     * dimmed grid stay on with nothing coming to clear them. Cards that arrive
     * from nothing look near enough the same and cannot leave the section in a
     * state no later click will undo.
     *
     * The stagger is capped so a collection of forty does not take four seconds
     * to finish arriving. */
    var cards = this.grid.children;
    if (!cards.length) return;

    g.killTweensOf(cards);
    g.fromTo(
      cards,
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.38,
        ease: 'power2.out',
        stagger: { each: 0.035, amount: Math.min(0.035 * cards.length, 0.45) },
        // Nothing of the animation is left on a card once it has played, so a
        // card is only ever styled by the stylesheet.
        clearProps: 'opacity,transform',
      }
    );
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

  /**
   * The rail's groups, opening and closing rather than snapping.
   *
   * `<details>` has no height to animate between — it is shut or it is not — so
   * the panel inside it is what moves, and the element's own `open` is set at
   * the two ends of that. Without GSAP the listener does nothing at all and the
   * browser's instant toggle stands, which is the behaviour this replaces.
   */
  function animateDisclosures(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.acl__disclosure'), function (details) {
      var summary = details.querySelector('summary');
      var panel = details.querySelector('.acl__children');
      if (!summary || !panel) return;

      summary.addEventListener('click', function (event) {
        var g = motion();
        if (!g) return;

        event.preventDefault();
        // Mid-flight clicks are ignored rather than queued; the alternative is
        // a panel that keeps opening after you have asked it to close.
        if (details.dataset.aclAnimating === '1') return;
        details.dataset.aclAnimating = '1';

        var done = function () {
          g.set(panel, { clearProps: 'height,opacity,overflow' });
          details.dataset.aclAnimating = '0';
        };

        if (!details.open) {
          details.open = true;
          g.fromTo(
            panel,
            { height: 0, opacity: 0, overflow: 'hidden' },
            { height: 'auto', opacity: 1, duration: 0.32, ease: 'power2.out', onComplete: done }
          );
        } else {
          g.to(panel, {
            height: 0,
            opacity: 0,
            overflow: 'hidden',
            duration: 0.24,
            ease: 'power2.in',
            onComplete: function () {
              details.open = false;
              done();
            },
          });
        }
      });
    });
  }

  /**
   * The phone drawer.
   *
   * It chooses nothing by itself. Tapping stages a change to a copy of the
   * rail's state; APPLY hands that copy back to the rail, which fetches,
   * caches and pushes history exactly as it does for its own links. So the
   * drawer is a second way of asking the same question, and there is still one
   * piece of code that answers it.
   */
  function Drawer(root, rail) {
    this.root = root;
    this.rail = rail;
    this.dialog = root.querySelector('[data-acl-drawer]');
    if (!this.dialog || !rail || !rail.state) return;

    this.openBtn = root.querySelector('[data-acl-open]');
    this.countEl = this.dialog.querySelector('[data-acl-drawer-count]');
    this.sortValueEl = this.dialog.querySelector('[data-acl-sort-value]');
    this.sheets = Array.prototype.slice.call(this.dialog.querySelectorAll('[data-acl-sheet]'));
    this.options = Array.prototype.slice.call(this.dialog.querySelectorAll('[data-acl-option]'));
    this.staged = null;

    this.onClick = this.onClick.bind(this);
    if (this.openBtn) this.openBtn.addEventListener('click', this.open.bind(this));
    this.dialog.addEventListener('click', this.onClick);

    var self = this;
    this.dialog.addEventListener('click', function (event) {
      // A click that lands on the dialog itself is a click on the backdrop.
      if (event.target === self.dialog) self.close();
    });

    // Escape closes a dialog without going through close(), so it would slam
    // shut and leave the page locked. Taken over, so every way out is the same
    // way out.
    this.dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      self.close();
    });

    this.dialog.addEventListener('close', function () {
      self.unlock();
    });
  }

  /** Whatever the rail currently shows, copied in so it can be edited safely. */
  Drawer.prototype.sync = function () {
    var s = this.rail.state;
    this.staged = { collection: s.collection, availability: s.availability, sort: s.sort };
    this.paint();

    if (this.countEl) {
      var active = this.root.querySelector('[data-acl-link].is-active');
      var count = active ? active.querySelector('.acl__count') : null;
      this.countEl.textContent = count ? count.textContent.trim() + ' Products' : '';
    }
  };

  Drawer.prototype.paint = function () {
    var st = this.staged;
    this.options.forEach(function (option) {
      var facet = option.getAttribute('data-acl-facet');
      var value = option.getAttribute('data-acl-value');
      var on = facet === 'availability' ? st.availability === value
             : facet === 'sort' ? st.sort === value
             : st.collection === value;
      option.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (this.sortValueEl) {
      var chosen = this.options.filter(function (o) {
        return o.getAttribute('data-acl-facet') === 'sort' && o.getAttribute('data-acl-value') === st.sort;
      })[0];
      var label = chosen ? chosen.querySelector('.acl__optionlabel') : null;
      this.sortValueEl.textContent = label ? label.textContent.trim() : '';
    }
  };

  /**
   * Swap which sheet is showing.
   *
   * `depth` says which way it is going, because the direction is the whole
   * message: going into a group should move the other way from coming back out
   * of one, or the drawer stops feeling like it has anywhere to be.
   */
  Drawer.prototype.show = function (name, depth) {
    this.sheets.forEach(function (sheet) {
      sheet.hidden = sheet.getAttribute('data-acl-sheet') !== name;
    });

    var body = this.dialog.querySelector('.acl__drawer-body');
    if (body) body.scrollTop = 0;

    var g = motion();
    var shown = this.dialog.querySelector('[data-acl-sheet="' + name + '"]');
    if (!g || !shown || typeof depth !== 'number') return;

    g.killTweensOf(shown);
    g.fromTo(
      shown,
      { x: depth >= 0 ? 20 : -20, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.28, ease: 'power2.out', clearProps: 'opacity,transform' }
    );
  };

  Drawer.prototype.open = function () {
    // Opening an open drawer is nothing. `showModal` throws on one that is
    // already up, and it sits before the scroll lock — so without this a second
    // call would leave the page unlocked underneath an open drawer.
    if (this.dialog.open) return;

    this.sync();
    this.show('root');
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');

    // Held while the drawer is up. `showModal` already makes the page behind
    // untouchable, but it does not stop it scrolling underneath — which is the
    // one way a covered page can still move.
    this.lock();

    var g = motion();
    if (!g) return;
    g.killTweensOf(this.dialog);
    g.fromTo(
      this.dialog,
      { xPercent: 100 },
      { xPercent: 0, duration: 0.34, ease: 'power3.out', clearProps: 'transform' }
    );
  };

  /* Remembered rather than assumed: another thing on the page may already have
     locked scrolling, and putting back `''` would quietly unlock it. */
  Drawer.prototype.lock = function () {
    this.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  };

  Drawer.prototype.unlock = function () {
    document.body.style.overflow = this.prevOverflow || '';
  };

  Drawer.prototype.close = function () {
    var self = this;
    var shut = function () {
      if (typeof self.dialog.close === 'function') self.dialog.close();
      else self.dialog.removeAttribute('open');
      // Released here rather than left to the `close` event alone: that event
      // is queued as a task, so the page would stay locked for a frame after
      // the drawer had gone. The listener stays as well, for the ways out that
      // never reach this function.
      self.unlock();
    };

    var g = motion();
    if (!g) return shut();

    g.killTweensOf(this.dialog);
    g.to(this.dialog, {
      xPercent: 100,
      duration: 0.26,
      ease: 'power3.in',
      onComplete: function () {
        shut();
        // Cleared after it has gone, so the next open starts from nothing left
        // behind by the last close.
        g.set(self.dialog, { clearProps: 'transform' });
      },
    });
  };

  Drawer.prototype.onClick = function (event) {
    var t = event.target;
    if (!t.closest || !this.staged) return;

    if (t.closest('[data-acl-drawer-close]')) return this.close();

    var goto = t.closest('[data-acl-goto]');
    if (goto) return this.show(goto.getAttribute('data-acl-goto'), 1);

    if (t.closest('[data-acl-back]')) return this.show('root', -1);

    var option = t.closest('[data-acl-option]');
    if (option) {
      var facet = option.getAttribute('data-acl-facet');
      var value = option.getAttribute('data-acl-value');
      // A second tap on the same thing takes it off again — except a
      // collection, which is not a filter and always has to be something.
      if (facet === 'availability') this.staged.availability = this.staged.availability === value ? '' : value;
      else if (facet === 'sort') this.staged.sort = this.staged.sort === value ? '' : value;
      else this.staged.collection = value;
      return this.paint();
    }

    if (t.closest('[data-acl-clear]')) {
      var first = this.root.querySelector('[data-acl-link]');
      this.staged = {
        collection: first ? first.getAttribute('data-acl-handle') : this.staged.collection,
        availability: '',
        sort: '',
      };
      return this.paint();
    }

    if (t.closest('[data-acl-apply]')) {
      var next = this.staged;
      this.close();
      if (this.rail.key(next) !== this.rail.key(this.rail.state)) {
        this.rail.apply(next, { history: true });
      }
    }
  };

  function init(scope) {
    (scope || document).querySelectorAll('[data-acl]').forEach(function (root) {
      if (root.aclReady) return;
      root.aclReady = true;
      var rail = new AllCollections(root);
      // Kept on the element so anything else on the page — the drawer, a test,
      // a console — can ask what is currently showing without guessing at it.
      root.aclInstance = rail;
      new StickyRail(root);
      new Drawer(root, rail);
      animateDisclosures(root);
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
