/**
 * The "Latest Journals" rail, phone only. Desktop and tablet keep the plain
 * grid — this only drives the arrows and the segmented progress bar that
 * appear once the grid becomes a horizontal scroller under 750px.
 */
class BlogPostGridCarousel extends HTMLElement {
  connectedCallback() {
    this.rail = this.querySelector('[data-bpg-rail]');
    this.prevButton = this.querySelector('[data-bpg-prev]');
    this.nextButton = this.querySelector('[data-bpg-next]');
    this.track = this.querySelector('[data-bpg-thumb]')?.parentElement;
    this.thumb = this.querySelector('[data-bpg-thumb]');

    if (!this.rail || !this.prevButton || !this.nextButton) return;

    this.prevButton.addEventListener('click', () => this.scrollByCard(-1));
    this.nextButton.addEventListener('click', () => this.scrollByCard(1));
    this.rail.addEventListener('scroll', () => this.onScroll(), { passive: true });
    window.addEventListener('resize', () => this.onScroll());

    this.onScroll();
  }

  scrollByCard(direction) {
    const card = this.rail.querySelector('.bpg__card');
    if (!card) return;

    const gap = parseFloat(getComputedStyle(this.rail).columnGap || '0') || 0;
    const amount = card.getBoundingClientRect().width + gap;
    this.rail.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }

  onScroll() {
    const max = this.rail.scrollWidth - this.rail.clientWidth;

    this.prevButton.disabled = this.rail.scrollLeft <= 1;
    this.nextButton.disabled = max <= 1 || this.rail.scrollLeft >= max - 1;

    if (!this.track || !this.thumb) return;

    const ratio = max > 0 ? this.rail.scrollLeft / max : 0;
    const room = this.track.clientWidth - this.thumb.offsetWidth;
    this.thumb.style.left = `${Math.max(0, room) * ratio}px`;
  }
}

customElements.define('blog-post-grid-carousel', BlogPostGridCarousel);
