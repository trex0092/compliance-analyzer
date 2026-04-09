// Wire all enhanced tabs into switchTab
(function() {
  var origSwitch = window.switchTab;
  window.switchTab = function(name) {
    origSwitch(name);
    if (name === 'reports') {
      var el = document.getElementById('tab-reports');
      if (el && typeof ReportGenerator !== 'undefined') {
        el.innerHTML = ReportGenerator.renderReportTab();
        if (ReportGenerator._renderCircularsList) { const cl=document.getElementById('circularsList'); if(cl) cl.innerHTML=ReportGenerator._renderCircularsList(); }
        if (ReportGenerator._renderMeetingsList) { const ml=document.getElementById('meetingsList'); if(ml) ml.innerHTML=ReportGenerator._renderMeetingsList(); }
      }
    }
    if (name === 'monitor') {
      var el = document.getElementById('tab-monitor');
      if (el && typeof RegulatoryMonitor !== 'undefined') el.innerHTML = RegulatoryMonitor.renderMonitorDashboard();
    }
    if (name === 'integrations') {
      var el = document.getElementById('tab-integrations');
      if (el && typeof IntegrationsEnhanced !== 'undefined') el.innerHTML = IntegrationsEnhanced.renderStatusDashboard();
    }
    if (name === 'goaml') {
      var el = document.getElementById('tab-goaml');
      if (el && typeof GoAMLExport !== 'undefined') el.innerHTML = GoAMLExport.renderGoAMLPanel();
    }
    if (name === 'threshold') {
      var el = document.getElementById('tab-threshold');
      if (el && typeof ThresholdMonitor !== 'undefined') el.innerHTML = ThresholdMonitor.renderThresholdPanel();
    }
    if (name === 'supplychain') {
      var el = document.getElementById('tab-supplychain');
      if (el && typeof SupplyChain !== 'undefined') el.innerHTML = SupplyChain.renderSupplyChainTab();
    }
    if (name === 'tfs') {
      var el = document.getElementById('tab-tfs');
      if (el && typeof TFSRefresh !== 'undefined') el.innerHTML = TFSRefresh.renderTFSPanel();
    }
    if (name === 'approvals') {
      var el = document.getElementById('tab-approvals');
      if (el && typeof ManagementApprovals !== 'undefined') el.innerHTML = ManagementApprovals.renderApprovalsTab();
    }
    if (name === 'regchanges') {
      var el = document.getElementById('tab-regchanges');
      if (el && typeof RegulatoryMonitor !== 'undefined') el.innerHTML = RegulatoryMonitor.renderChangeTrackerTab();
    }
    if (name === 'analytics') {
      var el = document.getElementById('tab-analytics');
      if (el && typeof AnalyticsDashboard !== 'undefined') {
        el.innerHTML = AnalyticsDashboard.renderAnalyticsTab();
        setTimeout(function() { AnalyticsDashboard.initCharts(); }, 50);
      }
    }
    if (name === 'workflows') {
      var el = document.getElementById('tab-workflows');
      if (el && typeof WorkflowEngine !== 'undefined') el.innerHTML = WorkflowEngine.renderWorkflowsTab();
    }
  };

  // Auto-migrate localStorage to IndexedDB on first load
  if (typeof ComplianceDB !== 'undefined') {
    ComplianceDB.migrateFromLocalStorage().catch(function(){});
  }
})();

// Service worker disabled — Netlify no-cache headers handle freshness
