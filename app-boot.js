// Wire all enhanced tabs into switchTab
(function () {
  var origSwitch = window.switchTab;
  // Hide the LAUNCH ANALYZER hero with a soft fade the first time
  // any tab switch happens. Persists for the session via sessionStorage.
  function hideHeroIntro() {
    try {
      var hero = document.getElementById('heroIntro');
      if (!hero) return;
      if (hero.classList.contains('hero-intro--gone')) return;
      hero.classList.add('hero-intro--gone');
      sessionStorage.setItem('heroIntroDismissed', '1');
      // After the transition removes the box, also remove from layout.
      setTimeout(function () {
        if (hero.parentNode) hero.style.display = 'none';
      }, 700);
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

  // Handle #metals-trading URL hash on page load
  setTimeout(function () {
    var hash = window.location.hash;
    if (hash === '#metals-trading' || hash === '#metalstrading') {
      window.switchTab('metalstrading');
    }
  }, 500);

  // If the hero was dismissed earlier in this session, keep it hidden
  // on reload so the user does not see it flash before the JS hides it.
  try {
    if (sessionStorage.getItem('heroIntroDismissed') === '1') {
      var hero = document.getElementById('heroIntro');
      if (hero) {
        hero.classList.add('hero-intro--gone');
        hero.style.display = 'none';
      }
    }
  } catch (err) {
    /* sessionStorage may be unavailable in private mode — ignore */
  }

  // Auto-migrate localStorage to IndexedDB on first load
  if (typeof ComplianceDB !== 'undefined') {
    ComplianceDB.migrateFromLocalStorage().catch(function () {});
  }
})();

// Service worker disabled — Netlify no-cache headers handle freshness
