// module-viewer.js — shared in-page module viewer for landing pages.
// Any landing page (compliance-ops.html, logistics.html, etc.) that
// wires up cards with `class="card" data-route="<tab>"` plus a matching
// <section id="moduleView"> block will get inline-iframe navigation
// instead of leaving the page.
(function () {
  'use strict';

  function titleFromCard(card, route) {
    var heading = card.querySelector('.card-title');
    if (heading && heading.textContent) return heading.textContent.trim();
    return (route || 'Module').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  function open(card) {
    var view = document.getElementById('moduleView');
    var frame = document.getElementById('moduleViewFrame');
    var title = document.getElementById('moduleViewTitle');
    if (!view || !frame || !title) return;
    var route = card.getAttribute('data-route') || '';
    var href = card.getAttribute('href') || '';
    title.textContent = titleFromCard(card, route);
    // Bounce src so the iframe re-navigates even when the same card is
    // reopened after being closed.
    frame.src = 'about:blank';
    setTimeout(function () {
      frame.src = href;
    }, 20);
    view.classList.add('is-open');
    setTimeout(function () {
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }

  function close() {
    var view = document.getElementById('moduleView');
    var frame = document.getElementById('moduleViewFrame');
    if (!view) return;
    view.classList.remove('is-open');
    if (frame) frame.src = 'about:blank';
    var anchor = document.querySelector('.section-head') || document.querySelector('.hero');
    if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.addEventListener(
    'click',
    function (e) {
      var t = e && e.target;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('#moduleViewClose')) {
        e.preventDefault();
        close();
        return;
      }
      var card = t.closest('a.card[data-route]');
      if (card) {
        e.preventDefault();
        open(card);
      }
    },
    false
  );

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
