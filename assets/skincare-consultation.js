/* Skincare consultation — the CTA doesn't link anywhere; it opens the
   beyond-chatbot widget by clicking its own launcher, so the widget's
   open/close state has exactly one owner. Quietly does nothing if the
   widget isn't rendered on this template.

   The portrait and the video/still on the right are plain <img> content
   (the still is even reused for the video's own fallback), and a plain
   image is natively draggable — a mousedown-and-move over one is the
   browser's own cue to start dragging it, not anything this section reacts
   to. That native drag can leave the page's input handling stuck for as
   long as it runs, which reads as the CTA going unresponsive and, in the
   worst case, as the whole tab freezing. Cancelling dragstart for the grid
   keeps that gesture from ever starting, so moving the mouse here — button
   down or not — never reads as anything but a hover. */
(function () {
  "use strict";

  function bind() {
    var buttons = document.querySelectorAll("[data-sc-open-chat]");
    if (buttons.length) {
      Array.prototype.forEach.call(buttons, function (button) {
        button.addEventListener("click", function () {
          var launcher = document.getElementById("bb-launcher");
          if (launcher) launcher.click();
        });
      });
    }

    var grids = document.querySelectorAll(".sc__grid");
    Array.prototype.forEach.call(grids, function (grid) {
      grid.addEventListener("dragstart", function (event) {
        event.preventDefault();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
