/**
 * FAQ — the rail that says where you are.
 *
 * The questions are `<details>`; opening and closing them is the browser's job
 * and is not in here. This file is only the rail, and it is the same rail the
 * Legal page has — measured offset, scrollspy, and the collapse to one row on a
 * phone. Kept as its own file because a section here owns its assets; the two
 * are the same shape on purpose, so a fix to one is worth carrying to the other.
 *
 * The page works without this file. Every policy is on it, and the rail is a
 * list of ordinary in-page links to them, landing on the offset the stylesheet
 * gives each policy. What this adds is what a link cannot do: move the filled
 * radio as the page scrolls, ease the jump when one is clicked, and — narrow,
 * where the rail collapses to the category you are in — open it to the rest.
 *
 * Two jobs, one measurement. Where the rail pins and where a policy has to land
 * are the same question asked twice, so the header is measured once per frame
 * and both answers come from it:
 *
 *   --fqc-sticky-top   where the rail pins: past the header, plus the gap.
 *   --fqc-land         where a policy lands. Wide, the rail is beside the
 *                      policies and this is the same number. Narrow, the rail
 *                      is above them, so a policy has to clear its height too
 *                      or it arrives underneath it.
 */
(function () {
  'use strict';

  /**
   * The header is fixed and hides itself on the way down the page, animating
   * its own `top` up to minus its height and dropping back as soon as you
   * scroll up. Anything pinned at a fixed distance from the top of the screen
   * cannot follow that: it either leaves a band of nothing once the header has
   * gone, or sits underneath it once it comes back. So the distance is measured
   * rather than declared — the same arrangement the collections rail uses.
   *
   * The header moves under a CSS transition, so scroll events alone would
   * report its position only at the moment the scroll happened and miss the
   * time it spends travelling. The loop below therefore keeps measuring for a
   * moment after scrolling stops, and stops on its own once it has.
   */
  function FaqRail(root) {
    this.root = root;
    this.rail = root.querySelector('[data-fqc-rail]');
    this.toggle = root.querySelector('[data-fqc-toggle]');
    this.links = Array.prototype.slice.call(root.querySelectorAll('[data-fqc-link]'));
    this.groups = Array.prototype.slice.call(root.querySelectorAll('[data-fqc-group]'));
    if (!this.links.length || !this.groups.length) return;

    this.header = document.querySelector('.section-header');
    this.frame = null;
    this.lastScroll = 0;
    this.appliedTop = null;
    this.appliedLand = null;
    this.appliedActive = null;
    this.railH = 0;

    // Below this width the rail crosses the top of the page instead of standing
    // beside the questions, and collapses to the one you are reading.
    this.stacked = window.matchMedia('(max-width: 989px)');
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.tick = this.tick.bind(this);
    this.onScroll = this.onScroll.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onLayoutChange = this.onLayoutChange.bind(this);
    this.onClick = this.onClick.bind(this);

    root.addEventListener('click', this.onClick);
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    if (this.stacked.addEventListener) this.stacked.addEventListener('change', this.onLayoutChange);

    this.onLayoutChange();
  }

  /**
   * The gap the rail keeps from the header. Narrow it keeps none: the rail is a
   * band across the top of the page and sits flush against the header, the way
   * the phone layout is drawn.
   */
  FaqRail.prototype.gap = function () {
    if (this.stacked.matches) return 0;
    var gap = parseFloat(getComputedStyle(this.root).getPropertyValue('--fqc-sticky-gap'));
    return isNaN(gap) ? 16 : gap;
  };

  /* The rect is the header's real position on screen, part-way through its own
     animation included — which is exactly what has to be cleared. Off the top of
     the screen entirely, there is only the screen edge left to keep away from. */
  FaqRail.prototype.top = function () {
    var gap = this.gap();
    var bottom = this.header ? this.header.getBoundingClientRect().bottom : 0;
    return Math.round(Math.max(gap, bottom + gap));
  };

  /**
   * Measured on layout changes rather than every frame: reading a height forces
   * the browser to lay the page out, and this one only changes when the window
   * does. Always the *closed* height — opening the rail is a temporary state
   * that a click on one of its links immediately ends, so a policy should land
   * clear of the rail as it will be, not as it is mid-tap.
   */
  FaqRail.prototype.measureRail = function () {
    if (!this.rail || !this.stacked.matches) {
      this.railH = 0;
      return;
    }
    var open = this.rail.classList.contains('is-open');
    if (open) this.rail.classList.remove('is-open');
    this.railH = this.rail.offsetHeight;
    if (open) this.rail.classList.add('is-open');
  };

  FaqRail.prototype.land = function () {
    return this.top() + this.railH;
  };

  FaqRail.prototype.apply = function () {
    var top = this.top();
    if (top !== this.appliedTop) {
      this.appliedTop = top;
      this.root.style.setProperty('--fqc-sticky-top', top + 'px');
    }

    var land = top + this.railH;
    if (land !== this.appliedLand) {
      this.appliedLand = land;
      this.root.style.setProperty('--fqc-land', land + 'px');
      this.root.style.setProperty('--fqc-rail-h', this.railH + 'px');
    }

    this.spy(land);
  };

  /**
   * The category you are in is the last one whose top edge has crossed the
   * line a rail link would scroll it to — so clicking a link and landing on it
   * lights that link and no other.
   *
   * The bottom of the page is the one place that rule breaks: a short last
   * category can never reach the line, because there is no scroll left to bring
   * it there. Whoever is at the bottom is in the last one.
   */
  FaqRail.prototype.spy = function (line) {
    var edge = line + 1;
    var current = this.groups[0];

    for (var i = 0; i < this.groups.length; i++) {
      if (this.groups[i].getBoundingClientRect().top <= edge) current = this.groups[i];
    }

    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    if (scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
      current = this.groups[this.groups.length - 1];
    }

    var id = current ? current.id : null;
    if (id === this.appliedActive) return;
    this.appliedActive = id;

    for (var j = 0; j < this.links.length; j++) {
      var link = this.links[j];
      var on = link.getAttribute('href') === '#' + id;
      link.classList.toggle('is-active', on);
      // Carried on the row as well: closed, the rail is whichever row this is,
      // and that is a question the stylesheet asks of the row.
      if (link.parentElement) link.parentElement.classList.toggle('is-current', on);
      if (on) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };

  FaqRail.prototype.tick = function () {
    this.apply();
    // Kept alive past the last scroll so the header is still being measured
    // while it finishes moving.
    if (Date.now() - this.lastScroll < 400) {
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.frame = null;
    }
  };

  FaqRail.prototype.onScroll = function () {
    this.lastScroll = Date.now();

    // Measured here and now, rather than waiting on the frame loop below. The
    // scroll is what moved the header, so this is the earliest the new position
    // can be known — and it means the rail is never a frame behind, nor
    // dependent on a callback that may be throttled.
    this.apply();

    // The loop is only for the travel: the header animates its own `top`, and
    // those in-between positions arrive after the scroll that caused them.
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  FaqRail.prototype.onResize = function () {
    this.measureRail();
    this.appliedLand = null;
    this.onScroll();
  };

  FaqRail.prototype.onLayoutChange = function () {
    // The open state belongs to the collapsed rail. Widening the window ends
    // that layout, so it ends with it rather than being left set on a rail that
    // has no button to unset it.
    if (!this.stacked.matches) this.setOpen(false);
    this.measureRail();
    this.appliedTop = null;
    this.appliedLand = null;
    this.apply();
  };

  FaqRail.prototype.setOpen = function (open) {
    if (!this.rail || !this.toggle) return;
    this.rail.classList.toggle('is-open', open);
    this.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  FaqRail.prototype.onClick = function (event) {
    if (!event.target.closest) return;

    var toggle = event.target.closest('[data-fqc-toggle]');
    if (toggle && this.root.contains(toggle)) {
      this.setOpen(this.toggle.getAttribute('aria-expanded') !== 'true');
      return;
    }

    var link = event.target.closest('[data-fqc-link]');
    if (!link || !this.root.contains(link)) return;

    var href = link.getAttribute('href') || '';
    if (href.charAt(0) !== '#') return;

    var target = document.getElementById(href.slice(1));
    if (!target) return;

    event.preventDefault();

    // Closed before the trip, not after: the rail shrinks back to one row, and
    // `scroll-margin-top` is already the height it shrinks to, so the category
    // arrives just under it rather than behind an open list.
    this.setOpen(false);

    target.scrollIntoView({
      behavior: this.still.matches ? 'auto' : 'smooth',
      block: 'start'
    });

    // Lit immediately rather than waiting for the scroll to arrive, so a tap is
    // acknowledged at once even though the page is still travelling.
    this.appliedActive = null;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', href);
    }
  };

  function init(scope) {
    (scope || document).querySelectorAll('[data-fqc]').forEach(function (root) {
      if (root.fqcReady) return;
      root.fqcReady = true;
      new FaqRail(root);
    });
  }

  init();

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });

  // Selecting a category or one of its questions in the theme editor should
  // show it — and a question whose answer is shut is no help, so it is opened.
  // A visitor's own clicks stay the browser's to handle.
  document.addEventListener('shopify:block:select', function (event) {
    var block = event.target;
    if (!block || !block.closest || !block.closest('[data-fqc]')) return;
    if (block.tagName === 'DETAILS') block.open = true;
    block.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
