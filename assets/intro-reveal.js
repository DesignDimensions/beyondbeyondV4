(function () {
  const root = document.documentElement;
  if (!root.classList.contains('intro-running')) return;

  const intro = document.getElementById('IntroReveal');
  const gsap = window.gsap;

  const bg = intro && intro.querySelector('[data-intro-bg]');
  const line = intro && intro.querySelector('[data-intro-line]');
  const logo = intro && intro.querySelector('[data-intro-logo]');
  const badge = intro && intro.querySelector('[data-intro-badge]');
  const words = intro ? Array.from(intro.querySelectorAll('[data-intro-word]')) : [];

  const header = document.querySelector('.section-header .header');
  const headerLogoWrap = header && header.querySelector('.header__heading-logo-wrapper, .header__heading-link > .h2');
  const navPill = header && header.querySelector('[data-intro-target]');
  const navPillText = header && header.querySelector('[data-intro-target-text]');
  const navPillItem = navPill && navPill.closest('.header__nad-item');
  const main = document.querySelector('.content-for-layout');

  const pageBits = [
    document.querySelector('.announcement-bar-section'),
    header && header.querySelector('header-drawer'),
    header && header.querySelector('.header__inline-menu'),
    header && header.querySelector('.header__icons'),
    headerLogoWrap,
    main,
    document.querySelector('.shopify-section-group-footer-group'),
  ].filter(Boolean);

  const handBack = pageBits.concat([navPillItem]).filter(Boolean);
  // Deliberate gestures only. `wheel` and `touchmove` used to be here too, but
  // the page is locked at `overflow: hidden` while the intro plays, so those
  // fire without moving anything — a nudged trackpad or the tail of an inertial
  // scroll carried in from the previous page killed the intro for no gain.
  const skipEvents = ['pointerdown', 'keydown'];
  const startWidth = window.innerWidth;

  let done = false;

  function finish() {
    if (done) return;
    done = true;
    clearTimeout(failsafe);
    window.removeEventListener('resize', onResize);
    skipEvents.forEach((e) => window.removeEventListener(e, skip));
    root.classList.remove('intro-running');
    if (gsap) gsap.set(handBack, { clearProps: 'all' });
    if (intro) intro.remove();
    try {
      sessionStorage.setItem('bb:intro-seen', '1');
    } catch (e) { }
    // Releases every section reveal that has been holding for the curtain.
    // Fired on every exit path — completed, skipped, failsafe — so a reveal can
    // never be stranded by the intro ending in an unexpected way.
    document.dispatchEvent(new CustomEvent('bb:intro-done'));
  }

  const failsafe = setTimeout(finish, 9000);

  if (!gsap || !intro || !badge || !logo) {
    finish();
    return;
  }

  function skip() {
    if (done) return;
    tl.pause();
    gsap.to(intro, { opacity: 0, duration: 0.3, ease: 'power2.out', onComplete: finish });
    gsap.to(handBack, { opacity: 1, y: 0, duration: 0.3 });
  }

  // Mobile browsers fire resize when the URL bar collapses; only a real width
  // change invalidates the measurements this timeline is built on.
  function onResize() {
    if (Math.abs(window.innerWidth - startWidth) > 40) skip();
  }

  const filt = (invert, blur, bright) => `invert(${invert}) blur(${blur}px) brightness(${bright})`;

  // Values are wrapped in functions so GSAP measures them the frame the tween
  // starts rather than when the timeline is built.
  function lazy(calc) {
    let memo = null;
    const get = () => (memo = memo || calc());
    return (key) => () => get()[key];
  }

  function spread(keys, calc) {
    const get = lazy(calc);
    return keys.reduce((vars, key) => ((vars[key] = get(key)), vars), {});
  }

  // Center-to-center move plus uniform scale, matching `el` onto `target`.
  const fitTo = (el, target) =>
    spread(['x', 'y', 'scaleX', 'scaleY'], () => {
      const a = el.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const ratio = a.width > 0 && b.width > 0 ? b.width / a.width : 1;
      return {
        x: gsap.getProperty(el, 'x') + (b.left + b.width / 2) - (a.left + a.width / 2),
        y: gsap.getProperty(el, 'y') + (b.top + b.height / 2) - (a.top + a.height / 2),
        scaleX: (gsap.getProperty(el, 'scaleX') || 1) * ratio,
        scaleY: (gsap.getProperty(el, 'scaleY') || 1) * ratio,
      };
    });

  // The badge's box grown by proportional padding — the pill the blue becomes.
  const pillAroundBadge = (grow) =>
    spread(['left', 'top', 'width', 'height'], () => {
      const r = badge.getBoundingClientRect();
      const padX = r.height * 0.5;
      const padY = r.height * 0.26;
      return {
        left: r.left + r.width / 2,
        top: r.top + r.height / 2,
        width: (r.width + padX * 2) * grow,
        height: (r.height + padY * 2) * grow,
      };
    });

  const sizeOf = (target) =>
    spread(['width', 'height'], () => {
      const b = target.getBoundingClientRect();
      return { width: b.width, height: b.height };
    });

  // The blue is anchored on the tagline and oversized just enough to still
  // cover the viewport from that off-centre point.
  function cover() {
    const r = (line || badge).getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      left: x,
      top: y,
      width: 2 * Math.max(x, w - x) + 240,
      height: 2 * Math.max(y, h - y) + 240,
    };
  }

  // Re-centres the blue on the badge every frame, so the highlight keeps
  // wrapping the word while both are still travelling.
  function trackBadge() {
    const r = badge.getBoundingClientRect();
    gsap.set(bg, { left: r.left + r.width / 2, top: r.top + r.height / 2 });
  }

  // The circle the blue passes through halfway, sized to sit around the word.
  const circleAroundBadge = () =>
    spread(['width', 'height', 'borderRadius'], () => {
      const r = badge.getBoundingClientRect();
      const d = Math.max(r.width, r.height) * 1.5;
      return { width: d, height: d, borderRadius: d / 2 };
    });

  const others = words.filter((w) => w !== badge);
  const navReady = !!(navPill && navPillText && navPill.getBoundingClientRect().width > 0);

  // The highlight is spared the burn-off only because it has somewhere to go:
  // the pill at the end of the navigation. On a phone that pill is inside the
  // inline menu, which is display:none at this width, so there is no landing
  // spot and nothing for it to fly to — it stays behind instead, hanging over
  // a page that has already arrived. With nowhere to land it is just another
  // word, and burns off with the rest of them.
  const burnOff = navReady ? others : words;

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' }, onComplete: finish });

  tl.set(bg, { xPercent: -50, yPercent: -50, ...spread(['left', 'top', 'width', 'height'], cover) })

    /* Act I — arrival */
    .fromTo(
      logo,
      { opacity: 0, scale: 0.86, y: 28, filter: filt(1, 20, 1) },
      { opacity: 1, scale: 1, y: 0, filter: filt(1, 0, 1), duration: 0.72, ease: 'expo.out' },
      0
    )
    .fromTo(
      words,
      { yPercent: 118, opacity: 0, filter: 'blur(0px)' },
      { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.52, stagger: 0.03, ease: 'expo.out' },
      0.2
    )

    /* Act II — the masks are dropped once the words are up, so the blur they
       dissolve with is not clipped to a hard rectangle. */
    .call(() => line.classList.add('intro__line--lit'), null, 0.74)
    .to(logo, { filter: filt(1, 0, 2.2), duration: 0.17, yoyo: true, repeat: 1 }, 0.84)

    /* Act III — everything burns off except the highlight, where there is a
       pill for the highlight to land in */
    .to(
      burnOff,
      {
        yPercent: 60,
        opacity: 0,
        filter: 'blur(8px)',
        duration: 0.34,
        ease: 'power2.in',
        stagger: { each: 0.024, from: 'edges' },
      },
      2.1
    )

    /* Act IV — the logo dissolves in place alongside the words */
    .to(logo, { y: 30, opacity: 0, filter: filt(1, 8, 1), duration: 0.34, ease: 'power2.in' }, 2.08);

  if (main) tl.fromTo(main, { y: 24 }, { y: 0, duration: 0.7, ease: 'power3.out' }, 2.86);

  /* Act V — the blue closes in on the highlight while the highlight is already
     on its way to the nav. It rounds down into a circle around the word at the
     halfway mark, then stretches out into the header pill. */
  if (navReady) {
    tl.to(badge, { ...fitTo(badge, navPillText), duration: 0.94, ease: 'power3.inOut' }, 2.54)
      .to(bg, { ...circleAroundBadge(), duration: 0.5, ease: 'power2.inOut', onUpdate: trackBadge }, 2.54)
      .to(
        bg,
        {
          ...sizeOf(navPill),
          borderRadius: 6,
          duration: 0.44,
          ease: 'power2.inOut',
          onUpdate: trackBadge,
        },
        3.04
      )
      .to(pageBits, { opacity: 1, duration: 0.5, stagger: 0.045 }, 2.76)
      .to([bg, badge], { scaleX: '*=1.12', scaleY: '*=0.9', duration: 0.1, ease: 'power2.out' }, 3.48)
      .to([bg, badge], { scaleX: '/=1.12', scaleY: '/=0.9', duration: 0.38, ease: 'elastic.out(1, 0.5)' }, 3.58)
      .to(navPillItem, { opacity: 1, duration: 0.14 }, 3.96)
      .to([bg, badge], { opacity: 0, duration: 0.14 }, 3.98);
  } else {
    /* Act V, without a landing — the curtain simply lifts. The words and the
       highlight have all burned off above, so the blue has nothing left to
       wrap and no pill to become: it fades out over the page arriving under
       it, which is the whole of the ending at this width. */
    tl.to(pageBits, { opacity: 1, duration: 0.5, stagger: 0.045 }, 2.6)
      .to(bg, { opacity: 0, duration: 0.5, ease: 'power2.inOut' }, 2.6);
  }

  function start() {
    if (done) return;
    window.scrollTo(0, 0);
    skipEvents.forEach((e) => window.addEventListener(e, skip, { passive: true, once: true }));
    window.addEventListener('resize', onResize);
    tl.timeScale(1.05).play();
  }

  // Only the logo bitmap is worth waiting on, and briefly — a blocked font or a
  // slow CDN must never leave the visitor staring at a motionless blue screen.
  const logoImg = logo.querySelector('img');
  const ready =
    logoImg && !logoImg.complete
      ? new Promise((res) => {
        logoImg.addEventListener('load', res, { once: true });
        logoImg.addEventListener('error', res, { once: true });
      })
      : Promise.resolve();

  Promise.race([ready, new Promise((res) => setTimeout(res, 250))]).then(start);
})();
