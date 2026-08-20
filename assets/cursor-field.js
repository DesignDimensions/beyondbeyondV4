/* ------------------------------------------------------------------------------------
   Cursor field.

   A soft wash of brand blue that trails the pointer, drifts on its own once the
   pointer has been still for a moment, and gives a small elastic bounce on
   click. Built on GSAP rather than hand-rolled easing:

     - gsap.quickTo drives each blob's position -- it exists specifically for
       repeatedly retargeting a tween toward a moving point, which is exactly
       what a cursor trail is, and it stays smooth regardless of frame rate in
       a way a plain per-frame lerp does not.
     - The idle drift fades in and out through a tweened influence value
       rather than snapping between "follow" and "wander", so the moment the
       pointer stops is never a visible seam.
     - The click bounce is a real spring (elastic.out) displacing a shared
       scale back to rest, not a fixed-length animation.
     - Each blob stretches slightly along its own direction of travel, scaled
       by how fast it is moving -- the thing that reads as "liquid" rather
       than "a circle glued to the mouse".

   Skipped entirely under prefers-reduced-motion, and if GSAP is somehow
   missing -- there is no reduced version of a screen-wide moving wash, only
   an absent one, and every part of this depends on GSAP being there.
   ------------------------------------------------------------------------------------ */
(function () {
  "use strict";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!window.gsap) return;

  var gsap = window.gsap;
  var COLOR = "1, 7, 239"; // brand blue, as an rgb() triplet so alpha can vary per shape

  // The smaller, denser blob rides closer to the cursor; the larger, softer
  // one lags further behind as a halo. Two speeds is what gives the trail
  // depth rather than one shape rigidly glued to the pointer.
  var BLOBS = [
    { radius: 130, blur: 56, alpha: 0.07, duration: 1.1, driftAmp: 40, driftSpeed: 0.00035, seed: 0 },
    { radius: 78, blur: 42, alpha: 0.11, duration: 0.5, driftAmp: 24, driftSpeed: 0.0005, seed: 4.2 },
  ];

  var IDLE_AFTER = 700; // ms with no pointer movement before drift starts fading in
  var STRETCH_MAX = 0.4; // how far a fast pointer elongates a blob along its heading
  var STRETCH_CAP = 46; // px of movement per frame beyond which stretch no longer grows

  function init() {
    var canvas = document.createElement("canvas");
    canvas.className = "cursor-field";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);

    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var width = window.innerWidth;
    var height = window.innerHeight;

    var pointer = { x: width / 2, y: height / 2 };
    var lastMove = 0;
    var hasPointer = false;
    var idle = false;

    // 0 while actively following the pointer, 1 while wandering on its own;
    // tweened rather than toggled so the switch is never a visible seam.
    var drift = { influence: 0 };

    // Shared across both blobs so a click reads as one cohesive pop rather
    // than each blob bouncing on its own beat. `breathe` is a slow ambient
    // pulse layered underneath it, so the field is never perfectly still
    // even with the pointer parked.
    var fx = { scale: 1, breathe: 1 };
    gsap.to(fx, { breathe: 1.05, duration: 3.6, ease: "sine.inOut", yoyo: true, repeat: -1 });

    var blobs = BLOBS.map(function (config) {
      var pos = { x: pointer.x, y: pointer.y };
      return {
        config: config,
        pos: pos,
        prev: { x: pos.x, y: pos.y },
        quickX: gsap.quickTo(pos, "x", { duration: config.duration, ease: "power3" }),
        quickY: gsap.quickTo(pos, "y", { duration: config.duration, ease: "power3" }),
      };
    });

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onPointerMove(event) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      lastMove = performance.now();

      // First movement of the session: place the blobs directly rather than
      // letting them glide in from the centre of the screen.
      if (!hasPointer) {
        blobs.forEach(function (blob) {
          blob.pos.x = pointer.x;
          blob.pos.y = pointer.y;
          blob.prev.x = pointer.x;
          blob.prev.y = pointer.y;
        });
      }
      hasPointer = true;

      if (idle) {
        idle = false;
        gsap.killTweensOf(drift);
        gsap.to(drift, { influence: 0, duration: 0.4, ease: "power2.out" });
      }
    }

    function onPointerDown() {
      gsap.killTweensOf(fx, "scale");
      // Displaced immediately, then let go -- the spring is the recoil back
      // to rest, not the trip out to the displaced value.
      fx.scale = 1.32;
      gsap.to(fx, { scale: 1, duration: 0.75, ease: "elastic.out(1, 0.4)" });
    }

    function driftOffset(config, now) {
      var t = now * config.driftSpeed + config.seed;
      return {
        x: Math.sin(t) * config.driftAmp + Math.sin(t * 0.47) * config.driftAmp * 0.4,
        y: Math.cos(t * 0.83) * config.driftAmp + Math.cos(t * 0.31) * config.driftAmp * 0.4,
      };
    }

    function tick() {
      // performance.now(), not gsap.ticker.time -- the two clocks don't
      // share an epoch, and lastMove below is already stamped with this one.
      var now = performance.now();

      if (hasPointer && !idle && now - lastMove > IDLE_AFTER) {
        idle = true;
        gsap.killTweensOf(drift);
        gsap.to(drift, { influence: 1, duration: 1.6, ease: "sine.inOut" });
      }

      blobs.forEach(function (blob) {
        var d = driftOffset(blob.config, now);
        blob.quickX(pointer.x + d.x * drift.influence);
        blob.quickY(pointer.y + d.y * drift.influence);
      });

      ctx.clearRect(0, 0, width, height);

      blobs.forEach(function (blob) {
        var config = blob.config;
        var dx = blob.pos.x - blob.prev.x;
        var dy = blob.pos.y - blob.prev.y;
        var travel = Math.min(Math.hypot(dx, dy), STRETCH_CAP);
        var angle = Math.atan2(dy, dx);
        var stretch = 1 + (travel / STRETCH_CAP) * STRETCH_MAX;
        blob.prev.x = blob.pos.x;
        blob.prev.y = blob.pos.y;

        var base = config.radius * fx.scale * fx.breathe;

        ctx.save();
        ctx.translate(blob.pos.x, blob.pos.y);
        ctx.rotate(angle);
        ctx.filter = "blur(" + config.blur + "px)";
        ctx.fillStyle = "rgba(" + COLOR + ", " + config.alpha + ")";
        ctx.beginPath();
        // Elongated along the heading and thinned across it, so a fast pass
        // reads as a stroke rather than a circle simply growing.
        ctx.ellipse(0, 0, base * stretch, base / Math.sqrt(stretch), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });

    // No point painting a tab nobody is looking at.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) gsap.ticker.remove(tick);
      else gsap.ticker.add(tick);
    });

    gsap.ticker.add(tick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
