/**
 * Header dropdown — showing the card for the link being pointed at.
 *
 * The links are the menu; the card beside them is a preview of one of them.
 * So this listens for a pointer or a focus landing on a link and shows that
 * link's card. Nothing here is required for the menu to work: every link is a
 * real link, every card is already drawn, and with this script absent the
 * panel simply keeps showing the one the server marked.
 *
 * Delegated from the document, because the panels are inside `<details>`
 * elements that the theme editor replaces wholesale when the header section
 * is edited — there is nothing to re-bind afterwards this way.
 */
(function () {
  'use strict';

  function show(panel, index) {
    var links = panel.querySelectorAll('[data-hdm-link]');
    var cards = panel.querySelectorAll('[data-hdm-card]');
    var i;

    for (i = 0; i < links.length; i++) {
      links[i].classList.toggle('is-active', links[i].getAttribute('data-hdm-link') === index);
    }

    for (i = 0; i < cards.length; i++) {
      var on = cards[i].getAttribute('data-hdm-card') === index;
      cards[i].classList.toggle('is-active', on);
      // The cards that are not showing stay out of the way of a screen
      // reader, which is navigating the links rather than the preview.
      if (on) {
        cards[i].removeAttribute('aria-hidden');
      } else {
        cards[i].setAttribute('aria-hidden', 'true');
      }
    }
  }

  function activate(event) {
    var link = event.target.closest ? event.target.closest('[data-hdm-link]') : null;
    if (!link) return;

    var panel = link.closest('[data-hdm]');
    if (!panel) return;

    show(panel, link.getAttribute('data-hdm-link'));
  }

  // `mouseover` rather than `mouseenter`: it bubbles, so one listener covers
  // every link in every menu, including ones added after this ran.
  document.addEventListener('mouseover', activate);
  document.addEventListener('focusin', activate);

  /**
   * A menu that has been closed goes back to the link it opened on. Leaving
   * the last-hovered card showing would mean the menu opens on whatever the
   * pointer happened to brush on its way out the time before.
   */
  document.addEventListener(
    'toggle',
    function (event) {
      var details = event.target;
      if (!details.classList || !details.classList.contains('hdm')) return;
      if (details.open) return;

      var panel = details.querySelector('[data-hdm]');
      if (!panel) return;

      var fallback = panel.getAttribute('data-hdm-default');
      if (fallback !== null && fallback !== '-1') show(panel, fallback);
    },
    true
  );
})();
