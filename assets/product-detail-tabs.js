/**
 * Product detail tabs.
 *
 * A tab list over stacked panels: choosing one lights it and hides the rest.
 * Every panel is already in the markup, so switching costs nothing and the
 * section's height — set by the tallest panel, since they share a grid cell —
 * never moves under the reader.
 *
 * The arrow keys walk the list the way a tab list is expected to, wrapping at
 * each end, and move the focus with the selection so the keyboard and the
 * pointer end up in the same place.
 *
 * The filled block behind the chosen tab is one element for the whole control,
 * parked over a tab by measurement, so a switch slides it across the track.
 * The measurement is redone whenever the tabs can have changed size — a resize,
 * a late web font — because the block is placed in pixels, not in segments.
 *
 * Without JavaScript the first panel is the one marked active in the markup and
 * stays visible, and the chosen tab keeps the fill CSS gives it, so the section
 * still says something and still shows which tab it is saying it from.
 */
(function () {
  'use strict';

  function setup(root) {
    if (root.pdtBound) return;
    root.pdtBound = true;

    var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-pdt-tab]'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('[data-pdt-panel]'));
    if (tabs.length < 2) return;

    var track = root.querySelector('[data-pdt-tabs]');
    var pill = root.querySelector('[data-pdt-pill]');
    var current = Math.max(0, tabs.indexOf(root.querySelector('[data-pdt-tab][aria-selected="true"]')));
    var resizeTimer = null;

    var stillMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

    /**
     * Put the block over a tab.
     *
     * `travel` is the move it is making — {x, y} of how far it has to go — and
     * is what the deformation is read off: the control is a row on desktop and
     * a column on mobile, so the axis it squashes across is the one it is
     * crossing, whichever that turns out to be. A placement with no travel (the
     * first one, and every one after a resize) is set without a transition,
     * since sliding in from wherever the block happened to sit is not a switch.
     *
     * The deformation is a CSS animation on the face rather than something
     * driven from here on a timer. A timer firing partway through the journey
     * is a second instruction arriving mid-motion, and the block visibly stops
     * and starts again; an animation is decided once, up front.
     */
    function placePill(index, travel) {
      if (!track || !pill) return;

      var tab = tabs[index];
      var w = tab.offsetWidth;
      var h = tab.offsetHeight;
      // A control inside something hidden measures zero; leave it for the next
      // pass rather than parking the block in the corner at no size.
      if (!w || !h) return;

      if (!travel) track.classList.add('is-pill-instant');

      pill.style.setProperty('--pdt-pill-x', tab.offsetLeft + 'px');
      pill.style.setProperty('--pdt-pill-y', tab.offsetTop + 'px');
      pill.style.setProperty('--pdt-pill-w', w + 'px');
      pill.style.setProperty('--pdt-pill-h', h + 'px');
      track.classList.add('is-pill-ready');

      if (!travel) {
        // Land the placement before transitions come back, or the next frame
        // animates it after all.
        void pill.offsetWidth;
        track.classList.remove('is-pill-instant');
        return;
      }

      if (stillMotion && stillMotion.matches) return;

      var crossing = Math.abs(travel.y) > Math.abs(travel.x) ? 'is-crossing-y' : 'is-crossing-x';
      // Dropping both classes and reading back a layout value restarts the
      // animation from the top, which is what a switch made while the last one
      // is still running needs.
      pill.classList.remove('is-crossing-x', 'is-crossing-y');
      void pill.offsetWidth;
      pill.classList.add(crossing);
    }

    function select(index, moveFocus) {
      var from = tabs[current];
      var to = tabs[index];
      var travel = index === current
        ? null
        : { x: to.offsetLeft - from.offsetLeft, y: to.offsetTop - from.offsetTop };
      current = index;

      tabs.forEach(function (tab, i) {
        var chosen = i === index;
        tab.setAttribute('aria-selected', chosen ? 'true' : 'false');
        // Only the chosen tab is in the tab order; the arrows reach the rest.
        tab.setAttribute('tabindex', chosen ? '0' : '-1');
      });

      panels.forEach(function (panel, i) {
        var chosen = i === index;
        panel.classList.toggle('is-active', chosen);
        panel.setAttribute('aria-hidden', chosen ? 'false' : 'true');
      });

      placePill(index, travel);

      if (moveFocus) tabs[index].focus();
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        select(index, false);
      });

      tab.addEventListener('keydown', function (event) {
        var step = 0;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') step = 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') step = -1;
        else if (event.key === 'Home') return select(0, true), event.preventDefault();
        else if (event.key === 'End') return select(tabs.length - 1, true), event.preventDefault();
        if (!step) return;

        event.preventDefault();
        select((index + step + tabs.length) % tabs.length, true);
      });
    });

    placePill(current, null);

    // The tabs change width with the viewport and again when a web font lands,
    // and the block is placed in pixels, so both are a re-measure.
    window.addEventListener('resize', function () {
      // The theme editor replaces a section's markup wholesale, which leaves
      // this listener holding the copy that was thrown away.
      if (!document.contains(root)) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        placePill(current, null);
      }, 120);
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        placePill(current, null);
      });
    }
  }

  function setupAll(scope) {
    Array.prototype.slice.call((scope || document).querySelectorAll('[data-pdt]')).forEach(setup);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setupAll();
    });
  } else {
    setupAll();
  }

  // The theme editor rebuilds a section's markup on every settings change,
  // which leaves the new copy unbound.
  document.addEventListener('shopify:section:load', function (event) {
    setupAll(event.target);
  });
})();
