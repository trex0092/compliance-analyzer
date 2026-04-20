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
    var conf = haystack.indexOf('test-hit') >= 0 ? 0.95
      : haystack.indexOf('pep') >= 0 ? 0.55
      : 0.04;
    var cls = conf >= 0.85 ? 'confirmed' : conf >= 0.5 ? 'potential' : 'weak';
    var disposition = dispositionFromClassification(cls);
    if (disposition === 'positive' || disposition === 'partial') disposition = 'pending';

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
    if (haystack.indexOf('test-adverse') >= 0) adverseHits = adverseMedia.slice(0, 3);
    else if (haystack.indexOf('pep') >= 0 && adverseMedia.indexOf('political_pep') >= 0) adverseHits.push('political_pep');

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

  // ─── Intelligence Drawer wiring ─────────────────────────────────────────
  //
  // Registers the screening-command landing with the shared Intelligence
  // drawer (PR #372 — intelligence-drawer.js). The drawer pushes the
  // landing's own localStorage snapshot through the weaponized brain
  // (brain-boot.js) for on-device typology pre-scan plus server-side
  // MegaBrain deep analysis when an auth token is present.
  //
  // Regulatory basis:
  //   FDL No.(10)/2025 Art.20-21 (CO duties), Art.26-27 (STR filing),
  //   Art.29 (no tipping off — redactions applied before API call),
  //   Cabinet Res 134/2025 Art.19 (internal review),
  //   Cabinet Res 74/2020 Art.4-7 (24h freeze),
  //   FATF Rec 10, 12, 15, 20, 22 · NIST AI RMF 1.0.
  function mountIntelligenceDrawer() {
    if (!window.__intelligenceDrawer) return;

    // Map a subject row (as stored by renderSubjectScreening / buildRow*)
    // onto the entity shape that brain-boot.js typology rules consume.
    function topScore(r) {
      if (!r) return 0;
      if (typeof r.confidence === 'number') return r.confidence;
      if (Array.isArray(r.per_list_breakdown)) {
        var m = 0;
        r.per_list_breakdown.forEach(function (pl) {
          var s = (pl && pl.score) || 0;
          if (s > m) m = s;
        });
        return m;
      }
      return 0;
    }
    function pickHighestRisk(subjects) {
      if (!Array.isArray(subjects) || !subjects.length) return null;
      var ranked = subjects.slice().sort(function (a, b) {
        var dispRank = { positive: 4, partial: 3, escalated: 3, pending: 2, false_positive: 1, negative: 0 };
        var da = dispRank[a.disposition] || 0;
        var db = dispRank[b.disposition] || 0;
        if (db !== da) return db - da;
        return topScore(b) - topScore(a);
      });
      return ranked[0];
    }
    function toBrainEntity(snap) {
      var subjects = snap.keys.subjects || [];
      var txs = snap.keys.transactions || [];
      var strs = snap.keys.strCases || [];
      var pick = pickHighestRisk(subjects) || {};
      var adverseBucket = (pick.adverse_media_hits || []).length;
      var specialBucket = (pick.special_flags || []);
      var adverseScore = Math.min(1, adverseBucket / 5);
      var sanctionsScore = topScore(pick);
      var pepMatch = specialBucket.indexOf('pep_screening') >= 0 || specialBucket.indexOf('pep') >= 0 || !!pick.pep;
      var sofVerified = pick.source_of_funds_verified !== false;
      var uboVerified = pick.ubo_verified !== false;
      return {
        id: pick.id || ('screening-command-' + (subjects.length || 0)),
        subjectName: pick.name || pick.subject_name || '',
        subjectType: pick.subject_type || 'individual',
        riskRating: pick.risk_rating || (sanctionsScore >= 0.85 ? 'HIGH' : sanctionsScore >= 0.5 ? 'MEDIUM' : 'LOW'),
        sanctionsMatchScore: sanctionsScore,
        adverseMediaScore: adverseScore,
        pepScreenResult: pepMatch ? 'MATCH' : 'CLEAR',
        pepDisclosed: !!pick.pep_disclosed,
        isPep: pepMatch,
        sofVerified: sofVerified,
        uboVerified: uboVerified,
        uboDepth: pick.ubo_depth || 0,
        cddExpiryDate: pick.cdd_expiry || null,
        strCasesOpen: strs.filter(function (s) { return s.status !== 'submitted' && s.status !== 'acknowledged' && s.status !== 'closed'; }).length,
        strCasesOverdue: strs.filter(function (s) {
          if (!s.deadline) return false;
          if (s.status === 'submitted' || s.status === 'acknowledged' || s.status === 'closed') return false;
          return new Date(s.deadline) < new Date();
        }).length,
        txCount: txs.length,
        lastActivityDate: txs.length ? txs[txs.length - 1].occurred_on : null,
        screeningListCoverage: Array.isArray(pick.sanctions_lists) ? pick.sanctions_lists.length : 0
      };
    }

    // Map the transaction-monitor rows into the shape brain-boot typology
    // rules expect (amount, date, counterpartyCountry, method, channel, …).
    function toBrainTxs(snap) {
      var txs = snap.keys.transactions || [];
      return txs.map(function (t) {
        var channel = (t.channel || '').toString().toUpperCase();
        var method = (t.method || t.channel || '').toString().toUpperCase();
        return {
          id: t.id,
          amount: t.amount || 0,
          currency: t.currency || 'AED',
          date: t.occurred_on || t.created_at || new Date().toISOString(),
          counterpartyCountry: (t.cp_country || '').toString().toUpperCase(),
          method: method,
          channel: channel,
          type: (t.direction || 'inbound').toUpperCase(),
          crossBorder: !!t.cross_border,
          thirdPartyPayer: !!t.third_party_payer,
          offshoreRouting: !!t.offshore_routing,
          pepLinked: !!t.pep_linked,
          priceGaming: !!t.price_gaming
        };
      });
    }

    // Preset 1 — rank subjects by sanctions proximity.
    function presetSanctionsRank(ctx) {
      var subjects = (ctx.snap.keys.subjects) || [];
      if (!subjects.length) return { verdict: 'clear', summary: 'No subjects loaded.', citations: [] };
      var ranked = subjects.slice().sort(function (a, b) { return topScore(b) - topScore(a); });
      var lines = ranked.slice(0, 10).map(function (s, i) {
        var disp = (DISPOSITIONS[s.disposition] || {}).label || 'PENDING';
        return (i + 1) + '. ' + (s.name || '—') + ' — score ' + (topScore(s) * 100).toFixed(1) + '% · ' + disp;
      });
      var top = ranked[0];
      var verdict = topScore(top) >= 0.85 ? 'freeze' : topScore(top) >= 0.5 ? 'review' : 'monitor';
      return {
        verdict: verdict,
        confidence: topScore(top),
        summary: 'Top sanctions-proximity ranking:\n\n' + lines.join('\n'),
        citations: ['FDL No.(10)/2025 Art.35', 'Cabinet Res 74/2020 Art.4-7', 'UNSCR 1267 / 1373']
      };
    }

    // Preset 2 — detect structuring across transactions (amounts just
    // below the AED 55K DPMS CTR threshold and the AED 60K cross-border).
    function presetStructuring(ctx) {
      var txs = ctx.txs || [];
      if (!txs.length) return { verdict: 'clear', summary: 'No transactions loaded.', citations: [] };
      var nearDpms = txs.filter(function (t) { return t.amount >= 45000 && t.amount < 55000; });
      var nearCross = txs.filter(function (t) { return t.crossBorder && t.amount >= 50000 && t.amount < 60000; });
      var byDay = {};
      txs.forEach(function (t) {
        var d = (t.date || '').slice(0, 10);
        byDay[d] = (byDay[d] || 0) + (t.amount || 0);
      });
      var burstDays = Object.keys(byDay).filter(function (d) { return byDay[d] > 150000; }).length;
      var hit = nearDpms.length >= 3 || nearCross.length >= 2 || burstDays >= 1;
      return {
        verdict: hit ? 'file_str' : 'monitor',
        confidence: hit ? 0.78 : 0.3,
        summary: [
          'Near-DPMS-threshold transactions (AED 45K–55K): ' + nearDpms.length,
          'Near-cross-border-threshold transactions (AED 50K–60K, crossBorder=true): ' + nearCross.length,
          'Same-day aggregated bursts (> AED 150K): ' + burstDays,
          '',
          hit ? 'Structuring pattern detected. Draft STR (FDL Art.26-27) and do NOT tip off (Art.29).'
              : 'No structuring pattern detected in the current window.'
        ].join('\n'),
        citations: ['FDL No.(10)/2025 Art.26-27', 'MoE Circular 08/AML/2021', 'Cabinet Res 134/2025 Art.16', 'FATF Rec 20']
      };
    }

    // Preset 3 — Benford's-law first-digit audit on transaction amounts.
    function presetBenford(ctx) {
      var txs = ctx.txs || [];
      var amounts = txs.map(function (t) { return Math.abs(t.amount || 0); }).filter(function (a) { return a > 0; });
      if (amounts.length < 10) {
        return { verdict: 'monitor', confidence: 0.2,
          summary: "Need at least 10 non-zero amounts to run Benford's law (have " + amounts.length + ').',
          citations: ['FDL No.(10)/2025 Art.19', 'FATF Rec 10'] };
      }
      var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      amounts.forEach(function (a) {
        var s = String(a).replace(/\D/g, '');
        var d = parseInt(s.charAt(0), 10);
        if (d >= 1 && d <= 9) counts[d]++;
      });
      var expected = [0, 0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];
      var chi2 = 0;
      var lines = [];
      for (var d = 1; d <= 9; d++) {
        var observed = counts[d] / amounts.length;
        chi2 += Math.pow(observed - expected[d], 2) / expected[d];
        lines.push('  digit ' + d + ': observed ' + (observed * 100).toFixed(1) + '% vs expected ' + (expected[d] * 100).toFixed(1) + '%');
      }
      var anomaly = chi2 > 15.5;
      return {
        verdict: anomaly ? 'review' : 'monitor',
        confidence: anomaly ? Math.min(0.95, 0.5 + chi2 / 40) : 0.35,
        summary: "Benford's law first-digit audit (n=" + amounts.length + ', chi² = ' + chi2.toFixed(2) + '):\n' + lines.join('\n') + '\n\n' +
          (anomaly ? "Distribution deviates from Benford. Manual review of invoice/transaction set recommended."
                   : "Distribution is within Benford tolerance (chi² ≤ 15.5)."),
        citations: ['FDL No.(10)/2025 Art.19', 'FATF Rec 10', 'MoE Circular 08/AML/2021']
      };
    }

    // Preset 4 — transaction velocity z-score vs a simple moving baseline.
    function presetVelocity(ctx) {
      var txs = ctx.txs || [];
      if (txs.length < 5) return { verdict: 'monitor', confidence: 0.2,
        summary: 'Need at least 5 transactions for a velocity z-score (have ' + txs.length + ').',
        citations: ['FDL No.(10)/2025 Art.16', 'FATF Rec 10'] };
      var amts = txs.map(function (t) { return t.amount || 0; });
      var mean = amts.reduce(function (s, x) { return s + x; }, 0) / amts.length;
      var variance = amts.reduce(function (s, x) { return s + Math.pow(x - mean, 2); }, 0) / amts.length;
      var sd = Math.sqrt(variance);
      var outliers = amts.map(function (a, i) { return { idx: i, z: sd ? (a - mean) / sd : 0, amount: a }; })
        .filter(function (x) { return Math.abs(x.z) >= 2.5; });
      var hit = outliers.length >= 1;
      return {
        verdict: hit ? 'review' : 'monitor',
        confidence: hit ? 0.7 : 0.3,
        summary: 'Velocity baseline: mean AED ' + mean.toFixed(0) + ', sd AED ' + sd.toFixed(0) + '.\n' +
          'Outliers (|z| ≥ 2.5): ' + outliers.length + '.\n' +
          outliers.slice(0, 5).map(function (o) { return '  tx#' + o.idx + ' — AED ' + o.amount.toFixed(0) + ' (z=' + o.z.toFixed(2) + ')'; }).join('\n'),
        citations: ['FDL No.(10)/2025 Art.16', 'FATF Rec 10', 'Cabinet Res 134/2025 Art.19']
      };
    }

    // Preset 5 — multi-jurisdiction layering detector.
    function presetLayering(ctx) {
      var txs = ctx.txs || [];
      var countries = {};
      txs.forEach(function (t) { if (t.counterpartyCountry) countries[t.counterpartyCountry] = (countries[t.counterpartyCountry] || 0) + 1; });
      var unique = Object.keys(countries);
      var highRisk = ['IR', 'KP', 'MM', 'RU', 'SY', 'BY', 'CU', 'VE', 'YE', 'LY', 'SO', 'SD'];
      var exposed = unique.filter(function (c) { return highRisk.indexOf(c) !== -1; });
      var hit = unique.length >= 5 || exposed.length >= 1;
      return {
        verdict: hit ? 'review' : 'monitor',
        confidence: hit ? 0.72 : 0.3,
        summary: 'Unique counterparty jurisdictions: ' + unique.length + '.\n' +
          'High-risk exposure: ' + (exposed.length ? exposed.join(', ') : 'none') + '.\n' +
          unique.map(function (c) { return '  ' + c + ' × ' + countries[c]; }).join('\n') + '\n\n' +
          (hit ? 'Multi-jurisdiction layering signal — run EDD per Cabinet Res 134/2025 Art.14.'
               : 'Jurisdictional footprint within normal bounds.'),
        citations: ['FDL No.(10)/2025 Art.26', 'Cabinet Res 134/2025 Art.5', 'Cabinet Res 134/2025 Art.14', 'FATF Rec 20']
      };
    }

    // Preset 6 — draft an STR narrative (no-tip-off safe).
    function presetStrNarrative(ctx) {
      var entity = ctx.entity || {};
      var typ = (window.__brainTypology && window.__brainTypology.scan(entity, ctx.txs)) || [];
      var crit = typ.filter(function (h) { return h.severity === 'critical'; });
      var high = typ.filter(function (h) { return h.severity === 'high'; });
      var txs = ctx.txs || [];
      var totalAed = txs.filter(function (t) { return (t.currency || 'AED') === 'AED'; })
        .reduce(function (s, t) { return s + (t.amount || 0); }, 0);
      var lines = [
        'DRAFT STR NARRATIVE — MLRO review required before filing.',
        '',
        'Subject: ' + (entity.subjectName || '[unnamed]') + ' (' + (entity.subjectType || 'individual') + ')',
        'Risk rating: ' + (entity.riskRating || '—'),
        'Sanctions match score: ' + ((entity.sanctionsMatchScore || 0) * 100).toFixed(1) + '%',
        'Adverse media score: ' + ((entity.adverseMediaScore || 0) * 100).toFixed(1) + '%',
        'PEP screen: ' + (entity.pepScreenResult || '—') + (entity.pepDisclosed ? ' (disclosed)' : ''),
        '',
        'Transactional footprint: ' + txs.length + ' transactions, total AED ' + totalAed.toFixed(0) + '.',
        'Typology matches: ' + typ.length + ' (' + crit.length + ' critical, ' + high.length + ' high).',
        '',
        'Indicators observed:',
      ].concat(typ.slice(0, 8).map(function (h) {
        return '  • [' + h.severity.toUpperCase() + '] ' + h.name + ' — ' + h.typologyId + ', FATF ' + h.fatfRef + ', ' + h.uaeRef;
      })).concat([
        '',
        'Suspicion grounds: the combination of the above indicators exceeds the MLRO reporting threshold.',
        'Regulatory basis: FDL No.(10)/2025 Art.26-27 (STR filing without delay), Art.29 (no tipping off to the subject).',
        '',
        'NOTE: this draft is for internal MLRO use only. Do not disclose, discuss, or otherwise tip off',
        'the subject (Art.29). Final narrative must be reviewed by the Compliance Officer before submission',
        'via the goAML portal.'
      ]);
      return {
        verdict: crit.length ? 'file_str' : high.length ? 'review' : 'monitor',
        confidence: crit.length ? 0.85 : high.length ? 0.6 : 0.35,
        summary: lines.join('\n'),
        citations: ['FDL No.(10)/2025 Art.26-27', 'FDL No.(10)/2025 Art.29', 'Cabinet Res 134/2025 Art.19', 'FATF Rec 20']
      };
    }

    // Preset 7 — cross-module correlation across the four storage keys.
    function presetCrossModule(ctx) {
      var subjects = ctx.snap.keys.subjects || [];
      var txs = ctx.snap.keys.transactions || [];
      var strs = ctx.snap.keys.strCases || [];
      var watch = ctx.snap.keys.watchlist || [];
      var hits = [];
      var watchedNames = new Set(watch.map(function (w) { return (w.name || '').toString().toLowerCase().trim(); }));
      subjects.forEach(function (s) {
        var n = (s.name || '').toString().toLowerCase().trim();
        if (n && watchedNames.has(n)) hits.push('Subject "' + (s.name || n) + '" is already on the active watchlist.');
      });
      var txCps = new Set(txs.map(function (t) { return (t.counterparty || '').toString().toLowerCase().trim(); }).filter(Boolean));
      subjects.forEach(function (s) {
        var n = (s.name || '').toString().toLowerCase().trim();
        if (n && txCps.has(n)) hits.push('Subject "' + (s.name || n) + '" appears as a transaction counterparty.');
      });
      strs.forEach(function (s) {
        var n = (s.subject || s.subject_name || '').toString().toLowerCase().trim();
        if (n && watchedNames.has(n)) hits.push('STR case subject "' + n + '" is also on the active watchlist.');
      });
      var verdict = hits.length ? 'review' : 'clear';
      return {
        verdict: verdict,
        confidence: hits.length ? 0.7 : 0.4,
        summary: hits.length
          ? 'Cross-module correlation hits (' + hits.length + '):\n' + hits.map(function (h) { return '  • ' + h; }).join('\n')
          : 'No cross-module correlations between subjects, transactions, STR cases and the watchlist in the current snapshot.',
        citations: ['FDL No.(10)/2025 Art.20-21', 'Cabinet Res 134/2025 Art.19', 'FATF Rec 20']
      };
    }

    window.__intelligenceDrawer.mount('screening-command', {
      launcherLabel: 'Intelligence',
      topic: 'screening_command_intelligence',
      storageKeys: {
        subjects: STORAGE.subjects,
        transactions: STORAGE.transactions,
        strCases: STORAGE.strCases,
        watchlist: STORAGE.watchlist
      },
      entityBuilder: toBrainEntity,
      txBuilder: toBrainTxs,
      presets: [
        { id: 'sanctions_rank', label: 'Rank subjects by sanctions proximity',
          note: 'Sorts the subject screening list by the highest classification score.',
          fn: presetSanctionsRank },
        { id: 'structuring', label: 'Detect structuring across transactions',
          note: 'Flags amounts near AED 55K / 60K and same-day bursts.',
          fn: presetStructuring },
        { id: 'benford', label: "Benford's law first-digit audit",
          note: 'Chi-squared test on transaction first digits; flags invoice manipulation.',
          fn: presetBenford },
        { id: 'velocity', label: 'Transaction velocity z-score',
          note: 'Flags amounts outside ±2.5 standard deviations of the subject baseline.',
          fn: presetVelocity },
        { id: 'layering', label: 'Multi-jurisdiction layering detector',
          note: 'Counts unique counterparty jurisdictions and high-risk exposure.',
          fn: presetLayering },
        { id: 'str_draft', label: 'Draft STR narrative (no-tip-off safe)',
          note: 'Assembles an MLRO-review-ready narrative from typology hits. Art.29 compliant.',
          fn: presetStrNarrative },
        { id: 'cross_module', label: 'Cross-module correlation sweep',
          note: 'Checks subject / transaction / STR / watchlist intersections.',
          fn: presetCrossModule }
      ]
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountIntelligenceDrawer);
  } else {
    mountIntelligenceDrawer();
  }
})();
