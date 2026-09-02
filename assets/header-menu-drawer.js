/**
 * The phone menu drawer.
 *
 * Three levels of the store's own navigation, one panel at a time. The panels
 * are all in the page already — the drawer only decides which one is showing —
 * so drilling in never waits on anything and never fails halfway.
 *
 * The page works without this file in the sense that matters: every leaf of the
 * menu is a real link. What this adds is the drawer itself, the way in and out,
 * and the movement between panels.
 */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * GSAP if the page has it and the visitor wants motion, otherwise nothing.
   * Read each time: `gsap.min.js` is deferred, and motion can be turned off
   * without a reload. Everything below works when this returns null.
   */
  function motion() {
    return !REDUCED.matches && window.gsap ? window.gsap : null;
  }

  function MenuDrawer(dialog) {
    this.dialog = dialog;
    this.panels = Array.prototype.slice.call(dialog.querySelectorAll('[data-hmd-panel]'));
    if (!this.panels.length) return;

    this.openBtn = document.querySelector('[data-hmd-open]');
    this.inner = dialog.querySelector('.hmd__inner');
    this.scroller = dialog.querySelector('.hmd__panels');
    this.current = 'root';

    this.onClick = this.onClick.bind(this);
    if (this.openBtn) this.openBtn.addEventListener('click', this.open.bind(this));
    dialog.addEventListener('click', this.onClick);

    var self = this;

    dialog.addEventListener('click', function (event) {
      // A click that lands on the dialog itself is a click on the backdrop.
      if (event.target === dialog) self.close();
    });

    // Escape closes a dialog without passing through close(), so it would slam
    // shut and leave the page locked. Taken over, so every way out is one way.
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      self.close();
    });

    dialog.addEventListener('close', function () {
      self.unlock();
    });
  }

  /* Remembered rather than assumed: something else on the page may already have
     locked scrolling, and putting back `''` would quietly unlock it. */
  MenuDrawer.prototype.lock = function () {
    this.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  };

  MenuDrawer.prototype.unlock = function () {
    document.body.style.overflow = this.prevOverflow || '';
  };

  /**
   * Show one panel.
   *
   * `depth` is which way it is going — in or back — because the direction is
   * the message. Going deeper and coming back out have to look different or the
   * drawer stops feeling like it has anywhere to be.
   */
  MenuDrawer.prototype.show = function (name, depth) {
    var found = false;

    this.panels.forEach(function (panel) {
      var on = panel.getAttribute('data-hmd-panel') === name;
      panel.hidden = !on;
      if (on) found = true;
    });

    // A panel that is not there would leave every one hidden and the drawer
    // blank. Falling back to the root is the one state always present.
    if (!found) return name === 'root' ? undefined : this.show('root', -1);

    this.current = name;
    if (this.scroller) this.scroller.scrollTop = 0;

    var g = motion();
    var shown = this.dialog.querySelector('[data-hmd-panel="' + name + '"]');
    if (!g || !shown || typeof depth !== 'number') return;

    g.killTweensOf(shown);
    g.fromTo(
      shown,
      { x: depth >= 0 ? 24 : -24, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.28, ease: 'power2.out', clearProps: 'opacity,transform' }
    );
  };

  MenuDrawer.prototype.open = function () {
    // Opening an open drawer is nothing. `showModal` throws on one already up,
    // and it runs before the scroll lock — so without this a second call would
    // leave the page unlocked underneath an open drawer.
    if (this.dialog.open) return;

    // Always from the top. A drawer that reopens three levels down is showing a
    // place the visitor has already left.
    this.show('root');

    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');

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

  MenuDrawer.prototype.close = function () {
    var self = this;

    var shut = function () {
      if (typeof self.dialog.close === 'function') self.dialog.close();
      else self.dialog.removeAttribute('open');
      // Released here rather than left to the `close` event alone: that event
      // is queued as a task, so the page would stay locked for a frame after
      // the drawer had gone. The listener stays for the ways out that never
      // reach this function.
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
        g.set(self.dialog, { clearProps: 'transform' });
      },
    });
  };

  MenuDrawer.prototype.onClick = function (event) {
    var t = event.target;
    if (!t.closest) return;

    if (t.closest('[data-hmd-close]')) {
      event.preventDefault();
      return this.close();
    }

    var goto = t.closest('[data-hmd-goto]');
    if (goto) {
      event.preventDefault();
      return this.show(goto.getAttribute('data-hmd-goto'), 1);
    }

    var back = t.closest('[data-hmd-back]');
    if (back) {
      event.preventDefault();
      return this.show(back.getAttribute('data-hmd-back'), -1);
    }

    // Anything else is a link to somewhere, and the browser can have it.
  };

  function init(scope) {
    (scope || document).querySelectorAll('[data-hmd]').forEach(function (dialog) {
      if (dialog.hmdReady) return;
      dialog.hmdReady = true;
      dialog.hmdInstance = new MenuDrawer(dialog);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }

  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
  });
})();
