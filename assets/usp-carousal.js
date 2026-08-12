(function () {
  function initCarousal() {
    const root = document.querySelector('.usp-carousal-container');
    if (!root || !window.gsap) return;

    const track = root.querySelector('.usp-carousal-track');
    if (!track) return;

    const itemWrap = track.querySelector('.page-width');
    if (!itemWrap) return;

    const items = Array.from(itemWrap.children);
    if (items.length === 0) return;

    const cloneSets = 2;
    for (let i = 0; i < cloneSets; i++) {
      items.forEach((item) => itemWrap.appendChild(item.cloneNode(true)));
    }

    const originalWidth = () => {
      const firstRect = items[0].getBoundingClientRect();
      const lastRect = items[items.length - 1].getBoundingClientRect();
      return lastRect.right - firstRect.left;
    };

    const state = {
      x: 0,
      isDragging: false,
      dragStartX: 0,
      startX: 0,
      animation: null,
      autoSpeed: 80,
    };

    const wrapX = (x, width) => {
      const wrapped = ((x % width) + width) % width;
      return wrapped === 0 ? 0 : wrapped - width;
    };

    const setTransform = (x) => {
      state.x = x;
      gsap.set(track, { x: state.x });
    };

    const startAutoScroll = () => {
      const distance = originalWidth();
      if (distance <= 0) return;
      if (state.animation) {
        state.animation.kill();
      }
      state.animation = gsap.to(track, {
        x: -distance,
        duration: Math.max(8, distance / state.autoSpeed),
        ease: 'none',
        onUpdate() {
          state.x = gsap.getProperty(track, 'x');
        },
        onComplete() {
          gsap.set(track, { x: 0 });
          state.x = 0;
          if (!state.isDragging) {
            startAutoScroll();
          }
        },
      });
    };

    const stopAutoScroll = () => {
      if (state.animation) {
        state.animation.kill();
        state.animation = null;
      }
    };

    const pointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      state.isDragging = true;
      state.dragStartX = event.clientX;
      state.startX = state.x;
      stopAutoScroll();
      root.classList.add('usp-carousal-grabbing');
      track.style.willChange = 'transform';
      window.addEventListener('pointermove', pointerMove, { passive: false });
      window.addEventListener('pointerup', pointerUp, { passive: true });
      window.addEventListener('pointercancel', pointerUp, { passive: true });
    };

    const pointerMove = (event) => {
      if (!state.isDragging) return;
      event.preventDefault();
      const delta = event.clientX - state.dragStartX;
      const nextX = wrapX(state.startX + delta, originalWidth());
      setTransform(nextX);
    };

    const pointerUp = () => {
      if (!state.isDragging) return;
      state.isDragging = false;
      root.classList.remove('usp-carousal-grabbing');
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
      startAutoScroll();
    };

    root.addEventListener('pointerdown', pointerDown, { passive: true });
    gsap.set(track, { x: 0, force3D: true });
    startAutoScroll();
  }

  if (document.readyState === 'complete') {
    initCarousal();
  } else {
    window.addEventListener('load', initCarousal);
  }
})();