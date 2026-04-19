(function () {
  var view = document.getElementById('moduleView');
  var frame = document.getElementById('moduleViewFrame');
  var titleEl = document.getElementById('moduleViewTitle');
  var closeBtn = document.getElementById('moduleViewClose');
  if (!view || !frame || !titleEl || !closeBtn) return;

  function openModule(route, label) {
    frame.src = 'index.html#' + route;
    titleEl.textContent = label || 'Module';
    view.classList.add('is-open');
    view.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () {
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function closeModule() {
    view.classList.remove('is-open');
    view.setAttribute('aria-hidden', 'true');
    frame.src = 'about:blank';
  }

  document.querySelectorAll('.card[data-route]').forEach(function (card) {
    card.addEventListener('click', function (event) {
      event.preventDefault();
      var route = card.getAttribute('data-route');
      var label = card.querySelector('.card-title');
      openModule(route, label ? label.textContent : 'Module');
    });
  });

  closeBtn.addEventListener('click', closeModule);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && view.classList.contains('is-open')) {
      closeModule();
    }
  });
})();
