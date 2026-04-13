/**
 * goAML XML Export Module v1.0
 * Generates UAE FIU goAML-compliant XML for STR/SAR/CTR filing.
 * Supports: STR (Suspicious Transaction Report), SAR (Suspicious Activity Report),
 *           CTR (Cash Transaction Report), FFR (Funds Freeze Report)
 */
const GoAMLExport = (function() {
  'use strict';

  const REPORT_TYPES = {
    STR: { code: 'STR', name: 'Suspicious Transaction Report', goamlType: 'STR' },
    SAR: { code: 'SAR', name: 'Suspicious Activity Report', goamlType: 'SAR' },
    FFR: { code: 'FFR', name: 'Funds Freeze Report', goamlType: 'FFR' },
    AIF: { code: 'AIF', name: 'Additional Information Form', goamlType: 'AIF' },
    AIFT: { code: 'AIFT', name: 'Additional Information Follow-up', goamlType: 'AIFT' },
    DPMSR: { code: 'DPMSR', name: 'DPMS Suspicious Report', goamlType: 'DPMSR' },
    HRC: { code: 'HRC', name: 'High Risk Customer Report', goamlType: 'HRC' },
    HRCA: { code: 'HRCA', name: 'High Risk Customer Activity', goamlType: 'HRCA' },
    PNMR: { code: 'PNMR', name: 'Partial Name Match Report', goamlType: 'PNMR' },
  };

  const STORAGE_KEY = 'fgl_goaml_reports';

  function escapeXml(str) {
    if (str === null || str === undefined || str === '') return '';
    return String(str)
      // Strip XML 1.0 forbidden control characters. U+0009, U+000A, U+000D
      // are the only permitted low-range code points. Any other control
      // character will cause the FIU parser to reject the filing.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/[\uFEFF]/g, '') // drop BOM
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Return YYYY-MM-DD in Asia/Dubai local time, not UTC. Prevents off-by-one
  // drift when STRs are generated between 00:00 and 03:59 GST.
  function uaeDateOnly(d) {
    var dt = d ? new Date(d) : new Date();
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
    } catch (_) {
      return dt.toISOString().slice(0, 10);
    }
  }

  function validateDate(dateStr) {
    if (!dateStr) return '';
    var d = String(dateStr).trim();
    var year, month, day;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
      var p = d.split('/');
      day = parseInt(p[0], 10); month = parseInt(p[1], 10); year = parseInt(p[2], 10);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
      var q = d.slice(0, 10).split('-');
      year = parseInt(q[0], 10); month = parseInt(q[1], 10); day = parseInt(q[2], 10);
    } else {
      return '';
    }
    // Semantic validation — reject 31/02, 29/02/2025, etc.
    var parsed = new Date(year, month - 1, day);
    if (parsed.getDate() !== day || parsed.getMonth() !== month - 1 || parsed.getFullYear() !== year) {
      return '';
    }
    var iso = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    // Reject future dates using Asia/Dubai "today" as the reference —
    // not UTC, because STRs generated at 02:30 GST would otherwise reject
    // a valid same-day transaction.
    var todayUae = uaeDateOnly();
    if (iso > todayUae) {
      console.warn('[goAML] Future date rejected: ' + iso + ' (today GST: ' + todayUae + ')');
      return '';
    }
    return iso;
  }

  function generateReportId() {
    var rand = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint8Array(3))).map(function(b){return b.toString(16).padStart(2,'0')}).join('').toUpperCase()
      : Math.random().toString(36).slice(2, 8).toUpperCase();
    return 'RPT-' + Date.now().toString(36).toUpperCase() + '-' + rand;
  }

  function getReporterInfo() {
    // Pull from active company profile if available
    let companies; try { companies = JSON.parse(localStorage.getItem('fgl_companies') || '[]'); } catch(_) { companies = []; }
    const activeIdx = Number(localStorage.getItem('fgl_active_company') || '0');
    const company = companies[activeIdx] || {};
    return {
      entityName: company.name || 'Reporting Entity',
      entityId: company.licenseNo || '',
      country: 'AE',
      city: company.city || 'Dubai',
      contactPerson: company.complianceOfficer || '',
      phone: company.phone || '',
      email: company.email || '',
    };
  }

  function buildSTRXml(data) {
    const reporter = getReporterInfo();
    const reportId = generateReportId();
    const now = new Date().toISOString();
    const dateOnly = uaeDateOnly();

    // Validate the transaction date BEFORE building XML; refuse to silently
    // fall back to today if the operator typed an invalid or future date.
    var txDate = validateDate(data.transactionDate);
    if (data.transactionDate && !txDate) {
      throw new Error('[goAML STR] Invalid transaction date: "' + data.transactionDate + '". Please correct and retry.');
    }
    if (!txDate) txDate = dateOnly;

    return `<?xml version="1.0" encoding="UTF-8"?>
<goAMLReport>
  <reportHeader>
    <reportId>${escapeXml(reportId)}</reportId>
    <reportType>${escapeXml(data.reportType || 'STR')}</reportType>
    <reportDate>${dateOnly}</reportDate>
    <reportStatus>NEW</reportStatus>
    <priority>${escapeXml(data.priority || 'HIGH')}</priority>
    <currency>${escapeXml(data.currency || 'AED')}</currency>
    <reportingCountry>AE</reportingCountry>
  </reportHeader>

  <reportingEntity>
    <entityName>${escapeXml(reporter.entityName)}</entityName>
    <entityIdentification>${escapeXml(reporter.entityId)}</entityIdentification>
    <entityType>DPMS</entityType>
    <country>${escapeXml(reporter.country)}</country>
    <city>${escapeXml(reporter.city)}</city>
    <contactPerson>
      <name>${escapeXml(reporter.contactPerson)}</name>
      <phone>${escapeXml(reporter.phone)}</phone>
      <email>${escapeXml(reporter.email)}</email>
    </contactPerson>
  </reportingEntity>

  <suspiciousSubject>
    <subjectType>${escapeXml(data.subjectType || 'INDIVIDUAL')}</subjectType>
    <fullName>${escapeXml(data.subjectName)}</fullName>
    <dateOfBirth>${escapeXml(data.subjectDob || '')}</dateOfBirth>
    <nationality>${escapeXml(data.subjectNationality || '')}</nationality>
    <idType>${escapeXml(data.subjectIdType || 'PASSPORT')}</idType>
    <idNumber>${escapeXml(data.subjectIdNumber || '')}</idNumber>
    <occupation>${escapeXml(data.subjectOccupation || '')}</occupation>
    <address>
      <street>${escapeXml(data.subjectAddress || '')}</street>
      <city>${escapeXml(data.subjectCity || '')}</city>
      <country>${escapeXml(data.subjectCountry || '')}</country>
    </address>
    <accountInfo>
      <accountNumber>${escapeXml(data.accountNumber || '')}</accountNumber>
      <bankName>${escapeXml(data.bankName || '')}</bankName>
    </accountInfo>
  </suspiciousSubject>

  <transactionDetails>
    <transactionDate>${escapeXml(txDate)}</transactionDate>
    <transactionType>${escapeXml(data.transactionType || 'PURCHASE')}</transactionType>
    <amount>${escapeXml(String(data.amount || '0'))}</amount>
    <currency>${escapeXml(data.currency || 'AED')}</currency>
    <amountLocal>${escapeXml(String(data.amountLocal || data.amount || ''))}</amountLocal>
    <currencyLocal>AED</currencyLocal>
    <conductedBy>${escapeXml(data.conductedBy || data.subjectName || '')}</conductedBy>
    <commodityType>${escapeXml(data.commodityType || 'PRECIOUS_METALS')}</commodityType>
    <commodityDescription>${escapeXml(data.commodityDescription || '')}</commodityDescription>
    <paymentMethod>${escapeXml(data.paymentMethod || 'CASH')}</paymentMethod>
    <originCountry>${escapeXml(data.originCountry || '')}</originCountry>
    <destinationCountry>${escapeXml(data.destinationCountry || 'AE')}</destinationCountry>
  </transactionDetails>

  <groundsForSuspicion>
    <indicators>${escapeXml(data.indicators)}</indicators>
    <narrativeDescription>${escapeXml(data.narrative || '')}</narrativeDescription>
    <redFlagCategories>
${(data.redFlags || []).map(f => `      <flag>${escapeXml(f)}</flag>`).join('\n')}
    </redFlagCategories>
    <actionsTaken>${escapeXml(data.actionsTaken || 'Filed STR with UAE FIU via goAML')}</actionsTaken>
    <internalCaseRef>${escapeXml(data.caseRef || '')}</internalCaseRef>
  </groundsForSuspicion>

  <relatedReports>
${(data.relatedReports || []).map(r => `    <reportRef>${escapeXml(r)}</reportRef>`).join('\n')}
  </relatedReports>

  <attachments>
${(data.attachments || []).map(a => `    <attachment>
      <fileName>${escapeXml(a.name)}</fileName>
      <fileType>${escapeXml(a.type)}</fileType>
      <description>${escapeXml(a.description || '')}</description>
    </attachment>`).join('\n')}
  </attachments>

  <reportFooter>
    <generatedBy>Hawkeye Sterling V2</generatedBy>
    <generatedAt>${now}</generatedAt>
    <disclaimer>This report was generated by an automated compliance tool. All information should be verified by the designated Compliance Officer before submission to the UAE FIU via goAML.</disclaimer>
  </reportFooter>
</goAMLReport>`;
  }

  function buildCTRXml(data) {
    const reporter = getReporterInfo();
    const reportId = generateReportId();
    const now = new Date().toISOString();
    const dateOnly = uaeDateOnly();

    var txDate = validateDate(data.transactionDate);
    if (data.transactionDate && !txDate) {
      throw new Error('[goAML CTR] Invalid transaction date: "' + data.transactionDate + '". Please correct and retry.');
    }
    if (!txDate) txDate = dateOnly;

    return `<?xml version="1.0" encoding="UTF-8"?>
<goAMLReport>
  <reportHeader>
    <reportId>${escapeXml(reportId)}</reportId>
    <reportType>CTR</reportType>
    <reportDate>${dateOnly}</reportDate>
    <reportStatus>NEW</reportStatus>
    <currency>${escapeXml(data.currency || 'AED')}</currency>
    <reportingCountry>AE</reportingCountry>
    <thresholdBasis>UAE FDL No.10/2025 Art.24 — AED 55,000 DPMS threshold</thresholdBasis>
  </reportHeader>

  <reportingEntity>
    <entityName>${escapeXml(reporter.entityName)}</entityName>
    <entityIdentification>${escapeXml(reporter.entityId)}</entityIdentification>
    <entityType>DPMS</entityType>
    <country>${escapeXml(reporter.country)}</country>
    <city>${escapeXml(reporter.city)}</city>
  </reportingEntity>

  <transactingParty>
    <partyType>${escapeXml(data.subjectType || 'INDIVIDUAL')}</partyType>
    <fullName>${escapeXml(data.subjectName)}</fullName>
    <nationality>${escapeXml(data.subjectNationality || '')}</nationality>
    <idType>${escapeXml(data.subjectIdType || 'PASSPORT')}</idType>
    <idNumber>${escapeXml(data.subjectIdNumber || '')}</idNumber>
  </transactingParty>

  <cashTransaction>
    <transactionDate>${escapeXml(txDate)}</transactionDate>
    <cashAmount>${escapeXml(String(data.amount || '0'))}</cashAmount>
    <currency>${escapeXml(data.currency || 'AED')}</currency>
    <transactionType>${escapeXml(data.transactionType || 'PURCHASE')}</transactionType>
    <commodityType>${escapeXml(data.commodityType || 'GOLD')}</commodityType>
    <commodityWeight>${escapeXml(data.commodityWeight || '')}</commodityWeight>
    <commodityPurity>${escapeXml(data.commodityPurity || '')}</commodityPurity>
  </cashTransaction>

  <reportFooter>
    <generatedBy>Hawkeye Sterling V2</generatedBy>
    <generatedAt>${now}</generatedAt>
  </reportFooter>
</goAMLReport>`;
  }

  function saveReport(report) {
    let list; try { list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(_) { list = []; }
    list.unshift(report);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
  }

  function getReports() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(_) { return []; }
  }

  function downloadXml(xml, filename) {
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Pre-submission validation gate. Runs the browser mirror of
   * src/utils/goamlValidator.ts (loaded via goaml-validator-bridge.js)
   * and refuses to emit any XML that fails.
   *
   * If the validator bridge is not loaded, the exporter REFUSES to produce
   * XML — regulatory-critical artifacts must never ship unvalidated.
   *
   * Regulatory: FDL No.10/2025 Art.26-27 (STR), Art.29 (no tipping off),
   *             UAE FIU goAML Schema.
   */
  function assertValidOrThrow(xml, reportType) {
    var validator = typeof window !== 'undefined' ? window.GoAMLValidator : null;
    if (!validator || typeof validator.validateReport !== 'function') {
      var msg = '[goAML] Validator bridge not loaded (window.GoAMLValidator). '
        + 'Refusing to emit goAML XML — unvalidated regulatory artifacts must not '
        + 'leave this browser. Ensure <script src="goaml-validator-bridge.js"> is '
        + 'loaded before goaml-export.js in index.html.';
      console.error(msg);
      if (typeof toast === 'function') toast('goAML validator not loaded — export blocked', 'error');
      throw new Error(msg);
    }
    var result = validator.validateReport(xml, reportType);
    if (!result.valid) {
      var summary = result.errors.map(function (e) { return '[' + e.field + '] ' + e.message; }).join('; ');
      var blockMsg = '[goAML] ' + reportType + ' validation FAILED: ' + summary;
      console.error(blockMsg, result.errors);
      if (typeof toast === 'function') toast('goAML ' + reportType + ' invalid — ' + summary, 'error');
      if (typeof logAudit === 'function') logAudit('goaml', 'Rejected invalid ' + reportType + ': ' + summary);
      throw new Error(blockMsg);
    }
  }

  function exportSTR(data) {
    const xml = buildSTRXml(data);
    assertValidOrThrow(xml, 'STR');
    const reportId = xml.match(/<reportId>(.*?)<\/reportId>/)?.[1] || 'UNKNOWN';
    const filename = `goAML_STR_${reportId}_${new Date().toISOString().slice(0,10)}.xml`;
    downloadXml(xml, filename);
    saveReport({ id: reportId, type: 'STR', subject: data.subjectName, amount: data.amount, date: new Date().toISOString(), filename });
    return { xml, reportId, filename };
  }

  function exportCTR(data) {
    const xml = buildCTRXml(data);
    assertValidOrThrow(xml, 'CTR');
    const reportId = xml.match(/<reportId>(.*?)<\/reportId>/)?.[1] || 'UNKNOWN';
    const filename = `goAML_CTR_${reportId}_${new Date().toISOString().slice(0,10)}.xml`;
    downloadXml(xml, filename);
    saveReport({ id: reportId, type: 'CTR', subject: data.subjectName, amount: data.amount, date: new Date().toISOString(), filename });
    return { xml, reportId, filename };
  }

  function renderGoAMLPanel() {
    const reports = getReports();
    const recentHtml = reports.slice(0, 10).map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <div>
          <span class="badge ${r.type === 'STR' ? 'b-r' : 'b-a'}">${r.type}</span>
          <span style="font-size:12px;margin-left:6px">${r.subject || 'Unknown'}</span>
          <span style="font-size:11px;color:var(--muted);margin-left:8px">${r.amount ? 'USD ' + Number(r.amount).toLocaleString('en-GB') : ''}</span>
        </div>
        <div style="font-size:11px;color:var(--muted)">${new Date(r.date).toLocaleDateString('en-GB')}</div>
      </div>
    `).join('') || '<p style="color:var(--muted);font-size:13px">No goAML reports generated yet.</p>';

    return `
      <div class="card">
        <div class="top-bar" style="margin-bottom:10px">
          <span class="lbl" style="margin:0">goAML XML Export</span>
          <span style="font-size:11px;color:var(--muted);font-family:'Montserrat',sans-serif">UAE FIU compliant STR/CTR XML generation</span>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Generate goAML-schema XML files for direct upload to the UAE FIU portal. Supports STR, SAR, CTR, and FFR report types.</p>

        <div class="row row-2" style="margin-bottom:8px">
          <div><span class="lbl">Report Type</span>
            <select id="goamlReportType">
              <option value="STR">STR — Suspicious Transaction Report</option>
              <option value="SAR">SAR — Suspicious Activity Report</option>
              <option value="FFR">FFR — Funds Freeze Report</option>
              <option value="AIF">AIF — Additional Information Form</option>
              <option value="AIFT">AIFT — Additional Information Follow-up</option>
              <option value="DPMSR">DPMSR — DPMS Suspicious Report</option>
              <option value="HRC">HRC — High Risk Customer Report</option>
              <option value="HRCA">HRCA — High Risk Customer Activity</option>
              <option value="PNMR">PNMR — Partial Name Match Report</option>
            </select>
          </div>
          <div><span class="lbl">Priority</span>
            <select id="goamlPriority"><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select>
          </div>
        </div>

        <div class="row row-3" style="margin-bottom:8px">
          <div><span class="lbl">Subject Full Name</span><input type="text" id="goamlSubjectName" placeholder="Full legal name" /></div>
          <div><span class="lbl">Subject Type</span><select id="goamlSubjectType"><option value="INDIVIDUAL">Individual</option><option value="LEGAL_ENTITY">Legal Entity</option></select></div>
          <div><span class="lbl">Nationality</span><input type="text" id="goamlNationality" placeholder="e.g. AE, IN, PK" /></div>
        </div>

        <div class="row row-3" style="margin-bottom:8px">
          <div><span class="lbl">ID Type</span><select id="goamlIdType"><option value="PASSPORT">Passport</option><option value="EMIRATES_ID">Emirates ID</option><option value="TRADE_LICENSE">Trade License</option><option value="OTHER">Other</option></select></div>
          <div><span class="lbl">ID Number</span><input type="text" id="goamlIdNumber" placeholder="Document number" /></div>
          <div><span class="lbl">Date of Birth</span><input type="text" id="goamlDob" placeholder="dd/mm/yyyy" oninput="if(window.csFormatDateInput)csFormatDateInput(this);else if(window.maFormatDateInput)maFormatDateInput(this)" maxlength="10" /></div>
        </div>

        <div class="row row-3" style="margin-bottom:8px">
          <div><span class="lbl">Transaction Amount</span><input type="number" id="goamlAmount" placeholder="Amount" /></div>
          <div><span class="lbl">Currency</span><select id="goamlCurrency"><option value="USD">USD</option><option value="AED">AED</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></div>
          <div><span class="lbl">Transaction Date</span><input type="text" id="goamlTxDate" placeholder="dd/mm/yyyy" oninput="if(window.csFormatDateInput)csFormatDateInput(this);else if(window.maFormatDateInput)maFormatDateInput(this)" maxlength="10" /></div>
        </div>

        <div class="row row-2" style="margin-bottom:8px">
          <div><span class="lbl">Transaction Type</span><select id="goamlTxType"><option value="PURCHASE">Purchase</option><option value="SALE">Sale</option><option value="TRANSFER">Transfer</option><option value="EXCHANGE">Exchange</option><option value="REFINING">Refining</option></select></div>
          <div><span class="lbl">Payment Method</span><select id="goamlPayment"><option value="CASH">Cash</option><option value="WIRE">Wire Transfer</option><option value="CHEQUE">Cheque</option><option value="CRYPTO">Cryptocurrency</option><option value="OTHER">Other</option></select></div>
        </div>

        <div class="row row-2" style="margin-bottom:8px">
          <div><span class="lbl">Commodity Type</span><select id="goamlCommodity"><option value="GOLD">Gold</option><option value="SILVER">Silver</option><option value="PLATINUM">Platinum</option><option value="OTHER">Other</option></select></div>
          <div><span class="lbl">Origin Country</span><input type="text" id="goamlOriginCountry" placeholder="e.g. CH, ZA, GH" /></div>
        </div>

        <div style="margin-bottom:8px">
          <span class="lbl">Suspicious Indicators / Grounds</span>
          <textarea id="goamlIndicators" placeholder="Describe suspicious indicators, red flags, and grounds for reporting..." style="min-height:60px"></textarea>
        </div>

        <div style="margin-bottom:8px">
          <span class="lbl">Narrative Description</span>
          <textarea id="goamlNarrative" placeholder="Full narrative of circumstances..." style="min-height:60px"></textarea>
        </div>

        <div style="margin-bottom:12px">
          <span class="lbl">Internal Case Reference</span>
          <input type="text" id="goamlCaseRef" placeholder="e.g. CASE-2026-001" />
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gold" data-action="GoAMLExport.generateAndDownload">Generate goAML XML</button>
          <button class="btn btn-sm btn-blue" data-action="GoAMLExport.previewXml">Preview XML</button>
          <button class="btn btn-sm btn-blue" data-action="GoAMLExport.populateFromSTR">Import from STR Draft</button>
          <button class="btn btn-sm btn-red" data-action="GoAMLExport.cancelForm">Cancel</button>
        </div>

        <div id="goamlPreview" style="display:none;margin-top:12px"></div>
      </div>

      <div class="card">
        <span class="lbl">Recent goAML Exports</span>
        <div id="goamlReportHistory">${recentHtml}</div>
      </div>
    `;
  }

  function getFormData() {
    const byId = id => document.getElementById(id);
    return {
      reportType: byId('goamlReportType')?.value || 'STR',
      priority: byId('goamlPriority')?.value || 'HIGH',
      subjectName: byId('goamlSubjectName')?.value?.trim() || '',
      subjectType: byId('goamlSubjectType')?.value || 'INDIVIDUAL',
      subjectNationality: byId('goamlNationality')?.value?.trim() || '',
      subjectIdType: byId('goamlIdType')?.value || 'PASSPORT',
      subjectIdNumber: byId('goamlIdNumber')?.value?.trim() || '',
      subjectDob: byId('goamlDob')?.value || '',
      amount: byId('goamlAmount')?.value || '',
      currency: byId('goamlCurrency')?.value || 'USD',
      transactionDate: byId('goamlTxDate')?.value || '',
      transactionType: byId('goamlTxType')?.value || 'PURCHASE',
      paymentMethod: byId('goamlPayment')?.value || 'CASH',
      commodityType: byId('goamlCommodity')?.value || 'GOLD',
      originCountry: byId('goamlOriginCountry')?.value?.trim() || '',
      indicators: byId('goamlIndicators')?.value?.trim() || '',
      narrative: byId('goamlNarrative')?.value?.trim() || '',
      caseRef: byId('goamlCaseRef')?.value?.trim() || '',
    };
  }

  function generateAndDownload() {
    const data = getFormData();
    if (!data.subjectName) { toast('Enter subject name', 'error'); return; }
    if (!data.indicators && data.reportType !== 'CTR') { toast('Enter suspicious indicators', 'error'); return; }

    let result;
    try {
      if (data.reportType === 'CTR') {
        result = exportCTR(data);
      } else {
        result = exportSTR(data);
      }
    } catch (err) {
      // assertValidOrThrow already surfaced a toast + audit log. Abort the UI
      // update so the operator is NOT shown a false "success" message for
      // an unvalidated / rejected regulatory artifact.
      return;
    }

    toast(`goAML ${data.reportType} exported: ${result.filename}`, 'success');
    if (typeof logAudit === 'function') logAudit('goaml', `Generated ${data.reportType} for ${data.subjectName} (${result.reportId})`);

    // Refresh history
    const histEl = document.getElementById('goamlReportHistory');
    if (histEl) {
      const reports = getReports();
      histEl.innerHTML = reports.slice(0, 10).map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <div>
            <span class="badge ${r.type === 'STR' ? 'b-r' : 'b-a'}">${r.type}</span>
            <span style="font-size:12px;margin-left:6px">${r.subject || 'Unknown'}</span>
          </div>
          <div style="font-size:11px;color:var(--muted)">${new Date(r.date).toLocaleDateString('en-GB')}</div>
        </div>
      `).join('');
    }
  }

  function previewXml() {
    const data = getFormData();
    if (!data.subjectName) { toast('Enter subject name first', 'error'); return; }
    const xml = data.reportType === 'CTR' ? buildCTRXml(data) : buildSTRXml(data);
    const el = document.getElementById('goamlPreview');
    if (el) {
      el.style.display = 'block';
      el.innerHTML = `<div class="summary-box" style="white-space:pre-wrap;font-size:11px;font-family:'Montserrat',sans-serif;max-height:400px;overflow-y:auto">${escapeXml(xml)}</div>
        <button class="btn btn-sm btn-green" style="margin-top:6px" data-action="GoAMLExport.copyPreviewXml">Copy XML</button>`;
    }
  }

  function populateFromSTR() {
    const strSubject = document.getElementById('strSubject');
    const strAmount = document.getElementById('strAmount');
    const strIndicators = document.getElementById('strIndicators');
    if (strSubject?.value) document.getElementById('goamlSubjectName').value = strSubject.value;
    if (strAmount?.value) document.getElementById('goamlAmount').value = strAmount.value;
    if (strIndicators?.value) document.getElementById('goamlIndicators').value = strIndicators.value;
    toast('Imported from STR draft fields', 'success');
  }

  function cancelForm() {
    const fields = ['goamlSubjectName','goamlSubjectId','goamlAmount','goamlTxDate','goamlOriginCountry','goamlIndicators','goamlNarrative','goamlCaseRef'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const selects = ['goamlReportType','goamlCurrency','goamlTxType','goamlPayment','goamlCommodity'];
    selects.forEach(id => { const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
    const preview = document.getElementById('goamlPreview');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
    toast('Form cleared', 'success');
  }

  function copyPreviewXml() {
    navigator.clipboard.writeText(document.querySelector('#goamlPreview .summary-box').textContent);
    toast('XML copied', 'success');
  }

  return {
    REPORT_TYPES,
    renderGoAMLPanel,
    generateAndDownload,
    previewXml,
    populateFromSTR,
    cancelForm,
    exportSTR,
    exportCTR,
    getReports,
    copyPreviewXml,
  };
})();
