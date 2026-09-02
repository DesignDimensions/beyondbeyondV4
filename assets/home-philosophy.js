/* ==========================================================================
   Philosophy Bubble
   --------------------------------------------------------------------------
   Two paths. When three.js is there, the metaball blob in
   home-philosophy-blob.js takes over and owns all of the motion; this file
   feeds it the pointer, runs the frame loop and keeps the HTML label riding on
   the blob's core.

   When it isn't — no WebGL, three.js failed to load, or the merchant chose the
   image style — the CSS bubble stays and gets the lighter treatment: a drifting
   translate, a lean towards the cursor, and a squash along its own direction of
   travel.

   Either way the markup renders complete and static on its own. The reveal
   transitions are only armed once this script runs.
   ========================================================================== */
(() => {
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* Only a real cursor gets to pull the bubble — a touch drag would yank it. */
  const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* Marching cubes re-triangulates the whole field every frame, so there is no
     point running it faster than the eye asks for on a 120Hz panel. The margin
     matters: at exactly 1000/60 a 60Hz display delivers frames a hair under the
     threshold and the gate drops roughly every other one, halving the rate and
     showing up as a steady judder. Leaving room admits every frame at 60Hz
     while still folding 120Hz down to about 60. */
  const FRAME_MS = 1000 / 60 - 3;

  /* CSS-path constants: drift in pixels, and how hard travel squashes. */
  const DRIFT_X = [14, 8];
  const DRIFT_Y = [12, 6];
  const MAX_PULL = 60;
  const SQUEEZE_PER_PX = 0.06;
  const MAX_SQUEEZE = 0.09;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  /* Polyline length in rendered pixels, by pushing each vertex through the
     element's screen matrix before measuring. getTotalLength() would report the
     user-space length, which is the thing that does not match here. */
  const screenLength = (poly) => {
    const m = poly.getScreenCTM();
    const pts = poly.points;
    if (!m || !pts || pts.numberOfItems < 2) return 0;

    let total = 0;
    let px = 0;
    let py = 0;

    for (let i = 0; i < pts.numberOfItems; i += 1) {
      const pt = pts.getItem(i);
      const x = m.a * pt.x + m.c * pt.y + m.e;
      const y = m.b * pt.x + m.d * pt.y + m.f;
      if (i > 0) total += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }

    return total;
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* Holds the reveal until the full-screen intro has handed the page over. Runs
     straight away when there is no intro to wait for. */
  const introReady = (callback) => {
    if (typeof window.bbIntroReady === 'function') window.bbIntroReady(callback);
    else callback();
  };

  class PhilosophyBubble {
    constructor(root) {
      this.root = root;
      this.wrap = root.querySelector('[data-hp-bubble-wrap]');
      this.bubble = root.querySelector('[data-hp-bubble]');
      this.stage = root.querySelector('[data-hp-stage]');

      if (!this.wrap || !this.bubble || !this.stage) return;

      this.pull = (Number(root.dataset.pull) || 0) / 100;
      this.squeeze = (Number(root.dataset.squeeze) || 0) / 100;
      this.speed = (Number(root.dataset.float) || 100) / 100;

      this.pointer = { x: 0, y: 0 };
      this.lean = { x: 0, y: 0 };
      this.last = { x: 0, y: 0 };
      this.k = 0;
      this.angle = 0;
      this.hasPointer = false;
      this.frame = null;
      this.lastFrame = 0;
      this.seed = Math.random() * 10000;

      this.onMove = this.onMove.bind(this);
      this.onLeave = this.onLeave.bind(this);
      this.tick = this.tick.bind(this);

      this.initBlob();
      this.armReveal();
      this.watch();
      this.fitStage();
      this.watchFit();
    }

    /* The stage has no in-flow content of its own — the bubble, dots, lines
       and callouts are all `position: absolute`, placed by percentages of
       the stage's own box, so nothing inside it can give it an intrinsic
       height. `--hp-stage-h` stays as the reference those percentages
       resolve against (and the no-JS fallback), but the height actually
       rendered is trimmed to fit the content: drop back to that reference,
       measure how far the content reaches from it, then pin the stage
       there. Resetting first each time matters — resolving against last
       run's already-trimmed height, instead of the stable reference, would
       creep the stage shorter on every resize. */
    fitStage() {
      if (!this.stage) return;

      this.stage.style.removeProperty('height');

      const nodes = this.stage.querySelectorAll('.hp-bubble-wrap, .hp-callout, .hp-dot');
      let maxBottom = 0;
      nodes.forEach((el) => {
        const bottom = el.offsetTop + el.offsetHeight;
        if (bottom > maxBottom) maxBottom = bottom;
      });

      if (maxBottom > 0) this.stage.style.height = `${Math.ceil(maxBottom)}px`;
    }

    /* Refit on resize — a narrower stage can wrap a callout onto an extra
       line — and once webfonts land, which changes the same text metrics
       after the initial, pre-font layout has already been measured. */
    watchFit() {
      this.onFitResize = () => {
        if (this.fitRaf) return;
        this.fitRaf = requestAnimationFrame(() => {
          this.fitRaf = null;
          this.fitStage();
        });
      };
      window.addEventListener('resize', this.onFitResize, { passive: true });

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this.fitStage());
      }
    }

    /* The blob replaces the flat CSS bubble; if it can't start, what's already
       in the markup stands. */
    initBlob() {
      if (this.root.dataset.style !== 'gel') return;

      /* Say so rather than quietly degrading. Without this, a three.js that
         failed to load looks identical to a deliberately flat bubble — the CSS
         fallback just renders and nothing indicates the 3D path never started. */
      if (!window.HomePhilosophyBlob) {
        console.warn(
          '[philosophy] 3D bubble unavailable — three.js or MarchingCubes did not load. ' +
            'Showing the CSS fallback. Check assets/three.min.js is complete (607784 bytes).'
        );
        return;
      }

      const quality = Number(this.root.dataset.quality) || 88;
      const mobile = window.innerWidth <= 768;

      this.blob = window.HomePhilosophyBlob.create(this.bubble, {
        resolution: mobile ? Math.round(quality * 0.6) : quality,
        wobble: (Number(this.root.dataset.wobble) || 0) / 45,
        squeeze: this.squeeze,
        speed: this.speed,
        /* Their reach 0.16 and strength 0.1 converted into our field. Theirs
           run against a core radius of ~0.0894 grid units, ours against 0.195,
           so both scale by 2.18 to land the droplet at the same size and the
           same travel relative to the body. */
        hoverReach: 0.206 * (0.5 + this.pull),
        hoverStrength: 0.104 * (0.5 + this.pull),
        hitElement: this.stage,
        pixelRatio: mobile ? 1.6 : 2,
        envUrl: this.root.dataset.env,
        tint: this.root.dataset.tint,
      });

      if (!this.blob) {
        console.warn('[philosophy] WebGL context or shader unavailable — showing the CSS fallback.');
        return;
      }

      this.root.classList.add('hp--gl');

      if ('ResizeObserver' in window) {
        this.ro = new ResizeObserver(() => this.blob.resize());
        this.ro.observe(this.bubble);
      } else {
        this.onResize = () => this.blob.resize();
        window.addEventListener('resize', this.onResize);
      }
    }

    /* Two reveal paths. GSAP gets a proper timeline where the pieces overlap —
       lines drawing while the copy is still rising, dots landing on a slight
       overshoot. The CSS path is a staggered fade, which is all a chain of
       transitions can express. Either way the markup renders finished, so a
       page without JS shows complete content rather than an empty section. */
    armReveal() {
      const parts = {
        heading: this.root.querySelector('.section-title'),
        callouts: this.root.querySelectorAll('.hp-callout'),
        textDots: this.root.querySelectorAll('.hp-dot--text'),
        anchorDots: this.root.querySelectorAll('.hp-dot--anchor'),
        lines: this.root.querySelectorAll('.hp-line'),
        bubble: this.wrap,
      };

      const play = window.gsap && !REDUCED.matches
        ? this.buildTimeline(window.gsap, parts)
        : this.armCssReveal();

      /* Triggered on the section's top edge crossing 85% of the viewport, not
         on a visible ratio. A ratio can be unreachable: this section is as tall
         as its stage setting plus the copy, and once that passes ~5x the
         viewport height it can never be 20% visible at once, so a `threshold`
         of 0.2 would simply never fire and the reveal would never play. An edge
         crossing fires whatever the section's height. */
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            io.disconnect();
            introReady(play);
          });
        },
        { rootMargin: '0px 0px -15% 0px', threshold: 0 }
      );

      io.observe(this.root);
      this.revealIo = io;
    }

    armCssReveal() {
      this.root.setAttribute('data-hp-animate', '');
      return () => this.root.classList.add('is-in-view');
    }

    buildTimeline(gsap, p) {
      /* Dash lengths have to be measured in screen space. The overlay uses a
         0-1000 grid stretched non-uniformly over the stage, and the stroke is
         non-scaling, so the browser dashes in rendered pixels while the path's
         own coordinates are in stretched user units. Declaring the length in
         user units draws only part of each line and leaves it stopping short of
         its dot. Points are written text-dot first, so the draw runs outward
         into the bubble. */
      /* Measured twice: once now so the lines start hidden, and again the
         moment the reveal actually plays. The section is normally armed at
         DOMContentLoaded and played much later, and a web font landing in
         between reflows the callouts and moves the line endpoints — a dash
         length from the old layout draws the line short of its dot. The
         getTotalLength fallback matters too: getScreenCTM returns null while an
         element is unrendered, and a length of 0 means no dash at all, which
         shows the line already drawn and skips the animation outright. */
      const arm = () => {
        p.lines.forEach((line) => {
          const length = screenLength(line) || (line.getTotalLength ? line.getTotalLength() : 0);
          gsap.set(line, { strokeDasharray: length, strokeDashoffset: length });
        });
      };

      arm();
      gsap.set([p.textDots, p.anchorDots], { scale: 0, transformOrigin: '50% 50%' });
      gsap.set(p.callouts, { opacity: 0, y: 16 });
      gsap.set(p.bubble, { opacity: 0, scale: 0.9, transformOrigin: '50% 50%' });
      if (p.heading) gsap.set(p.heading, { opacity: 0, y: 22 });

      const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });

      if (p.heading) tl.to(p.heading, { opacity: 1, y: 0, duration: 0.9 }, 0);
      tl.to(p.bubble, { opacity: 1, scale: 1, duration: 1.6, ease: 'power2.out' }, 0.15);

      /* Each callout runs its own little sequence — dot, line, dot, text — and
         the three are offset from each other rather than every property being
         staggered across all three at once. That difference is the whole
         effect: this reads as three annotations being drawn in turn, where a
         property-wise stagger reads as one bulk transition. */
      const START = 0.55;
      const GAP = 0.6;

      p.lines.forEach((line, i) => {
        const at = START + i * GAP;

        tl.to(p.textDots[i], { scale: 1, duration: 0.4, ease: 'back.out(1.8)' }, at)
          .to(
            line,
            {
              strokeDashoffset: 0,
              duration: 0.85,
              ease: 'power2.inOut',
              /* Drop the dash once drawn. A stale length left in place would
                 reopen gaps in the line if the viewport is resized afterwards. */
              onComplete: () => gsap.set(line, { clearProps: 'strokeDasharray,strokeDashoffset' }),
            },
            at + 0.15
          )
          /* Lands as the line arrives, so the dot reads as the line's endpoint
             rather than as a separate mark that was already waiting there. */
          .to(p.anchorDots[i], { scale: 1, duration: 0.4, ease: 'back.out(1.8)' }, at + 0.9)
          .to(p.callouts[i], { opacity: 1, y: 0, duration: 0.7 }, at + 0.55);
      });

      return () => {
        arm();
        tl.play();
      };
    }

    /* The loop and the pointer listeners only run while the section is on
       screen — off screen it costs nothing. */
    watch() {
      this.io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            entry.isIntersecting ? this.start() : this.stop();
          });
        },
        { rootMargin: '120px' }
      );

      this.io.observe(this.root);
    }

    start() {
      if (REDUCED.matches) {
        /* No loop, but the blob still has to exist — draw it once, at rest. */
        if (this.blob) this.blob.frame(0);
        return;
      }

      if (this.frame !== null) return;

      if (FINE_POINTER.matches) {
        window.addEventListener('pointermove', this.onMove, { passive: true });
        document.addEventListener('mouseleave', this.onLeave, { passive: true });
      }

      this.frame = requestAnimationFrame(this.tick);
    }

    stop() {
      if (this.frame === null) return;
      window.removeEventListener('pointermove', this.onMove);
      document.removeEventListener('mouseleave', this.onLeave);
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }

    onMove(event) {
      /* Mouse only, as theirs is — a pen or touch contact should not drag the
         droplet around. */
      if (event.pointerType && event.pointerType !== 'mouse') return;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.hasPointer = true;
    }

    onLeave() {
      this.hasPointer = false;
    }

    tick(now) {
      this.frame = requestAnimationFrame(this.tick);

      if (this.blob) {
        if (now - this.lastFrame < FRAME_MS) return;
        this.lastFrame = now;

        this.blob.setPointer(this.pointer.x, this.pointer.y, this.hasPointer && this.pull > 0);

        const core = this.blob.frame((now + this.seed) * 0.001);
        if (core) {
          /* The label is HTML, so it has to be told where the core drifted to
             rather than being carried by it. */
          this.bubble.style.setProperty('--hp-label-x', `${core.x.toFixed(2)}px`);
          this.bubble.style.setProperty('--hp-label-y', `${core.y.toFixed(2)}px`);
        }
        return;
      }

      this.tickCss((now + this.seed) * this.speed);
    }

    /* Pointer distance from the bubble's resting centre, softened so the pull
       fades out rather than snapping on at the section edge. */
    cssTarget() {
      if (!this.hasPointer || !this.pull) return { x: 0, y: 0 };

      const box = this.wrap.getBoundingClientRect();
      const cx = box.left + box.width / 2 - this.lean.x;
      const cy = box.top + box.height / 2 - this.lean.y;
      const dx = this.pointer.x - cx;
      const dy = this.pointer.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.max(this.stage.offsetWidth * 0.55, 520);
      const falloff = Math.pow(1 - clamp(dist / reach, 0, 1), 1.6);
      const strength = MAX_PULL * this.pull * falloff;

      return { x: (dx / dist) * strength, y: (dy / dist) * strength };
    }

    tickCss(t) {
      /* Free drift — two frequencies per axis so the path never visibly loops. */
      const driftX = Math.sin(t * 0.00042) * DRIFT_X[0] + Math.sin(t * 0.00027 + 1.7) * DRIFT_X[1];
      const driftY = Math.cos(t * 0.00035 + 0.6) * DRIFT_Y[0] + Math.sin(t * 0.00061 + 2.4) * DRIFT_Y[1];

      const goal = this.cssTarget();
      this.lean.x = lerp(this.lean.x, goal.x, 0.06);
      this.lean.y = lerp(this.lean.y, goal.y, 0.06);

      const x = driftX + this.lean.x;
      const y = driftY + this.lean.y;

      const vx = x - this.last.x;
      const vy = y - this.last.y;
      const speed = Math.hypot(vx, vy);
      if (speed > 0.01) this.angle = (Math.atan2(vy, vx) * 180) / Math.PI;

      /* A slow breath keeps it alive even when it is barely moving. */
      const breath = (Math.sin(t * 0.0009) + 1) * 0.5 * 0.012;
      const wanted = clamp(speed * SQUEEZE_PER_PX * this.squeeze, 0, MAX_SQUEEZE) + breath * this.squeeze;
      this.k = lerp(this.k, wanted, 0.1);

      this.last.x = x;
      this.last.y = y;

      this.wrap.style.setProperty('--hp-x', `${x.toFixed(2)}px`);
      this.wrap.style.setProperty('--hp-y', `${y.toFixed(2)}px`);
      this.bubble.style.setProperty('--hp-squeeze-angle', `${this.angle.toFixed(2)}deg`);
      this.bubble.style.setProperty('--hp-sx', (1 + this.k).toFixed(4));
      this.bubble.style.setProperty('--hp-sy', (1 - this.k * 0.85).toFixed(4));
    }

    destroy() {
      this.stop();
      if (this.revealIo) this.revealIo.disconnect();
      if (this.io) this.io.disconnect();
      if (this.ro) this.ro.disconnect();
      if (this.onResize) window.removeEventListener('resize', this.onResize);
      if (this.onFitResize) window.removeEventListener('resize', this.onFitResize);
      if (this.fitRaf) cancelAnimationFrame(this.fitRaf);
      if (this.blob) this.blob.destroy();
    }
  }

  const instances = new WeakMap();

  const init = (scope = document) => {
    scope.querySelectorAll('[data-hp]').forEach((root) => {
      if (instances.has(root)) return;
      instances.set(root, new PhilosophyBubble(root));
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }

  /* Theme editor: sections are swapped out from under us. */
  document.addEventListener('shopify:section:load', (event) => init(event.target));
  document.addEventListener('shopify:section:unload', (event) => {
    event.target.querySelectorAll('[data-hp]').forEach((root) => {
      const instance = instances.get(root);
      if (instance) instance.destroy();
      instances.delete(root);
    });
  });
})();
