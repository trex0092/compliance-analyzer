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
  // Passes the event to the handler. For handlers that originally used
  // "this" (e.g., attachIARFile(this)), the function receives e and
  // should use e.target to get the element.
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

  // ─── Complex Handler Helpers ─────────────────────────────────────────
  // These replace multi-statement inline onclick handlers.

  window._resetAccountsAndReload = function () {
    if (confirm('This will clear all login data and let you create a new account. App data (shipments, evidence, etc.) will be kept. Continue?')) {
      localStorage.removeItem('fgl_users');
      localStorage.removeItem('fgl_session');
      localStorage.removeItem('fgl_sessions');
      localStorage.removeItem('fgl_auth_log');
      location.reload();
    }
  };

  window._openMainPanelWithToast = function () {
    if (typeof openMainPanel === 'function') openMainPanel();
    if (typeof toast === 'function') toast('You can configure API keys in Settings', 'info', 4000);
  };

  window._switchTabAndCloseMenu = function (tab) {
    if (typeof switchTab === 'function') switchTab(tab);
    if (window.MobileResponsive) MobileResponsive.closeMenu();
  };

  window._confirmAndClear = function (msg, fn) {
    if (confirm(msg) && typeof window[fn] === 'function') window[fn]();
  };

  window._confirmClearStorage = function (msg, key) {
    if (confirm(msg)) {
      localStorage.removeItem(key);
      if (typeof toast === 'function') toast('Data cleared', 'success');
    }
  };

  window._clickFileInput = function (inputId) {
    var el = document.getElementById(inputId);
    if (el) el.click();
  };

  window._attachFileHandler = function (inputId, fn, arg) {
    var el = document.getElementById(inputId);
    if (!el) return;
    el.addEventListener('change', function () {
      if (arg) window[fn](el, arg);
      else window[fn](el);
    });
  };

  window._multiAction = function (/* fn1, fn2, ... */) {
    for (var i = 0; i < arguments.length; i++) {
      var fn = resolveFunction(arguments[i]);
      if (typeof fn === 'function') fn();
    }
  };

  window._attachCProgFileEwra = function (e) { if (typeof attachCProgFile === 'function') attachCProgFile(e.target, 'ewra'); };
  window._attachCProgFileBwra = function (e) { if (typeof attachCProgFile === 'function') attachCProgFile(e.target, 'bwra'); };
  window._attachCProgFileManual = function (e) { if (typeof attachCProgFile === 'function') attachCProgFile(e.target, 'manual'); };

  // Change handlers that need this/e.target as argument
  window.attachIARFile = window.attachIARFile || function () {};
  window.attachCompanyFile = window.attachCompanyFile || function () {};
  window.attachTrainingFile = window.attachTrainingFile || function () {};
  window.attachEmployeeFile = window.attachEmployeeFile || function () {};
  window.attachRACIFile = window.attachRACIFile || function () {};
  window.showSelectedFile = window.showSelectedFile || function () {};
  window.loadCompanyProfileEditor = window.loadCompanyProfileEditor || function () {};
  window.raciColorChange = window.raciColorChange || function () {};
  window.filterDefinitions = window.filterDefinitions || function () {};

  // Toggle dropdown visibility
  window._toggleDropdown = function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  };

  // AI provider selector handler
  window._aiProviderChange = function (e) {
    document.querySelectorAll('.ai-key-section').forEach(function (s) { s.style.display = 'none'; });
    var v = e.target.value;
    if (v === 'claude') { var el = document.getElementById('claudeKeySection'); if (el) el.style.display = 'block'; }
    else if (v === 'gemini') { var el = document.getElementById('geminiKeySection'); if (el) el.style.display = 'block'; }
    else if (v === 'openai') { var el = document.getElementById('openaiKeySection'); if (el) el.style.display = 'block'; }
    else if (v === 'copilot') { var el = document.getElementById('copilotKeySection'); if (el) el.style.display = 'block'; }
    else if (v === 'mixed') {
      ['copilotKeySection', 'geminiKeySection', 'claudeKeySection'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'block'; });
    }
  };

  // Upload button: multi or single file
  window._uploadFiles = function () {
    var f = document.getElementById('uploadFileInput');
    if (f && f.files && f.files.length > 1) { if (typeof uploadMultipleFiles === 'function') uploadMultipleFiles(); }
    else { if (typeof uploadFileToServer === 'function') uploadFileToServer(); }
  };

  window._riskRatingColor = function (e) {
    var v = e.target.value;
    e.target.style.color = v === 'Low' ? 'var(--green)' : v === 'Medium' ? 'var(--amber)' : v === 'High' ? 'var(--red)' : '';
  };

  window._fixAsanaEntityTasks = function () {
    if (typeof fixAsanaEntityTasks === 'function') fixAsanaEntityTasks();
  };

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
