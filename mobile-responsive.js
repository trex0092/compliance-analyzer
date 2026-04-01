/**
 * Mobile Responsive Module
 * Adds touch-friendly enhancements and hamburger menu for mobile navigation.
 */
var MobileResponsive = (function () {
  'use strict';

  var MOBILE_BREAKPOINT = 768;
  var menuOpen = false;

  /**
   * Detect whether the current viewport qualifies as mobile.
   * @returns {boolean}
   */
  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  /**
   * Toggle the mobile hamburger menu open/closed.
   */
  function toggleMenu() {
    var tabs = document.getElementById('tabsNav');
    if (!tabs) return;

    menuOpen = !menuOpen;
    if (menuOpen) {
      tabs.classList.add('menu-open');
      document.body.style.overflow = 'hidden';
    } else {
      tabs.classList.remove('menu-open');
      document.body.style.overflow = '';
    }
  }

  /**
   * Close the mobile menu (convenience for tab clicks).
   */
  function closeMenu() {
    if (!menuOpen) return;
    var tabs = document.getElementById('tabsNav');
    if (tabs) tabs.classList.remove('menu-open');
    menuOpen = false;
    document.body.style.overflow = '';
  }

  /**
   * Wire up all tab buttons so they close the mobile menu on click.
   */
  function wireTabCloseHandlers() {
    var tabs = document.getElementById('tabsNav');
    if (!tabs) return;
    var tabEls = tabs.querySelectorAll('.tab');
    tabEls.forEach(function (tab) {
      tab.addEventListener('click', function () {
        if (isMobile() && menuOpen) {
          closeMenu();
        }
      });
    });
  }

  /**
   * Add touch-friendly enhancements for mobile devices.
   */
  function addTouchEnhancements() {
    // Add viewport meta if missing
    if (!document.querySelector('meta[name="viewport"]')) {
      var meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.head.appendChild(meta);
    }

    // Increase tap targets: ensure all buttons have minimum 44px touch target
    if (isMobile()) {
      var style = document.createElement('style');
      style.id = 'mobile-touch-enhancements';
      style.textContent =
        '@media (max-width: ' + MOBILE_BREAKPOINT + 'px) {' +
        '  button, .btn, .tab { min-height: 44px; }' +
        '  .logo-text { font-size: 16px; }' +
        '  .subtitle { font-size: 10px; letter-spacing: 1px; }' +
        '}';
      document.head.appendChild(style);
    }
  }

  /**
   * Handle resize events — close menu when returning to desktop.
   */
  function onResize() {
    if (!isMobile() && menuOpen) {
      closeMenu();
    }
  }

  /**
   * Close menu when pressing Escape.
   */
  function onKeydown(e) {
    if (e.key === 'Escape' && menuOpen) {
      closeMenu();
    }
  }

  /**
   * Initialise the mobile responsive module.
   */
  function init() {
    wireTabCloseHandlers();
    addTouchEnhancements();
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeydown);
  }

  // Auto-initialise when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public API
  return {
    init: init,
    isMobile: isMobile,
    toggleMenu: toggleMenu,
    closeMenu: closeMenu
  };
})();
