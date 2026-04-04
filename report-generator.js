/**
 * Report Generator Module — Compliance Analyser v2.3
 * PDF/DOCX report generation with templates, scheduling, and history
 */
(function () {
  'use strict';

  const REPORT_HISTORY_KEY = 'fgl_report_history';
  const REPORT_SCHEDULES_KEY = 'fgl_report_schedules';

  // Use global scoping if available (company isolation)
  function _sk(key) { return typeof scopeKey === 'function' ? scopeKey(key) : key; }
  function _parse(key, fb) { return typeof safeLocalParse === 'function' ? safeLocalParse(key, fb) : (function(){ try { return JSON.parse(localStorage.getItem(_sk(key))||JSON.stringify(fb)); } catch(_){ return fb; } })(); }
  function _save(key, val) { if (typeof safeLocalSave === 'function') safeLocalSave(key, val); else localStorage.setItem(_sk(key), JSON.stringify(val)); }
  function _remove(key) { if (typeof safeLocalRemove === 'function') safeLocalRemove(key); else localStorage.removeItem(_sk(key)); }

  const TEMPLATES = {
    executive: {
      name: 'Executive Summary',
      icon: '📋',
      sections: ['header', 'scorecard', 'keyFindings', 'riskOverview', 'recommendations', 'footer'],
    },
    gap_analysis: {
      name: 'Compliance Gap Analysis',
      icon: '🔍',
      sections: ['header', 'frameworkCoverage', 'gapDetails', 'remediationPlan', 'timeline', 'footer'],
    },
    audit: {
      name: 'Regulatory Audit Report',
      icon: '📊',
      sections: ['header', 'auditScope', 'findings', 'evidenceSummary', 'complianceMatrix', 'signoff', 'footer'],
    },
    risk: {
      name: 'Risk Assessment Report',
      icon: '⚠️',
      sections: ['header', 'riskMatrix', 'entityRisks', 'countryExposure', 'mitigations', 'footer'],
    },
    incident: {
      name: 'Incident Summary Report',
      icon: '🚨',
      sections: ['header', 'incidentOverview', 'timeline', 'rootCause', 'correctiveActions', 'footer'],
    },
    ewra_bwra: {
      name: 'EWRA / BWRA Risk Assessment',
      icon: '🛡️',
      sections: ['header', 'riskMethodology', 'inherentRisk', 'controlEffectiveness', 'residualRisk', 'riskMatrix', 'footer'],
    },
    cdd_review: {
      name: 'CDD Periodic Review',
      icon: '👤',
      sections: ['header', 'customerProfile', 'cddStatus', 'riskRating', 'eddRequirements', 'reviewDecision', 'footer'],
    },
    str_sar: {
      name: 'STR / SAR Filing Report',
      icon: '📤',
      sections: ['header', 'subjectDetails', 'transactionSummary', 'suspicionIndicators', 'redFlags', 'filingDecision', 'footer'],
    },
    sanctions_screening: {
      name: 'Sanctions Screening Report',
      icon: '🔒',
      sections: ['header', 'entityScreened', 'listsChecked', 'matchResults', 'falsePositiveAnalysis', 'escalation', 'footer'],
    },
    tfs_ffr: {
      name: 'TFS / Funds Freeze Report (FFR)',
      icon: '🚫',
      sections: ['header', 'matchDetails', 'assetFreeze', 'reportingTimeline', 'authorityNotification', 'footer'],
    },
    supplier_dd: {
      name: 'Supplier Due Diligence (KYS)',
      icon: '⛏️',
      sections: ['header', 'supplierProfile', 'cahraAssessment', 'lbmaCompliance', 'riskScoring', 'approvalDecision', 'footer'],
    },
    training: {
      name: 'Training Completion Report',
      icon: '🎓',
      sections: ['header', 'trainingOverview', 'attendanceList', 'completionRates', 'assessmentResults', 'gaps', 'footer'],
    },
    annual_compliance: {
      name: 'Annual Compliance Report',
      icon: '📅',
      sections: ['header', 'yearSummary', 'keyMetrics', 'strActivity', 'sanctionsActivity', 'trainingStatus', 'auditFindings', 'remediationProgress', 'footer'],
    },
    onboarding: {
      name: 'Customer Onboarding Report',
      icon: '🤝',
      sections: ['header', 'customerIdentification', 'cddVerification', 'uboIdentification', 'riskClassification', 'approvalRecord', 'footer'],
    },
    transaction_monitoring: {
      name: 'Transaction Monitoring Report',
      icon: '📈',
      sections: ['header', 'monitoringPeriod', 'alertsSummary', 'redFlagAnalysis', 'escalatedCases', 'closedAlerts', 'footer'],
    },
    regulatory_change: {
      name: 'Regulatory Change Impact Assessment',
      icon: '📡',
      sections: ['header', 'changeDescription', 'impactedPolicies', 'gapIdentification', 'actionPlan', 'implementationTimeline', 'footer'],
    },
    pep_edd: {
      name: 'PEP / EDD Assessment',
      icon: '🏛️',
      sections: ['header', 'pepIdentification', 'sofVerification', 'sowVerification', 'riskAssessment', 'seniorApproval', 'footer'],
    },
    dpmsr: {
      name: 'DPMSR Submission Report',
      icon: '🏢',
      sections: ['header', 'reportingPeriod', 'transactionVolume', 'customerStatistics', 'complianceDeclarations', 'submissionConfirmation', 'footer'],
    },
    breach_penalty: {
      name: 'Regulatory Breach Report',
      icon: '⛔',
      sections: ['header', 'breachDescription', 'regulatoryReference', 'penaltyExposure', 'rootCause', 'correctiveActions', 'preventiveMeasures', 'footer'],
    },
    kye: {
      name: 'KYE Screening Report',
      icon: '👥',
      sections: ['header', 'employeeProfile', 'backgroundCheck', 'conflictOfInterest', 'fitnessAssessment', 'recertificationStatus', 'footer'],
    },
  };

  function getHistory() { return _parse(REPORT_HISTORY_KEY, []); }

  function saveHistory(h) { _save(REPORT_HISTORY_KEY, h.slice(0, 200)); }

  function addToHistory(entry) {
    const h = getHistory();
    h.unshift({ ...entry, id: crypto.randomUUID(), generatedAt: new Date().toISOString() });
    saveHistory(h);
  }

  function getSchedules() { return _parse(REPORT_SCHEDULES_KEY, []); }

  function saveSchedules(s) { _save(REPORT_SCHEDULES_KEY, s); }

  // ── Template Themes ──
  const THEMES = {
    executive:              { bg: [27,42,74],   accent: [201,168,76],  text: [255,255,255], heading: [201,168,76],  stripe: '#1B2A4A', accentHex: '#C9A84C', label: 'EXECUTIVE BRIEF' },
    gap_analysis:           { bg: [13,115,119],  accent: [255,255,255], text: [255,255,255], heading: [13,115,119],  stripe: '#0D7377', accentHex: '#0D7377', label: 'GAP ANALYSIS' },
    audit:                  { bg: [44,62,107],   accent: [192,192,192], text: [255,255,255], heading: [44,62,107],   stripe: '#2C3E6B', accentHex: '#2C3E6B', label: 'AUDIT REPORT' },
    risk:                   { bg: [139,26,26],   accent: [232,160,48],  text: [255,255,255], heading: [139,26,26],   stripe: '#8B1A1A', accentHex: '#E8A030', label: 'RISK ASSESSMENT' },
    incident:               { bg: [220,20,60],   accent: [60,60,60],    text: [255,255,255], heading: [180,20,50],   stripe: '#DC143C', accentHex: '#DC143C', label: 'INCIDENT REPORT' },
    ewra_bwra:              { bg: [91,44,135],   accent: [200,180,230], text: [255,255,255], heading: [91,44,135],   stripe: '#5B2C87', accentHex: '#5B2C87', label: 'EWRA / BWRA' },
    cdd_review:             { bg: [26,82,118],   accent: [135,195,230], text: [255,255,255], heading: [26,82,118],   stripe: '#1A5276', accentHex: '#1A5276', label: 'CDD REVIEW' },
    str_sar:                { bg: [125,90,0],    accent: [255,215,0],   text: [255,255,255], heading: [125,90,0],    stripe: '#7D5A00', accentHex: '#DAA520', label: 'STR / SAR FILING' },
    sanctions_screening:    { bg: [44,44,44],    accent: [200,40,40],   text: [255,255,255], heading: [200,40,40],   stripe: '#2C2C2C', accentHex: '#C82828', label: 'SANCTIONS SCREENING' },
    tfs_ffr:                { bg: [17,17,17],    accent: [204,0,0],     text: [255,255,255], heading: [204,0,0],     stripe: '#111111', accentHex: '#CC0000', label: 'TFS / FFR' },
    supplier_dd:            { bg: [27,94,32],    accent: [165,138,100], text: [255,255,255], heading: [27,94,32],    stripe: '#1B5E20', accentHex: '#1B5E20', label: 'SUPPLIER DUE DILIGENCE' },
    training:               { bg: [46,125,50],   accent: [200,230,200], text: [255,255,255], heading: [46,125,50],   stripe: '#2E7D32', accentHex: '#2E7D32', label: 'TRAINING REPORT' },
    annual_compliance:      { bg: [13,27,42],    accent: [201,168,76],  text: [255,255,255], heading: [201,168,76],  stripe: '#0D1B2A', accentHex: '#C9A84C', label: 'ANNUAL COMPLIANCE' },
    onboarding:             { bg: [0,105,92],    accent: [255,200,120], text: [255,255,255], heading: [0,105,92],    stripe: '#00695C', accentHex: '#00695C', label: 'CUSTOMER ONBOARDING' },
    transaction_monitoring: { bg: [55,71,79],    accent: [66,165,245],  text: [255,255,255], heading: [55,71,79],    stripe: '#37474F', accentHex: '#42A5F5', label: 'TRANSACTION MONITORING' },
    regulatory_change:      { bg: [230,81,0],    accent: [25,50,95],    text: [255,255,255], heading: [230,81,0],    stripe: '#E65100', accentHex: '#E65100', label: 'REGULATORY CHANGE' },
    pep_edd:                { bg: [106,27,56],   accent: [255,240,220], text: [255,255,255], heading: [106,27,56],   stripe: '#6A1B38', accentHex: '#6A1B38', label: 'PEP / EDD ASSESSMENT' },
    dpmsr:                  { bg: [26,35,126],   accent: [158,158,158], text: [255,255,255], heading: [26,35,126],   stripe: '#1A237E', accentHex: '#1A237E', label: 'DPMSR SUBMISSION' },
    breach_penalty:         { bg: [183,28,28],   accent: [30,30,30],    text: [255,255,255], heading: [183,28,28],   stripe: '#B71C1C', accentHex: '#B71C1C', label: 'REGULATORY BREACH' },
    kye:                    { bg: [48,63,159],   accent: [144,175,230], text: [255,255,255], heading: [48,63,159],   stripe: '#303F9F', accentHex: '#303F9F', label: 'KYE SCREENING' },
  };

  const SEV_COLORS = { CRITICAL: [217,79,79], HIGH: [232,160,48], MEDIUM: [74,143,193], LOW: [61,168,118] };

  // ── PDF Generation (uses jsPDF already loaded) ──
  function generatePDF(templateName, data) {
    const template = TEMPLATES[templateName];
    if (!template) { if (typeof toast === 'function') toast('Unknown template', 'error'); return; }
    const theme = THEMES[templateName] || THEMES.executive;

    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) { if (typeof toast === 'function') toast('jsPDF not loaded', 'error'); return; }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    const contentW = pageW - margin * 2;
    let y = margin;

    function addPage() {
      doc.addPage();
      y = margin + 4;
      doc.setFillColor(...ccRGB);
      doc.rect(0, 0, pageW, 3, 'F');
      doc.setFillColor(201, 168, 76);
      doc.rect(0, 3, pageW, 0.4, 'F');
    }
    function checkPage(needed) { if (y + needed > 278) addPage(); }

    function addFooter() {
      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setDrawColor(...ccRGB);
        doc.setLineWidth(0.3);
        doc.line(margin, 285, margin + contentW, 285);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(150, 150, 150);
        doc.text('CONFIDENTIAL — ' + cName + ' | ' + template.name + ' | Generated ' + new Date().toLocaleDateString('en-GB'), margin, 289);
        doc.text('Page ' + p + ' of ' + totalPages, margin + contentW, 289, { align: 'right' });
      }
    }

    function sectionTitle(title) {
      checkPage(14);
      doc.setFillColor(...ccRGB);
      doc.rect(margin, y - 1, contentW, 7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(title.toUpperCase(), margin + 3, y + 4);
      y += 10;
      doc.setTextColor(50, 50, 50);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
    }

    function bodyText(txt) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(txt, contentW);
      doc.text(lines, margin, y);
      y += lines.length * 3.5 + 3;
    }

    // ── Company color & logo ──
    const company = typeof getActiveCompany === 'function' ? getActiveCompany() : {};
    const companyColor = typeof getCompanyDocColor === 'function' ? getCompanyDocColor(company.id || 'company-5') : '#1a1a6e';
    const ccRGB = [parseInt(companyColor.slice(1,3),16), parseInt(companyColor.slice(3,5),16), parseInt(companyColor.slice(5,7),16)];
    const cName = (company.name || data.company || 'N/A').toUpperCase();
    const activity = company.activity || 'Non-Manufactured Precious Metal Trading';
    const licenseNo = company.licenseNo || '';
    const logo = typeof getCompanyLogoBase64 === 'function' ? getCompanyLogoBase64(company.id) : '';
    const loc = company.location || 'Dubai, UAE';
    const yr = new Date().getFullYear();

    // ── Header band ──
    doc.setFillColor(...ccRGB);
    doc.rect(0, 0, pageW, 6, 'F');
    // Thin gold accent line
    doc.setFillColor(201, 168, 76);
    doc.rect(0, 6, pageW, 0.8, 'F');

    let headerY = 12;
    // Logo
    if (logo) {
      try { doc.addImage(logo, 'PNG', margin, headerY, 18, 18); } catch(e) {}
    }
    const textX = logo ? margin + 22 : margin;
    // Company name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...ccRGB);
    doc.text(cName, textX, headerY + 5);
    // Sub-header
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(activity + (licenseNo ? '  |  License No. ' + licenseNo : '') + '  |  ' + loc + '', textX, headerY + 10);
    // Date
    doc.text('Generated: ' + new Date().toLocaleDateString('en-GB') + '  |  ' + yr, textX, headerY + 14);
    headerY += 20;

    // Report title bar
    doc.setFillColor(...ccRGB);
    doc.rect(margin, headerY, contentW, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(template.name.toUpperCase() + ' ' + yr, margin + contentW / 2, headerY + 6, { align: 'center' });
    headerY += 11;

    // Entity line
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(cName + '  |  ' + activity + '  |  ' + loc + '  |  ' + yr, margin + contentW / 2, headerY + 4, { align: 'center' });
    headerY += 8;

    // Thin line separator
    doc.setDrawColor(...ccRGB);
    doc.setLineWidth(0.3);
    doc.line(margin, headerY, margin + contentW, headerY);

    y = headerY + 4;

    // ── Compliance Scorecard ──
    if (data.metrics) {
      sectionTitle('Compliance Scorecard');
      const m = data.metrics;
      const cards = [
        { label: 'CRITICAL', val: m.critical || 0, col: [217,79,79] },
        { label: 'HIGH', val: m.high || 0, col: [232,160,48] },
        { label: 'MEDIUM', val: m.medium || 0, col: [74,143,193] },
        { label: 'COMPLIANT', val: m.compliant || 0, col: [61,168,118] },
      ];
      const cardW = (contentW - 12) / 4;
      cards.forEach((c, i) => {
        const x = margin + i * (cardW + 4);
        doc.setFillColor(...c.col);
        doc.roundedRect(x, y, cardW, 18, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.text(String(c.val), x + cardW / 2, y + 10, { align: 'center' });
        doc.setFontSize(7);
        doc.text(c.label, x + cardW / 2, y + 15, { align: 'center' });
      });
      y += 26;
    }

    // ── Summary ──
    if (data.summary) {
      sectionTitle('Executive Summary');
      bodyText(data.summary);
    }

    // ── Findings ──
    if (data.findings && data.findings.length) {
      sectionTitle('Detailed Findings (' + data.findings.length + ')');
      data.findings.forEach((f, i) => {
        checkPage(35);
        // Severity badge
        const col = SEV_COLORS[f.severity] || [120,120,120];
        doc.setFillColor(...col);
        doc.roundedRect(margin, y - 1, 24, 6, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7);
        doc.text(f.severity || 'INFO', margin + 12, y + 3, { align: 'center' });
        // Title
        doc.setTextColor(40, 40, 40);
        doc.setFontSize(11);
        doc.text(f.title || 'Finding ' + (i + 1), margin + 28, y + 3);
        y += 9;
        // Body
        if (f.body) {
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          const bLines = doc.splitTextToSize(f.body, contentW - 4);
          doc.text(bLines, margin + 4, y);
          y += bLines.length * 4 + 2;
        }
        // Recommendation
        if (f.recommendation) {
          doc.setFillColor(...theme.heading);
          doc.rect(margin + 4, y - 1, 1.5, 8, 'F');
          doc.setTextColor(...theme.heading);
          doc.setFontSize(8);
          doc.text('RECOMMENDATION', margin + 8, y + 2);
          doc.setTextColor(80, 80, 80);
          doc.setFontSize(9);
          const rLines = doc.splitTextToSize(f.recommendation, contentW - 12);
          doc.text(rLines, margin + 8, y + 6);
          y += rLines.length * 4 + 8;
        }
        // Regulatory ref
        if (f.regulatory_ref) {
          doc.setTextColor(150, 150, 150);
          doc.setFontSize(7);
          doc.text('Ref: ' + f.regulatory_ref, margin + 4, y);
          y += 5;
        }
        // Divider
        doc.setDrawColor(220, 220, 220);
        doc.line(margin, y, margin + contentW, y);
        y += 5;
      });
    }

    // ── Risk Matrix (risk templates) ──
    if (data.entityRisks && (templateName === 'risk' || templateName === 'ewra_bwra')) {
      sectionTitle('Entity Risk Assessment');
      data.entityRisks.forEach(r => {
        checkPage(12);
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        doc.text(`${r.entity}: Risk Score ${r.score}/100 (${r.rating})`, margin + 4, y);
        // Score bar
        const barW = (r.score / 100) * 60;
        const barCol = r.score >= 70 ? [217,79,79] : r.score >= 40 ? [232,160,48] : [61,168,118];
        doc.setFillColor(230, 230, 230);
        doc.roundedRect(margin + contentW - 65, y - 3, 60, 4, 1, 1, 'F');
        doc.setFillColor(...barCol);
        doc.roundedRect(margin + contentW - 65, y - 3, barW, 4, 1, 1, 'F');
        y += 8;
      });
      y += 4;
    }

    // ── Incidents ──
    if (data.incidents && data.incidents.length) {
      sectionTitle('Incident Log (' + data.incidents.length + ')');
      data.incidents.forEach(inc => {
        checkPage(18);
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        doc.text(`${inc.date || 'N/A'}  —  ${inc.title}  [${inc.status}]`, margin + 4, y);
        y += 5;
        if (inc.description) {
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          const dLines = doc.splitTextToSize(inc.description, contentW - 8);
          doc.text(dLines, margin + 8, y);
          y += dLines.length * 3.5 + 4;
        }
      });
    }

    // ── Footer on all pages ──
    const totalPages = doc.internal.getNumberOfPages();
    addFooter();

    const filename = `ComplianceReport_${templateName}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);

    addToHistory({ template: templateName, templateName: template.name, format: 'PDF', filename, company: data.company || 'N/A' });
    if (typeof toast === 'function') toast(`${template.name} PDF generated`, 'success');
    return filename;
  }

  // ── DOCX Generation (HTML blob) ──
  function generateDOCX(templateName, data) {
    const template = TEMPLATES[templateName];
    if (!template) { if (typeof toast === 'function') toast('Unknown template', 'error'); return; }
    const theme = THEMES[templateName] || THEMES.executive;

    const sevStyles = {
      CRITICAL: 'background:#fde8e8;color:#D94F4F',
      HIGH: 'background:#fef3e2;color:#E8A030',
      MEDIUM: 'background:#e8f0f8;color:#4A8FC1',
      LOW: 'background:#e8f5ef;color:#3DA876',
    };

    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${template.name}</title>
<style>
body{font-family:'Arial Narrow',Arial,sans-serif;font-size:8pt;color:#1a1a1a;margin:0;padding:0}
.header{background:${theme.stripe};color:white;padding:30px 40px 25px;border-bottom:4px solid ${theme.accentHex}}
.header h1{margin:0;font-size:22px;color:white;font-family:'Arial Narrow',Arial,sans-serif}
.header .label{display:inline-block;background:${theme.accentHex};color:white;padding:3px 12px;border-radius:3px;font-size:8pt;margin-top:8px;letter-spacing:2px;font-family:'Arial Narrow',Arial,sans-serif}
.header .meta{color:#ccc;font-size:8pt;margin-top:10px;font-family:'Arial Narrow',Arial,sans-serif}
.content{padding:30px 40px}
h2{color:${theme.stripe};border-left:4px solid ${theme.accentHex};padding-left:12px;margin-top:28px;font-size:12pt;font-family:'Arial Narrow',Arial,sans-serif}
.badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:8pt;font-weight:bold;letter-spacing:0.5px;font-family:'Arial Narrow',Arial,sans-serif}
table{border-collapse:collapse;width:100%;margin:14px 0}
th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:8pt;font-family:'Arial Narrow',Arial,sans-serif}
th{background:${theme.stripe};color:white;font-size:8pt;text-transform:uppercase;letter-spacing:0.5px}
.scorecard{display:flex;gap:8px;margin:16px 0}
.score-card{flex:1;text-align:center;padding:16px 8px;border-radius:6px;color:white;font-size:11px}
.score-card .val{font-size:28px;font-weight:bold;display:block;margin-bottom:4px}
.rec{background:#f8f6f0;border-left:4px solid ${theme.accentHex};padding:10px 16px;margin:8px 0;font-size:12px}
.finding{border:1px solid #eee;border-radius:6px;padding:16px;margin:12px 0;border-left:4px solid #ccc}
.finding.CRITICAL{border-left-color:#D94F4F} .finding.HIGH{border-left-color:#E8A030} .finding.MEDIUM{border-left-color:#4A8FC1} .finding.LOW{border-left-color:#3DA876}
.ref{color:#999;font-size:10px;font-style:italic}
.footer{margin-top:40px;padding:16px 40px;background:#f5f5f5;border-top:3px solid ${theme.accentHex};font-size:10px;color:#888}
.watermark{float:right;color:#bbb;font-size:9px;letter-spacing:2px}
</style></head><body>`;

    // Header
    html += `<div class="header">
      <h1>${template.icon} ${template.name}</h1>
      <span class="label">${theme.label}</span>
      <div class="meta"><strong>Company:</strong> ${data.company || 'N/A'} &nbsp;|&nbsp; <strong>Date:</strong> ${new Date().toLocaleDateString('en-GB')} &nbsp;|&nbsp; <strong>Generated by:</strong> Compliance Analyser v2.5</div>
    </div>
    <div class="content">`;

    // Scorecard
    if (data.metrics) {
      const m = data.metrics;
      html += `<h2>Compliance Scorecard</h2>
      <table><tr>
        <td style="text-align:center;background:#fde8e8;width:25%"><span style="font-size:28px;font-weight:bold;color:#D94F4F">${m.critical || 0}</span><br><small>CRITICAL</small></td>
        <td style="text-align:center;background:#fef3e2;width:25%"><span style="font-size:28px;font-weight:bold;color:#E8A030">${m.high || 0}</span><br><small>HIGH</small></td>
        <td style="text-align:center;background:#e8f0f8;width:25%"><span style="font-size:28px;font-weight:bold;color:#4A8FC1">${m.medium || 0}</span><br><small>MEDIUM</small></td>
        <td style="text-align:center;background:#e8f5ef;width:25%"><span style="font-size:28px;font-weight:bold;color:#3DA876">${m.compliant || 0}</span><br><small>COMPLIANT</small></td>
      </tr></table>`;
    }

    // Summary
    if (data.summary) {
      html += `<h2>Executive Summary</h2><p style="line-height:1.6">${data.summary}</p>`;
    }

    // Findings
    if (data.findings && data.findings.length) {
      html += `<h2>Detailed Findings (${data.findings.length})</h2>`;
      data.findings.forEach((f, i) => {
        const sev = f.severity || 'INFO';
        const style = sevStyles[sev] || 'background:#f0f0f0;color:#666';
        html += `<div class="finding ${sev}">
          <p><span class="badge" style="${style}">${sev}</span> &nbsp;<strong style="font-size:14px">${f.title || 'Finding ' + (i + 1)}</strong></p>
          ${f.body ? `<p>${f.body}</p>` : ''}
          ${f.regulatory_ref ? `<p class="ref">Reference: ${f.regulatory_ref}</p>` : ''}
          ${f.recommendation ? `<div class="rec"><strong>Recommendation:</strong> ${f.recommendation}</div>` : ''}
        </div>`;
      });
    }

    // Entity Risks
    if (data.entityRisks) {
      html += `<h2>Entity Risk Assessment</h2><table><tr><th>Entity</th><th>Score</th><th>Rating</th></tr>`;
      data.entityRisks.forEach(r => {
        const color = r.score >= 70 ? '#D94F4F' : r.score >= 40 ? '#E8A030' : '#3DA876';
        html += `<tr><td>${r.entity}</td><td style="color:${color};font-weight:bold">${r.score}/100</td><td>${r.rating}</td></tr>`;
      });
      html += `</table>`;
    }

    // Incidents
    if (data.incidents && data.incidents.length) {
      html += `<h2>Incident Log (${data.incidents.length})</h2><table><tr><th>Date</th><th>Title</th><th>Status</th><th>Description</th></tr>`;
      data.incidents.forEach(inc => {
        html += `<tr><td>${inc.date || 'N/A'}</td><td><strong>${inc.title}</strong></td><td>${inc.status}</td><td>${inc.description || ''}</td></tr>`;
      });
      html += `</table>`;
    }

    html += `</div>`;
    html += `<div class="footer"><span class="watermark">CONFIDENTIAL — AUDIT COPY</span>${template.icon} ${template.name} | Compliance Analyser v2.5 | Generated ${new Date().toISOString()}</div>`;
    html += `</body></html>`;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const filename = `ComplianceReport_${templateName}_${new Date().toISOString().split('T')[0]}.doc`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();

    addToHistory({ template: templateName, templateName: template.name, format: 'DOCX', filename, company: data.company || 'N/A' });
    if (typeof toast === 'function') toast(`${template.name} DOCX generated`, 'success');
    return filename;
  }

  // ── Report Scheduling ──
  function scheduleReport(config) {
    const schedules = getSchedules();
    schedules.push({
      id: crypto.randomUUID(),
      template: config.template,
      frequency: config.frequency || 'weekly',
      nextRun: config.nextRun || new Date(Date.now() + 7 * 86400000).toISOString(),
      format: config.format || 'PDF',
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    saveSchedules(schedules);
    if (typeof toast === 'function') toast('Report scheduled', 'success');
  }

  function deleteSchedule(id) {
    if (!confirm('Are you sure you want to delete this schedule?')) return;
    const schedules = getSchedules().filter(s => s.id !== id);
    saveSchedules(schedules);
  }

  function toggleSchedule(id) {
    const schedules = getSchedules();
    const s = schedules.find(x => x.id === id);
    if (s) s.enabled = !s.enabled;
    saveSchedules(schedules);
  }

  // ── Render Report Tab UI ──
  function renderReportTab() {
    const history = getHistory();
    const schedules = getSchedules();
    const templateOptions = Object.entries(TEMPLATES).map(([k, v]) =>
      `<option value="${k}">${v.icon} ${v.name}</option>`
    ).join('');

    return `
<div class="card">
  <div class="sec-title">GENERATE REPORT</div>
  <div class="row row-3">
    <div><label class="lbl">TEMPLATE</label><select id="reportTemplate">${templateOptions}</select></div>
    <div><label class="lbl">FORMAT</label><select id="reportFormat"><option value="PDF">PDF</option><option value="DOCX">Word (DOCX)</option></select></div>
    <div><label class="lbl">COMPANY</label><input id="reportCompany" placeholder="Company name" /></div>
  </div>
  <button class="btn btn-gold" onclick="ReportGenerator.generateFromUI()" style="margin-top:8px">Generate Report</button>
</div>

<div class="card">
  <div class="sec-title">SCHEDULE REPORTS</div>
  <div class="row row-3">
    <div><label class="lbl">TEMPLATE</label><select id="schedTemplate">${templateOptions}</select></div>
    <div><label class="lbl">FREQUENCY</label><select id="schedFreq"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
    <div><label class="lbl">FORMAT</label><select id="schedFormat"><option value="PDF">PDF</option><option value="DOCX">Word</option></select></div>
  </div>
  <button class="btn btn-sm btn-green" onclick="ReportGenerator.scheduleFromUI()" style="margin-top:8px">Add Schedule</button>
  <div id="reportSchedulesList" style="margin-top:12px">
    ${schedules.length ? schedules.map(s => `
      <div class="asana-item">
        <div>
          <div class="asana-name">${TEMPLATES[s.template]?.icon || '📋'} ${TEMPLATES[s.template]?.name || s.template} (${s.format})</div>
          <div class="asana-meta">${s.frequency} | Next: ${new Date(s.nextRun).toLocaleDateString('en-GB')} | ${s.enabled ? '✅ Active' : '⏸ Paused'}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn-sm" onclick="ReportGenerator.toggleSchedule('${s.id}');switchTab('reports')">${s.enabled ? 'Pause' : 'Resume'}</button>
          <button class="btn-sm btn-red" onclick="ReportGenerator.deleteSchedule('${s.id}');switchTab('reports')">Delete</button>
        </div>
      </div>
    `).join('') : '<p style="color:var(--muted);font-size:13px">No scheduled reports.</p>'}
  </div>
</div>

<div class="card">
  <div class="top-bar" style="margin-bottom:10px">
    <div class="sec-title" style="margin:0;border:none;padding:0">REPORT HISTORY <span style="color:var(--muted);font-size:10px">(${history.length} reports)</span></div>
    ${history.length ? '<button class="btn btn-sm btn-red" onclick="ReportGenerator.clearHistory()">Clear History</button>' : ''}
  </div>
  <div id="reportHistoryList">
    ${history.length ? history.slice(0, 50).map(h => `
      <div class="asana-item">
        <div>
          <div class="asana-name">${h.templateName || h.template} — ${h.format}</div>
          <div class="asana-meta">${new Date(h.generatedAt).toLocaleString('en-GB')} | ${h.company} | ${h.filename}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="btn btn-sm btn-green" onclick="ReportGenerator.redownload('${h.template}','${h.format}','${(h.company || '').replace(/'/g, "\\'")}')">⬇ Download</button>
          <span class="asana-status s-ok">${h.format}</span>
        </div>
      </div>
    `).join('') : '<p style="color:var(--muted);font-size:13px">No reports generated yet.</p>'}
  </div>
</div>

<div class="card">
  <div class="top-bar" style="margin-bottom:10px">
    <span class="sec-title" style="margin:0;border:none;padding:0">Circulars</span>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-sm btn-blue" onclick="document.getElementById('circFileInput').click()" style="padding:3px 10px;font-size:10px">File</button>
      <input type="file" id="circFileInput" style="display:none" onchange="ReportGenerator.attachCircularFile(this)" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.zip">
      <button class="btn btn-sm btn-green" onclick="ReportGenerator.exportCircularsPDF()" style="padding:3px 10px;font-size:10px">PDF</button>
      <button class="btn btn-sm btn-green" onclick="ReportGenerator.exportCircularsDOCX()" style="padding:3px 10px;font-size:10px">Word</button>
      <button class="btn btn-sm btn-red" onclick="ReportGenerator.clearCirculars()" style="padding:3px 10px;font-size:10px">Clear</button>
    </div>
  </div>
  <div class="row" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:12px">
    <div><span class="lbl">Circular Reference</span><input type="text" id="circRef" placeholder="e.g. CIR-2026-001" /></div>
    <div><span class="lbl">Subject Name</span><input type="text" id="circSubject" placeholder="Subject of circular" /></div>
    <div><span class="lbl">Calendar Month</span><select id="circMonth"><option value="">Select</option><option>January</option><option>February</option><option>March</option><option>April</option><option>May</option><option>June</option><option>July</option><option>August</option><option>September</option><option>October</option><option>November</option><option>December</option></select></div>
    <div><span class="lbl">Issue / Effective Date</span><input type="text" placeholder="dd/mm/yyyy" id="circDate" /></div>
  </div>
  <button class="btn btn-gold" onclick="ReportGenerator.addCircular()">Add Circular</button>
  <div id="circularsList" style="margin-top:12px"></div>
</div>

<div class="card">
  <div class="top-bar" style="margin-bottom:10px">
    <span class="sec-title" style="margin:0;border:none;padding:0">Meeting Minutes Report</span>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-sm btn-blue" onclick="document.getElementById('meetFileInput').click()" style="padding:3px 10px;font-size:10px">File</button>
      <input type="file" id="meetFileInput" style="display:none" onchange="ReportGenerator.attachMeetingFile(this)" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.zip">
      <button class="btn btn-sm btn-green" onclick="ReportGenerator.exportMeetingsPDF()" style="padding:3px 10px;font-size:10px">PDF</button>
      <button class="btn btn-sm btn-green" onclick="ReportGenerator.exportMeetingsDOCX()" style="padding:3px 10px;font-size:10px">Word</button>
      <button class="btn btn-sm btn-red" onclick="ReportGenerator.clearMeetings()" style="padding:3px 10px;font-size:10px">Clear</button>
    </div>
  </div>
  <div class="row" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:12px">
    <div><span class="lbl">Subject Reference</span><input type="text" id="meetRef" placeholder="e.g. MOM-2026-001" /></div>
    <div><span class="lbl">Calendar Month</span><select id="meetMonth"><option value="">Select</option><option>January</option><option>February</option><option>March</option><option>April</option><option>May</option><option>June</option><option>July</option><option>August</option><option>September</option><option>October</option><option>November</option><option>December</option></select></div>
    <div><span class="lbl">Issue / Effective Date</span><input type="text" placeholder="dd/mm/yyyy" id="meetDate" /></div>
  </div>
  <button class="btn btn-gold" onclick="ReportGenerator.addMeeting()">Add Meeting Minutes</button>
  <div id="meetingsList" style="margin-top:12px"></div>
</div>`;
  }

  function generateFromUI() {
    const template = document.getElementById('reportTemplate')?.value;
    const format = document.getElementById('reportFormat')?.value;
    const company = document.getElementById('reportCompany')?.value || 'N/A';

    // Pull company info for enriched reports
    const activeCompany = typeof getActiveCompany === 'function' ? getActiveCompany() : {};
    const companyName = company || activeCompany.name || 'N/A';
    const companyActivity = activeCompany.activity || 'Non-Manufactured Precious Metal Trading';
    const companyLicense = activeCompany.licenseNo || '';
    const companyLoc = activeCompany.location || 'Dubai, UAE';
    const yr = new Date().getFullYear();
    const dateStr = new Date().toLocaleDateString('en-GB');

    const defaultSummary = 'This report has been prepared in accordance with the applicable regulatory requirements of the UAE Central Bank, '
      + 'the Financial Action Task Force (FATF) recommendations, and the relevant provisions of Federal Decree-Law No. 20 of 2018 on Anti-Money Laundering '
      + 'and Combating the Financing of Terrorism and Illegal Organisations. '
      + 'The assessment covers the compliance posture of ' + companyName + ', a licensed ' + companyActivity + ' entity operating from ' + companyLoc
      + (companyLicense ? ' (License No. ' + companyLicense + ')' : '') + '. '
      + 'All findings and recommendations contained herein are based on documented evidence, regulatory guidance, and industry best practices as at ' + dateStr + '. '
      + 'This document is strictly confidential and intended solely for the use of authorised personnel within the organisation and its appointed compliance officers.';

    const data = {
      company: companyName,
      summary: window.lastResult?.summary || defaultSummary,
      metrics: window.lastResult?.metrics || { critical: 0, high: 0, medium: 0, compliant: 0 },
      findings: window.lastResult?.findings || [],
    };

    // Pull incidents if available
    try {
      const incidents = _parse('fgl_incidents', []);
      if (incidents.length) data.incidents = incidents;
    } catch (_) {}

    // Pull entity risks if available
    try {
      const shipments = _parse('fgl_shipments', []);
      if (shipments.length) {
        data.entityRisks = shipments.slice(0, 20).map(s => ({
          entity: s.supplier || s.client || 'Entity',
          score: parseInt(s.riskScore) || 30,
          rating: s.risk || 'Low',
        }));
      }
    } catch (_) {}

    if (format === 'PDF') generatePDF(template, data);
    else generateDOCX(template, data);
  }

  function scheduleFromUI() {
    const template = document.getElementById('schedTemplate')?.value;
    const frequency = document.getElementById('schedFreq')?.value;
    const format = document.getElementById('schedFormat')?.value;
    const intervals = { daily: 86400000, weekly: 7 * 86400000, monthly: 30 * 86400000 };
    scheduleReport({ template, frequency, format, nextRun: new Date(Date.now() + (intervals[frequency] || intervals.weekly)).toISOString() });
    if (typeof switchTab === 'function') switchTab('reports');
  }

  function clearHistory() {
    if (!confirm('Clear all report history?')) return;
    saveHistory([]);
    if (typeof toast === 'function') toast('Report history cleared', 'info');
    if (typeof switchTab === 'function') switchTab('reports');
  }

  function redownload(template, format, company) {
    const cName = company || 'N/A';
    const dateStr = new Date().toLocaleDateString('en-GB');
    const defaultSummary = 'This report has been prepared in accordance with the applicable regulatory requirements of the UAE Central Bank, '
      + 'the Financial Action Task Force (FATF) recommendations, and the relevant provisions of Federal Decree-Law No. 20 of 2018 on Anti-Money Laundering '
      + 'and Combating the Financing of Terrorism and Illegal Organisations. '
      + 'The assessment covers the compliance posture of ' + cName + '. '
      + 'All findings and recommendations contained herein are based on documented evidence, regulatory guidance, and industry best practices as at ' + dateStr + '. '
      + 'This document is strictly confidential and intended solely for the use of authorised personnel within the organisation.';
    const data = {
      company: cName,
      summary: window.lastResult?.summary || defaultSummary,
      metrics: window.lastResult?.metrics || { critical: 0, high: 0, medium: 0, compliant: 0 },
      findings: window.lastResult?.findings || [],
    };
    try {
      const incidents = _parse('fgl_incidents', []);
      if (incidents.length) data.incidents = incidents;
    } catch (_) {}
    if (format === 'PDF') generatePDF(template, data);
    else generateDOCX(template, data);
  }

  // ======= CIRCULARS =======
  const CIRC_KEY = 'fgl_circulars';
  function getCirculars() { return _parse(CIRC_KEY, []); }
  function saveCirculars(arr) { _save(CIRC_KEY, arr); }

  function addCircular() {
    const ref = document.getElementById('circRef')?.value?.trim();
    const subject = document.getElementById('circSubject')?.value?.trim();
    const month = document.getElementById('circMonth')?.value;
    const date = document.getElementById('circDate')?.value;
    if (!ref) { toast('Enter circular reference','error'); return; }
    if (!subject) { toast('Enter subject name','error'); return; }
    const list = getCirculars();
    list.unshift({ id: Date.now(), ref, subject, month: month||'', date: date||'', createdAt: new Date().toISOString() });
    saveCirculars(list);
    ['circRef','circSubject','circMonth','circDate'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    renderCircularsInPlace();
    toast('Circular added','success');
  }

  function editCircular(id) {
    const list = getCirculars();
    const c = list.find(x => x.id === id);
    if (!c) return;
    const el = (i) => document.getElementById(i);
    if (el('circRef')) el('circRef').value = c.ref || '';
    if (el('circSubject')) el('circSubject').value = c.subject || '';
    if (el('circMonth')) el('circMonth').value = c.month || '';
    if (el('circDate')) el('circDate').value = c.date || '';
    saveCirculars(list.filter(x => x.id !== id));
    renderCircularsInPlace();
    toast('Editing circular — modify fields and click Add Circular to save', 'info', 4000);
  }

  function deleteCircular(id) {
    if (!confirm('Are you sure you want to delete this circular?')) return;
    const list = getCirculars().filter(c => c.id !== id);
    saveCirculars(list);
    renderCircularsInPlace();
    toast('Circular deleted');
  }

  function renderCircularsList() {
    const list = getCirculars();
    if (!list.length) return '<p style="color:var(--muted);font-size:13px">No circulars recorded.</p>';
    return list.map(c => {
      const attachHtml = c.attachment ? `<span style="color:var(--green);font-size:10px;margin-left:6px" title="${c.attachment.name}">📎 ${c.attachment.name} (${formatFileSize(c.attachment.size)})</span> <button class="btn btn-sm btn-green" style="padding:1px 6px;font-size:9px" onclick="ReportGenerator.downloadAttachment('circular',${c.id})">Download</button> <button class="btn btn-sm" style="padding:1px 6px;font-size:9px" onclick="ReportGenerator.removeAttachment('circular',${c.id})">Remove</button>` : '';
      return `<div class="asana-item"><div><div class="asana-name">${c.ref} — ${c.subject}${attachHtml}</div><div class="asana-meta">${c.month||'—'} | ${c.date||'—'}</div></div><div style="display:flex;gap:4px"><button class="btn btn-sm btn-gold" style="padding:2px 8px;font-size:10px" onclick="ReportGenerator.editCircular(${c.id})">Edit</button><button class="btn btn-sm btn-red" style="padding:2px 8px;font-size:10px" onclick="ReportGenerator.deleteCircular(${c.id})">Delete</button></div></div>`;
    }).join('');
  }
  function renderCircularsInPlace() { const el=document.getElementById('circularsList'); if(el) el.innerHTML=renderCircularsList(); }

  function clearCirculars() { if(!confirm('Clear all circulars?')) return; _remove(CIRC_KEY); renderCircularsInPlace(); toast('Circulars cleared'); }

  function exportCircularsPDF() {
    if(!window.jspdf){if(typeof toast==='function')toast('PDF library not loaded','error');return;}
    const list=getCirculars(); if(!list.length){toast('No circulars','error');return;}
    const doc=new jspdf.jsPDF(); const pw=doc.internal.pageSize.getWidth();
    doc.setFillColor(30,30,30);doc.rect(0,0,pw,28,'F');
    doc.setFontSize(16);doc.setTextColor(180,151,90);doc.text('Circulars Register',14,18);
    doc.setFontSize(8);doc.setTextColor(120);doc.text('Generated: '+new Date().toLocaleDateString('en-GB'),pw-14,18,{align:'right'});
    let y=36;
    list.forEach((c,i)=>{if(y>265){doc.addPage();y=20;}doc.setFillColor(40,40,40);doc.rect(14,y-4,pw-28,7,'F');doc.setFontSize(9);doc.setTextColor(180,151,90);doc.text((i+1)+'. '+c.ref,16,y);doc.setTextColor(160);doc.text(c.subject,60,y);doc.text((c.month||'')+'  '+(c.date||''),pw-16,y,{align:'right'});y+=10;});
    doc.save('Circulars_'+new Date().toISOString().slice(0,10)+'.pdf'); toast('PDF exported','success');
  }
  function exportCircularsDOCX() {
    const list=getCirculars(); if(!list.length){toast('No circulars','error');return;}
    let html = window.wordDocHeader ? window.wordDocHeader('Circulars Register') : '<html><head><meta charset="utf-8"></head><body>';
    html += '<table><tr><th>#</th><th>Reference</th><th>Subject</th><th>Month</th><th>Date</th></tr>';
    list.forEach((c,i)=>{html+='<tr><td>'+(i+1)+'</td><td>'+c.ref+'</td><td>'+c.subject+'</td><td>'+(c.month||'')+'</td><td>'+(c.date||'')+'</td></tr>';});
    html += '</table>' + (window.wordDocFooter ? window.wordDocFooter() : '</body></html>');
    if (window.downloadWordDoc) { window.downloadWordDoc(html, 'Circulars_'+new Date().toISOString().slice(0,10)+'.doc'); }
    else { const blob=new Blob(['\ufeff'+html],{type:'application/msword'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Circulars_'+new Date().toISOString().slice(0,10)+'.doc';a.click(); }
    toast('Word exported','success');
  }
  function exportCircularsCSV() {
    const list=getCirculars(); if(!list.length){toast('No circulars','error');return;}
    const csv=[['Reference','Subject','Month','Date'],...list.map(c=>[c.ref,c.subject,c.month,c.date])].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Circulars_'+new Date().toISOString().slice(0,10)+'.csv';a.click();toast('CSV exported','success');
  }

  // ======= MEETING MINUTES =======
  const MEET_KEY = 'fgl_meeting_minutes';
  function getMeetings() { return _parse(MEET_KEY, []); }
  function saveMeetings(arr) { _save(MEET_KEY, arr); }

  function addMeeting() {
    const ref = document.getElementById('meetRef')?.value?.trim();
    const month = document.getElementById('meetMonth')?.value;
    const date = document.getElementById('meetDate')?.value;
    if (!ref) { toast('Enter subject reference','error'); return; }
    const list = getMeetings();
    list.unshift({ id: Date.now(), ref, month: month||'', date: date||'', createdAt: new Date().toISOString() });
    saveMeetings(list);
    ['meetRef','meetMonth','meetDate'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    renderMeetingsInPlace();
    toast('Meeting minutes added','success');
  }

  function editMeeting(id) {
    const list = getMeetings();
    const m = list.find(x => x.id === id);
    if (!m) return;
    const el = (i) => document.getElementById(i);
    if (el('meetRef')) el('meetRef').value = m.ref || '';
    if (el('meetMonth')) el('meetMonth').value = m.month || '';
    if (el('meetDate')) el('meetDate').value = m.date || '';
    saveMeetings(list.filter(x => x.id !== id));
    renderMeetingsInPlace();
    toast('Editing meeting minutes — modify fields and click Add Meeting Minutes to save', 'info', 4000);
  }

  function deleteMeeting(id) {
    if (!confirm('Are you sure you want to delete this meeting minutes record?')) return;
    const list = getMeetings().filter(m => m.id !== id);
    saveMeetings(list);
    renderMeetingsInPlace();
    toast('Meeting minutes deleted');
  }

  function renderMeetingsList() {
    const list = getMeetings();
    if (!list.length) return '<p style="color:var(--muted);font-size:13px">No meeting minutes recorded.</p>';
    return list.map(m => {
      const attachHtml = m.attachment ? `<span style="color:var(--green);font-size:10px;margin-left:6px" title="${m.attachment.name}">📎 ${m.attachment.name} (${formatFileSize(m.attachment.size)})</span> <button class="btn btn-sm btn-green" style="padding:1px 6px;font-size:9px" onclick="ReportGenerator.downloadAttachment('meeting',${m.id})">Download</button> <button class="btn btn-sm" style="padding:1px 6px;font-size:9px" onclick="ReportGenerator.removeAttachment('meeting',${m.id})">Remove</button>` : '';
      return `<div class="asana-item"><div><div class="asana-name">${m.ref}${attachHtml}</div><div class="asana-meta">${m.month||'—'} | ${m.date||'—'}</div></div><div style="display:flex;gap:4px"><button class="btn btn-sm btn-gold" style="padding:2px 8px;font-size:10px" onclick="ReportGenerator.editMeeting(${m.id})">Edit</button><button class="btn btn-sm btn-red" style="padding:2px 8px;font-size:10px" onclick="ReportGenerator.deleteMeeting(${m.id})">Delete</button></div></div>`;
    }).join('');
  }
  function renderMeetingsInPlace() { const el=document.getElementById('meetingsList'); if(el) el.innerHTML=renderMeetingsList(); }

  function clearMeetings() { if(!confirm('Clear all meeting minutes?')) return; _remove(MEET_KEY); renderMeetingsInPlace(); toast('Meeting minutes cleared'); }

  function exportMeetingsPDF() {
    if(!window.jspdf){if(typeof toast==='function')toast('PDF library not loaded','error');return;}
    const list=getMeetings(); if(!list.length){toast('No meeting minutes','error');return;}
    const doc=new jspdf.jsPDF(); const pw=doc.internal.pageSize.getWidth();
    doc.setFillColor(30,30,30);doc.rect(0,0,pw,28,'F');
    doc.setFontSize(16);doc.setTextColor(180,151,90);doc.text('Meeting Minutes Report',14,18);
    doc.setFontSize(8);doc.setTextColor(120);doc.text('Generated: '+new Date().toLocaleDateString('en-GB'),pw-14,18,{align:'right'});
    let y=36;
    list.forEach((m,i)=>{if(y>265){doc.addPage();y=20;}doc.setFillColor(40,40,40);doc.rect(14,y-4,pw-28,7,'F');doc.setFontSize(9);doc.setTextColor(180,151,90);doc.text((i+1)+'. '+m.ref,16,y);doc.setTextColor(160);doc.text((m.month||'')+'  '+(m.date||''),pw-16,y,{align:'right'});y+=10;});
    doc.save('Meeting_Minutes_'+new Date().toISOString().slice(0,10)+'.pdf'); toast('PDF exported','success');
  }
  function exportMeetingsDOCX() {
    const list=getMeetings(); if(!list.length){toast('No meeting minutes','error');return;}
    let html = window.wordDocHeader ? window.wordDocHeader('Meeting Minutes Report') : '<html><head><meta charset="utf-8"></head><body>';
    html += '<table><tr><th>#</th><th>Subject Reference</th><th>Month</th><th>Date</th></tr>';
    list.forEach((m,i)=>{html+='<tr><td>'+(i+1)+'</td><td>'+m.ref+'</td><td>'+(m.month||'')+'</td><td>'+(m.date||'')+'</td></tr>';});
    html += '</table>' + (window.wordDocFooter ? window.wordDocFooter() : '</body></html>');
    if (window.downloadWordDoc) { window.downloadWordDoc(html, 'Meeting_Minutes_'+new Date().toISOString().slice(0,10)+'.doc'); }
    else { const blob=new Blob(['\ufeff'+html],{type:'application/msword'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Meeting_Minutes_'+new Date().toISOString().slice(0,10)+'.doc';a.click(); }
    toast('Word exported','success');
  }
  function exportMeetingsCSV() {
    const list=getMeetings(); if(!list.length){toast('No meeting minutes','error');return;}
    const csv=[['Subject Reference','Month','Date'],...list.map(m=>[m.ref,m.month,m.date])].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Meeting_Minutes_'+new Date().toISOString().slice(0,10)+'.csv';a.click();toast('CSV exported','success');
  }

  // ======= FILE ATTACHMENT HELPERS =======
  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function attachCircularFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('File too large (max 5 MB)', 'error'); input.value = ''; return; }
    const list = getCirculars();
    if (!list.length) { toast('Add a circular first, then attach a file', 'error'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function () {
      list[0].attachment = { name: file.name, size: file.size, type: file.type, data: reader.result };
      saveCirculars(list);
      renderCircularsInPlace();
      toast('File attached to latest circular', 'success');
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  function attachMeetingFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('File too large (max 5 MB)', 'error'); input.value = ''; return; }
    const list = getMeetings();
    if (!list.length) { toast('Add meeting minutes first, then attach a file', 'error'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = function () {
      list[0].attachment = { name: file.name, size: file.size, type: file.type, data: reader.result };
      saveMeetings(list);
      renderMeetingsInPlace();
      toast('File attached to latest meeting minutes', 'success');
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  function downloadAttachment(type, id) {
    const list = type === 'circular' ? getCirculars() : getMeetings();
    const item = list.find(i => i.id === id);
    if (!item?.attachment?.data) { toast('No attachment found', 'error'); return; }
    const a = document.createElement('a');
    a.href = item.attachment.data;
    a.download = item.attachment.name;
    a.click();
  }

  function removeAttachment(type, id) {
    if (!confirm('Remove this attachment?')) return;
    const list = type === 'circular' ? getCirculars() : getMeetings();
    const item = list.find(i => i.id === id);
    if (item) {
      delete item.attachment;
      if (type === 'circular') { saveCirculars(list); renderCircularsInPlace(); }
      else { saveMeetings(list); renderMeetingsInPlace(); }
      toast('Attachment removed', 'success');
    }
  }

  async function saveCircularsToDrive() {
    const list = getCirculars();
    if (!list.length) { toast('No circulars to upload','error'); return; }
    if (typeof uploadToGDrive !== 'function') { toast('Google Drive not configured. Set up in Settings.','error'); return; }
    const csv = [['#','Circular Reference','Subject','Month','Date'], ...list.map((c,i) => [i+1, c.ref, c.subject, c.month||'', c.date||''])].map(r => r.map(v => '"'+String(v||'').replace(/"/g,'""')+'"').join(',')).join('\n');
    try {
      await uploadToGDrive('Circulars_' + new Date().toISOString().slice(0,10) + '.csv', '\ufeff' + csv, 'text/csv');
      toast('Circulars uploaded to Google Drive','success');
    } catch(e) { toast('Drive upload failed: ' + e.message,'error'); }
  }

  async function saveMeetingsToDrive() {
    const list = getMeetings();
    if (!list.length) { toast('No meeting minutes to upload','error'); return; }
    if (typeof uploadToGDrive !== 'function') { toast('Google Drive not configured. Set up in Settings.','error'); return; }
    const csv = [['#','Subject Reference','Month','Date'], ...list.map((m,i) => [i+1, m.ref, m.month||'', m.date||''])].map(r => r.map(v => '"'+String(v||'').replace(/"/g,'""')+'"').join(',')).join('\n');
    try {
      await uploadToGDrive('Meeting_Minutes_' + new Date().toISOString().slice(0,10) + '.csv', '\ufeff' + csv, 'text/csv');
      toast('Meeting minutes uploaded to Google Drive','success');
    } catch(e) { toast('Drive upload failed: ' + e.message,'error'); }
  }

  window.ReportGenerator = {
    generatePDF,
    generateDOCX,
    generateFromUI,
    redownload,
    clearHistory,
    scheduleReport,
    scheduleFromUI,
    deleteSchedule,
    toggleSchedule,
    getHistory,
    getSchedules,
    renderReportTab,
    TEMPLATES,
    addCircular, editCircular, deleteCircular, clearCirculars, exportCircularsPDF, exportCircularsDOCX, exportCircularsCSV, saveCircularsToDrive, attachCircularFile,
    addMeeting, editMeeting, deleteMeeting, clearMeetings, exportMeetingsPDF, exportMeetingsDOCX, exportMeetingsCSV, saveMeetingsToDrive, attachMeetingFile,
    downloadAttachment, removeAttachment,
    _renderCircularsList: renderCircularsList,
    _renderMeetingsList: renderMeetingsList,
  };
})();
