/**
 * Threshold Monitor & CTR Workflow Module v1.0
 * UAE FDL No.10/2025 Art.24 — AED 55,000 DPMS cash transaction threshold
 * Auto-detects threshold breaches, structuring patterns, and generates CTR alerts.
 */
const ThresholdMonitor = (function() {
  'use strict';

  const AED_THRESHOLD = 55000;
  const USD_TO_AED = 3.6725; // Fixed peg
  const STRUCTURING_WINDOW_DAYS = 7;
  const STRUCTURING_COMBINED_FACTOR = 0.8; // 80% of threshold = suspicious if split
  const ALERTS_KEY = 'fgl_threshold_alerts';
  const CTR_QUEUE_KEY = 'fgl_ctr_queue';

  function getAlerts() { try { return JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]'); } catch(_) { return []; } }
  function saveAlerts(arr) { localStorage.setItem(ALERTS_KEY, JSON.stringify(arr.slice(0, 500))); }
  function getCTRQueue() { try { return JSON.parse(localStorage.getItem(CTR_QUEUE_KEY) || '[]'); } catch(_) { return []; } }
  function saveCTRQueue(arr) { localStorage.setItem(CTR_QUEUE_KEY, JSON.stringify(arr.slice(0, 200))); }

  function toAED(amount, currency) {
    if (!amount) return 0;
    const num = Number(amount);
    if (isNaN(num)) return 0;
    if (currency === 'AED') return num;
    if (currency === 'USD') return num * USD_TO_AED;
    if (currency === 'EUR') return num * USD_TO_AED * 1.10;
    if (currency === 'GBP') return num * USD_TO_AED * 1.30;
    return num * USD_TO_AED;
  }

  function scanShipments() {
    let shipments; try { shipments = JSON.parse(localStorage.getItem('fgl_shipments') || '[]'); } catch(_) { shipments = []; }
    const alerts = [];
    const now = new Date();

    // Group by customer
    const byCustomer = {};
    for (const s of shipments) {
      const cust = s.customerId || s.supplier || 'UNKNOWN';
      if (!byCustomer[cust]) byCustomer[cust] = [];
      byCustomer[cust].push(s);
    }

    for (const [customer, custShipments] of Object.entries(byCustomer)) {
      for (const s of custShipments) {
        const amountAED = toAED(s.valueUSD || s.value || 0, s.currency || 'USD');

        // Direct threshold breach
        if (amountAED >= AED_THRESHOLD && (s.paymentMethod || '').toLowerCase().includes('cash')) {
          alerts.push({
            id: 'THR-' + (s.id || Date.now()),
            type: 'THRESHOLD_BREACH',
            severity: 'CRITICAL',
            customer,
            shipmentId: s.id,
            amount: amountAED,
            currency: 'AED',
            date: s.date || s.shipmentDate,
            message: `Cash transaction AED ${amountAED.toLocaleString('en-GB')} exceeds DPMS threshold of AED ${AED_THRESHOLD.toLocaleString('en-GB')}. CTR filing required under FDL Art.24.`,
            requiresCTR: true,
            ctrStatus: 'PENDING',
          });
        }
      }

      // Structuring detection: multiple transactions by same customer within window
      const recentCash = custShipments
        .filter(s => (s.paymentMethod || '').toLowerCase().includes('cash'))
        .filter(s => {
          const d = new Date(s.date || s.shipmentDate);
          return (now - d) / 86400000 <= STRUCTURING_WINDOW_DAYS;
        });

      if (recentCash.length >= 2) {
        const totalAED = recentCash.reduce((sum, s) => sum + toAED(s.valueUSD || s.value || 0, s.currency || 'USD'), 0);
        const avgPerTx = totalAED / recentCash.length;
        const thresholdStructuring = AED_THRESHOLD * STRUCTURING_COMBINED_FACTOR;

        if (totalAED >= AED_THRESHOLD && avgPerTx < AED_THRESHOLD) {
          alerts.push({
            id: 'STR-' + customer + '-' + Date.now(),
            type: 'STRUCTURING_SUSPECTED',
            severity: 'HIGH',
            customer,
            amount: totalAED,
            currency: 'AED',
            txCount: recentCash.length,
            window: STRUCTURING_WINDOW_DAYS,
            date: new Date().toISOString(),
            message: `Potential structuring: ${recentCash.length} cash transactions totaling AED ${totalAED.toLocaleString('en-GB')} within ${STRUCTURING_WINDOW_DAYS} days. Individual amounts below threshold but combined exceeds AED ${AED_THRESHOLD.toLocaleString('en-GB')}.`,
            requiresCTR: false,
            requiresSTR: true,
          });
        }
      }
    }

    // Save new alerts (avoid duplicates by ID)
    const existing = getAlerts();
    const existingIds = new Set(existing.map(a => a.id));
    const newAlerts = alerts.filter(a => !existingIds.has(a.id));
    if (newAlerts.length > 0) {
      saveAlerts([...newAlerts, ...existing]);
      newAlerts.forEach(function(a) {
        if (typeof WorkflowEngine !== 'undefined') WorkflowEngine.processTrigger('threshold_breach', { type: a.type, severity: a.severity, customer: a.customer, amount: a.amountAED, details: a.description || a.type + ' — ' + a.customer });
      });
    }

    return { alerts: [...newAlerts, ...existing.filter(a => a.type === 'THRESHOLD_BREACH' || a.type === 'STRUCTURING_SUSPECTED')], newCount: newAlerts.length };
  }

  function queueCTR(alert) {
    const queue = getCTRQueue();
    queue.unshift({
      id: 'CTR-' + Date.now(),
      alertId: alert.id,
      customer: alert.customer,
      amount: alert.amount,
      currency: alert.currency,
      date: alert.date,
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
    });
    saveCTRQueue(queue);
    // Update alert status
    const alerts = getAlerts();
    const idx = alerts.findIndex(a => a.id === alert.id);
    if (idx >= 0) { alerts[idx].ctrStatus = 'QUEUED'; saveAlerts(alerts); }
    if (typeof toast === 'function') toast('CTR queued for filing', 'success');
  }

  function fileCTR(ctrId) {
    const queue = getCTRQueue();
    const idx = queue.findIndex(c => c.id === ctrId);
    if (idx < 0) return;
    queue[idx].status = 'FILED';
    queue[idx].filedAt = new Date().toISOString();
    saveCTRQueue(queue);

    // Generate goAML XML if available
    if (typeof GoAMLExport !== 'undefined') {
      GoAMLExport.exportCTR({
        subjectName: queue[idx].customer,
        amount: queue[idx].amount,
        currency: queue[idx].currency,
        transactionDate: queue[idx].date,
      });
    }

    if (typeof logAudit === 'function') logAudit('ctr', `CTR filed for ${queue[idx].customer} — AED ${queue[idx].amount}`);
    if (typeof toast === 'function') toast('CTR filed and goAML XML generated', 'success');
  }

  function renderThresholdPanel() {
    const result = scanShipments();
    const alerts = result.alerts;
    const ctrQueue = getCTRQueue();

    const alertsHtml = alerts.slice(0, 20).map(a => `
      <div style="padding:10px;border:1px solid ${a.severity === 'CRITICAL' ? 'var(--red)' : 'var(--amber)'};border-radius:3px;margin-bottom:8px;background:var(--surface2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <span class="badge ${a.severity === 'CRITICAL' ? 'b-r' : 'b-a'}">${a.type.replace('_', ' ')}</span>
            <span style="font-size:12px;font-weight:500;margin-left:8px">${a.customer}</span>
          </div>
          <span style="font-size:11px;color:var(--muted)">${a.date ? new Date(a.date).toLocaleDateString('en-GB') : ''}</span>
        </div>
        <p style="font-size:12px;margin:0 0 8px 0">${a.message}</p>
        <div style="display:flex;gap:6px">
          ${a.requiresCTR ? `<button class="btn btn-sm btn-gold" onclick="ThresholdMonitor.queueCTR(${JSON.stringify(a).replace(/"/g, '&quot;')})">Queue CTR Filing</button>` : ''}
          ${a.requiresSTR ? `<button class="btn btn-sm btn-green" onclick="switchTab('incidents');document.getElementById('strSubject').value='${a.customer}';document.getElementById('strAmount').value='${Math.round(a.amount / USD_TO_AED)}'">Draft STR</button>` : ''}
        </div>
      </div>
    `).join('') || '<p style="color:var(--muted);font-size:13px">No threshold alerts detected. All transactions within AED 55,000 DPMS limit.</p>';

    const ctrHtml = ctrQueue.slice(0, 10).map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <div>
          <span class="badge ${c.status === 'FILED' ? 'b-g' : 'b-a'}">${c.status}</span>
          <span style="font-size:12px;margin-left:6px">${c.customer}</span>
          <span style="font-size:11px;color:var(--muted);margin-left:6px">AED ${Number(c.amount).toLocaleString('en-GB')}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:11px;color:var(--muted)">${new Date(c.createdAt).toLocaleDateString('en-GB')}</span>
          ${c.status === 'QUEUED' ? `<button class="btn btn-sm btn-green" onclick="ThresholdMonitor.fileCTR('${c.id}')">File CTR</button>` : ''}
        </div>
      </div>
    `).join('') || '<p style="color:var(--muted);font-size:13px">No CTR filings in queue.</p>';

    return `
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">DPMS Threshold Monitor</span>
          <div style="display:flex;gap:6px;align-items:center">
            <span style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">UAE FDL Art.24 | AED 55,000</span>
            <button class="btn btn-sm btn-green" onclick="ThresholdMonitor.refresh()">Scan Now</button>
          </div>
        </div>
        <div class="token-note" style="margin-bottom:12px">
          <strong>Regulatory basis:</strong> UAE Federal Decree-Law No.10/2025, Article 24 requires Dealers in Precious Metals and Stones (DPMS) to file a Cash Transaction Report (CTR) for any cash transaction ≥ AED 55,000 (~USD 14,972). Structuring detection monitors split transactions designed to avoid the threshold.
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
          <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:var(--red)" id="tmAlertCount">${alerts.filter(a => a.severity === 'CRITICAL').length}</div>
            <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">Critical</div>
          </div>
          <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:var(--amber)" id="tmWarningCount">${alerts.filter(a => a.severity === 'HIGH').length}</div>
            <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">Warnings</div>
          </div>
          <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:var(--amber)">${ctrQueue.filter(c => c.status === 'QUEUED').length}</div>
            <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">CTR Pending</div>
          </div>
          <div style="background:var(--surface2);border-radius:3px;padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:var(--green)">${ctrQueue.filter(c => c.status === 'FILED').length}</div>
            <div style="font-size:10px;color:var(--muted);font-family:'Montserrat',sans-serif">CTR Filed</div>
          </div>
        </div>
        ${alertsHtml}
      </div>

      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">CTR Filing Queue</span>
          <span style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">Cash Transaction Reports pending goAML submission</span>
        </div>
        ${ctrHtml}
      </div>
    `;
  }

  function refresh() {
    const el = document.getElementById('tab-threshold');
    if (el) el.innerHTML = renderThresholdPanel();
  }

  return {
    AED_THRESHOLD,
    scanShipments,
    queueCTR,
    fileCTR,
    renderThresholdPanel,
    refresh,
  };
})();
