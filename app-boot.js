// Wire all enhanced tabs into switchTab
(function () {
  var origSwitch = window.switchTab;
  // Historically, the first switchTab() call faded out the LAUNCH ANALYZER
  // hero and persisted that dismissal in sessionStorage. After PR #334
  // adopted the workbench-style landing, `#heroIntro` is no longer just an
  // intro — it now wraps the entire main-page landing surface (eyebrow +
  // serif title + summary cells + the two Operations Surface cards
  // Integrations and Trading + the regulatory strip). Hiding it leaves
  // only the header above an empty viewport, which is exactly what the
  // user reported (blank main page after clicking any tab/card).
  //
  // hideHeroIntro is now a no-op that ALSO clears any stale
  // sessionStorage flag from before this fix, so existing browser tabs
  // self-heal without needing the user to clear storage. The unused
  // `.hero-intro--gone` CSS in index.html is harmless and left in place.
  // Regulatory basis: FDL No.10/2025 Art.20 — the CO must always be
  // able to reach every operations surface from a single landing view.
  function hideHeroIntro() {
    try {
      sessionStorage.removeItem('heroIntroDismissed');
      var hero = document.getElementById('heroIntro');
      if (!hero) return;
      hero.classList.remove('hero-intro--gone');
      if (hero.style.display === 'none') hero.style.display = '';
    } catch (err) {
      /* best-effort */
    }
  }
  // Soft fade-in animation on the active tab content.
  function softFadeActiveTab() {
    try {
      var active = document.querySelector('.tab-content.active');
      if (!active) return;
      active.classList.remove('tab-soft-enter');
      // Force reflow so the animation re-runs.
      void active.offsetWidth;
      active.classList.add('tab-soft-enter');
      setTimeout(function () {
        if (active) active.classList.remove('tab-soft-enter');
      }, 700);
    } catch (err) {
      /* no-op */
    }
  }
  // Scroll the tab nav + active content into view after every switch.
  // Lands the user inside the analyzer when they click LAUNCH ANALYZER
  // on the intro hero. Idempotent on tab-bar clicks.
  function scrollToActiveTab() {
    try {
      var nav = document.getElementById('tabsNav');
      if (!nav) return;
      var rect = nav.getBoundingClientRect();
      if (rect.top < 0 || rect.top > window.innerHeight - 40) {
        nav.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      /* no-op */
    }
  }
  window.switchTab = function (name) {
    hideHeroIntro();
    origSwitch(name);
    // Defer scroll + fade so origSwitch + renderers finish first.
    setTimeout(function () {
      scrollToActiveTab();
      softFadeActiveTab();
    }, 0);
    if (name === 'reports') {
      var el = document.getElementById('tab-reports');
      if (el && typeof ReportGenerator !== 'undefined') {
        el.innerHTML = ReportGenerator.renderReportTab();
        if (ReportGenerator._renderCircularsList) {
          const cl = document.getElementById('circularsList');
          if (cl) cl.innerHTML = ReportGenerator._renderCircularsList();
        }
        if (ReportGenerator._renderMeetingsList) {
          const ml = document.getElementById('meetingsList');
          if (ml) ml.innerHTML = ReportGenerator._renderMeetingsList();
        }
      }
    }
    if (name === 'monitor') {
      var el = document.getElementById('tab-monitor');
      if (el && typeof RegulatoryMonitor !== 'undefined')
        el.innerHTML = RegulatoryMonitor.renderMonitorDashboard();
    }
    if (name === 'integrations') {
      var el = document.getElementById('tab-integrations');
      if (el && typeof IntegrationsEnhanced !== 'undefined')
        el.innerHTML = IntegrationsEnhanced.renderStatusDashboard();
    }
    if (name === 'goaml') {
      var el = document.getElementById('tab-goaml');
      if (el && typeof GoAMLExport !== 'undefined') el.innerHTML = GoAMLExport.renderGoAMLPanel();
    }
    if (name === 'threshold') {
      var el = document.getElementById('tab-threshold');
      if (el && typeof ThresholdMonitor !== 'undefined')
        el.innerHTML = ThresholdMonitor.renderThresholdPanel();
    }
    if (name === 'supplychain') {
      var el = document.getElementById('tab-supplychain');
      if (el && typeof SupplyChain !== 'undefined')
        el.innerHTML = SupplyChain.renderSupplyChainTab();
    }
    if (name === 'tfs') {
      var el = document.getElementById('tab-tfs');
      if (el && typeof TFSRefresh !== 'undefined') el.innerHTML = TFSRefresh.renderTFSPanel();
    }
    if (name === 'approvals') {
      var el = document.getElementById('tab-approvals');
      if (el && typeof ManagementApprovals !== 'undefined')
        el.innerHTML = ManagementApprovals.renderApprovalsTab();
    }
    if (name === 'regchanges') {
      var el = document.getElementById('tab-regchanges');
      if (el && typeof RegulatoryMonitor !== 'undefined')
        el.innerHTML = RegulatoryMonitor.renderChangeTrackerTab();
    }
    if (name === 'workflows') {
      var el = document.getElementById('tab-workflows');
      if (el && typeof WorkflowEngine !== 'undefined')
        el.innerHTML = WorkflowEngine.renderWorkflowsTab();
    }
    if (name === 'pipeline') {
      var el = document.getElementById('tab-pipeline');
      if (el && typeof CompliancePipeline !== 'undefined')
        el.innerHTML = CompliancePipeline.renderPipelineTab();
    }
    if (name === 'intelligence') {
      var el = document.getElementById('tab-intelligence');
      if (el && typeof ComplianceIntelligence !== 'undefined')
        el.innerHTML = ComplianceIntelligence.renderIntelligenceTab();
    }
    if (name === 'metalstrading') {
      if (typeof mtInit === 'function') mtInit();
    }
  };

  // Handle URL-hash deep links. Used by the landing pages (logistics.html,
  // compliance-ops.html, workbench.html) that embed index.html in an iframe
  // and switch sub-tabs by rewriting the iframe hash. Fires on load AND on
  // hashchange so the embedded tab follows the parent's navigation.
  var HASH_TAB_MAP = {
    '#metals-trading': 'metalstrading',
    '#metalstrading': 'metalstrading',
    '#shipments': 'shipments',
    '#tab-shipments': 'shipments',
    '#tracking': 'tracking',
    '#tab-tracking': 'tracking',
    '#localshipments': 'localshipments',
    '#tab-localshipments': 'localshipments',
    '#training': 'training',
    '#tab-training': 'training',
    '#employees': 'employees',
    '#tab-employees': 'employees',
    '#incidents': 'incidents',
    '#tab-incidents': 'incidents',
    '#reports': 'reports',
    '#tab-reports': 'reports',
    '#asana': 'asana',
    '#tab-asana': 'asana',
    '#onboarding': 'onboarding',
    '#tab-onboarding': 'onboarding',
    '#approvals': 'approvals',
    '#tab-approvals': 'approvals',
    // Landing-page surface deep-links (workbench / logistics / compliance-ops).
    // Each hash maps to an existing `tab-<id>` block in index.html so
    // switchTab() will activate it when the iframe loads with the
    // corresponding deep-link hash.
    '#iarreport': 'iarreport',
    '#tab-iarreport': 'iarreport',
    '#riskassessment': 'riskassessment',
    '#tab-riskassessment': 'riskassessment',
    '#calendar': 'calendar',
    '#tab-calendar': 'calendar',
    '#monitor': 'monitor',
    '#tab-monitor': 'monitor',
    '#integrations': 'integrations',
    '#tab-integrations': 'integrations',
    '#supplychain': 'supplychain',
    '#tab-supplychain': 'supplychain',
    '#workflows': 'workflows',
    '#tab-workflows': 'workflows',
    '#pipeline': 'pipeline',
    '#tab-pipeline': 'pipeline',
    '#customer360': 'customer360',
    '#tab-customer360': 'customer360',
    '#esg': 'esg',
    '#tab-esg': 'esg',
    '#redflags': 'redflags',
    '#tab-redflags': 'redflags',
    '#aigovern': 'aigovern',
    '#tab-aigovern': 'aigovern',
    '#ai-govern': 'aigovern',
    '#approvedaccounts': 'approvedaccounts',
    '#tab-approvedaccounts': 'approvedaccounts',
    '#approved-accounts': 'approvedaccounts',
    // Screening-command landing slugs. Cards on screening-command.html
    // open the embedded iframe with these hashes; without these entries
    // the matching index.html tab never activates and the iframe shows
    // whatever tab was last rendered (FDL Art.20-21 — the screening
    // surface must always reflect the URL the operator deep-linked to).
    '#screening': 'screening',
    '#tab-screening': 'screening',
    '#subject-screening': 'screening',
    '#transaction-monitor': 'screening',
    '#str': 'incidents',
    '#str-cases': 'incidents',
    '#watchlist': 'screening',
    // Aliases for the two main-page Operations Surface deep links so
    // anchor href="#trading" and href="#integrations" both resolve.
    '#trading': 'metalstrading',
  };
  function applyHashRoute() {
    var hash = window.location.hash;
    if (!hash) return;
    var target = HASH_TAB_MAP[hash];
    if (target && typeof window.switchTab === 'function') {
      window.switchTab(target);
    }
  }
  setTimeout(applyHashRoute, 500);
  window.addEventListener('hashchange', applyHashRoute);

  // Path-based deep links for the two main-page Operations Surface cards
  // on index.html. Netlify status-200 rewrites map /integrations and
  // /trading to the root index.html body while keeping the clean URL in
  // the address bar; this handler reads location.pathname and activates
  // the matching tab + scrolls it into view. Without it, /integrations
  // would silently load index.html with the (already-default) integrations
  // tab and the user would see no visible response — the original
  // P0-blocking behaviour.
  //
  // Regulatory basis: FDL No.10/2025 Art.20 (CO must be able to deep-
  // link to a specific surface for evidence) & Art.24 (every surface
  // visit becomes a distinct URL the 10-year audit trail can reference).
  var PATH_TAB_MAP = {
    '/integrations': 'integrations',
    '/trading': 'metalstrading',
  };
  function applyPathRoute() {
    var path = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
    var target = PATH_TAB_MAP[path];
    if (!target || typeof window.switchTab !== 'function') return;
    window.switchTab(target);
    // Scroll the activated tab into view so the user can see the surface
    // they asked for. requestAnimationFrame waits for the tab content to
    // mount (switchTab toggles classes synchronously, but content
    // injection inside switchTab can happen after layout).
    requestAnimationFrame(function () {
      var el = document.getElementById('tab-' + target);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
  setTimeout(applyPathRoute, 500);
  window.addEventListener('popstate', applyPathRoute);

  // The legacy "rehydrate hero-dismissed state on reload" block lived
  // here. After PR #334 the `#heroIntro` section became the entire
  // main-page landing surface (Operations Surface cards + summary +
  // regulatory strip), so persisting the dismissal across reloads left
  // the user staring at a blank viewport below the header. The flag is
  // proactively cleared inside hideHeroIntro() so any browser tab
  // carrying the stale value self-heals on the next interaction.
  try { sessionStorage.removeItem('heroIntroDismissed'); } catch (err) { /* ignore */ }

  // Auto-migrate localStorage to IndexedDB on first load
  if (typeof ComplianceDB !== 'undefined') {
    ComplianceDB.migrateFromLocalStorage().catch(function () {});
  }
})();

// Service worker disabled — Netlify no-cache headers handle freshness
