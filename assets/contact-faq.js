/*
 * Contact FAQ — the one thing the section needs a script for.
 *
 * Selecting a question in the theme editor scrolls it into view, which is no
 * help when the answer it is asking about is closed. Opening it here is the
 * whole job; a visitor's own clicks are the browser's to handle.
 */
document.addEventListener('shopify:block:select', (event) => {
  const question = event.target.closest('.cfq__item');
  if (question) question.open = true;
});
