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
 * Without JavaScript the first panel is the one marked active in the markup
 * and stays visible, so the section still says something.
 */
(function () {
  'use strict';

  function setup(root) {
    if (root.pdtBound) return;
    root.pdtBound = true;

    var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-pdt-tab]'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('[data-pdt-panel]'));
    if (tabs.length < 2) return;

    function select(index, moveFocus) {
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
