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

  document.addEventListener(
    'click',
    function (event) {
      var card = event.target.closest && event.target.closest('.card[data-route]');
      if (!card) return;
      event.preventDefault();
      event.stopPropagation();
      var route = card.getAttribute('data-route');
      var label = card.querySelector('.card-title');
      openModule(route, label ? label.textContent : 'Module');
    },
    true
  );

  closeBtn.addEventListener('click', closeModule);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && view.classList.contains('is-open')) {
      closeModule();
    }
  });
})();
