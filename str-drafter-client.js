// ═══════════════════════════════════════════════════════════════════════════
// STR Drafter Client
// Browser-side wrapper around the deterministic STR narrative builder pattern
// from src/services/strNarrativeBuilder.ts. Ports the same template structure
// (header / subject / relationship / suspicion WHO/WHAT/WHERE/WHEN/WHY/HOW /
// red flags / evidence / action / signature) with the same tip-off blocking
// (FDL Art.29) and 500-character minimum (EOCN goAML v3).
//
// Regulatory basis: FDL Art.26-29 · EOCN goAML STR Submission v3 · FATF Rec 20
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var TIP_OFF = [/\byou\b/i, /\byour\b/i, /\bwe are reporting you\b/i, /\bnotif(y|ied|ying)\s+the\s+subject\b/i];
  var MIN_LEN = 500;

  function esc(s) {
    if (s === null || s === undefined) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function safeJson(key, fb) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fb; } catch (_) { return fb; }
  }

  // Aggregate evidence for a customer by reusing Customer 360 pull logic
  function loadCustomerEvidence(customerId) {
    var ev = {
      customerId: customerId,
      displayName: customerId,
      cdd: null,
      redFlags: [],
      transactions: [],
      screening: [],
    };
    var cdds = safeJson('fgl_cdd_records', []);
    ev.cdd = cdds.find(function (c) { return c && c.customerId === customerId; }) || null;
    if (ev.cdd && ev.cdd.displayName) ev.displayName = ev.cdd.displayName;
    ev.redFlags = safeJson('fgl_flag_hits', []).filter(function (f) { return f && f.customerId === customerId; });
    ev.transactions = safeJson('fgl_transactions', []).filter(function (t) { return t && t.customerId === customerId; });
    ev.screening = safeJson('fgl_sanctions_matches', []).filter(function (s) { return s && s.customerId === customerId; });
    return ev;
  }

  // Pure deterministic builder — mirrors strNarrativeBuilder.ts
  function buildNarrative(input) {
    var warnings = [];
    var header = input.filingType + ' — ' + input.subject.fullName + ' — ' + input.reportDate;
    var subject = [
      'Subject: ' + input.subject.fullName + ' (' + input.subject.entityType + ').',
      input.subject.nationality ? 'Nationality: ' + input.subject.nationality + '.' : '',
      input.subject.idNumber ? 'ID: ' + input.subject.idNumber + '.' : '',
      input.subject.registeredAddress ? 'Registered address: ' + input.subject.registeredAddress + '.' : ''
    ].filter(Boolean).join(' ');

    var relationship = [
      'Onboarded: ' + input.relationship.onboardingDate + '.',
      input.relationship.accountNumber ? 'Account: ' + input.relationship.accountNumber + '.' : '',
      input.relationship.productType ? 'Product: ' + input.relationship.productType + '.' : ''
    ].filter(Boolean).join(' ');

    var s = input.suspicion;
    var suspicion = [
      'WHO: ' + s.who + '.',
      'WHAT: ' + s.what + '.',
      'WHERE: ' + s.where + '.',
      'WHEN: ' + s.when + '.',
      'WHY: ' + s.why + '.',
      'HOW: ' + s.how + '.'
    ].join(' ');

    var redFlags = input.redFlags.length
      ? 'Red flag indicators triggered: ' + input.redFlags.map(function (r) {
          return '[' + r.code + '] ' + r.description + ' (' + r.regulatoryReference + ')';
        }).join('; ') + '.'
      : 'No specific red flag indicators recorded.';

    var evidence = input.evidence.length
      ? 'Supporting evidence: ' + input.evidence.map(function (e) {
          return e.refId + ' — ' + e.description + (e.vaultHash ? ' [vault:' + e.vaultHash.slice(0, 12) + '…]' : '');
        }).join('; ') + '.'
      : 'Supporting evidence: retained in the reporting entity compliance vault (refs available on request).';

    var action = input.actionTaken.length
      ? 'Action taken by the reporting entity: ' + input.actionTaken.join('; ') + '.'
      : 'Action taken: no customer-facing action. Relationship continued under enhanced monitoring pending FIU guidance per FDL Art.29.';

    var signature = 'Signed: ' + input.reportingOfficer.fullName +
      ' (ID ' + input.reportingOfficer.officerId + ', ' + input.reportingOfficer.role + ') — ' + input.reportDate + '.';

    var text = [header, subject, relationship, suspicion, redFlags, evidence, action, signature].join('\n\n');

    // Tip-off check
    TIP_OFF.forEach(function (re) {
      if (re.test(text)) warnings.push('Possible tipping-off language detected (FDL Art.29): ' + re.source);
    });
    if (text.length < MIN_LEN) {
      warnings.push('Narrative below EOCN minimum of ' + MIN_LEN + ' chars — add detail before filing.');
    }

    return {
      filingType: input.filingType,
      text: text,
      characterCount: text.length,
      warnings: warnings,
      sections: { header: header, subject: subject, relationship: relationship, suspicion: suspicion, redFlags: redFlags, evidence: evidence, action: action, signature: signature }
    };
  }

  // Open a draft for a customerId — pre-fills modal from existing data.
  window.strDrafterOpen = function (customerId) {
    var modal = document.getElementById('strDrafterModal');
    if (!modal) { if (typeof toast === 'function') toast('STR drafter UI not mounted', 'error'); return; }
    modal.classList.add('open');
    var ev = loadCustomerEvidence(customerId);
    document.getElementById('str-customer-id').value = customerId || '';
    document.getElementById('str-subject-name').value = ev.displayName || customerId || '';
    document.getElementById('str-filing-type').value = 'STR';
    document.getElementById('str-nationality').value = (ev.cdd && ev.cdd.jurisdiction) || '';
    document.getElementById('str-onboarding-date').value = (ev.cdd && ev.cdd.onboardingDate) || new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
    document.getElementById('str-account').value = (ev.cdd && ev.cdd.accountNumber) || '';
    document.getElementById('str-product').value = 'Physical gold / bullion';
    document.getElementById('str-who').value = ev.displayName;
    var flagDescriptions = ev.redFlags.length ? ev.redFlags.map(function (f) { return f.flag || f.description || ''; }).filter(Boolean).join('; ') : 'Structured activity inconsistent with declared CDD profile';
    document.getElementById('str-what').value = flagDescriptions;
    document.getElementById('str-where').value = (ev.cdd && ev.cdd.jurisdiction) || 'UAE';
    var first = ev.transactions[0], last = ev.transactions[ev.transactions.length - 1];
    document.getElementById('str-when').value = first && last ? (first.date || '') + ' — ' + (last.date || '') : new Date().toISOString().slice(0, 10);
    document.getElementById('str-why').value = 'Transactions inconsistent with documented source-of-funds and source-of-wealth; multiple red-flag indicators triggered.';
    document.getElementById('str-how').value = 'Aggregated cash / bullion activity processed through the reporting entity; originating funds could not be verified to the standard required by FDL Art.13-14.';
    document.getElementById('str-action').value = 'Relationship placed under enhanced monitoring. No customer-facing notification made (FDL Art.29). STR drafted for MLRO four-eyes review.';
    // Pre-populate red flags from collected hits
    var rfText = ev.redFlags.length
      ? ev.redFlags.map(function (f, i) { return 'RF-' + (i + 1) + ' | ' + (f.flag || f.description || '') + ' | ' + (f.ref || 'n/a'); }).join('\n')
      : 'RF-1 | Structured activity inconsistent with CDD profile | FATF Rec.20';
    document.getElementById('str-redflags').value = rfText;
    // Officer defaults
    try {
      var user = (typeof AuthRBAC !== 'undefined' && AuthRBAC.getCurrentUser) ? AuthRBAC.getCurrentUser() : null;
      document.getElementById('str-officer-name').value = (user && user.displayName) || 'Compliance Officer';
      document.getElementById('str-officer-id').value = (user && user.id) || 'CO-001';
    } catch (_) {}
    document.getElementById('str-officer-role').value = 'MLRO';
    document.getElementById('str-report-date').value = new Date().toLocaleDateString('en-GB');
    document.getElementById('strDrafterOutput').textContent = '(Click "Draft narrative" to generate.)';
    document.getElementById('strDrafterWarnings').innerHTML = '';
  };

  window.strDrafterClose = function () {
    var modal = document.getElementById('strDrafterModal');
    if (modal) modal.classList.remove('open');
  };

  function readVal(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  window.strDrafterBuild = function () {
    // Parse red flags — each line "CODE | DESCRIPTION | REF"
    var rfRaw = readVal('str-redflags') || '';
    var redFlags = rfRaw.split('\n').map(function (line) {
      var parts = line.split('|').map(function (p) { return p.trim(); });
      if (parts.length < 2 || !parts[1]) return null;
      return { code: parts[0] || 'RF', description: parts[1], regulatoryReference: parts[2] || 'n/a' };
    }).filter(Boolean);

    var input = {
      filingType: readVal('str-filing-type') || 'STR',
      subject: {
        fullName: readVal('str-subject-name'),
        entityType: 'individual',
        nationality: readVal('str-nationality'),
        idNumber: '',
        registeredAddress: ''
      },
      relationship: {
        onboardingDate: readVal('str-onboarding-date'),
        accountNumber: readVal('str-account'),
        productType: readVal('str-product')
      },
      suspicion: {
        who: readVal('str-who'), what: readVal('str-what'), where: readVal('str-where'),
        when: readVal('str-when'), why: readVal('str-why'), how: readVal('str-how')
      },
      redFlags: redFlags,
      evidence: [{ refId: 'VAULT-AUTO', description: 'Customer 360 evidence bundle pulled from the reporting entity compliance vault.' }],
      actionTaken: [readVal('str-action')],
      reportingOfficer: {
        fullName: readVal('str-officer-name'),
        officerId: readVal('str-officer-id'),
        role: readVal('str-officer-role')
      },
      reportDate: readVal('str-report-date')
    };

    var narrative = buildNarrative(input);
    var out = document.getElementById('strDrafterOutput');
    if (out) out.textContent = narrative.text;
    var warnEl = document.getElementById('strDrafterWarnings');
    if (warnEl) {
      if (narrative.warnings.length === 0) {
        warnEl.innerHTML = '<div style="color:#3fb950;font-size:11px;margin-top:8px">✓ ' + narrative.characterCount + ' chars · ready for four-eyes review</div>';
      } else {
        warnEl.innerHTML = '<div style="color:#f85149;font-size:11px;margin-top:8px">⚠ ' + narrative.warnings.length + ' warning(s):' +
          narrative.warnings.map(function (w) { return '<div>• ' + esc(w) + '</div>'; }).join('') + '</div>';
      }
    }
    window._strLastNarrative = narrative;
  };

  window.strDrafterCopy = function () {
    var narr = window._strLastNarrative;
    if (!narr) { if (typeof toast === 'function') toast('Draft a narrative first', 'error'); return; }
    try {
      navigator.clipboard.writeText(narr.text);
      if (typeof toast === 'function') toast('Narrative copied to clipboard', 'success');
    } catch (_) {
      if (typeof toast === 'function') toast('Copy failed — select the text manually', 'error');
    }
  };

  window.strDrafterSaveCase = function () {
    var narr = window._strLastNarrative;
    if (!narr) { if (typeof toast === 'function') toast('Draft a narrative first', 'error'); return; }
    try {
      var cases = [];
      try { cases = JSON.parse(localStorage.getItem('fgl_str_cases') || '[]'); } catch (_) {}
      cases.unshift({
        id: 'STR_' + Date.now(),
        customerId: readVal('str-customer-id'),
        filingType: narr.filingType,
        narrative: narr.text,
        characterCount: narr.characterCount,
        warnings: narr.warnings,
        status: 'Draft',
        createdAt: new Date().toISOString()
      });
      localStorage.setItem('fgl_str_cases', JSON.stringify(cases));
      if (typeof logAudit === 'function') logAudit('str_case_drafted', 'STR draft saved for ' + readVal('str-customer-id'));
      if (typeof toast === 'function') toast('STR case saved as draft', 'success');
      if (typeof window.gsbRefresh === 'function') window.gsbRefresh();
    } catch (err) {
      if (typeof toast === 'function') toast('Save failed: ' + err.message, 'error');
    }
  };
})();
