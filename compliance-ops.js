// compliance-ops.js — in-page module viewer
// Clicking a card on compliance-ops.html opens the corresponding
// index.html tab inline (via iframe) instead of navigating away,
// keeping the user on the Compliance Operations landing page.
(function () {
  'use strict';

  var MODULE_LABELS = {
    training: 'Training',
    employees: 'Employees',
    incidents: 'Incidents',
    reports: 'Reports',
  };

  function open(route, href) {
    var view = document.getElementById('moduleView');
    var frame = document.getElementById('moduleViewFrame');
    var title = document.getElementById('moduleViewTitle');
    if (!view || !frame || !title) return;
    title.textContent = MODULE_LABELS[route] || 'Module';
    // Always bounce the src so the iframe re-routes even when the
    // user reopens the same card.
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
    var grid = document.querySelector('.section-head');
    if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.addEventListener(
    'click',
    function (e) {
      var t = e && e.target;
      if (!t || typeof t.closest !== 'function') return;
      var closeBtn = t.closest('#moduleViewClose');
      if (closeBtn) {
        e.preventDefault();
        close();
        return;
      }
      var card = t.closest('a.card[data-route]');
      if (card) {
        e.preventDefault();
        var route = card.getAttribute('data-route') || '';
        var href = card.getAttribute('href') || '';
        open(route, href);
      }
    },
    false
  );

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
