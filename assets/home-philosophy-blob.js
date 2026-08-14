/* ==========================================================================
   Philosophy Bubble — metaball gel blob
   --------------------------------------------------------------------------
   Same construction as the reference: a three.js MarchingCubes isosurface fed
   by a handful of metaballs, shaded as clear glass against the white page.

   Why metaballs rather than a deformed sphere — the surface is the sum of a
   scalar field, so anything added to that field reshapes the silhouette and
   merges into it smoothly. The cursor is just another ball: as it gains
   influence the body swells towards it and pulls back when it leaves, which is
   the reaching-and-settling motion a shaped sphere can never quite fake.

   Exposed as window.HomePhilosophyBlob. Returns null if three.js, MarchingCubes
   or WebGL is missing, so the caller can keep its CSS bubble.
   ========================================================================== */
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* Field constants. A ball's surface sits where strength / d² equals
     ISOLATION + SUBTRACT, so its radius in grid units is
     sqrt(strength / (ISOLATION + SUBTRACT)) — every size below is derived from
     that rather than guessed. */
  const ISOLATION = 30;
  /* Also sets how far a ball writes into the field: sqrt(strength/subtract),
     against a surface at sqrt(strength/(isolation+subtract)). The ratio between
     the two — sqrt(1 + isolation/subtract) — is the reach of a ball's pull
     beyond its own skin, so this number is really "how gooey". Too low and
     nearby balls drag on each other from a distance; too high and nothing
     blends. It also sets the volume touched each frame, most of the CPU
     cost. */
  const SUBTRACT = 45;
  const FALLOFF = ISOLATION + SUBTRACT;
  /* Grid space is 0..1; the mesh spans -1..1 locally, hence the doubling.
     SCALE and CORE_R move together: the body's apparent size is their product,
     so shrinking the core in grid terms while scaling the mesh up leaves it
     looking identical while freeing up grid for the droplet to travel across.
     The grid is the hard limit on how far the droplet can go. */
  const SCALE = 2.6;
  const FOV = 38;
  const CAM_Z = 5.2;
  /* Fraction of the available room at which the droplet begins to fade. The
     room itself is measured per axis at runtime, since it depends on the
     canvas aspect. */
  const EDGE_FADE_FROM = 0.80;

  /* Core radius, in grid units, and the strength that produces it. */
  const CORE_R = 0.15;
  const CORE_S = CORE_R * CORE_R * FALLOFF;

  const strengthFor = (radiusInCoreRadii) => {
    const r = radiusInCoreRadii * CORE_R;
    return r * r * FALLOFF;
  };

  /* The body holds one shape. A single ball offset a little from the core
     keeps it from being a mathematically perfect sphere, but nothing here moves
     over time — the life comes from the environment turning across the surface
     instead, which reads as rotation rather than as the shape churning. */
  const DROP = { r: 0.74, x: 0.30, y: 0.16 };

  const VERT = `
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vScreen;

    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = -mv.xyz;
      vScreen = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `;

  /* Glass shows you the room it is standing in, and almost nothing else. The
     reference reflects a photographed interior — windows with dark mullions,
     dark walls, a pale floor — and every angular caustic inside its bubble is
     one of those edges bent through the body. buildEnv() paints an equivalent
     room for exactly that reason.

     Two primitives matter more than any constant here:

     band() has a flat top — it holds 1.0 out to 45% of its width before
     falling off. That is what makes the contour a drawn line with body rather
     than a hairline peak at a single value.

     specular() is Blinn-Phong, off the half-vector. Phong's reflect() at the
     same exponent gives a much tighter, harder spot; the broad soft glints
     here are the half-vector's doing. */
  const FRAG = `
    precision highp float;

    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vScreen;

    uniform samplerCube uEnv;
    uniform float uTime;
    uniform float uAlpha;
    uniform float uHover;
    uniform vec3 uAccent;
    uniform float uEnvRot;

    /* Turning the sample direction rotates what the glass sees while the
       geometry stays exactly where it was put. Rotating the mesh instead also
       carries every ball in the field with it — including the one tracking the
       cursor, which then drifts away from the pointer entirely. */
    vec3 spin(vec3 d, float a) {
      float c = cos(a);
      float sn = sin(a);
      return vec3(c * d.x + sn * d.z, d.y, -sn * d.x + c * d.z);
    }

    float specular(vec3 n, vec3 v, vec3 l, float power) {
      vec3 h = normalize(v + l);
      return pow(max(dot(n, h), 0.0), power);
    }

    float band(float value, float center, float width) {
      return 1.0 - smoothstep(width * 0.45, width, abs(value - center));
    }

    float boxMask(vec2 p, vec2 center, vec2 size, float soft) {
      vec2 d = abs(p - center) - size;
      float outside = length(max(d, 0.0));
      float inside = min(max(d.x, d.y), 0.0);
      return 1.0 - smoothstep(0.0, soft, outside + inside);
    }

    void main() {
      vec3 n = normalize(vNormal);
      vec3 v = normalize(vView);
      float backFace = gl_FrontFacing ? 0.0 : 1.0;

      float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
      float fresnel = pow(1.0 - ndv, 1.55);
      float rim = smoothstep(0.05, 0.95, fresnel);
      float outerLine = band(fresnel, 0.84, 0.15);
      float innerLine = band(fresnel, 0.60, 0.12) * smoothstep(-0.95, 0.15, -n.y);
      float backRim = backFace * smoothstep(0.18, 0.92, fresnel);

      vec3 l1 = normalize(vec3(-0.55, 0.82, 0.75));
      vec3 l2 = normalize(vec3(0.65, -0.24, 0.86));
      vec3 l3 = normalize(vec3(-0.18 + sin(uTime * 0.35) * 0.08, 0.30, 0.94));

      float glint =
        specular(n, v, l1, 72.0) * 0.85 +
        specular(n, v, l2, 30.0) * 0.14 +
        specular(n, v, l3, 180.0) * 0.62;

      vec3 envReflect = textureCube(uEnv, spin(reflect(-v, n), uEnvRot)).rgb;
      vec3 envRefract = textureCube(uEnv, spin(normalize(refract(-v, n, 0.74) + n * 0.22), uEnvRot)).rgb;
      envReflect = clamp((envReflect - 0.48) * 1.95 + 0.48, 0.0, 1.0);
      envRefract = clamp((envRefract - 0.50) * 1.85 + 0.46, 0.0, 1.0);

      vec3 envCol = mix(envRefract, envReflect, fresnel * 0.92);
      float envLuma = dot(envCol, vec3(0.299, 0.587, 0.114));
      /* Windowed to the environment actually in use. Pale water tops out around
         0.62 on 1 - luma, so the old 0.46..0.92 range sat almost entirely above
         the signal and returned zero — the reflections vanish and no amount of
         weighting brings them back. Retuning the window is the fix; crushing
         the image to fit the window instead just posterises it. */
      float envDark = smoothstep(0.20, 0.62, 1.0 - envLuma);
      float envBright = smoothstep(0.10, 0.98, envLuma);

      float lowerBend = smoothstep(-0.85, 0.18, -n.y) * smoothstep(0.10, 0.95, fresnel);
      float depthLens = (1.0 - rim) * smoothstep(0.22, 1.0, ndv);

      /* Placed shading, held at a fixed bearing on the body: normalising the
         view position gives a direction on the unit circle, so these stay put
         while the field churns underneath. */
      vec2 p = normalize(vScreen.xy + vec2(0.0001));
      float topHighlight = boxMask(p, vec2(0.42, 0.42), vec2(0.115, 0.23), 0.14) *
        smoothstep(0.08, 0.92, n.x) * smoothstep(-0.10, 0.82, n.y);
      float sideHighlight = boxMask(p, vec2(-0.70, -0.05), vec2(0.055, 0.20), 0.13) *
        smoothstep(0.10, 0.92, -n.x);
      float bottomHighlight = boxMask(p, vec2(0.18, -0.74), vec2(0.24, 0.055), 0.12) *
        smoothstep(0.10, 0.92, -n.y);
      float controlled = topHighlight * 0.78 + sideHighlight * 0.38 + bottomHighlight * 0.42;
      float darkBite = band(p.y + p.x * 0.20, -0.64, 0.060) * smoothstep(0.22, 1.0, fresnel);

      /* Flat, deliberately. Gating the environment behind fresnel confines it
         to the silhouette and leaves the interior empty — which is what turns
         the bubble into a stroked ring around a blank fill. The room has to
         show through the whole body. */
      const float ENV_MASK = 0.90;

      /* One brand colour drives the whole palette rather than a set of hand
         picked constants. The body takes only a trace of it, because a
         saturated tint at low alpha over a white page is invisible; the contour
         and the shadow take far more, because they carry nearly all of the
         alpha. Getting that split wrong is why earlier tint settings did
         almost nothing to the perceived colour. */
      vec3 body = mix(vec3(1.0), uAccent, 0.055);
      vec3 deepInk = mix(vec3(0.30, 0.31, 0.34), uAccent, 0.55);
      vec3 shadeInk = mix(vec3(0.34, 0.33, 0.38), uAccent, 0.45);
      vec3 haloInk = mix(vec3(0.86, 0.87, 0.90), uAccent, 0.22);
      /* Barely any tint now: the environment is a blue water photograph, so the
         reflections arrive coloured. Leaving this at the value the greyscale
         room needed would stack two blues and drive it toward cyan. */
      vec3 envTint = mix(vec3(1.0), uAccent, 0.035);

      vec3 col = body;
      col = mix(col, mix(vec3(1.0), uAccent, 0.03), depthLens * 0.018 + lowerBend * 0.035);
      col = mix(col, envCol * envTint, ENV_MASK * 0.80);
      col = mix(col, shadeInk, envDark * ENV_MASK * 0.13 + darkBite * 0.18);
      col = mix(col, deepInk, outerLine * 0.18 + innerLine * 0.19);
      col = mix(col, haloInk, rim * 0.12 + lowerBend * 0.055 + backRim * 0.12);
      col += vec3(1.0) * (glint * 0.52 + envBright * fresnel * 0.12 + controlled);

      /* The environment's share of the alpha budget is the dial between an
         empty shell and a metallic one. Around 0.06 the reflections barely
         reach the middle; much past 0.2 the room stops being a ghost inside the
         glass and becomes the object, dark and literal. */
      float alpha =
        rim * 0.075 +
        outerLine * 0.185 +
        innerLine * 0.10 +
        backRim * 0.05 +
        envDark * ENV_MASK * 0.115 +
        envBright * ENV_MASK * 0.13 +
        lowerBend * 0.035 +
        depthLens * 0.006 +
        darkBite * 0.10 +
        glint * 0.24 +
        controlled * 0.14 +
        uHover * smoothstep(0.12, 0.95, fresnel) * 0.05;

      alpha = clamp(alpha * uAlpha, 0.0, 0.58);
      if (alpha < 0.002) discard;

      gl_FragColor = vec4(col, alpha);
    }
  `;

  /* A room, painted into an equirectangular canvas and converted to a cube map.
     The reference reflects a photographed interior, and that is not incidental:
     the hard bright/dark boundaries of window panes against their mullions are
     what produce the angular caustics drifting inside the body. A smooth
     gradient environment — however carefully graded — has no edges to bend, so
     the bubble comes out blank no matter what the shader does with it.

     v runs from straight up at 0 to straight down at 1. Ceiling dark, wall band
     with windows through the middle, pale floor below. */
  function buildEnv(THREE, renderer) {
    const W = 1024;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');

    const soft = (x, y, rx, ry, color) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / Math.max(rx, ry));
      ctx.translate(-x, -y);
      ctx.fillStyle = g;
      ctx.fillRect(x - rx * 1.6, y - rx * 1.6, rx * 3.2, rx * 3.2);
      ctx.restore();
    };

    /* A pale room with dark linework, not a dark room. What the body shows is
       whatever survives compositing onto a white page, and only marks darker
       than the page survive at all — so the room is mostly light, and all of
       its contrast lives in localised dark edges: mullions, frames, furniture.
       Invert that and the bubble comes out as a grey disc. */
    const wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, '#f4f2ee');
    wall.addColorStop(0.42, '#e7e4de');
    wall.addColorStop(0.68, '#d8d3ca');
    wall.addColorStop(1, '#efece6');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);

    /* Windows: bright panes, hard dark bars. The highest-contrast edges in the
       room and the source of the angular caustics that drift inside the body. */
    const window_ = (x, y, w, h, cols, rows) => {
      const glass = ctx.createLinearGradient(x, y, x, y + h);
      glass.addColorStop(0, '#ffffff');
      glass.addColorStop(0.6, '#f2f6fb');
      glass.addColorStop(1, '#dde6f0');
      ctx.fillStyle = glass;
      ctx.fillRect(x, y, w, h);

      /* Trees outside, so the panes are not flat fills. */
      ctx.fillStyle = 'rgba(96,108,96,0.22)';
      for (let i = 0; i < 11; i += 1) {
        ctx.fillRect(x + ((i * 41) % w), y + h * 0.2, 3 + (i % 3) * 3, h * 0.75);
      }

      ctx.fillStyle = 'rgba(74,76,86,0.72)';
      const bar = 7;
      for (let i = 0; i <= cols; i += 1) ctx.fillRect(x + (i * (w - bar)) / cols, y, bar, h);
      for (let j = 0; j <= rows; j += 1) ctx.fillRect(x, y + (j * (h - bar)) / rows, w, bar);
    };

    window_(W * 0.27, H * 0.28, W * 0.27, H * 0.34, 3, 3);
    window_(W * 0.61, H * 0.32, W * 0.18, H * 0.27, 2, 3);
    window_(W * 0.02, H * 0.35, W * 0.10, H * 0.21, 1, 2);

    /* Uprights and a rail: more dark linework at other angles, so the caustics
       are not all parallel. */
    ctx.fillStyle = 'rgba(78,80,90,0.6)';
    ctx.fillRect(W * 0.84, H * 0.26, 10, H * 0.38);
    ctx.fillRect(W * 0.90, H * 0.30, 6, H * 0.30);
    ctx.fillStyle = 'rgba(90,88,86,0.4)';
    ctx.fillRect(0, H * 0.655, W, 9);

    /* Furniture: broad dark masses, no hard silhouette. */
    soft(W * 0.16, H * 0.76, 200, 130, 'rgba(96,92,86,0.42)');
    soft(W * 0.68, H * 0.78, 170, 110, 'rgba(102,98,92,0.34)');
    soft(W * 0.42, H * 0.70, 120, 80, 'rgba(110,106,100,0.26)');
    /* A warm lamp and a floor bounce. */
    soft(W * 0.87, H * 0.44, 85, 65, 'rgba(255,206,140,0.6)');
    soft(W * 0.45, H * 0.93, 300, 100, 'rgba(255,252,246,0.5)');

    /* Blur the whole room before it becomes a cube map. Refraction through a
       curved body spreads what it sees, so the caustics should arrive as soft
       ghosts of the window frames — sharp source edges come through as literal,
       recognisable grids drawn inside the glass. */
    const blurred = document.createElement('canvas');
    blurred.width = W;
    blurred.height = H;
    const bctx = blurred.getContext('2d');
    if ('filter' in bctx) bctx.filter = 'blur(7px)';
    bctx.drawImage(c, 0, 0);

    const tex = new THREE.CanvasTexture(blurred);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.needsUpdate = true;

    const target = new THREE.WebGLCubeRenderTarget(256);
    target.fromEquirectangularTexture(renderer, tex);
    tex.dispose();

    return target;
  }

  class Blob {
    static create(host, options) {
      const THREE = window.THREE;
      if (!THREE || !THREE.MarchingCubes) return null;

      const canvas = document.createElement('canvas');
      canvas.className = 'hp-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      host.appendChild(canvas);

      try {
        return new Blob(THREE, canvas, options || {});
      } catch (err) {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        return null;
      }
    }

    constructor(THREE, canvas, options) {
      this.THREE = THREE;
      this.canvas = canvas;
      this.opts = options;

      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setClearColor(0xffffff, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.pixelRatio || 2));
      /* No tone mapping or output encoding is set: three only injects those
         into its own material chunks, and this is a hand-written shader. Its
         colours and the environment canvas are both authored in sRGB and go out
         untouched, which keeps the two consistent. */

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
      this.camera.position.set(0, 0, CAM_Z);

      /* The painted room stands in for the first few frames. It is a decent
         approximation, but the photographic cube is what actually carries the
         look — a real room has light distributed in ways worth reflecting that
         no hand-painted canvas reproduces. */
      this.env = buildEnv(THREE, this.renderer);
      this.disposed = false;

      this.material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uEnv: { value: this.env.texture },
          uTime: { value: 0 },
          uAlpha: { value: 1 },
          uHover: { value: 0 },
          uAccent: { value: new THREE.Color(options.tint || 0x064cd7) },
          uEnvRot: { value: 0 },
        },
        transparent: true,
        side: THREE.DoubleSide,
        /* A translucent shell has no meaningful depth order against itself. */
        depthWrite: false,
        depthTest: false,
      });

      const res = options.resolution || 88;
      this.field = new THREE.MarchingCubes(res, this.material, false, false, options.maxPoly || 220000);
      this.field.isolation = ISOLATION;

      /* Three nested nodes so the squash lands on the blob's direction of
         travel rather than on the world axes. A node applies its scale before
         its rotation, so the composed transform reads outward-in as
         R(angle) · S · R(-angle) — the classic squash basis change. Collapsing
         this into fewer nodes silently cancels the two rotations and leaves an
         axis-aligned squash. */
      this.pivot = new THREE.Object3D();
      this.squasher = new THREE.Object3D();
      this.pivot.add(this.squasher);
      this.squasher.add(this.field);
      this.scene.add(this.pivot);

      this.pointer = {
        x: 0.5,
        y: 0.5,
        smoothX: 0.5,
        smoothY: 0.5,
        midX: 0.5,
        midY: 0.5,
        strength: 0,
        midStrength: 0,
        target: 0,
        clientX: 0,
        clientY: 0,
        active: false,
      };
      this.core = { x: 0.5, y: 0.5 };
      this.squeeze = { k: 0 };
      this.lastTime = 0;

      this.pointerEase = options.pointerEase || 0.13;
      this.hoverEase = options.hoverEase || 0.15;
      this.hoverStrength = options.hoverStrength || 0.11;
      /* Converted from their subtract 13 against isolation 82. What carries
         over is sqrt(1 + isolation/subtract) — how far a ball's pull reaches
         past its own skin — which is 2.66 there and needs subtract 5 here. */
      this.hoverSubtract = options.hoverSubtract || 5;
      this.hoverReach = options.hoverReach || 0.22;
      this.hoverMin = options.hoverMin || 0.1;
      this.squeezeAmount = options.squeeze || 0.35;
      this.wobble = typeof options.wobble === 'number' ? options.wobble : 1;
      this.speed = options.speed || 1;

      this.hit = options.hitElement || canvas;
      this.hitAspect = 1;
      this.sized = false;
      this.resize();

      if (options.envUrl) this.loadEnv(options.envUrl);
    }

    /* Equirectangular photo in, cube map out. three does the projection on the
       GPU, so one panorama ships instead of six faces. */
    loadEnv(url) {
      new this.THREE.TextureLoader().load(
        url,
        (tex) => {
          if (this.disposed) {
            tex.dispose();
            return;
          }

          tex.mapping = this.THREE.EquirectangularReflectionMapping;

          const target = new this.THREE.WebGLCubeRenderTarget(512);
          target.fromEquirectangularTexture(this.renderer, tex);
          tex.dispose();

          const previous = this.env;
          this.env = target;
          this.material.uniforms.uEnv.value = target.texture;
          previous.dispose();
        },
        undefined,
        /* Painted room stays if the asset is missing. */
        () => {}
      );
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      this.sized = true;
      this.width = rect.width;
      this.height = rect.height;
      this.renderer.setSize(rect.width, rect.height, false);
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
    }

    /* Pointer arrives in client coordinates; store it as 0..1 across the canvas
       with y flipped into world orientation, plus how much sway it should have
       based on how far outside the canvas it is. */
    setPointer(clientX, clientY, active) {
      /* Stores raw client coordinates and nothing else. Resolving them against
         the canvas needs getBoundingClientRect, which forces a synchronous
         layout — and pointermove fires far faster than once a frame on a
         high-polling mouse, so doing it here stalls the whole loop. The rect is
         read once per frame in resolvePointer() instead. */
      this.pointer.clientX = clientX;
      this.pointer.clientY = clientY;
      this.pointer.active = active;
    }

    resolvePointer() {
      const hit = this.hit.getBoundingClientRect();
      if (!hit.width || !hit.height) return;

      const px = this.pointer.clientX;
      const py = this.pointer.clientY;

      /* Binary, not a distance falloff: full influence anywhere over the
         interactive area, none outside it. All of the softness comes from
         hoverEase smoothing that step, which is why it still feels gradual. */
      const inside =
        this.pointer.active &&
        px >= hit.left && px <= hit.right && py >= hit.top && py <= hit.bottom;
      this.pointer.target = inside ? 1 : 0;

      this.pointer.x = clamp((px - hit.left) / hit.width, 0, 1);
      this.pointer.y = clamp(1 - (py - hit.top) / hit.height, 0, 1);
      this.hitAspect = hit.width / hit.height;
    }

    frame(seconds) {
      if (!this.sized) this.resize();
      if (!this.sized) return null;

      const t = seconds * this.speed;
      const p = this.pointer;

      this.resolvePointer();

      /* Exponential smoothing corrected for elapsed time. A raw per-frame lerp
         eases at whatever rate the frame happens to arrive, so any hitch in the
         field rebuild shows up directly as a stutter in the follow. Solving for
         dt makes the motion identical at 60fps, 45fps or 144Hz — most of what
         reads as smoothness here is this, not the easing constants. */
      const dt = this.lastTime ? clamp(seconds - this.lastTime, 0, 0.1) : 1 / 60;
      this.lastTime = seconds;
      const ease = (rate) => 1 - Math.pow(1 - rate, dt * 60);

      const pe = ease(this.pointerEase);
      const he = ease(this.hoverEase);

      /* Two first-order filters in series rather than one. A single lerp
         responds fastest at the instant the target moves and decays from there,
         which is what gives it that slightly abrupt start. Cascading two makes
         the response ease in as well as out — a critically damped second-order
         curve, so it arrives without overshoot and never snaps. */
      p.midX += (p.x - p.midX) * pe;
      p.midY += (p.y - p.midY) * pe;
      p.smoothX += (p.midX - p.smoothX) * pe;
      p.smoothY += (p.midY - p.smoothY) * pe;

      p.midStrength += (p.target - p.midStrength) * he;
      p.strength += (p.midStrength - p.strength) * he;

      /* Cursor offset from centre in frustum-half-height units, measured
         across the interactive area rather than the canvas — their canvas spans
         its whole section, so this keeps the same proportions. */
      const halfH = CAM_Z * Math.tan((FOV / 2) * (Math.PI / 180));
      const offX = (p.smoothX - 0.5) * 2 * (this.hitAspect || 1);
      const offY = (p.smoothY - 0.5) * 2;

      this.field.reset();

      /* The core holds its position. It breathes on its own clock, but the
         cursor never translates it — the pointer acts on the surface and on the
         reflections only, so the body stays anchored under the label. */
      const cx = 0.5 + Math.sin(t * 0.31) * 0.014 + Math.sin(t * 0.17 + 1.3) * 0.009;
      const cy = 0.5 + Math.cos(t * 0.27) * 0.016 + Math.sin(t * 0.21 + 2.4) * 0.008;

      this.field.addBall(cx, cy, 0.5, CORE_S, SUBTRACT);

      /* Fixed offset, so the silhouette is stable frame to frame. */
      this.field.addBall(
        cx + DROP.x * CORE_R,
        cy + DROP.y * CORE_R,
        0.5,
        strengthFor(DROP.r),
        SUBTRACT
      );

      /* The droplet, on their terms exactly:

           position  0.5 + offset x reach, clamped to 0.08..0.92
           size      strength x emerge x near
           emerge    smoothstep of (influence - min) / (1 - min)
           near      hypot(offset) / 0.34, floored at 0.3

         `near` is the detail that makes it feel alive: the droplet is small
         when the cursor sits near the middle and grows as it travels out, so it
         reads as being drawn further out of the body the further you pull.

         Nothing is eased here. All the smoothing already happened in
         smoothX/smoothY, and a second stage on top only adds lag. */
      const influence = p.strength;

      if (influence > this.hoverMin) {
        const raw = clamp((influence - this.hoverMin) / (1 - this.hoverMin), 0, 1);
        const emerge = raw * raw * (3 - 2 * raw);
        const near = clamp(Math.hypot(offX, offY) / 0.34, 0.3, 1);

        const dx = offX * this.hoverReach;
        const dy = offY * this.hoverReach;

        /* Room available per axis: whichever is tighter of the visible frustum
           and the grid itself, less the droplet's own radius. Measured rather
           than hard-coded, so a wider canvas automatically grants more travel.
           Fading strength shrinks the metaball's radius, so it scales away
           instead of being sliced by the viewport edge. */
        const rGrid = Math.sqrt(this.hoverStrength / (ISOLATION + this.hoverSubtract));
        const limX = Math.min(0.5, (halfH * this.camera.aspect) / (2 * SCALE)) - rGrid;
        const limY = Math.min(0.5, halfH / (2 * SCALE)) - rGrid;

        const out = Math.max(Math.abs(dx) / limX, Math.abs(dy) / limY);
        const t0 = clamp((out - EDGE_FADE_FROM) / (1 - EDGE_FADE_FROM), 0, 1);
        const fade = 1 - t0 * t0 * (3 - 2 * t0);

        if (fade > 0.002) {
          this.field.addBall(
            clamp(0.5 + dx, 0.05, 0.95),
            clamp(0.5 + dy, 0.05, 0.95),
            0.5,
            this.hoverStrength * emerge * near * fade,
            this.hoverSubtract
          );
        }
      }

      this.field.update();

      /* Breath only. Velocity-driven squash deformed the silhouette, which is
         exactly what the body should no longer do. */
      const breath = (0.5 + 0.5 * Math.sin(t * 0.55)) * 0.012;
      this.squeeze.k = lerp(this.squeeze.k, breath * this.squeezeAmount, ease(0.06));

      /* Axis-aligned now: with no direction of travel there is nothing to
         orient the squash to, so the pivot's rotation and the field's
         counter-rotation are both left at zero. */
      this.squasher.scale.set(
        SCALE * (1 + this.squeeze.k),
        SCALE * (1 - this.squeeze.k * 0.85),
        SCALE
      );
      /* The mesh never turns. The reflections do, via the sample direction —
         a continuous drift plus a nudge from the cursor. */
      this.material.uniforms.uEnvRot.value = t * 0.20 + offX * 0.28 * influence;
      this.material.uniforms.uTime.value = t;
      this.material.uniforms.uHover.value = influence;

      this.renderer.render(this.scene, this.camera);

      /* Hand the core's screen offset back so the HTML label can ride along. */
      const pxPerWorld = this.height / (2 * halfH);
      return {
        x: (cx - 0.5) * 2 * SCALE * pxPerWorld,
        y: -(cy - 0.5) * 2 * SCALE * pxPerWorld,
      };
    }

    setAlpha(value) {
      this.material.uniforms.uAlpha.value = value;
    }

    destroy() {
      this.disposed = true;
      this.field.geometry.dispose();
      this.material.dispose();
      this.env.dispose();
      this.renderer.dispose();
      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
  }

  window.HomePhilosophyBlob = Blob;
})();
