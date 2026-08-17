/**
 * Video Parallax — the quote turns to dust, the dust multiplies, the film fills.
 *
 * It plays. The section is an ordinary band at its own height, and the sequence
 * runs on its own clock the first time the band is properly on screen — the
 * visitor arrives, stops, and watches it. Nothing here is tied to scroll
 * position.
 *
 *   set    the quote arrives, line by line, in its own colour
 *   fill   the film grains into the letters, out of the middle of the quote
 *   dust   they give up their edges and break into specks; the specks multiply
 *          and spread outward until there is nothing left but film
 *
 * Both reveals work the same way — a soft front travelling out from the middle,
 * and a per-cell number deciding when each speck takes its turn. The fill's
 * front only has to cross the quote; the dust's has to cross the whole band.
 *
 * All of it is one fragment shader over one full-screen quad. Thousands of
 * specks appearing independently is not something the DOM can be asked to do —
 * every element is a layer, and a thousand layers is a slideshow.
 *
 * ---------------------------------------------------------------------------
 * How the dust works
 * ---------------------------------------------------------------------------
 * The band is divided into cells far smaller than a letter's stroke. Each cell
 * holds one soft speck and two fixed random numbers: when it appears, and how
 * big it is. A speck fades up once local density passes its number, so within
 * any area specks arrive in scattered order rather than as a marching line —
 * that is what makes it read as dust settling rather than as a wipe.
 *
 * Where that density comes from is what makes it start at the words:
 *
 *   letters  the letterforms, giving up their own density as the phase runs.
 *            This is the type coming apart.
 *   seeded   a wide blurred field around them, so the first loose specks appear
 *            hugging the words.
 *   front    a soft-edged circle travelling out from the middle of the band,
 *            where the words are, until it has passed every corner.
 *
 * The front is the part that matters. A term that simply rises with the phase
 * fills every corner of the band on the same frame as the centre, and then
 * nothing appears to have come from the type at all.
 *
 * Specks also grow with density, so the cloud thickens as well as multiplies.
 * Past 0.85 they are dense enough to merge and a solid is faded under them to
 * close the last gaps — invisible at this speck size, and the guarantee that
 * the finish is clean film and not a fine mesh.
 *
 * ---------------------------------------------------------------------------
 * Why the cloud has depth
 * ---------------------------------------------------------------------------
 * One grid of cells can only ever be a pattern on a pane: every speck the same
 * size, all of them arriving on one plane, none of them able to pass in front
 * of another. So the cloud is three of those grids at different depths, painted
 * back to front, and each depth sets everything about its sheet at once:
 *
 *   coarser    a speck covers more of the screen the closer it is
 *   later      near sheets hold back a beat before they arrive
 *   faster     and then stream outward, while the far ones barely move
 *   softer     they are in front of the focal plane, so their edges go
 *   clearer    with less air in the way, so the far sheets carry more haze
 *
 * Of those, the speed is what does the work — parallax is what the eye reads
 * distance from. The rest keep it honest. Each speck is then lit as a sphere
 * rather than filled as a disc, which is what gives an individual mote volume
 * once the sheet it belongs to has been placed in space.
 *
 * All of it scales with one setting, and all of it is taken back off over the
 * settle: depth belongs to dust in flight, and the band finishes as film.
 *
 * Written for WebGL 1 (GLSL ES 1.00). If the context, the shader or the texture
 * upload fails, the section drops to the plain video underneath.
 */
(function () {
  'use strict';

  // Capped at the density most retina screens actually are. Below it the
  // browser rescales what the shader drew, and the finished picture is softer
  // than the plain video it replaced — which reads as blur, not grain.
  var MAX_DPR = 2;
  // How far the quote sits below its resting place before it arrives, in UV.
  var ENTRY_RISE = 0.02;
  // Blur on the field channel, as a multiple of the type size. Wide on purpose:
  // it has to be a soft cloud around the words, not a legible copy of them.
  var FIELD_BLUR = 1.3;
  // Smallest a speck cell is allowed to get, in device pixels. A count that is
  // right on a wide screen puts the cell under a pixel on a phone, and dust
  // finer than a pixel is not dust, it is aliasing.
  var MIN_CELL = 2.5;
  // Per-frame rate of the hand-over between the shader and the video element.
  // Slow enough to be a settle rather than a cut, quick enough that the real
  // picture is not kept waiting behind a crossfade of a picture of itself.
  var PLAIN_EASE = 0.09;
  /* What share of the time left after the quote the dust gets. Under 1 on
     purpose: the spread finishes with time in hand instead of on the very last
     frame, and the video element takes the band over as soon as it does rather
     than the shader holding a finished still until the clock runs out. */
  var DUST_SPAN = 0.85;
  /* The dust reading at which the band is film in everything but name — the
     specks have closed over and the settle has taken the grain off — and so the
     point to start handing back to the video element. */
  var PLAIN_AT = 0.92;
  /* And where the push in has to be finished. The cross-fade only passes
     unnoticed because both layers are the same frame at the same size, and the
     video element is never zoomed; a push still running at hand-over would drift
     the edges against each other while both are on screen. */
  var PUSH_DONE = 0.85;
  /* What share of the cloud each depth sheet carries. Three sheets at full
     strength are three clouds, and the band closes over well before it should —
     the sequence is meant to spread for as long as it always did, and depth was
     never a licence to change its pacing. Tuned against the single-sheet
     coverage curve it replaced. */
  var SHEET_LOAD = 0.75;

  var VERTEX_SRC = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  vUv.y = 1.0 - vUv.y;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAGMENT_SRC = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uText;',
    'uniform sampler2D uVideo;',
    'uniform vec2 uVideoScale;',
    'uniform vec2 uVideoOffset;',
    'uniform vec2 uAspect;',
    'uniform float uEntry;',
    'uniform float uFill;',
    'uniform float uDust;',
    'uniform float uGrain;',
    'uniform float uFilm;',
    'uniform float uSeed;',
    'uniform float uHasVideo;',
    'uniform vec3 uBg;',
    'uniform vec3 uInk;',
    'uniform float uSoft;',
    'uniform float uSettle;',
    'uniform float uDepth;',

    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',

    /* ----------------------------------------------------------------------
       One sheet of the cloud, at depth z — 0 the far side of it, 1 the near.
       Everything about a sheet follows from z: how coarse its cells are, how
       late it starts, how fast it streams outward, how soft its specks are and
       how they are lit. Those cues all agreeing is what makes a stack of flat
       sheets read as a volume; any one of them alone reads as a filter.
       ---------------------------------------------------------------------- */
    'float sheet(float z, float d, float base, float seed, out float shade) {',
    /* Nearer sheets are coarser — one speck of dust covers more of the screen
       the closer it is to the eye. The far sheet keeps the full count, so the
       finest cells stay exactly the size they have always been and the clamp
       in resize() still holds. */
    '  float scale = uGrain * mix(1.0, 0.5, z);',
    /* And nearer sheets start a beat later, then rush past while the far ones
       barely move. That difference in speed is the depth: parallax is what the
       eye actually reads distance from, not size and not shading. */
    '  float phase = clamp((uDust - z * 0.12) / (1.0 - z * 0.12), 0.0, 1.0);',
    '  float zoom = 1.0 + phase * uDepth * mix(0.04, 0.55, z);',
    '  vec2 suv = 0.5 + (vUv - 0.5) / zoom;',

    /* Each sheet's lattice gets its own orientation. Cells are square and a
       speck sits in the middle of one, so wherever coverage saturates the
       corners it cannot reach are left over as a grid of dark seams — and an
       axis-aligned grid of seams is the most 2D thing a field of specks can
       do. Turned off-axis by a different angle each, the seams of one sheet
       cross the seams of the others instead of agreeing with them. Angles stay
       inside a quadrant: at 90 degrees a square lattice is itself again. */
    '  float a = 0.40 + z * 0.78;',
    '  vec2 s = suv * uAspect * scale;',
    '  vec2 p = vec2(s.x * cos(a) - s.y * sin(a), s.x * sin(a) + s.y * cos(a)) + seed;',
    '  vec2 cell = floor(p);',
    '  vec2 g = fract(p) - 0.5;',

    /* Its own front, reaching further on the near side, so the cloud comes
       forward as a shell rather than opening as a circle drawn on the page. */
    '  float reach = phase * mix(1.6, 2.3, z);',
    '  float front = 1.0 - smoothstep(reach - 0.5, reach, d);',
    /* The letterforms stay with the far sheet: the type is in the film, and
       what leaves it is the dust, so their density is damped as z rises. And
       nothing but the far sheet exists before the dust starts — a mote in
       front of a letter that has not begun to come apart is just dirt on the
       lens, and the quote is meant to be read. */
    '  float presence = mix(1.0, smoothstep(0.0, 0.18, uDust), min(z * 4.0, 1.0));',
    '  float own = front * (0.1 + 0.9 * phase) * mix(1.0, 0.8, z) * ' + SHEET_LOAD.toFixed(3) + ';',
    '  float density = clamp(max(base * (1.0 - 0.8 * z), own) * presence, 0.0, 1.0);',

    '  float on = 1.0 - smoothstep(density - 0.14, density + 0.02, hash(cell + seed));',
    '  float r = mix(0.16, 0.85, density) * (0.75 + 0.5 * hash(cell + seed + 31.7));',
    // Near specks sit in front of the focal plane, so their edges go softer.
    '  float soft = clamp(uSoft + uDepth * (z - 0.5) * 0.12, 0.0, 0.97);',
    '  float speck = on * (1.0 - smoothstep(r * (1.0 - soft), r, length(g)));',

    /* Lit like a little sphere instead of filled like a disc: the normal comes
       from where in the speck we are, so each one has a side turned away from
       the light. Biased toward the eye so they read as motes catching a light,
       not as beads. Taken back off over the settle — the finished band is film,
       and film has no lighting of its own. */
    '  vec2 q = g / max(r, 0.001);',
    '  vec3 n = normalize(vec3(q, sqrt(max(1.0 - dot(q, q), 0.0)) + 0.45));',
    '  float lit = clamp(dot(n, normalize(vec3(-0.42, -0.55, 0.72))), 0.0, 1.0);',
    '  shade = mix(1.0, mix(0.76, 1.14, lit), uDepth * (1.0 - uSettle));',

    '  return speck;',
    '}',

    'void main() {',
    // The block rises into place as one; the stagger below is per line.
    '  vec2 tuv = vUv + vec2(0.0, (1.0 - uEntry) * ' + ENTRY_RISE.toFixed(3) + ');',
    '  vec4 t = texture2D(uText, tuv);',
    '  float line = max(t.b * 8.0 - 1.0, 0.0);',
    '  float e = clamp((uEntry - line * 0.18) / 0.82, 0.0, 1.0);',
    '  e = e * e * (3.0 - 2.0 * e);',
    '  float sharp = t.r * e;',
    '  float field = t.g * e;',

    // Density. The letters give up a little of theirs as the phase runs, which
    // is them coming apart; the cloud around them gains far more, which is the
    // dust multiplying. Whichever is greater wins, so the words never thin out
    // faster than the cloud replaces them.
    /* A front, travelling out from the middle of the band — where the words
       are — rather than a level that rises everywhere at once. That was the
       whole problem with a plain `dust * dust` term: every corner of the band
       started filling on the same frame as the centre, so nothing appeared to
       come from the type at all.

       Distance is measured in the aspect-corrected space and divided by the
       distance to the farthest corner, so the front is round and reaches every
       edge of a 2.8:1 band on the same schedule as a square one. It is pushed
       out to 1.8 so that by the end its soft trailing edge has cleared the
       corners too — stop it at 1.0 and they never quite fill. */
    /* How far out we are, as a fraction of the way to the edge — measured on a
       rounded rectangle rather than a circle. A round front in a band this wide
       is over the top and bottom edges at a third of its journey and still a
       long way from the left and right ends, which is why those ends were the
       last thing to fill and sat there granulating on their own. Blended with
       the round measure so the front still curves instead of reading as a box
       opening out. */
    '  vec2 edge = abs(vUv - 0.5) * 2.0;',
    '  float d = mix(length(edge) * 0.7071, max(edge.x, edge.y), 0.65);',
    '  float reach = uDust * 1.8;',
    '  float front = 1.0 - smoothstep(reach - 0.5, reach, d);',

    '  float letters = sharp * (1.0 - uDust * 0.75);',
    '  float seeded = field * uDust * 1.5;',
    '  float ambient = front * (0.1 + 0.9 * uDust);',
    '  float density = clamp(max(letters, max(seeded, ambient)), 0.0, 1.0);',
    /* What every sheet inherits: the type coming apart, and the cloud hugging
       it. Each sheet adds its own front to this at its own depth. The density
       above is kept whole for one job only — the solid that closes the last
       gaps at the end, which has to be the same guarantee it always was. */
    '  float base = clamp(max(letters, seeded), 0.0, 1.0);',

    /* The grid the fill uses. The dust has its own now, one per sheet, inside
       sheet() — this one stays put, because the fill belongs to the letters and
       the letters do not stream anywhere. */
    '  vec2 p = vUv * uAspect * uGrain;',
    '  vec2 cell = floor(p);',
    '  vec2 g = fract(p) - 0.5;',

    /* The film arriving inside the letters, on the same terms as the dust: its
       own front out of the middle of the quote, and its own per-cell number, so
       it grains in from the centre of the type and spreads through the words
       rather than every letter turning over on the same frame.

       A shorter reach than the dust front — this one only has to cross the
       quote, not the band — and a different seed, so the two phases do not
       light up the same cells in the same order. */
    '  float fillReach = uFill * 1.3;',
    '  float fillLevel = clamp((1.0 - smoothstep(fillReach - 0.55, fillReach, d)) * 1.15, 0.0, 1.0);',
    '  float fillOn = 1.0 - smoothstep(fillLevel - 0.25, fillLevel + 0.05, hash(cell + 5.3));',
    '  float fr = mix(0.35, 1.0, fillLevel) * (0.75 + 0.5 * hash(cell + 31.7));',
    '  float fillSpeck = fillOn * (1.0 - smoothstep(fr * (1.0 - uSoft), fr, length(g)));',
    '  float fillMask = max(fillSpeck, smoothstep(0.9, 1.0, fillLevel));',

    '  vec2 vuv = vUv * uVideoScale + uVideoOffset;',
    '  vec3 film = texture2D(uVideo, vuv).rgb * uHasVideo;',
    /* The ink is the type's colour, so it is confined to the type. It used to be
       what the whole band held before the film came through, which meant that
       everywhere the fill's front had not reached — and that front only ever had
       to cross the quote — the dust was revealing ink instead of film. On a
       2.8:1 band that is the left and right ends: black specks salted through
       the picture, which reads as the band pixelating rather than as dust.
       Beyond the letters the answer is now simply the film. */
    '  vec3 filled = mix(uBg, film, uHasVideo);',
    '  vec3 inside = mix(filled, uInk, sharp * (1.0 - fillMask));',

    /* The cloud, painted back to front: each sheet covers what is behind it, so
       a near mote passes in front of a far one instead of merging with it. That
       occlusion is the part a single sheet of specks can never do, however it is
       shaded — with one grid there is no behind.

       Far sheets also come back nearer the background colour, which is haze:
       more air between them and the eye. Like the shading, it is taken off over
       the settle, so what the sequence hands over is clean film and not a
       photograph of a dust cloud. */
    '  vec3 col = uBg;',
    '  float shade;',
    '  for (int i = 0; i < 3; i++) {',
    '    float z = float(i) * 0.5;',
    '    float cover = sheet(z, d, base, float(i) * 17.3, shade);',
    '    float clarity = mix(1.0 - uDepth * 0.18 * (1.0 - z), 1.0, uSettle);',
    '    col = mix(col, mix(uBg, inside * shade, clarity), cover);',
    '  }',

    /* The solid under the specks, once they are dense enough to hide the join.
       Brought forward a little, so a region that is nearly covered resolves
       into film rather than holding its last few gaps open. Not further: closing
       it early enough to matter turned the spread into a wipe — 0.6 took the
       whole band from barely dusted to finished in a third of a second. */
    '  col = mix(col, inside, smoothstep(0.80, 1.0, density));',

    /* And every cell takes its picture from somewhere slightly else. This is
       what still works once the sequence has finished and the band is solid
       film: coverage is untouched, so nothing opens up to the page — the image
       itself granulates and drifts under the cursor. */

    /* Reseeded every frame — grain that holds still stops being grain. Taken
       off entirely as the dust settles: it belongs to the sequence, and once
       the band is whole film it is just noise over a clean picture. */
    '  float fg = hash(floor(vUv * uAspect * 900.0) + uSeed) - 0.5;',
    '  col += fg * uFilm * (1.0 - uSettle);',

    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function easeOutCubic(t) {
    var inv = 1 - t;
    return 1 - inv * inv * inv;
  }

  function smoothstep(a, b, x) {
    var t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Holds the reveal until the full-screen intro has handed the page over.
  function introReady(callback) {
    if (typeof window.bbIntroReady === 'function') window.bbIntroReady(callback);
    else callback();
  }

  function hexToRgb(hex) {
    var value = String(hex || '').replace('#', '');
    if (value.length === 3) {
      value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
    }
    var int = parseInt(value, 16);
    if (isNaN(int)) return [1, 1, 1];
    return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /* ------------------------------------------------------------------------
     The quote, painted once
     ------------------------------------------------------------------------
     Three passes into one canvas with `lighter`, which adds per channel, so
     each lands in its own channel without touching the others:

       R  the letterforms
       G  the same, blurred wide — the field the first specks appear in
       B  which line, so each can arrive on its own beat
     ------------------------------------------------------------------------ */
  function paintQuote(canvas, options) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    if (!w || !h) return;

    var size = (options.size / 100) * w;
    var leading = size * options.leading;
    var lines = options.lines;
    var top = h / 2 - ((lines.length - 1) * leading) / 2;
    var i;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = options.weight + ' ' + size + 'px ' + options.family;
    if (options.tracking && 'letterSpacing' in ctx) {
      ctx.letterSpacing = options.tracking * size + 'px';
    }
    ctx.globalCompositeOperation = 'lighter';

    ctx.filter = 'none';
    ctx.fillStyle = '#ff0000';
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], w / 2, top + i * leading);

    ctx.filter = 'blur(' + Math.round(size * FIELD_BLUR) + 'px)';
    ctx.fillStyle = '#00ff00';
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], w / 2, top + i * leading);

    // Offset by one so the first line is distinguishable from the ground.
    ctx.filter = 'none';
    for (i = 0; i < lines.length; i++) {
      ctx.fillStyle = 'rgb(0,0,' + Math.round(((i + 1) / 8) * 255) + ')';
      ctx.fillText(lines[i], w / 2, top + i * leading);
    }

    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
  }

  function VideoParallax(root) {
    this.root = root;
    this.band = root.querySelector('[data-vpx-band]');
    this.canvas = root.querySelector('[data-vpx-canvas]');
    this.video = root.querySelector('[data-vpx-video]');

    this.duration = parseFloat(root.dataset.vpxDuration) || 5200;
    this.push = (parseFloat(root.dataset.vpxPush) || 0) / 100;
    this.grain = parseFloat(root.dataset.vpxGrainSize) || 900;
    this.film = (parseFloat(root.dataset.vpxGrain) || 0) / 100;
    this.autoplay = root.dataset.vpxAutoplay !== 'false';

    // Never quite 1: at 1 the dot has no solid core left and the cloud stops
    // reading as specks at all.
    this.soft = Math.min((parseFloat(root.dataset.vpxSoft) || 0) / 100, 0.95);

    /* How hard the depth cues are pushed. Not a switch for the sheets — they
       are how the cloud is built — but the scale on what separates them: the
       streaming, the lighting, the haze. A section stored before this setting
       existed gets the schema default like any other, so the fallback here is
       only for a hand-written attribute. */
    var depth = parseFloat(root.dataset.vpxDepth);
    this.depth = isNaN(depth) ? 0.7 : depth / 100;

    this.quote = {
      lines: (root.dataset.vpxQuote || '').split('\n').filter(Boolean),
      size: parseFloat(root.dataset.vpxTypeSize) || 5,
      leading: parseFloat(root.dataset.vpxTypeLeading) || 1.15,
      weight: root.dataset.vpxTypeWeight || '500',
      tracking: parseFloat(root.dataset.vpxTypeTracking) || 0,
      family: root.dataset.vpxTypeFamily || 'serif'
    };

    var phases = (root.dataset.vpxPhases || '').split(',');
    this.setEnd = parseFloat(phases[0]) || 0.12;
    this.fillEnd = parseFloat(phases[1]) || 0.42;
    this.dustStart = parseFloat(phases[2]) || 0.55;

    this.bg = hexToRgb(root.dataset.vpxBg);
    this.ink = hexToRgb(root.dataset.vpxInk);

    this.t = 0;
    this.startedAt = 0;
    // 0 = the shader is drawing, 1 = the video element has the picture back.
    this.plain = 0;
    this.playing = false;
    this.frameId = null;
    this.visible = false;
    this.ready = false;

    this.tick = this.tick.bind(this);
    this.onMotionChange = this.onMotionChange.bind(this);
    this.onResize = this.onResize.bind(this);

    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (this.motionQuery.addEventListener) {
      this.motionQuery.addEventListener('change', this.onMotionChange);
    } else if (this.motionQuery.addListener) {
      this.motionQuery.addListener(this.onMotionChange);
    }

    /* Two watches. The wide one keeps the film decoding and the canvas painting
       whenever the band is anywhere near; the tight one starts the clock, and
       only once the band is genuinely being looked at — an animation that opens
       on a held quote is wasted on someone who has not arrived yet. */
    this.observer = new IntersectionObserver(
      function (entries) {
        this.visible = entries[entries.length - 1].isIntersecting;
        this.onVisibilityChange();
      }.bind(this),
      { rootMargin: '25% 0px 25% 0px' }
    );

    this.playObserver = new IntersectionObserver(
      function (entries) {
        if (entries[entries.length - 1].isIntersecting) this.play();
      }.bind(this),
      { threshold: 0.55 }
    );

    this.applyMotionMode();
  }

  /* The stylesheet ships the section showing the plain video, so a page whose
     script never arrived — or whose GPU refused — gets exactly that. Arming is
     what puts the canvas in front of it. */
  VideoParallax.prototype.applyMotionMode = function () {
    var reduced = prefersReducedMotion();

    if (reduced) {
      this.fallback();
    } else if (!this.ready) {
      this.ready = this.setupGL();
      if (this.ready) {
        this.root.classList.add('vpx--armed');
        this.observeSize();
        introReady(
          function () {
            this.observer.observe(this.root);
            this.playObserver.observe(this.band);
          }.bind(this)
        );
      }
    }

    if (!this.video) return;

    if (reduced || !this.autoplay) {
      this.video.removeAttribute('autoplay');
      this.video.setAttribute('controls', '');
      if (reduced) this.video.pause();
    } else {
      this.video.removeAttribute('controls');
    }
  };

  VideoParallax.prototype.setupGL = function () {
    if (!this.canvas || !this.quote.lines.length) return false;

    var options = { alpha: false, antialias: false, depth: false, stencil: false };
    var gl =
      this.canvas.getContext('webgl', options) ||
      this.canvas.getContext('experimental-webgl', options);
    if (!gl) return false;

    var vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) return false;

    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);

    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var pos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    this.gl = gl;
    this.u = {};
    [
      'uText', 'uVideo', 'uVideoScale', 'uVideoOffset', 'uAspect', 'uEntry',
      'uFill', 'uDust', 'uGrain', 'uFilm', 'uSeed', 'uHasVideo', 'uBg', 'uInk',
      'uSoft', 'uSettle', 'uDepth'
    ].forEach(
      function (name) {
        this.u[name] = gl.getUniformLocation(program, name);
      }.bind(this)
    );

    this.quoteCanvas = document.createElement('canvas');
    this.textTexture = this.createTexture(gl);
    this.videoTexture = this.createTexture(gl);

    gl.uniform1i(this.u.uText, 0);
    gl.uniform1i(this.u.uVideo, 1);
    gl.uniform3fv(this.u.uBg, this.bg);
    gl.uniform3fv(this.u.uInk, this.ink);
    // uGrain is set in resize(), where the canvas size is known — the speck
    // count has to be clamped against it.
    gl.uniform1f(this.u.uFilm, this.film * 0.16);
    gl.uniform1f(this.u.uSoft, this.soft);
    gl.uniform1f(this.u.uDepth, this.depth);

    this.resize();
    // An opaque canvas that has never been drawn to is black. Give it the
    // background colour now, before it is ever composited.
    this.render();

    // Webfonts land after first paint; the quote has to be repainted in the
    // real face once they do or the texture keeps a fallback forever.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(
        function () {
          this.paint();
          this.render();
        }.bind(this)
      );
    }

    return true;
  };

  VideoParallax.prototype.createTexture = function (gl) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  };

  VideoParallax.prototype.observeSize = function () {
    if (typeof ResizeObserver === 'function') {
      this.sizeObserver = new ResizeObserver(this.onResize);
      this.sizeObserver.observe(this.band);
    } else {
      window.addEventListener('resize', this.onResize);
    }
  };

  VideoParallax.prototype.onResize = function () {
    this.resize();
    this.render();
  };

  VideoParallax.prototype.resize = function () {
    if (!this.gl) return;
    var rect = this.band.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (w === this.width && h === this.height) return;

    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
    this.gl.uniform2f(this.u.uAspect, 1, h / w);
    this.gl.uniform1f(this.u.uGrain, Math.min(this.grain, w / MIN_CELL));
    this.paint();
  };

  VideoParallax.prototype.paint = function () {
    if (!this.gl || !this.width) return;
    this.quoteCanvas.width = this.width;
    this.quoteCanvas.height = this.height;
    paintQuote(this.quoteCanvas, this.quote);

    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.quoteCanvas);
  };

  VideoParallax.prototype.onMotionChange = function () {
    this.applyMotionMode();
    this.onVisibilityChange();
  };

  VideoParallax.prototype.onVisibilityChange = function () {
    if (this.visible && this.ready && !prefersReducedMotion()) this.start();
    else this.stop();
    this.syncPlayback();
  };

  VideoParallax.prototype.syncPlayback = function () {
    if (!this.video || !this.autoplay || prefersReducedMotion()) return;
    if (this.visible) {
      var played = this.video.play();
      if (played && typeof played.catch === 'function') played.catch(function () {});
    } else {
      this.video.pause();
    }
  };

  /* Once. The clock starts here and nowhere else — this is the whole of what
     "it plays when you get there" means. */
  VideoParallax.prototype.play = function () {
    if (this.playing || !this.ready || prefersReducedMotion()) return;
    this.playing = true;
    this.startedAt = 0;
    this.playObserver.disconnect();
  };

  VideoParallax.prototype.start = function () {
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(this.tick);
  };

  VideoParallax.prototype.stop = function () {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  };

  /* Cover-fit plus the slow push in. All of it a change to where the shader
     samples the film, so none of it moves an element. */
  VideoParallax.prototype.fitVideo = function (t) {
    var vw = this.video ? this.video.videoWidth : 0;
    var vh = this.video ? this.video.videoHeight : 0;
    if (!vw || !vh) return;

    var zoom = 1 + this.push * (1 - clamp01(t / PUSH_DONE));
    var bandRatio = this.width / this.height;
    var videoRatio = vw / vh;
    var sx = 1;
    var sy = 1;
    if (videoRatio > bandRatio) sx = bandRatio / videoRatio;
    else sy = videoRatio / bandRatio;

    sx /= zoom;
    sy /= zoom;
    this.gl.uniform2f(this.u.uVideoScale, sx, sy);
    this.gl.uniform2f(this.u.uVideoOffset, (1 - sx) / 2, (1 - sy) / 2);
  };

  VideoParallax.prototype.render = function () {
    var gl = this.gl;
    if (!gl) return;
    var t = this.t;

    var entry = easeOutCubic(clamp01(t / Math.max(0.0001, this.setEnd)));
    var fill = easeInOutCubic(
      clamp01((t - this.setEnd) / Math.max(0.0001, this.fillEnd - this.setEnd))
    );
    // Eased in, so the words hold their shape a moment before they let go, and
    // the cloud arrives rather than being switched on.
    var dust = easeInOutCubic(
      clamp01((t - this.dustStart) / Math.max(0.0001, (1 - this.dustStart) * DUST_SPAN))
    );
    // Held for tick(), which hands over on the dust being done rather than on
    // the clock reaching the end.
    this.dust = dust;

    if (this.video && this.video.readyState >= 2 && !this.videoFailed) {
      try {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
        this.hasVideo = 1;
      } catch (error) {
        // A cross-origin file served without CORS taints the upload. Nothing to
        // retry — drop to the plain video underneath and stop asking.
        this.videoFailed = true;
        this.fallback();
        return;
      }
      this.fitVideo(t);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);

    gl.uniform1f(this.u.uEntry, entry);
    gl.uniform1f(this.u.uFill, fill);
    gl.uniform1f(this.u.uDust, dust);
    /* Over the last of the dust phase, so the sequence hands over a clean
       picture rather than one that stays permanently under its own texture.
       Brought forward: the grain and the depth cues are there to sell dust in
       flight, and once the band is mostly film they are only holding it back
       from being the film. */
    gl.uniform1f(this.u.uSettle, smoothstep(0.58, 0.88, dust));
    gl.uniform1f(this.u.uSeed, Math.random() * 1000);
    gl.uniform1f(this.u.uHasVideo, this.hasVideo || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  VideoParallax.prototype.fallback = function () {
    this.stop();
    if (this.sizeObserver) {
      this.sizeObserver.disconnect();
      this.sizeObserver = null;
    }
    this.ready = false;
    this.root.classList.remove('vpx--armed');
  };

  /* Once the sequence is over there is nothing left for the shader to say: the
     band is whole film, and the shader's copy of it is a resampled texture. So
     it stands down and lets the video element show through — the sharper
     picture, and since the loop stops drawing, the cheaper one. */
  VideoParallax.prototype.tick = function (now) {
    this.frameId = requestAnimationFrame(this.tick);
    this.now = now;

    if (this.playing) {
      if (!this.startedAt) this.startedAt = now;
      this.t = clamp01((now - this.startedAt) / this.duration);
    }

    // The band is whole film before the clock runs out. Waiting for the clock as
    // well only kept a resampled copy of the video in front of the video.
    var wanted = this.t >= 1 || this.dust >= PLAIN_AT ? 1 : 0;
    this.plain += (wanted - this.plain) * PLAIN_EASE;
    if (this.plain > 0.999) this.plain = 1;
    else if (this.plain < 0.001) this.plain = 0;

    if (this.plain !== this.lastPlain) {
      this.lastPlain = this.plain;
      this.root.style.setProperty('--vpx-plain', this.plain.toFixed(3));
    }

    // Nothing to draw once the canvas is fully out of the way. It is drawn
    // again from the first frame it starts coming back, so it is never seen
    // holding a stale one.
    if (this.plain < 1) this.render();
  };

  VideoParallax.prototype.destroy = function () {
    this.fallback();
    if (this.observer) this.observer.disconnect();
    if (this.playObserver) this.playObserver.disconnect();
    window.removeEventListener('resize', this.onResize);
    if (this.motionQuery.removeEventListener) {
      this.motionQuery.removeEventListener('change', this.onMotionChange);
    } else if (this.motionQuery.removeListener) {
      this.motionQuery.removeListener(this.onMotionChange);
    }
    if (this.video) this.video.pause();
  };

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-vpx]');
    Array.prototype.forEach.call(roots, function (root) {
      if (root.vpxInstance) return;
      root.vpxInstance = new VideoParallax(root);
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

  document.addEventListener('shopify:section:unload', function (event) {
    var root = event.target.querySelector('[data-vpx]');
    if (root && root.vpxInstance) {
      root.vpxInstance.destroy();
      root.vpxInstance = null;
    }
  });
})();
