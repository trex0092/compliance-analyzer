// page-nav.js — dynamic page-specific navigation for landing pages.
//
// Renders a different set of navigation items depending on which landing
// page is active (workbench / logistics / compliance-ops / routines).
// Each item deep-links to /<page>/<slug> and opens the matching module
// in the embedded iframe via landing-module-viewer.js (which observes
// clicks on any `[data-route][data-slug]` target, including the nav
// items rendered here).
//
// Before this module, every landing page showed the same nav items
// (IAR REPORT | INTEGRATIONS | SUPPLY | TRADING) because the bar was
// hard-coded once in index.html and inherited whenever any landing
// page opened the module iframe. That made the nav non-contextual.
// We now render the nav at the LANDING level so /workbench,
// /logistics, /compliance-ops each have their own menu.
(function () {
  'use strict';

  // Page-specific navigation items. Each item has:
  //   label — visible text (DM Mono caps).
  //   slug  — URL segment pushed to the address bar: /<page>/<slug>.
  //   route — hash target forwarded to index.html's switchTab() when the
  //           module opens in the iframe.
  var NAV_CONFIG = {
    workbench: [
      { label: 'IAR REPORT',      slug: 'iar-report',       route: 'iarreport' },
      { label: 'COMPLIANCE TASKS',slug: 'compliance-tasks', route: 'asana' },
      { label: 'RISK & CRA',      slug: 'risk-cra',         route: 'riskassessment' },
      { label: 'CALENDAR',        slug: 'calendar',         route: 'calendar' },
      { label: 'REPORTS',         slug: 'reports',          route: 'reports' },
      { label: 'REG MONITOR',     slug: 'reg-monitor',      route: 'monitor' },
      { label: 'SUPPLY',          slug: 'supply',           route: 'supplychain' },
      { label: 'APPROVALS',       slug: 'approvals',        route: 'approvals' },
      { label: 'WORKFLOWS',       slug: 'workflows',        route: 'workflows' },
      { label: 'EXPORT PIPELINE', slug: 'export-pipeline',  route: 'pipeline' },
      { label: 'TRADING',         slug: 'trading',          route: 'metalstrading' },
      { label: 'CUSTOMER 360',    slug: 'customer-360',     route: 'customer360' },
      { label: 'ESG',             slug: 'esg',              route: 'esg' },
      { label: 'RED FLAGS',       slug: 'red-flags',        route: 'redflags' },
      { label: '4-EYES',          slug: '4-eyes',           route: 'approvals' },
      { label: 'AI GOVERN',       slug: 'ai-govern',        route: 'aigovern' }
    ],
    logistics: [
      { label: 'IAR REPORT',       slug: 'iar-report',       route: 'iarreport' },
      { label: 'COMPLIANCE TASKS', slug: 'compliance-tasks', route: 'asana' },
      { label: 'RISK & CRA',       slug: 'risk-cra',         route: 'riskassessment' },
      { label: 'INTEGRATIONS',     slug: 'integrations',     route: 'integrations' },
      { label: 'SUPPLY',           slug: 'supply',           route: 'supplychain' },
      { label: 'APPROVALS',        slug: 'approvals',        route: 'approvals' },
      { label: 'TRAINING',         slug: 'training',         route: 'training' },
      { label: 'ESG',              slug: 'esg',              route: 'esg' }
    ],
    'compliance-ops': [
      { label: 'TRAINING',     slug: 'training',     route: 'training' },
      { label: 'EMPLOYEES',    slug: 'employees',    route: 'employees' },
      { label: 'INCIDENTS',    slug: 'incidents',    route: 'incidents' },
      { label: 'REPORTS',      slug: 'reports',      route: 'reports' },
      { label: 'RISK & CRA',   slug: 'risk-cra',     route: 'riskassessment' },
      { label: 'APPROVALS',    slug: 'approvals',    route: 'approvals' },
      { label: 'REG MONITOR',  slug: 'reg-monitor',  route: 'monitor' },
      { label: 'AI GOVERN',    slug: 'ai-govern',    route: 'aigovern' }
    ],
    'screening-command': [
      { label: 'SUBJECT SCREENING',   slug: 'subject-screening',   route: 'screening' },
      { label: 'TRANSACTION MONITOR', slug: 'transaction-monitor', route: 'screening' },
      { label: 'STR CASES',           slug: 'str-cases',           route: 'incidents' },
      { label: 'WATCHLIST',           slug: 'watchlist',           route: 'screening' }
    ]
    // /routines renders its own cadence-chip filter bar in routines.html
    // (All / Continuous / Daily / Weekly) — no separate page-nav here.
  };

  function currentPage() {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    if (!segs.length) return '';
    return segs[0].replace(/\.html$/, '');
  }

  function currentSlug() {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    return segs.length >= 2 ? segs[1] : '';
  }

  function render() {
    var mount = document.getElementById('pageNav');
    if (!mount) return;
    var page = currentPage();
    var items = NAV_CONFIG[page];
    if (!items || !items.length) {
      mount.innerHTML = '';
      mount.setAttribute('hidden', '');
      return;
    }
    mount.removeAttribute('hidden');
    var activeSlug = currentSlug();
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var href = '/' + page + '/' + item.slug;
      var isActive = item.slug === activeSlug;
      parts.push(
        '<a class="page-nav-link' + (isActive ? ' is-active' : '') + '" ' +
          'href="' + href + '" ' +
          'data-route="' + item.route + '" ' +
          'data-slug="' + item.slug + '"' +
          (isActive ? ' aria-current="page"' : '') +
          '>' + item.label + '</a>'
      );
    }
    mount.innerHTML = parts.join('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  // React to history changes (module open/close pushes state) so the
  // active pill follows the URL.
  window.addEventListener('popstate', render);

  // Exposed so landing-module-viewer.js can re-render the active pill
  // after its own pushState/replaceState calls, which do not fire
  // `popstate` in the current tab.
  window.__renderPageNav = render;
})();
