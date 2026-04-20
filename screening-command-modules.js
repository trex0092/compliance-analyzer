/**
 * Screening Command native modules — purple palette.
 */
(function () {
  'use strict';

  var STORAGE = {
    subjects: 'fgl_screening_subjects',
    transactions: 'fgl_tx_monitor',
    strCases: 'fgl_str_cases',
    watchlist: 'fgl_active_watchlist'
  };

  // Matches the key used by screening-command.js so the MLRO only signs in
  // once. When this is empty we degrade to on-device simulation.
  var TOKEN_KEY = 'hawkeye.watchlist.adminToken';
  var SCREENING_ENDPOINT = '/api/screening/run';
  var API_TIMEOUT_MS = 25000;

  // Four-eyes MLRO disposition states. Every subject row carries a
  // disposition so the audit chain (FDL Art.24) can reconstruct the
  // decision even after the event is closed.
  var DISPOSITIONS = {
    positive:       { tone: 'warn',   label: 'POSITIVE MATCH' },
    partial:        { tone: 'accent', label: 'PARTIAL MATCH' },
    negative:       { tone: 'ok',     label: 'NEGATIVE' },
    false_positive: { tone: 'ok',     label: 'FALSE POSITIVE' },
    pending:        { tone: 'accent', label: 'PENDING REVIEW' },
    escalated:      { tone: 'warn',   label: 'ESCALATED' }
  };

  // Maps the backend classification coming back from
  // multiModalNameMatcher → our MLRO-facing disposition.
  function dispositionFromClassification(cls) {
    if (cls === 'confirmed') return 'positive';
    if (cls === 'potential') return 'partial';
    if (cls === 'weak') return 'negative';
    return 'negative';
  }

  var SANCTIONS_LISTS = [
    {
      id: 'uae_eocn',
      label: 'UAE Local Terrorist List (EOCN / Executive Office)',
      citation: 'Cabinet Res 74/2020 Art.4-7 · FDL No.(10)/2025 Art.35 · MANDATORY',
      detail: 'UAE domestic terror-designation list maintained by the Executive Office for CTFEF. Confirmed match triggers a 24-hour freeze and 5-business-day CNMR.'
    },
    {
      id: 'un_unsc',
      label: 'UN Consolidated Sanctions List (UNSC)',
      citation: 'UNSCR 1267 / 1988 / 2231 · FATF Rec 6-7 · MANDATORY',
      detail: 'All Security Council sanctions regimes (ISIL-Da\'esh / Al-Qaida, Taliban, DPRK, Iran, Libya, Somalia, Yemen, etc.). Legally mandatory under UN Charter Art.25.'
    },
    {
      id: 'ofac_sdn',
      label: 'OFAC Specially Designated Nationals List (SDN)',
      citation: 'US Treasury OFAC · 31 CFR 501 · Secondary-sanctions risk for USD clearing',
      detail: 'SDN + Consolidated Non-SDN lists (SSI, NS-PLC, FSE, 13599). Key risk for USD-denominated flows and USD correspondent relationships.'
    },
    {
      id: 'uk_ofsi',
      label: 'UK OFSI Consolidated Financial Sanctions List',
      citation: 'UK Sanctions and Anti-Money Laundering Act 2018 · SAMLA',
      detail: 'Post-Brexit UK-autonomous financial sanctions regime. Relevant for GBP-denominated flows and UK-nexus trade.'
    },
    {
      id: 'eu_csfl',
      label: 'EU Consolidated Financial Sanctions List',
      citation: 'Council Regulation (EC) No 2580/2001 · EU Restrictive Measures',
      detail: 'EU autonomous sanctions covering all 27 Member States. Critical for EUR flows, goods transiting EU, and EU-banked counterparties.'
    },
    {
      id: 'interpol',
      label: 'INTERPOL Red Notices (where applicable)',
      citation: 'INTERPOL Constitution Art.3 · Rules on the Processing of Data',
      detail: 'Wanted-persons notices for arrest and extradition. Manual verification — not all Red Notices meet sanctions-equivalent threshold.'
    }
  ];

  var ADVERSE_MEDIA_CATEGORIES = [
    {
      id: 'criminal_fraud',
      label: 'Criminal / Fraud Allegations',
      citation: 'FDL No.(10)/2025 Art.2 · FATF Rec 10-12',
      detail: 'Indictments, convictions, arrest warrants, organised-crime links, predicate offences (fraud, forgery, bribery, corruption).'
    },
    {
      id: 'money_laundering',
      label: 'Money Laundering',
      citation: 'FDL No.(10)/2025 Art.2 + Art.26-27 · FATF Rec 3',
      detail: 'Layering, structuring, smurfing, trade-based laundering (TBML), shell-company typologies, placement through DPMS or VASP rails.'
    },
    {
      id: 'tf_pf_links',
      label: 'Terrorist Financing or Proliferation Financing Links',
      citation: 'Cabinet Res 74/2020 · Cabinet Res 156/2025 · FATF Rec 5-8 · UNSCR 1267 / 1373 / 1540',
      detail: 'Direct or indirect links to designated terror entities, foreign terrorist fighters, WMD proliferation networks, dual-use procurement.'
    },
    {
      id: 'regulatory_action',
      label: 'Regulatory Actions, Fines, or Investigations',
      citation: 'Cabinet Res 71/2024 · MoE supervisory powers · CBUAE / SCA / VARA actions',
      detail: 'Enforcement orders, administrative penalties (AED 10K–100M range), licence suspension, consent decrees, ongoing investigations.'
    },
    {
      id: 'negative_reputation',
      label: 'Negative Reputation or Commercial Disputes',
      citation: 'Cabinet Res 134/2025 Art.14 (EDD triggers) · Reputational-risk doctrine',
      detail: 'Litigation history, insolvency, chronic non-payment, contract breach, cross-border disputes, sanctions-circumvention allegations.'
    },
    {
      id: 'political_pep',
      label: 'Political Controversy or PEP Connections',
      citation: 'FATF Rec 12 · Cabinet Res 134/2025 Art.14 · FDL Art.14',
      detail: 'Foreign / domestic PEPs, family members, close associates, ministerial positions, state-owned enterprise directorships, graft allegations.'
    },
    {
      id: 'human_rights',
      label: 'Human Rights, Environmental, or Ethical Violations',
      citation: 'LBMA RGG v9 · UAE MoE RSG · OECD DD Guidance · UK Modern Slavery Act 2015',
      detail: 'Conflict minerals, child labour, forced labour, environmental harm in CAHRA, unethical sourcing, ASM non-compliance, community-impact disputes.'
    }
  ];

  // Specialised screening dimensions the MLRO may run alongside sanctions + adverse media.
  // Basis: FDL No.(10)/2025 Art.20-21, Cabinet Res 74/2020, Cabinet Res 156/2025,
  // FATF Rec 7 (PF), FATF Rec 5 (TF), and UAE Strategic Trade Control regime.
  var SPECIAL_SCREENS = [
    {
      id: 'tax_evasion',
      label: 'Tax evasion',
      citation: 'FATF Rec 3 · OECD CRS · UAE Federal Decree-Law No.(47)/2022 (Corporate Tax)',
      detail: 'Undeclared income, offshore concealment, CRS non-reporting, VAT evasion, transfer-pricing abuse, shell-company tax layering.'
    },
    {
      id: 'proliferation',
      label: 'Proliferation financing',
      citation: 'Cabinet Res 156/2025 · FATF Rec 7 · UNSCR 1540 / 2231',
      detail: 'Financing WMD programmes, DPRK / Iran procurement networks, front-company intermediaries, sensitive-goods end-users.'
    },
    {
      id: 'terrorism',
      label: 'Financing of terrorism',
      citation: 'Cabinet Res 74/2020 · FDL No.(10)/2025 Art.35 · FATF Rec 5-8 · UNSCR 1267 / 1373',
      detail: 'Designated-entity funding, NPO abuse, foreign-fighter facilitation, informal value-transfer (hawala), charity-sector exploitation.'
    },
    {
      id: 'dual_goods',
      label: 'Dual-use / strategic goods',
      citation: 'UAE Strategic Trade Control (Federal Law No.(13)/2007) · Cabinet Res 156/2025 Art.7 · Wassenaar Arrangement',
      detail: 'Items on the UAE dual-use control list, cryptographic technology, chemical / biological precursors, nuclear-related equipment, end-use diversion risk.'
    }
  ];

  // ─── Known public adverse-media register ────────────────────────────
  // Seed dataset of subjects with CONFIRMED public-source adverse media
  // reporting, curated for the UAE DPMS / AML compliance domain. The
  // simulation path (used when the MLRO is not yet signed in) screens
  // subject names against this register so high-profile published cases
  // surface a PENDING REVIEW verdict rather than a misleading NEGATIVE.
  //
  // A simulated screen can NEVER produce a definitive clean disposition
  // (FDL No.(10)/2025 Art.20-21 — CO situational awareness; FATF Rec 10
  // — ongoing CDD). This register is the minimum floor of integrity for
  // the pre-auth path; the authenticated backend runs the full fan-out.
  //
  // Every entry must cite a named public source. No rumours, no
  // uncited allegations — FDL Art.29 no-tipping-off still applies and
  // reputational exposure demands primary-source discipline.
  var KNOWN_ADVERSE_MEDIA = [
    {
      names: ['ozcan halac', 'özcan halaç', 'ozcan halaç', 'özcan halac'],
      country: 'turkey',
      entityType: 'individual',
      categories: ['criminal_fraud', 'money_laundering', 'regulatory_action'],
      classification: 'potential',
      confidence: 0.82,
      source: 'Reuters · 6 Oct 2025',
      url: 'https://www.reuters.com/world/middle-east/turkey-orders-23-arrests-istanbul-gold-refinery-probe-state-media-says-2025-10-06/',
      summary: 'Turkey ordered 23 arrests in an Istanbul gold-refinery probe (Oct 2025); named individual in state-media reporting on the export-subsidy fraud scheme (~$12M). Corroborated by Turkish Minute (6 Oct 2025) and Hurriyet Daily News. DPMS-sector adverse media — relevant to MoE Circular 08/AML/2021 and LBMA RGG v9 supply-chain due diligence.'
    },
    {
      names: [
        'istanbul gold refinery',
        'istanbul altin rafinerisi',
        'i̇stanbul altin rafinerisi',
        'iar',
        'istanbul gold refinery inc',
        'istanbul gold refinery a.s.',
        'istanbul altin rafinerisi as'
      ],
      country: 'turkey',
      entityType: 'legal_entity',
      categories: ['criminal_fraud', 'money_laundering', 'regulatory_action', 'negative_reputation'],
      classification: 'confirmed',
      confidence: 0.93,
      source: 'Reuters · Turkish Minute · Hurriyet Daily News · 6 Oct 2025',
      url: 'https://www.turkishminute.com/2025/10/06/turkey-detains-21-in-probe-into-istanbul-gold-refinery-over-export-subsidy-fraud/',
      summary: 'Istanbul Gold Refinery (IAR) and affiliated companies implicated in a coordinated export-subsidy fraud scheme (Oct 2025). Turkish authorities detained 21-22 individuals and issued 23 detention warrants; alleged state defrauded of ~$12-12.5M via fake gold exports to obtain subsidies. DPMS-sector — direct exposure for UAE gold refiners and counterparties under MoE Circular 08/AML/2021 and LBMA RGG v9.'
    }
  ];

  function normalizeName(s) {
    // Turkish characters that do not decompose under NFD need an
    // explicit fold: ı (dotless i), İ (dotted capital I, already
    // handled by toLowerCase but mapped here for safety), plus a
    // handful of extended Latin pairs used in UAE-relevant
    // jurisdictions (TR, DE, ES, scandinavian). NFD handles the rest.
    var folded = String(s == null ? '' : s)
      .toLowerCase()
      .replace(/ı/g, 'i')
      .replace(/İ/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ç/g, 'c')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ß/g, 'ss')
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      .replace(/ñ/g, 'n');
    return folded
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // strip remaining combining diacritics
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Token-set name match. Both subject and candidate are tokenised and
  // we consider a match when every candidate token appears in the
  // subject (or vice-versa for short names). This is deliberately
  // conservative — we want to catch "ozcan halac" / "Özcan Halaç" /
  // "Halac, Ozcan" but not random substring collisions.
  function nameMatches(subject, candidate) {
    var a = normalizeName(subject);
    var b = normalizeName(candidate);
    if (!a || !b) return false;
    if (a === b) return true;
    var aTok = a.split(' ').filter(Boolean);
    var bTok = b.split(' ').filter(Boolean);
    if (!aTok.length || !bTok.length) return false;
    var setA = {};
    aTok.forEach(function (t) { setA[t] = true; });
    var overlap = 0;
    bTok.forEach(function (t) { if (setA[t]) overlap += 1; });
    // Require every candidate token to appear in the subject when the
    // candidate is short (two-token names). For longer candidates, a
    // majority overlap is enough.
    if (bTok.length <= 2) return overlap === bTok.length;
    return overlap >= Math.ceil(bTok.length * 0.75);
  }

  function findKnownAdverseMedia(subjectName, aliases) {
    var candidates = [subjectName].concat(Array.isArray(aliases) ? aliases : []);
    for (var i = 0; i < KNOWN_ADVERSE_MEDIA.length; i++) {
      var entry = KNOWN_ADVERSE_MEDIA[i];
      for (var j = 0; j < entry.names.length; j++) {
        for (var k = 0; k < candidates.length; k++) {
          if (candidates[k] && nameMatches(candidates[k], entry.names[j])) return entry;
        }
      }
    }
    return null;
  }

  function safeParse(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }
  function safeSave(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.getUTCDate().toString().padStart(2, '0') + '/' +
        (d.getUTCMonth() + 1).toString().padStart(2, '0') + '/' + d.getUTCFullYear();
    } catch (_) { return iso; }
  }
  function head(title, actionsHtml) {
    return '<div class="mv-head"><h2 class="mv-title">' + esc(title) + '</h2>' +
      '<div class="mv-actions">' + (actionsHtml || '') + '</div></div>';
  }
  function emptyState(icon, msg) {
    return '<div class="mv-empty-state"><div class="mv-empty-icon">' + icon + '</div>' +
      '<p>' + esc(msg) + '</p></div>';
  }

  function renderSubjectScreening(host) {
    var rows = safeParse(STORAGE.subjects, []);
    var positives  = rows.filter(function (r) { return r.disposition === 'positive'; }).length;
    var partials   = rows.filter(function (r) { return r.disposition === 'partial'; }).length;
    var falsePos   = rows.filter(function (r) { return r.disposition === 'false_positive'; }).length;
    var negatives  = rows.filter(function (r) { return r.disposition === 'negative'; }).length;
    var pending    = rows.filter(function (r) { return !r.disposition || r.disposition === 'pending'; }).length;
    var adverseHits = rows.filter(function (r) {
      return Array.isArray(r.adverse_media_hits) && r.adverse_media_hits.length;
    }).length;
    var specialHits = rows.filter(function (r) {
      return Array.isArray(r.special_flags) && r.special_flags.length;
    }).length;

    function checkboxGroup(fieldName, items) {
      return items.map(function (it) {
        return '<label class="mv-check" style="align-items:flex-start;line-height:1.45">' +
          '<input type="checkbox" name="' + fieldName + '" value="' + esc(it.id) + '" checked>' +
          '<span>' +
            '<strong>' + esc(it.label) + '</strong>' +
            (it.citation ? '<br><em style="opacity:.65;font-size:11px;font-style:normal">' + esc(it.citation) + '</em>' : '') +
            (it.detail ? '<br><span style="opacity:.75;font-size:12px">' + esc(it.detail) + '</span>' : '') +
          '</span>' +
        '</label>';
      }).join('');
    }
    function specialGroup(items) {
      return checkboxGroup('special_screens', items);
    }

    host.innerHTML = [
      head('Subject Screening',
        '<span class="mv-pill">' + SANCTIONS_LISTS.length + ' / ' + SANCTIONS_LISTS.length + ' lists · ' +
          ADVERSE_MEDIA_CATEGORIES.length + ' media categories · ' + SPECIAL_SCREENS.length + ' specialised checks</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-sub-new">+ New screening</button>'
      ),
      '<p class="mv-lede">Multi-modal fuzzy match (Jaro-Winkler · Levenshtein · Soundex · Double Metaphone · token-set) against every configured sanctions list, adverse-media category, and specialised screening check (tax evasion, proliferation financing, financing of terrorism, dual-use goods). Four-eyes MLRO disposition on every partial / confirmed match.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Screened</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + positives + '</div><div class="mv-stat-k">Positive match</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + partials + '</div><div class="mv-stat-k">Partial match</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + negatives + '</div><div class="mv-stat-k">Negative</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + falsePos + '</div><div class="mv-stat-k">False positive</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="accent">' + pending + '</div><div class="mv-stat-k">Pending review</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + adverseHits + '</div><div class="mv-stat-k">Adverse media</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + specialHits + '</div><div class="mv-stat-k">PF/TF/Tax/Dual</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v">24h</div><div class="mv-stat-k">EOCN freeze</div></div>',
      '</div>',

      '<form id="sc-subject-form" class="mv-form">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Subject type</span>',
            '<select name="subject_type">',
              '<option value="individual">Individual</option>',
              '<option value="entity">Entity / Organisation</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Name / Entity</span>',
            '<input type="text" name="name" required placeholder="Full legal name or registered entity"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Alias</span>',
            '<input type="text" name="alias" placeholder="Also known as / trading name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Gender</span>',
            '<select name="gender">',
              '<option value="">—</option>',
              '<option value="female">Female</option>',
              '<option value="male">Male</option>',
              '<option value="na">N/A (entity)</option>',
            '</select></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Date of birth / Registration (dd/mm/yyyy)</span>',
            '<input type="text" name="dob" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Citizenship / Registered country</span>',
            '<input type="text" name="country" placeholder="e.g. UAE, India, BVI"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Passport / Registration number</span>',
            '<input type="text" name="passport" placeholder="Passport no. or trade licence / CR no."></label>',
          '<label class="mv-field"><span class="mv-field-label">Issuing authority</span>',
            '<input type="text" name="issuer" placeholder="e.g. DED, UAE MOI, HMPO"></label>',
        '</div>',

        '<h4 class="mv-field-label" style="margin-top:14px">Sanctions lists</h4>',
        '<div class="mv-grid-2">', checkboxGroup('sanctions_lists', SANCTIONS_LISTS), '</div>',

        '<h4 class="mv-field-label" style="margin-top:14px">Adverse media categories</h4>',
        '<div class="mv-grid-2">', checkboxGroup('adverse_media', ADVERSE_MEDIA_CATEGORIES), '</div>',

        '<h4 class="mv-field-label" style="margin-top:14px">Specialised screening</h4>',
        '<div class="mv-grid-2">', specialGroup(SPECIAL_SCREENS), '</div>',

        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Run screening</button>',
          '<button type="reset" class="mv-btn mv-btn-ghost">Clear</button>',
        '</div>',
      '</form>',

      '<h3 class="mv-subhead">Recent subjects</h3>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice(-10).reverse().map(function (r, idx) {
            var disp = DISPOSITIONS[r.disposition || 'pending'] || DISPOSITIONS.pending;
            var conf = (r.confidence || 0);
            var identLine = [
              (r.subject_type === 'entity' ? 'Entity' : 'Individual'),
              r.gender ? r.gender.charAt(0).toUpperCase() + r.gender.slice(1) : null,
              r.country || null,
              r.dob ? 'DOB/Reg ' + r.dob : null,
              r.passport ? 'Doc ' + r.passport : null
            ].filter(Boolean).map(esc).join(' · ');

            // Per-list disposition chips (POSITIVE / PARTIAL / NEGATIVE per list)
            var perListHtml = '';
            if (Array.isArray(r.per_list) && r.per_list.length) {
              perListHtml = '<div class="mv-list-meta" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' +
                r.per_list.map(function (pl) {
                  var plDisp = DISPOSITIONS[pl.disposition] || DISPOSITIONS.negative;
                  var countSuffix = pl.hit_count > 0 ? ' · ' + pl.hit_count + ' hit' + (pl.hit_count === 1 ? '' : 's') : '';
                  return '<span class="mv-badge" data-tone="' + plDisp.tone + '">' +
                    esc(pl.list) + ': ' + plDisp.label + countSuffix + '</span>';
                }).join('') +
              '</div>';
            }

            // Hit detail (top 3 candidates per list with breakdown percentages)
            var hitDetailHtml = '';
            if (Array.isArray(r.per_list)) {
              var allHits = [];
              r.per_list.forEach(function (pl) {
                if (Array.isArray(pl.hits)) {
                  pl.hits.forEach(function (h) { allHits.push({ list: pl.list, h: h }); });
                }
              });
              if (allHits.length) {
                hitDetailHtml = '<div class="mv-list-meta" style="margin-top:4px;opacity:.85">' +
                  allHits.slice(0, 3).map(function (x) {
                    var b = x.h.breakdown || {};
                    return '<strong>' + esc(x.list) + '</strong> → ' + esc(x.h.candidate) +
                      ' (' + Math.round(((b.score || 0) * 100)) + '%' +
                      (b.jaroWinkler ? ', JW ' + Math.round(b.jaroWinkler * 100) + '%' : '') +
                      (b.tokenSet ? ', Tok ' + Math.round(b.tokenSet * 100) + '%' : '') +
                      ')';
                  }).join('<br>') +
                '</div>';
              }
            }

            var adverseHitsLine = Array.isArray(r.adverse_media_hits) && r.adverse_media_hits.length
              ? '<div class="mv-list-meta" data-tone="warn">Adverse media: ' + r.adverse_media_hits.map(esc).join(', ') + '</div>' : '';
            var knownSourceLine = r.known_adverse_source && r.known_adverse_source.url
              ? '<div class="mv-list-meta" data-tone="warn">' +
                  'Public source: <a href="' + esc(r.known_adverse_source.url) + '" target="_blank" rel="noopener noreferrer">' +
                    esc(r.known_adverse_source.source) +
                  '</a>' +
                  (r.known_adverse_source.summary
                    ? '<br><span style="opacity:.85">' + esc(r.known_adverse_source.summary) + '</span>'
                    : '') +
                '</div>'
              : '';
            var specialHitsLine = Array.isArray(r.special_flags) && r.special_flags.length
              ? '<div class="mv-list-meta" data-tone="warn">Specialised flag: ' + r.special_flags.map(esc).join(', ') + '</div>' : '';
            var integrityLine = r.integrity && r.integrity !== 'complete'
              ? '<div class="mv-list-meta" data-tone="warn">Screening integrity: ' + esc(r.integrity) + ' — re-screen when upstream recovers (FDL Art.20-21)</div>' : '';
            var sourceLine = r.source === 'backend'
              ? '<div class="mv-list-meta" style="opacity:.55">Source: live backend · ' + esc(r.run_id || 'run') + '</div>'
              : '<div class="mv-list-meta" style="opacity:.55">Source: local simulation (sign in for live screening)</div>';

            // MLRO disposition action row. Hidden for already-closed dispositions.
            var canAct = r.disposition === 'pending' || r.disposition === 'positive' || r.disposition === 'partial';
            var actionHtml = canAct
              ? '<div class="mv-form-actions" style="margin-top:8px;gap:6px;flex-wrap:wrap">' +
                  '<button class="mv-btn mv-btn-sm mv-btn-ok" data-action="sc-sub-dispose" data-id="' + esc(r.id) + '" data-d="positive">Confirm match</button>' +
                  '<button class="mv-btn mv-btn-sm" data-action="sc-sub-dispose" data-id="' + esc(r.id) + '" data-d="partial">Partial — investigate</button>' +
                  '<button class="mv-btn mv-btn-sm" data-action="sc-sub-dispose" data-id="' + esc(r.id) + '" data-d="false_positive">False positive</button>' +
                  '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="sc-sub-dispose" data-id="' + esc(r.id) + '" data-d="escalated">Escalate</button>' +
                '</div>'
              : '';

            return '<li class="mv-list-item" style="flex-direction:column;align-items:stretch">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
                '<div class="mv-list-main">' +
                  '<div class="mv-list-title">' + esc(r.name) +
                    (r.alias ? ' <em style="opacity:.7">(a.k.a. ' + esc(r.alias) + ')</em>' : '') +
                  '</div>' +
                  '<div class="mv-list-meta">' + identLine + '</div>' +
                  '<div class="mv-list-meta">Screened ' + esc(fmtDate(r.screened_at)) +
                    ' · top score ' + (conf * 100).toFixed(0) + '%</div>' +
                  perListHtml +
                  hitDetailHtml +
                  adverseHitsLine +
                  knownSourceLine +
                  specialHitsLine +
                  integrityLine +
                  sourceLine +
                '</div>' +
                '<span class="mv-badge" data-tone="' + disp.tone + '">' + disp.label + '</span>' +
              '</div>' +
              actionHtml +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128269;', 'No subjects screened yet. Run a screening above.')
    ].join('');

    var form = host.querySelector('#sc-subject-form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.disabled) return;

        var fd = new FormData(form);
        var sanctionsLists = fd.getAll('sanctions_lists');
        var adverseMedia = fd.getAll('adverse_media');
        var specialScreens = fd.getAll('special_screens');

        // Map our list ids → the backend list codes accepted by
        // netlify/functions/screening-run.mts (selectedLists contract).
        var LIST_ID_TO_BACKEND = {
          uae_eocn: 'UAE_EOCN',
          un_unsc:  'UN',
          ofac_sdn: 'OFAC',
          uk_ofsi:  'UK_OFSI',
          eu_csfl:  'EU',
          interpol: 'INTERPOL'
        };
        var backendLists = sanctionsLists
          .map(function (id) { return LIST_ID_TO_BACKEND[id]; })
          .filter(Boolean);

        var subjectTypeForm = fd.get('subject_type') || 'individual';
        var body = {
          subjectName: (fd.get('name') || '').toString().trim(),
          aliases: fd.get('alias') ? [fd.get('alias').toString().trim()] : undefined,
          entityType: subjectTypeForm === 'entity' ? 'legal_entity' : 'individual',
          dob: (fd.get('dob') || '').toString().trim() || undefined,
          country: (fd.get('country') || '').toString().trim() || undefined,
          idNumber: (fd.get('passport') || '').toString().trim() || undefined,
          eventType: 'ad_hoc',
          selectedLists: backendLists.length ? backendLists : undefined,
          enrollInWatchlist: true,
          runAdverseMedia: adverseMedia.length > 0,
          adverseMediaPredicates: adverseMedia.length > 0 ? adverseMedia : undefined,
          createAsanaTask: true
        };

        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = 'Screening…'; }

        Promise.resolve().then(function () {
          var token = '';
          try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (_) {}
          if (!token) return null; // force fallback

          var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          var timer = controller ? setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS) : null;

          return fetch(SCREENING_ENDPOINT, {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller ? controller.signal : undefined
          }).then(function (res) {
            if (timer) clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          }).catch(function () {
            if (timer) clearTimeout(timer);
            return null;
          });
        }).then(function (data) {
          var row;
          if (data && data.sanctions) {
            row = buildRowFromBackend(body, fd, data, sanctionsLists, adverseMedia, specialScreens);
          } else {
            row = buildRowFromSimulation(body, fd, sanctionsLists, adverseMedia, specialScreens);
          }
          rows.push(row);
          safeSave(STORAGE.subjects, rows);
          renderSubjectScreening(host);
        });
      });
    }

    host.querySelectorAll('[data-action="sc-sub-dispose"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var d = btn.getAttribute('data-d');
        var idx = -1;
        for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { idx = i; break; } }
        if (idx < 0) return;
        rows[idx].disposition = d;
        rows[idx].disposed_at = new Date().toISOString();
        safeSave(STORAGE.subjects, rows);
        renderSubjectScreening(host);
      };
    });
  }

  // ─── Screening row builders ─────────────────────────────────────────
  function buildRowFromBackend(body, fd, data, sanctionsLists, adverseMedia, specialScreens) {
    var perList = [];
    var topScore = 0;
    if (data.sanctions && Array.isArray(data.sanctions.perList)) {
      data.sanctions.perList.forEach(function (l) {
        var hitCount = Array.isArray(l.hits) ? l.hits.length : 0;
        var topHit = hitCount ? l.hits[0] : null;
        var cls = (topHit && topHit.classification) || l.topClassification || 'none';
        var score = topHit && topHit.breakdown && topHit.breakdown.score ? topHit.breakdown.score : 0;
        if (score > topScore) topScore = score;
        perList.push({
          list: l.list,
          disposition: dispositionFromClassification(cls),
          hit_count: hitCount,
          classification: cls,
          hits: (l.hits || []).slice(0, 5)
        });
      });
    }
    var topClass = (data.sanctions && data.sanctions.topClassification) || 'none';
    var disposition = dispositionFromClassification(topClass);
    if (disposition === 'positive' || disposition === 'partial') disposition = 'pending';

    var adverseHits = [];
    if (data.adverseMedia && Array.isArray(data.adverseMedia.hits) && data.adverseMedia.hits.length) {
      adverseHits = adverseMedia.slice(0, Math.min(adverseMedia.length, data.adverseMedia.hits.length));
    }

    return {
      id: 'sub-' + Date.now(),
      subject_type: body.entityType === 'legal_entity' ? 'entity' : 'individual',
      name: body.subjectName,
      alias: (fd.get('alias') || '').toString().trim(),
      gender: fd.get('gender') || '',
      dob: body.dob || '',
      country: body.country || '',
      passport: body.idNumber || '',
      issuer: (fd.get('issuer') || '').toString().trim(),
      confidence: topScore,
      top_classification: topClass,
      disposition: disposition,
      per_list: perList,
      sanctions_lists: sanctionsLists,
      adverse_media: adverseMedia,
      adverse_media_hits: adverseHits,
      special_screens: specialScreens,
      special_flags: [],
      integrity: data.screeningIntegrity || 'complete',
      run_id: (data.runId || data.run_id || '').toString(),
      source: 'backend',
      screened_at: new Date().toISOString()
    };
  }

  function buildRowFromSimulation(body, fd, sanctionsLists, adverseMedia, specialScreens) {
    // Deterministic keyword-based simulation so the form is still useful
    // when the MLRO hasn't signed in yet (no token = no live screening).
    var nameLower = (body.subjectName || '').toLowerCase();
    var aliasLower = ((body.aliases || [])[0] || '').toLowerCase();
    var haystack = nameLower + ' ' + aliasLower;

    // First: screen against the seeded known public adverse-media
    // register. This catches high-profile Reuters / state-media cases
    // (e.g. Istanbul gold-refinery probe, Oct 2025) that the MLRO would
    // be negligent to pass as NEGATIVE even in the pre-auth flow.
    var knownHit = findKnownAdverseMedia(body.subjectName, body.aliases);

    var conf, cls;
    if (knownHit) {
      conf = knownHit.confidence;
      cls = conf >= 0.85 ? 'confirmed' : conf >= 0.5 ? 'potential' : 'weak';
    } else {
      conf = haystack.indexOf('test-hit') >= 0 ? 0.95
        : haystack.indexOf('pep') >= 0 ? 0.55
        : 0.04;
      cls = conf >= 0.85 ? 'confirmed' : conf >= 0.5 ? 'potential' : 'weak';
    }
    var disposition = dispositionFromClassification(cls);
    if (disposition === 'positive' || disposition === 'partial') disposition = 'pending';
    // Integrity gate (FDL No.(10)/2025 Art.20-21, FATF Rec 10): a
    // simulated screen MUST NOT produce a clean NEGATIVE disposition.
    // Force PENDING REVIEW so the MLRO re-runs on the live backend
    // before closing the file.
    if (disposition === 'negative') disposition = 'pending';

    var perList = sanctionsLists.map(function (listId) {
      var item = SANCTIONS_LISTS.filter(function (l) { return l.id === listId; })[0];
      return {
        list: item ? item.label : listId,
        disposition: dispositionFromClassification(cls),
        hit_count: cls === 'weak' ? 0 : 1,
        classification: cls,
        hits: cls === 'weak' ? [] : [{
          candidate: body.subjectName + ' (simulated)',
          classification: cls,
          breakdown: { score: conf, jaroWinkler: conf, tokenSet: conf * 0.9 }
        }]
      };
    });

    var adverseHits = [];
    if (knownHit) {
      // Intersect the known-hit categories with what the MLRO asked to
      // screen for. If the MLRO disabled every category the known-hit
      // covers, fall back to the full known-hit category list so the
      // adverse-media signal is never silently dropped.
      var intersection = knownHit.categories.filter(function (c) {
        return adverseMedia.indexOf(c) >= 0;
      });
      adverseHits = intersection.length ? intersection : knownHit.categories.slice();
    } else if (haystack.indexOf('test-adverse') >= 0) {
      adverseHits = adverseMedia.slice(0, 3);
    } else if (haystack.indexOf('pep') >= 0 && adverseMedia.indexOf('political_pep') >= 0) {
      adverseHits.push('political_pep');
    }

    var specialFlags = [];
    if (haystack.indexOf('test-pf') >= 0 && specialScreens.indexOf('proliferation') >= 0) specialFlags.push('proliferation');
    if (haystack.indexOf('test-tf') >= 0 && specialScreens.indexOf('terrorism') >= 0) specialFlags.push('terrorism');
    if (haystack.indexOf('test-tax') >= 0 && specialScreens.indexOf('tax_evasion') >= 0) specialFlags.push('tax_evasion');
    if (haystack.indexOf('test-dual') >= 0 && specialScreens.indexOf('dual_goods') >= 0) specialFlags.push('dual_goods');

    return {
      id: 'sub-' + Date.now(),
      subject_type: body.entityType === 'legal_entity' ? 'entity' : 'individual',
      name: body.subjectName,
      alias: (fd.get('alias') || '').toString().trim(),
      gender: fd.get('gender') || '',
      dob: body.dob || '',
      country: body.country || '',
      passport: body.idNumber || '',
      issuer: (fd.get('issuer') || '').toString().trim(),
      confidence: conf,
      top_classification: cls,
      disposition: disposition,
      per_list: perList,
      sanctions_lists: sanctionsLists,
      adverse_media: adverseMedia,
      adverse_media_hits: adverseHits,
      known_adverse_source: knownHit ? {
        source: knownHit.source,
        url: knownHit.url,
        summary: knownHit.summary
      } : null,
      special_screens: specialScreens,
      special_flags: specialFlags,
      integrity: 'simulated',
      source: 'simulation',
      screened_at: new Date().toISOString()
    };
  }

  function classifyTxAlert(row) {
    var amt = row.amount || 0;
    var flags = [];
    if (row.channel === 'cash' && amt >= 55000) flags.push('DPMS CTR (AED 55K)');
    if (row.cross_border && amt >= 60000) flags.push('Cross-border declaration (AED 60K)');
    if (amt >= 50000 && amt < 55000) flags.push('Structuring near AED 55K');
    if (row.third_party_payer) flags.push('Third-party payer');
    if (row.offshore_routing) flags.push('Offshore routing');
    if (amt > 0 && amt % 10000 === 0 && amt >= 30000) flags.push('Round-number');
    if (row.velocity_spike) flags.push('Velocity spike');
    if (row.price_gaming) flags.push('Price gaming');
    return flags.length ? flags.join(' · ') : null;
  }

  function renderTransactionMonitor(host) {
    var rows = safeParse(STORAGE.transactions, []);
    var alerts = rows.filter(function (r) { return r.alert; });
    var critical = rows.filter(function (r) {
      return (r.alert || '').indexOf('DPMS CTR') >= 0 || (r.alert || '').indexOf('Cross-border') >= 0;
    });

    host.innerHTML = [
      head('Transaction Monitor',
        '<span class="mv-pill">AED 55K DPMS CTR · AED 60K cross-border</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-tx-new-toggle">+ Add transaction</button>'
      ),
      '<p class="mv-lede">Rule + behavioural engine: structuring near AED 55K, velocity spikes, third-party payers, offshore routing, round-number and price-gaming patterns. Critical alerts auto-open an Asana case.</p>',
      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Transactions</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + alerts.length + '</div><div class="mv-stat-k">Alerts</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + critical.length + '</div><div class="mv-stat-k">Reportable</div></div>',
      '</div>',

      '<form id="sc-tx-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Transaction reference</span>',
            '<input type="text" name="ref" placeholder="TXN-2026-0001"></label>',
          '<label class="mv-field"><span class="mv-field-label">Counterparty</span>',
            '<input type="text" name="counterparty" required placeholder="Customer / entity name"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Amount (AED)</span>',
            '<input type="number" name="amount" min="0" step="0.01" required placeholder="0.00"></label>',
          '<label class="mv-field"><span class="mv-field-label">Currency (original)</span>',
            '<input type="text" name="currency" value="AED" placeholder="AED"></label>',
          '<label class="mv-field"><span class="mv-field-label">Occurred on (dd/mm/yyyy)</span>',
            '<input type="text" name="occurred_on" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Channel</span>',
            '<select name="channel">',
              '<option value="cash">Cash (DPMS)</option>',
              '<option value="wire">Wire / SWIFT</option>',
              '<option value="card">Card</option>',
              '<option value="metal">Physical metal transfer</option>',
              '<option value="crypto">Virtual asset</option>',
              '<option value="other">Other</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Direction</span>',
            '<select name="direction">',
              '<option value="inbound">Inbound</option>',
              '<option value="outbound">Outbound</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Counterparty country</span>',
            '<input type="text" name="cp_country" placeholder="e.g. UAE, IN, CH"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Payment method / rails</span>',
            '<input type="text" name="method" placeholder="e.g. EmiratesNBD, Al Etihad, cash drop"></label>',
          '<label class="mv-field"><span class="mv-field-label">Source of funds declared</span>',
            '<input type="text" name="source_of_funds" placeholder="e.g. salary, business revenue, inheritance"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="cross_border"><span>Cross-border</span></label>',
          '<label class="mv-check"><input type="checkbox" name="third_party_payer"><span>Third-party payer</span></label>',
          '<label class="mv-check"><input type="checkbox" name="offshore_routing"><span>Offshore routing</span></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-check"><input type="checkbox" name="velocity_spike"><span>Velocity spike</span></label>',
          '<label class="mv-check"><input type="checkbox" name="price_gaming"><span>Price-gaming pattern</span></label>',
          '<label class="mv-check"><input type="checkbox" name="pep_linked"><span>PEP-linked</span></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Notes</span>',
          '<textarea name="notes" rows="2" placeholder="Behavioural context, observed pattern, linked STR reference…"></textarea></label>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Log transaction</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="sc-tx-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      rows.length
        ? '<ul class="mv-list">' + rows.slice(-20).reverse().map(function (r) {
            var tone = r.alert ? ((r.alert.indexOf('DPMS') >= 0 || r.alert.indexOf('Cross-border') >= 0) ? 'warn' : 'accent') : 'ok';
            var label = r.alert || 'Clean';
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.counterparty) + ' — AED ' + esc((r.amount || 0).toLocaleString()) +
                  (r.ref ? ' <em style="opacity:.7">(' + esc(r.ref) + ')</em>' : '') +
                '</div>' +
                '<div class="mv-list-meta">' +
                  esc(fmtDate(r.occurred_on)) + ' · ' + esc(r.channel || 'cash') +
                  ' · ' + esc(r.direction || 'inbound') +
                  (r.cp_country ? ' · ' + esc(r.cp_country) : '') +
                  (r.method ? ' · ' + esc(r.method) : '') +
                '</div>' +
                (r.notes ? '<div class="mv-list-meta" style="opacity:.75">' + esc(r.notes) + '</div>' : '') +
              '</div>' +
              '<span class="mv-badge" data-tone="' + tone + '">' + esc(label) + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128200;', 'No transactions being monitored.')
    ].join('');

    host.querySelectorAll('[data-action="sc-tx-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#sc-tx-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#sc-tx-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var row = {
          id: 'tx-' + Date.now(),
          ref: (fd.get('ref') || '').toString().trim(),
          counterparty: (fd.get('counterparty') || '').toString().trim(),
          amount: parseFloat(fd.get('amount')) || 0,
          currency: (fd.get('currency') || 'AED').toString().trim(),
          occurred_on: (fd.get('occurred_on') || '').toString().trim() || new Date().toISOString().slice(0, 10),
          channel: fd.get('channel') || 'cash',
          direction: fd.get('direction') || 'inbound',
          cp_country: (fd.get('cp_country') || '').toString().trim(),
          method: (fd.get('method') || '').toString().trim(),
          source_of_funds: (fd.get('source_of_funds') || '').toString().trim(),
          cross_border: fd.get('cross_border') === 'on',
          third_party_payer: fd.get('third_party_payer') === 'on',
          offshore_routing: fd.get('offshore_routing') === 'on',
          velocity_spike: fd.get('velocity_spike') === 'on',
          price_gaming: fd.get('price_gaming') === 'on',
          pep_linked: fd.get('pep_linked') === 'on',
          notes: (fd.get('notes') || '').toString().trim(),
          created_at: new Date().toISOString()
        };
        if (!row.counterparty) return;
        row.alert = classifyTxAlert(row);
        rows.push(row);
        safeSave(STORAGE.transactions, rows);
        renderTransactionMonitor(host);
      };
    }
  }

  var STR_KINDS = [
    ['STR',  'STR — Suspicious Transaction Report'],
    ['SAR',  'SAR — Suspicious Activity Report'],
    ['AIF',  'AIF — Additional Information File'],
    ['PEPR', 'PEPR — PEP Report'],
    ['HRCR', 'HRCR — High Risk Country Report'],
    ['FTFR', 'FTFR — Foreign Terrorist Fighter Report']
  ];
  var STR_RED_FLAGS = [
    'Structuring / smurfing near AED 55K',
    'Velocity spike (unusual transaction frequency)',
    'Third-party payer',
    'Offshore / high-risk jurisdiction routing',
    'Round-number or price-gaming pattern',
    'Sanctions / PEP match',
    'UBO obscured / shell-company indicator',
    'Dual-use / strategic goods red flag',
    'Adverse media hit',
    'Cash-intensive business inconsistency',
    'Source of funds unclear',
    'Non-cooperation with CDD request',
    'Refusal of source-of-wealth evidence',
    'Rapid movement in/out of metals / VASP',
    'Inconsistent with customer profile'
  ];
  var STR_STATUSES = [
    ['draft',      'Draft'],
    ['review',     'MLRO review'],
    ['approved',   'Approved (four-eyes)'],
    ['submitted',  'Submitted to goAML'],
    ['acknowledged','Acknowledged by FIU'],
    ['closed',     'Closed']
  ];

  function renderSTRCases(host) {
    var rows = safeParse(STORAGE.strCases, []);
    var open = rows.filter(function (r) { return r.status !== 'closed' && r.status !== 'acknowledged'; });
    var submitted = rows.filter(function (r) { return r.status === 'submitted' || r.status === 'acknowledged'; });
    var overdue = rows.filter(function (r) {
      if (!r.deadline || r.status === 'submitted' || r.status === 'acknowledged' || r.status === 'closed') return false;
      return new Date(r.deadline).getTime() < Date.now();
    });

    host.innerHTML = [
      head('STR Case Management',
        '<span class="mv-pill">FDL Art.26-27 · file without delay</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-str-new-toggle">+ New case</button>'
      ),
      '<p class="mv-lede">STR / SAR / AIF / PEPR / HRCR / FTFR case files with red-flag taxonomy, suspicion narrative, goAML reference, and four-eyes approval. No tipping off.</p>',

      '<div class="mv-stat-row">',
        '<div class="mv-stat"><div class="mv-stat-v">' + rows.length + '</div><div class="mv-stat-k">Total</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + open.length + '</div><div class="mv-stat-k">Open</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="ok">' + submitted.length + '</div><div class="mv-stat-k">Submitted</div></div>',
        '<div class="mv-stat"><div class="mv-stat-v" data-tone="warn">' + overdue.length + '</div><div class="mv-stat-k">Overdue</div></div>',
      '</div>',

      '<form id="sc-str-form" class="mv-form" style="display:none">',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Case title</span>',
            '<input type="text" name="title" required placeholder="Short case descriptor"></label>',
          '<label class="mv-field"><span class="mv-field-label">Report kind</span>',
            '<select name="kind">',
              STR_KINDS.map(function (p) {
                return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Subject / Entity</span>',
            '<input type="text" name="subject" placeholder="Customer, counterparty, or entity"></label>',
          '<label class="mv-field"><span class="mv-field-label">Subject country</span>',
            '<input type="text" name="subject_country" placeholder="e.g. UAE, IN, RU"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Transaction amount (AED)</span>',
            '<input type="number" name="amount" min="0" step="0.01" placeholder="0.00"></label>',
          '<label class="mv-field"><span class="mv-field-label">Detected on (dd/mm/yyyy)</span>',
            '<input type="text" name="detected_on" placeholder="dd/mm/yyyy"></label>',
          '<label class="mv-field"><span class="mv-field-label">Filing deadline (dd/mm/yyyy)</span>',
            '<input type="text" name="deadline" placeholder="without delay — FDL Art.26-27"></label>',
        '</div>',
        '<label class="mv-field"><span class="mv-field-label">Red-flag taxonomy</span>',
          '<select name="red_flag">',
            '<option value="">Select red-flag category…</option>',
            STR_RED_FLAGS.map(function (f) {
              return '<option value="' + esc(f) + '">' + esc(f) + '</option>';
            }).join(''),
          '</select></label>',
        '<label class="mv-field"><span class="mv-field-label">Suspicion narrative</span>',
          '<textarea name="narrative" rows="4" placeholder="Who, what, when, where, why it is suspicious. Do NOT include tip-off-risking phrasing (FDL Art.29)."></textarea></label>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">goAML reference</span>',
            '<input type="text" name="goaml_ref" placeholder="e.g. RPT-2026-0001"></label>',
          '<label class="mv-field"><span class="mv-field-label">MLRO (preparer)</span>',
            '<input type="text" name="mlro" placeholder="MLRO name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Four-eyes approver</span>',
            '<input type="text" name="approver" placeholder="Second approver"></label>',
        '</div>',
        '<div class="mv-grid-2">',
          '<label class="mv-field"><span class="mv-field-label">Status</span>',
            '<select name="status">',
              STR_STATUSES.map(function (p) {
                return '<option value="' + esc(p[0]) + '"' + (p[0] === 'draft' ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
              }).join(''),
            '</select></label>',
          '<label class="mv-check" style="align-self:end"><input type="checkbox" name="no_tip_off" checked><span>No tipping-off observed (FDL Art.29)</span></label>',
        '</div>',
        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Open case</button>',
          '<button type="button" class="mv-btn mv-btn-ghost" data-action="sc-str-new-toggle">Cancel</button>',
        '</div>',
      '</form>',

      '<h3 class="mv-subhead">Register</h3>',
      rows.length
        ? '<ul class="mv-list">' + rows.slice().reverse().slice(0, 30).map(function (r) {
            var overdueFlag = r.deadline && r.status !== 'submitted' && r.status !== 'acknowledged' && r.status !== 'closed'
              && new Date(r.deadline).getTime() < Date.now();
            var tone = overdueFlag ? 'warn'
              : r.status === 'submitted' || r.status === 'acknowledged' ? 'ok'
              : r.status === 'approved' ? 'accent'
              : 'warn';
            var statusLabel = (STR_STATUSES.filter(function (p) { return p[0] === r.status; })[0] || [r.status || 'draft','Draft'])[1];
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.title || r.subject || '—') +
                  ' <span class="mv-badge" data-tone="accent">' + esc(r.kind || 'STR') + '</span>' +
                '</div>' +
                '<div class="mv-list-meta">' +
                  (r.subject ? 'Subject: ' + esc(r.subject) : '') +
                  (r.subject_country ? ' · ' + esc(r.subject_country) : '') +
                  (r.amount ? ' · AED ' + esc(Number(r.amount).toLocaleString()) : '') +
                  ' · detected ' + esc(fmtDate(r.detected_on)) +
                  ' · deadline ' + esc(fmtDate(r.deadline)) +
                '</div>' +
                (r.red_flag ? '<div class="mv-list-meta">Red flag: ' + esc(r.red_flag) + '</div>' : '') +
                (r.narrative ? '<div class="mv-list-meta" style="opacity:.75">' + esc(r.narrative.slice(0, 180)) + (r.narrative.length > 180 ? '…' : '') + '</div>' : '') +
                (r.goaml_ref ? '<div class="mv-list-meta">goAML ' + esc(r.goaml_ref) + '</div>' : '') +
              '</div>' +
              '<span class="mv-badge" data-tone="' + tone + '">' + esc(statusLabel) + (overdueFlag ? ' · overdue' : '') + '</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128204;', 'No STR cases open.')
    ].join('');

    host.querySelectorAll('[data-action="sc-str-new-toggle"]').forEach(function (btn) {
      btn.onclick = function () {
        var form = host.querySelector('#sc-str-form');
        if (!form) return;
        form.style.display = form.style.display === 'none' ? '' : 'none';
        if (form.style.display !== 'none') form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
    var form = host.querySelector('#sc-str-form');
    if (form) {
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var fd = new FormData(form);
        var toIso = function (dmy) {
          var s = (dmy || '').toString().trim();
          var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!m) return '';
          return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
        };
        rows.push({
          id: 'str-' + Date.now(),
          title: (fd.get('title') || '').toString().trim(),
          kind: fd.get('kind') || 'STR',
          subject: (fd.get('subject') || '').toString().trim(),
          subject_country: (fd.get('subject_country') || '').toString().trim(),
          amount: parseFloat(fd.get('amount')) || 0,
          detected_on: toIso(fd.get('detected_on')) || new Date().toISOString().slice(0, 10),
          deadline: toIso(fd.get('deadline')) || '',
          red_flag: fd.get('red_flag') || '',
          narrative: (fd.get('narrative') || '').toString().trim(),
          goaml_ref: (fd.get('goaml_ref') || '').toString().trim(),
          mlro: (fd.get('mlro') || '').toString().trim(),
          approver: (fd.get('approver') || '').toString().trim(),
          status: fd.get('status') || 'draft',
          no_tip_off: fd.get('no_tip_off') === 'on',
          opened_on: new Date().toISOString().slice(0, 10)
        });
        safeSave(STORAGE.strCases, rows);
        renderSTRCases(host);
      };
    }
  }

  function renderWatchlist(host) {
    var rows = safeParse(STORAGE.watchlist, []);
    host.innerHTML = [
      head('Active Watchlist',
        '<span class="mv-pill">2 ×/day re-screen · FDL Art.20-21</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-wl-new">+ Watch subject</button>'
      ),
      '<p class="mv-lede">Every screened subject auto-enrolled in ongoing monitoring. Two scheduled crons per day (06:00 / 14:00 UTC) re-screen the full watchlist and push delta alerts to Asana.</p>',
      rows.length
        ? '<ul class="mv-list">' + rows.map(function (r) {
            return '<li class="mv-list-item">' +
              '<div class="mv-list-main">' +
                '<div class="mv-list-title">' + esc(r.name) + '</div>' +
                '<div class="mv-list-meta">Added ' + esc(fmtDate(r.added_on)) + ' · last scan ' + esc(fmtDate(r.last_scan)) + '</div>' +
              '</div>' +
              '<span class="mv-badge" data-tone="ok">Monitoring</span>' +
            '</li>';
          }).join('') + '</ul>'
        : emptyState('&#128065;', 'Watchlist is empty.')
    ].join('');

    host.querySelectorAll('[data-action="sc-wl-new"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = prompt('Subject name to watch?');
        if (!name) return;
        rows.push({
          id: 'wl-' + Date.now(), name: name.trim(),
          added_on: new Date().toISOString().slice(0, 10),
          last_scan: new Date().toISOString().slice(0, 10)
        });
        safeSave(STORAGE.watchlist, rows);
        renderWatchlist(host);
      });
    });
  }

  window.__landingModules = window.__landingModules || {};
  window.__landingModules['screening-command'] = {
    screening: renderSubjectScreening,
    'subject-screening': renderSubjectScreening,
    'transaction-monitor': renderTransactionMonitor,
    str: renderSTRCases,
    'str-cases': renderSTRCases,
    watchlist: renderWatchlist
  };
})();
