/* Skincare consultation — the CTA doesn't link anywhere; it opens the
   beyond-chatbot widget by clicking its own launcher, so the widget's
   open/close state has exactly one owner. Quietly does nothing if the
   widget isn't rendered on this template. */
(function () {
  "use strict";

  function bind() {
    var buttons = document.querySelectorAll("[data-sc-open-chat]");
    if (!buttons.length) return;

    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener("click", function () {
        var launcher = document.getElementById("bb-launcher");
        if (launcher) launcher.click();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
