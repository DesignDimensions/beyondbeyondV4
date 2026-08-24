/**
 * Product Reviews.
 *
 * Two jobs, and they are independent of each other:
 *
 *   Paging   Every review is already in the page, so a page is only a matter
 *            of which of them are shown. The markup arrives with everything
 *            past the first page hidden, which is why there is no flash of a
 *            long list before this runs.
 *
 *   The form The modal is a native <dialog>, so the focus trap, the escape key
 *            and the backdrop are the browser's problem rather than this
 *            file's. Submitting posts to an endpoint the merchant hosts: a
 *            review has to be written with an Admin API token, and a storefront
 *            cannot hold one.
 *
 * With no endpoint set the form says so instead of appearing to send.
 */
(function () {
  'use strict';

  var PAGE_WINDOW = 4; // How many numbers to show before the gap.

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function Reviews(root) {
    this.root = root;
    this.list = root.querySelector('[data-prv-list]');
    this.pagesNav = root.querySelector('[data-prv-pages]');
    this.modal = root.querySelector('[data-prv-modal]');
    this.form = root.querySelector('[data-prv-form]');
    this.message = root.querySelector('[data-prv-message]');
    this.submitButton = root.querySelector('[data-prv-submit]');

    this.config = this.readConfig();

    this.page = 1;
    this.reviews = this.list
      ? Array.prototype.slice.call(this.list.querySelectorAll('[data-prv-review]'))
      : [];
    this.pageSize = Math.max(1, parseInt(this.list && this.list.dataset.prvPageSize, 10) || 2);
    this.pageCount = Math.ceil(this.reviews.length / this.pageSize) || 1;

    this.bind();
    this.renderPages();
  }

  Reviews.prototype.readConfig = function () {
    var node = this.root.querySelector('[data-prv-config]');
    if (!node) return {};
    try {
      return JSON.parse(node.textContent) || {};
    } catch (e) {
      return {};
    }
  };

  /* ------------------------------------------------------------------
     Paging
     ------------------------------------------------------------------ */

  Reviews.prototype.showPage = function (page) {
    this.page = Math.min(Math.max(1, page), this.pageCount);

    var first = (this.page - 1) * this.pageSize;
    var last = first + this.pageSize;

    this.reviews.forEach(function (review, index) {
      review.toggleAttribute('hidden', index < first || index >= last);
    });

    this.renderPages();
  };

  // 01 02 03 04 … 20 on the first page, and a run that slides from there.
  //
  // The run has to move with the page you are on, or the pages it does not
  // cover can never be reached: a fixed 1-2-3-4 leaves 5 to 9 with nothing to
  // press, since the only other number on the row is the last one. So the run
  // is PAGE_WINDOW numbers that always contain the current page, slid along and
  // clamped at both ends — which on page one is 1 to 4, the row the design
  // shows — and the first and last pages are always on the row besides, so
  // either end is one press away wherever you are.
  Reviews.prototype.pageNumbers = function () {
    var total = this.pageCount;
    var wanted = {};

    var run = Math.min(PAGE_WINDOW, total);
    var start = Math.min(Math.max(this.page - 1, 1), total - run + 1);
    for (var i = start; i < start + run; i += 1) wanted[i] = true;

    wanted[1] = true;
    wanted[total] = true;

    var numbers = Object.keys(wanted)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });

    // A gap stands for the numbers left out, so it is only drawn where numbers
    // were actually left out — never between two that already run on.
    var out = [];
    numbers.forEach(function (n, index) {
      if (index > 0 && n - numbers[index - 1] > 1) out.push(null);
      out.push(n);
    });

    return out;
  };

  Reviews.prototype.renderPages = function () {
    if (!this.pagesNav) return;

    // One page of reviews is not a set of pages to choose between.
    if (this.pageCount < 2) {
      this.pagesNav.textContent = '';
      return;
    }

    var self = this;
    var fragment = document.createDocumentFragment();

    this.pageNumbers().forEach(function (number) {
      if (number === null) {
        var gap = document.createElement('span');
        gap.className = 'prv__page-gap';
        gap.setAttribute('aria-hidden', 'true');
        gap.textContent = '…';
        fragment.appendChild(gap);
        return;
      }

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'prv__page';
      button.textContent = pad(number);
      if (number === self.page) button.setAttribute('aria-current', 'true');
      // Changing the page does not move the page. The list is short enough to
      // stay in view, and the button keeps the focus, so a reader is left
      // exactly where they pressed.
      button.addEventListener('click', function () {
        self.showPage(number);
      });
      fragment.appendChild(button);
    });

    this.pagesNav.textContent = '';
    this.pagesNav.appendChild(fragment);
  };

  /* ------------------------------------------------------------------
     The form
     ------------------------------------------------------------------ */

  Reviews.prototype.bind = function () {
    var self = this;

    var openers = this.root.querySelectorAll('[data-prv-open]');
    Array.prototype.forEach.call(openers, function (button) {
      button.addEventListener('click', function () {
        self.open();
      });
    });

    var closers = this.root.querySelectorAll('[data-prv-close]');
    Array.prototype.forEach.call(closers, function (button) {
      button.addEventListener('click', function () {
        self.close();
      });
    });

    if (this.modal) {
      // A click on the backdrop lands on the dialog itself, never on anything
      // inside it, which is what tells the two apart.
      this.modal.addEventListener('click', function (event) {
        if (event.target === self.modal) self.close();
      });
    }

    if (this.form) {
      this.form.addEventListener('submit', function (event) {
        event.preventDefault();
        self.submit();
      });
    }
  };

  Reviews.prototype.open = function () {
    if (!this.modal) return;
    this.say('', false);
    if (typeof this.modal.showModal === 'function') this.modal.showModal();
    else this.modal.setAttribute('open', '');
  };

  Reviews.prototype.close = function () {
    if (!this.modal) return;
    if (typeof this.modal.close === 'function') this.modal.close();
    else this.modal.removeAttribute('open');
  };

  Reviews.prototype.say = function (text, isError) {
    if (!this.message) return;
    this.message.textContent = text;
    this.message.classList.toggle('is-error', !!isError);
    this.message.toggleAttribute('hidden', !text);
  };

  Reviews.prototype.submit = function () {
    var self = this;

    // The browser's own validity, rather than a second set of rules here that
    // could disagree with the one the fields already carry.
    if (!this.form.checkValidity()) {
      this.form.reportValidity();
      return;
    }

    if (!this.config.endpoint) {
      this.say(this.config.unconfigured || 'The review form is not connected yet.', true);
      return;
    }

    var data = {};
    new FormData(this.form).forEach(function (value, key) {
      data[key] = value;
    });

    this.submitButton.disabled = true;
    this.say('', false);

    fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (response) {
        return response.json().catch(function () {
          return { ok: false };
        });
      })
      .then(function (body) {
        if (!body || body.ok !== true) throw new Error((body && body.error) || 'failed');
        self.form.reset();
        self.say(self.config.success || 'Thank you — your review has been received.', false);
      })
      .catch(function () {
        self.say(self.config.error || 'Sorry, your review could not be sent.', true);
      })
      .finally(function () {
        self.submitButton.disabled = false;
      });
  };

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-prv]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.prvInstance) return;
      root.prvInstance = new Reviews(root);
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
