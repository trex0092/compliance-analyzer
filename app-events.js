/**
 * Delegated Event System — Hawkeye Sterling V2
 *
 * Replaces inline event handlers (onclick, onchange, onkeydown, etc.)
 * with delegated listeners using data-* attributes. This allows the
 * Content Security Policy to drop 'unsafe-inline' from script-src.
 *
 * Usage in HTML:
 *   Before: <button onclick="switchTab('reports')">Reports</button>
 *   After:  <button data-action="switchTab" data-arg="reports">Reports</button>
 *
 *   Before: <input onchange="filterCompanies()" />
 *   After:  <input data-change="filterCompanies" />
 *
 *   Before: <input onkeydown="if(event.key==='Enter')attemptLogin()" />
 *   After:  <input data-enter="attemptLogin" />
 */
(function () {
  'use strict';

  // ─── Click Delegation ───────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;

    var action = target.getAttribute('data-action');
    var arg = target.getAttribute('data-arg');
    var arg2 = target.getAttribute('data-arg2');

    if (!action) return;

    // Resolve the function — supports dotted names like "MobileResponsive.toggleMenu"
    var fn = resolveFunction(action);
    if (typeof fn !== 'function') {
      console.warn('[Events] Unknown action:', action);
      return;
    }

    // Call with arguments if provided
    if (arg2 !== null) {
      fn(arg, arg2);
    } else if (arg !== null) {
      fn(arg);
    } else {
      fn();
    }
  });

  // ─── Change Delegation ──────────────────────────────────────────────
  document.addEventListener('change', function (e) {
    var target = e.target.closest('[data-change]');
    if (!target) return;

    var action = target.getAttribute('data-change');
    var fn = resolveFunction(action);
    if (typeof fn === 'function') fn(e);
  });

  // ─── Input Delegation ───────────────────────────────────────────────
  document.addEventListener('input', function (e) {
    var target = e.target.closest('[data-input]');
    if (!target) return;

    var action = target.getAttribute('data-input');
    var fn = resolveFunction(action);
    if (typeof fn === 'function') fn(e);
  });

  // ─── Enter Key Delegation ──────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var target = e.target.closest('[data-enter]');
    if (!target) return;

    var action = target.getAttribute('data-enter');
    var fn = resolveFunction(action);
    if (typeof fn === 'function') fn(e);
  });

  // ─── Mouseover/Mouseout Delegation ─────────────────────────────────
  document.addEventListener('mouseover', function (e) {
    var target = e.target.closest('[data-hover]');
    if (!target) return;
    var style = target.getAttribute('data-hover-style');
    if (style) target.style.cssText += style;
  });

  document.addEventListener('mouseout', function (e) {
    var target = e.target.closest('[data-hover]');
    if (!target) return;
    var restore = target.getAttribute('data-hover-restore');
    if (restore) target.style.cssText += restore;
  });

  // ─── Click Delegation (boolean args) ─────────────────────────────────
  // Support data-arg="true"/"false" as actual booleans
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action][data-arg]');
    if (!target) return;
    var arg = target.getAttribute('data-arg');
    if (arg === 'true') target.setAttribute('data-arg-bool', 'true');
    else if (arg === 'false') target.setAttribute('data-arg-bool', 'false');
  }, true); // capture phase, runs before the main click handler

  // ─── Change Delegation (with this.value) ───────────────────────────
  // Helper: compound handlers like switchActiveCompany + updateCompanyBar
  window._switchCompanyAndUpdateBar = function (e) {
    var val = e && e.target ? e.target.value : '';
    if (typeof switchActiveCompany === 'function') switchActiveCompany(val);
    if (typeof updateCompanyBar === 'function') updateCompanyBar();
  };

  // ─── Function Resolver ─────────────────────────────────────────────
  function resolveFunction(name) {
    if (!name) return null;
    var parts = name.split('.');
    var obj = window;
    for (var i = 0; i < parts.length; i++) {
      obj = obj[parts[i]];
      if (obj === undefined || obj === null) return null;
    }
    return obj;
  }
})();
