/**
 * Deep Reasoning — MLRO browser surface for the advisor-assisted
 * compliance analysis endpoint (/api/brain-reason).
 *
 * Renders a collapsible card the MLRO uses to submit a free-form
 * compliance question plus optional case context, and displays the
 * Sonnet-executor reasoning text + Opus-advisor call count inline.
 *
 * Auth: reads the JWT stored by /login.html under hawkeye.session.jwt
 * (fallback: hawkeye.watchlist.adminToken legacy mirror). Posts it
 * as Authorization: Bearer <token>.
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO reasoning trail)
 * and Art.24 (every reasoning turn is logged server-side).
 * Kept as a plain IIFE so it ships unmodified to the browser via
 * publish = '.' in netlify.toml, no bundler step. No CSP hash needed
 * because it loads via <script src>, not inline.
 */
(function () {
  'use strict';

  var MOUNT_ID = 'deepReasoningMount';
  var JWT_KEY = 'hawkeye.session.jwt';
  var LEGACY_KEY = 'hawkeye.watchlist.adminToken';
  var HISTORY_KEY = 'hawkeye.deep-reasoning.history.v1';
  var HISTORY_MAX = 10;

  // MLRO question templates — 10 patterns covering the most common
  // compliance decision points. Each loads a ready-crafted question
  // that the MLRO can edit before submitting. Saves the MLRO from
  // rewriting the same scaffold each session.
  var QUESTION_TEMPLATES = [
    {
      id: 'cdd_tier',
      label: 'Classify CDD tier for a new customer',
      question: 'Given the customer profile below, what CDD tier (SDD / CDD / EDD) applies under Cabinet Res 134/2025 Art.14 and FATF Rec 10? List the specific triggers that drove the tier, the mandatory review cycle, and whether senior-management sign-off is required.'
    },
    {
      id: 'str_draft',
      label: 'Draft STR narrative',
      question: 'Draft a UAE FIU-ready STR narrative (goAML format) for the case below. Follow FDL Art.26-27 drafting standards: Who-What-When-Where-Why-How. Flag any FDL Art.29 tip-off risk and list the filing deadline.'
    },
    {
      id: 'red_flags',
      label: 'Identify red flags',
      question: 'Enumerate every AML/CFT/CPF red flag present in the case below. For each flag, cite the FATF Recommendation or Cabinet Resolution that makes it a red flag and indicate severity (low / medium / high / critical).'
    },
    {
      id: 'sanctions_action',
      label: 'Sanctions match — action plan',
      question: 'A sanctions match has been identified in the case below. Walk through the mandatory action sequence under Cabinet Res 74/2020 Art.4-7 (24h freeze, EOCN notify, 5-business-day CNMR) and the FDL Art.29 no-tipping-off constraints.'
    },
    {
      id: 'pep_edd',
      label: 'PEP — EDD scope',
      question: 'The subject is a PEP (FATF Rec 12). Scope the EDD requirements: source-of-wealth evidence, senior-management approval chain, ongoing-monitoring cadence, and close-associates / family extension per Wolfsberg PEP FAQs.'
    },
    {
      id: 'dpms_threshold',
      label: 'DPMS threshold check',
      question: 'Using MoE Circular 08/AML/2021 and FDL Art.2, does the transaction below breach the AED 55K DPMS CTR threshold or the AED 60K cross-border threshold? If yes, list the filing obligations, deadlines, and the goAML report type.'
    },
    {
      id: 'ubo_chain',
      label: 'UBO chain analysis',
      question: 'Trace the beneficial-ownership chain below to the ≥25% threshold under Cabinet Decision 109/2023. Identify any opacity / secrecy-jurisdiction layer, any PEP-nexus UBO, and the re-verification deadline.'
    },
    {
      id: 'typology_match',
      label: 'Match to AML typology',
      question: 'Match the pattern below to the closest FATF / LBMA typology (TBML, DPMS layering, shell-company fronting, sanctions evasion, kleptocracy, etc.). Cite the typology reference and list the standard red-flag indicators expected for that typology.'
    },
    {
      id: 'filing_deadline',
      label: 'Compute filing deadlines',
      question: 'For the event below, compute every applicable filing deadline (STR, CTR, DPMSR, CNMR, EOCN freeze window) in UAE business days using src/utils/businessDays.ts semantics. Cite the article driving each deadline.'
    },
    {
      id: 'edd_sow',
      label: 'EDD — source-of-wealth requirements',
      question: 'Scope the source-of-wealth and source-of-funds evidence required for EDD on the subject below. Consider the 10-year retention rule (FDL Art.24), jurisdiction-of-origin risk, and documentary corroboration standards.'
    }
  ];

  // One-click scenario presets — load both the question AND the case
  // context so the MLRO can demo / regression-test the reasoning
  // surface against representative cases without typing.
  var SCENARIO_PRESETS = [
    {
      id: 'structuring',
      label: 'Structuring near AED 55K',
      question: 'Customer A made 4 cash deposits of AED 50K each across 3 days. What CDD level applies and what red flags are present?',
      context: 'Customer A: individual, UAE resident, retail jeweller. No prior adverse media. No PEP link. Deposits: AED 50K (Mon), 50K (Tue), 50K (Wed AM), 50K (Wed PM). All cash at the same branch. Occupation declared: gold retailer. Annual turnover declared: AED 800K.'
    },
    {
      id: 'pep_onboarding',
      label: 'PEP onboarding',
      question: 'The prospective client is a domestic PEP. What EDD steps and approvals are required before onboarding?',
      context: 'Prospective client: national of a FATF-grey jurisdiction, currently a sitting Deputy Minister. Purpose: opening a bullion-trading account with planned turnover AED 30M/year. Declared source of wealth: family business + public-sector salary. No known adverse media.'
    },
    {
      id: 'sanctions_hit',
      label: 'OFAC SDN hit',
      question: 'A returning customer has now matched OFAC SDN at 0.93 confidence. What is the mandatory action sequence?',
      context: 'Customer B: UAE legal entity, corporate gold trader, active since 2021. Quarterly re-screen on 21 Apr 2026 returned a 93% match against OFAC SDN (Russia-nexus designation under EO 14024). Pending outbound wire AED 1.2M to the matched counterparty.'
    },
    {
      id: 'cahra_supplier',
      label: 'CAHRA gold supplier',
      context: 'Counterparty: ASM gold refiner, DRC (North Kivu). Offering Dore bars @ 500g each, monthly volume 20kg. No LBMA certification; presents two OECD DD Step 2 attestations. Client onboarded 2024; prior imports from Uganda refiner (now flagged in ICGLR non-compliance bulletin).',
      question: 'Assess the due-diligence gap under LBMA RGG v9 Step 3-5 and UAE MoE RSG. Should the relationship continue?'
    },
    {
      id: 'shell_layering',
      label: 'Shell-UBO layering',
      question: 'The UBO chain has three BVI holding layers. How do we meet Cabinet Decision 109/2023 UBO obligations?',
      context: 'Client X: UAE free-zone LLC, 100% owned by BVI Co 1, which is 100% owned by BVI Co 2, which is 100% owned by a Liechtenstein Anstalt. Declared UBO: a natural person resident in Monaco. Client refuses to provide supporting BVI / Anstalt corporate documentation citing jurisdictional privacy.'
    },
    {
      id: 'str_trigger',
      label: 'STR trigger — cash + TBML signals',
      question: 'Do we need to file an STR on the pattern below? If yes, by when and what goAML code applies?',
      context: 'Customer Y: cash-intensive DPMS dealer. Pattern since Feb 2026: daily cash deposits AED 45-54K (consistently below the 55K CTR), matched by same-day outbound wire to a Hong Kong trading company; invoice references imported scrap gold but the declared weight is implausibly low for the invoice value. Customer declines to provide shipping documentation.'
    }
  ];

  function token() {
    try {
      return localStorage.getItem(JWT_KEY) || localStorage.getItem(LEGACY_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Minimal markdown → HTML for the model's output. Handles:
  //  - paragraphs (blank lines)
  //  - unordered lists ("- ", "* ")
  //  - bold (**x**)
  //  - inline code (`x`)
  // Everything else is escaped. No raw HTML from the model survives.
  function renderModelText(raw) {
    var text = escapeHtml(raw || '');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    var blocks = text.split(/\n{2,}/);
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var blk = blocks[i].trim();
      if (!blk) continue;
      var lines = blk.split('\n');
      var isList = lines.every(function (l) {
        return /^\s*[-*]\s+/.test(l);
      });
      if (isList) {
        out.push(
          '<ul>' +
            lines
              .map(function (l) {
                return '<li>' + l.replace(/^\s*[-*]\s+/, '') + '</li>';
              })
              .join('') +
            '</ul>'
        );
      } else {
        out.push('<p>' + lines.join('<br>') + '</p>');
      }
    }
    return out.join('');
  }

  // Parse the structured trailing block the executor emits per the
  // STRUCTURED_OUTPUT_GUIDANCE system prompt. Returns a map of the
  // parsed fields; missing fields are omitted. The raw reasoning
  // above the block is not touched.
  function parseStructuredOutput(raw) {
    if (!raw) return {};
    var text = String(raw);
    var out = {};
    function grab(label, rx) {
      var m = text.match(rx);
      if (m && m[1]) out[label] = m[1].trim().replace(/\s+/g, ' ');
    }
    grab('cddLevel',   /^\s*CDD LEVEL:\s*(.+)$/im);
    grab('redFlags',   /^\s*RED FLAGS:\s*(.+)$/im);
    grab('citations',  /^\s*CITATIONS:\s*(.+)$/im);
    grab('deadlines',  /^\s*DEADLINES:\s*(.+)$/im);
    grab('confidence', /^\s*CONFIDENCE:\s*(.+)$/im);
    grab('gaps',       /^\s*GAPS:\s*(.+)$/im);
    grab('followUp',   /^\s*FOLLOW-?UP:\s*(.+)$/im);
    // Fallback — if the model didn't emit the labelled block (or
    // emitted it incompletely), regex-scrape the prose for the same
    // signals. Only fills fields that the labelled grab missed, so a
    // compliant reply is never downgraded.
    if (!out.cddLevel) {
      var cddMatch = text.match(/\b(FREEZE|EDD|CDD|SDD)\b/);
      if (cddMatch) out.cddLevel = cddMatch[1];
    }
    if (!out.confidence) {
      var confMatch = text.match(/\bconfidence[:\s]+(?:is\s+|approximately\s+|around\s+|~)?(\d{1,3})\s*%/i);
      if (confMatch) out.confidence = confMatch[1] + '%';
    }
    if (!out.citations) {
      var citRx = /(FDL\s+(?:No\.?\s*\(?\d+\)?\/\d+\s+)?Art\.?\s*\d+(?:-\d+)?|Cabinet\s+Res(?:olution)?\.?\s*\d+\/\d+(?:\s+Art\.?\s*\d+(?:-\d+)?)?|Cabinet\s+Decision\s+\d+\/\d+|FATF\s+Rec(?:ommendation)?\.?\s*\d+(?:-\d+)?|LBMA\s+RGG\s+v?\d+(?:\s+Step\s+\d+(?:-\d+)?)?|MoE\s+Circular\s+\d+\/[A-Z]+\/\d+|UNSCR?\s+\d+(?:\/\d+)?)/gi;
      var seen = {};
      var cits = [];
      var cm;
      while ((cm = citRx.exec(text)) !== null && cits.length < 8) {
        var norm = cm[1].replace(/\s+/g, ' ');
        var key = norm.toLowerCase();
        if (!seen[key]) { seen[key] = true; cits.push(norm); }
      }
      if (cits.length) out.citations = cits.join(', ');
    }
    if (!out.deadlines) {
      var dlRx = /\b(\d+\s*(?:business\s+days?|working\s+days?|clock\s+hours?|hours?|days?))\b[^.;]{0,60}?(STR|SAR|CTR|DPMSR|CNMR|EOCN|freeze|filing|review|re-verif\w*)/gi;
      var dls = [];
      var dm;
      while ((dm = dlRx.exec(text)) !== null && dls.length < 5) {
        dls.push(dm[2] + ': ' + dm[1].replace(/\s+/g, ' '));
      }
      if (dls.length) out.deadlines = dls.join('; ');
    }
    // Secondary fallback for red-flags: scan for "flag" / "red flag"
    // headings followed by a bulleted / dashed list. Catches the case
    // where the model writes prose-style red-flag enumerations instead
    // of the labelled "RED FLAGS:" block.
    if (!out.redFlags) {
      var rfRx = /\bred[-\s]?flags?\b[:.\s]*\n?((?:\s*[-*·]\s*[^\n]+\n?){1,8})/i;
      var rfMatch = text.match(rfRx);
      if (rfMatch && rfMatch[1]) {
        var flags = rfMatch[1].split(/\n/)
          .map(function (l) { return l.replace(/^\s*[-*·]\s*/, '').trim(); })
          .filter(function (l) { return l.length > 0; });
        if (flags.length) out.redFlags = flags.join(', ');
      }
    }
    // Secondary fallback for gaps: look for "missing" / "need to obtain"
    // / "SOF/SOW" patterns in prose.
    if (!out.gaps) {
      var gapRx = /\b(?:missing|need to obtain|request|collect|pending)\s+([^.;\n]{10,120})/ig;
      var gaps = [];
      var gm;
      while ((gm = gapRx.exec(text)) !== null && gaps.length < 4) {
        gaps.push(gm[1].trim().replace(/\s+/g, ' '));
      }
      if (gaps.length) out.gaps = gaps.join('; ');
    }
    return out;
  }

  function splitList(s) {
    if (!s || /^none$/i.test(s)) return [];
    // Split on commas OR pipes OR semicolons; drop empty entries.
    return String(s).split(/[|,;]/)
      .map(function (v) { return v.trim(); })
      .filter(function (v) { return v.length > 0 && !/^none$/i.test(v); });
  }

  function renderStructuredBlock(parsed) {
    var keys = Object.keys(parsed || {});
    if (!keys.length) return '';
    var rows = [];
    if (parsed.cddLevel) {
      var tierColor =
        /freeze/i.test(parsed.cddLevel) ? 'background:#7f1d1d;color:#fff' :
        /edd/i.test(parsed.cddLevel)    ? 'background:#dc2626;color:#fff' :
        /cdd/i.test(parsed.cddLevel)    ? 'background:#d97706;color:#1a1a1a' :
        /sdd/i.test(parsed.cddLevel)    ? 'background:#166534;color:#fff' :
                                          'background:#4b5563;color:#fff';
      rows.push(
        '<div class="dr-box-row"><span class="dr-box-label">CDD tier</span>' +
        '<span class="dr-pill" style="' + tierColor + '">' + escapeHtml(parsed.cddLevel) + '</span></div>'
      );
    }
    if (parsed.confidence) {
      rows.push(
        '<div class="dr-box-row"><span class="dr-box-label">Confidence</span>' +
        '<span class="dr-pill dr-pill-muted">' + escapeHtml(parsed.confidence) + '</span></div>'
      );
    }
    function chipRow(label, list, tone) {
      if (!list.length) return;
      rows.push(
        '<div class="dr-box-row"><span class="dr-box-label">' + label + '</span>' +
        '<span class="dr-chips">' + list.map(function (v) {
          return '<span class="dr-chip dr-chip-' + tone + '">' + escapeHtml(v) + '</span>';
        }).join('') + '</span></div>'
      );
    }
    chipRow('Red flags', splitList(parsed.redFlags), 'warn');
    chipRow('Deadlines', splitList(parsed.deadlines), 'warn');
    chipRow('Citations', splitList(parsed.citations), 'cite');
    chipRow('Gaps',      splitList(parsed.gaps),      'gap');
    if (!rows.length) return '';
    return '<div class="dr-box"><div class="dr-box-head">Structured verdict</div>' + rows.join('') + '</div>';
  }

  function renderFollowUpButtons(parsed) {
    var items = splitList(parsed && parsed.followUp);
    if (!items.length) return '';
    var btns = items.slice(0, 3).map(function (q, i) {
      return '<button class="dr-follow" type="button" data-dr-follow-idx="' + i + '" data-dr-follow-q="' +
        escapeHtml(q).replace(/"/g, '&quot;') + '">' + escapeHtml(q) + '</button>';
    }).join('');
    return '<div class="dr-follow-wrap"><span class="dr-follow-lbl">Follow-up:</span>' + btns + '</div>';
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch (_) {}
  }
  function appendHistory(entry) {
    var list = loadHistory();
    list.unshift(entry);
    saveHistory(list);
  }
  function clearHistoryStore() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
  }

  function injectStyles() {
    if (document.getElementById('dr-style')) return;
    var s = document.createElement('style');
    s.id = 'dr-style';
    s.textContent = [
      '.dr-card { margin: 28px auto 0; max-width: 920px; padding: 22px 24px;',
      '  background: linear-gradient(180deg, rgba(30,18,50,0.72), rgba(10,6,20,0.72));',
      '  border: 1px solid rgba(255,139,209,0.28); border-radius: 16px;',
      '  box-shadow: 0 18px 60px rgba(0,0,0,0.4); color: #ece8ff; }',
      '.dr-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }',
      '.dr-title { font-size: 15px; font-weight: 700; letter-spacing: 0.02em;',
      '  background: linear-gradient(90deg,#ffd6a8,#ff8bd1 60%,#88b5ff);',
      '  -webkit-background-clip: text; background-clip: text; color: transparent; }',
      '.dr-sub { font-size: 11px; opacity: 0.7; margin-top: 4px; }',
      '.dr-toggle { background: none; border: 1px solid rgba(255,255,255,0.18);',
      '  color: #ece8ff; padding: 6px 12px; border-radius: 8px; font-size: 12px;',
      '  cursor: pointer; }',
      '.dr-toggle:hover { background: rgba(255,255,255,0.06); }',
      '.dr-body { margin-top: 16px; display: none; }',
      '.dr-body.open { display: block; }',
      '.dr-label { display: block; font-size: 11px; text-transform: uppercase;',
      '  letter-spacing: 0.08em; opacity: 0.75; margin: 12px 0 6px; }',
      '.dr-input, .dr-textarea { width: 100%; padding: 10px 12px;',
      '  background: rgba(255,255,255,0.05);',
      '  border: 1px solid rgba(255,255,255,0.14); border-radius: 10px;',
      '  color: inherit; font-size: 13px; outline: none; font-family: inherit; }',
      '.dr-textarea { min-height: 88px; resize: vertical; }',
      '.dr-input:focus, .dr-textarea:focus {',
      '  border-color: rgba(255,139,209,0.6); background: rgba(255,255,255,0.08); }',
      '.dr-actions { margin-top: 14px; display: flex; gap: 10px; align-items: center; }',
      '.dr-btn { padding: 9px 16px; background: linear-gradient(90deg,#ff8bd1,#ffd6a8);',
      '  color: #1a0a20; border: none; border-radius: 10px; font-weight: 700;',
      '  font-size: 13px; cursor: pointer; }',
      '.dr-btn:disabled { opacity: 0.5; cursor: wait; }',
      '.dr-hint { font-size: 11px; opacity: 0.6; }',
      '.dr-err { margin-top: 12px; font-size: 12px; color: #ffb0b0; min-height: 14px; }',
      '.dr-result { margin-top: 16px; padding: 14px 16px;',
      '  background: rgba(255,255,255,0.04); border-radius: 12px;',
      '  border: 1px solid rgba(255,255,255,0.1); }',
      '.dr-result p { margin: 0 0 10px; line-height: 1.55; font-size: 13px; }',
      '.dr-result p:last-child { margin-bottom: 0; }',
      '.dr-result ul { margin: 6px 0 10px 18px; font-size: 13px; line-height: 1.55; }',
      '.dr-result code { background: rgba(255,255,255,0.08); padding: 1px 5px;',
      '  border-radius: 4px; font-size: 12px; }',
      '.dr-meta { margin-top: 12px; font-size: 11px; opacity: 0.7;',
      '  display: flex; gap: 14px; flex-wrap: wrap; }',
      '.dr-meta b { color: #ffd6a8; font-weight: 600; }',
      '.dr-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0 4px; align-items: center; }',
      '.dr-select { background: rgba(255,255,255,0.05); color: #ece8ff; border: 1px solid rgba(255,255,255,0.14);',
      '  border-radius: 8px; padding: 6px 10px; font-size: 12px; font-family: inherit; }',
      '.dr-select:focus { outline: none; border-color: rgba(255,139,209,0.6); }',
      '.dr-chip-btn { background: rgba(255,139,209,0.1); color: #ffd6a8; border: 1px solid rgba(255,139,209,0.3);',
      '  border-radius: 999px; padding: 4px 10px; font-size: 11px; cursor: pointer;',
      '  font-family: inherit; transition: background 0.15s; }',
      '.dr-chip-btn:hover { background: rgba(255,139,209,0.2); }',
      '.dr-chip-btn.dr-chip-btn-ghost { background: none; color: #ece8ff; border-color: rgba(255,255,255,0.18); }',
      '.dr-chip-btn.dr-chip-btn-ghost:hover { background: rgba(255,255,255,0.06); }',
      '.dr-box { margin-top: 14px; padding: 12px 14px; border-radius: 10px;',
      '  background: rgba(255,139,209,0.05); border: 1px solid rgba(255,139,209,0.2); }',
      '.dr-box-head { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;',
      '  opacity: 0.8; margin-bottom: 8px; color: #ffd6a8; font-weight: 700; }',
      '.dr-box-row { display: flex; gap: 10px; align-items: flex-start;',
      '  margin-bottom: 6px; flex-wrap: wrap; font-size: 12px; }',
      '.dr-box-label { min-width: 90px; opacity: 0.7; font-size: 11px;',
      '  text-transform: uppercase; letter-spacing: 0.06em; padding-top: 3px; }',
      '.dr-pill { padding: 2px 8px; border-radius: 4px; font-size: 10px;',
      '  font-weight: 700; letter-spacing: 0.04em; }',
      '.dr-pill-muted { background: rgba(255,255,255,0.08); color: #ece8ff; }',
      '.dr-chips { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }',
      '.dr-chip { padding: 2px 8px; border-radius: 999px; font-size: 11px;',
      '  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }',
      '.dr-chip-warn { background: rgba(220,38,38,0.16); border-color: rgba(220,38,38,0.35); color: #fca5a5; }',
      '.dr-chip-cite { background: rgba(168,85,247,0.12); border-color: rgba(168,85,247,0.32); color: #d8b4fe; }',
      '.dr-chip-gap  { background: rgba(234,88,12,0.14); border-color: rgba(234,88,12,0.34); color: #fdba74; }',
      '.dr-follow-wrap { margin-top: 12px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }',
      '.dr-follow-lbl { font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.08em; }',
      '.dr-follow { background: rgba(136,181,255,0.12); border: 1px solid rgba(136,181,255,0.3);',
      '  color: #c3dafe; padding: 6px 10px; border-radius: 8px; font-size: 12px;',
      '  cursor: pointer; font-family: inherit; text-align: left; }',
      '.dr-follow:hover { background: rgba(136,181,255,0.22); }',
      '.dr-history { margin-top: 14px; padding: 10px 12px; border-radius: 10px;',
      '  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); display: none; }',
      '.dr-history.open { display: block; }',
      '.dr-history-item { padding: 8px; margin-bottom: 6px; border-radius: 8px;',
      '  background: rgba(255,255,255,0.04); cursor: pointer; font-size: 12px;',
      '  border: 1px solid transparent; }',
      '.dr-history-item:hover { border-color: rgba(255,139,209,0.3); }',
      '.dr-history-item:last-child { margin-bottom: 0; }',
      '.dr-history-title { font-weight: 600; font-size: 12px; margin-bottom: 2px; }',
      '.dr-history-meta { font-size: 10px; opacity: 0.65; }',
      '.dr-history-empty { font-size: 11px; opacity: 0.55; text-align: center; padding: 8px; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function render(mount) {
    var templateOptions = QUESTION_TEMPLATES.map(function (t) {
      return '<option value="' + t.id + '">' + escapeHtml(t.label) + '</option>';
    }).join('');
    var scenarioButtons = SCENARIO_PRESETS.map(function (p) {
      return '<button class="dr-chip-btn" type="button" data-dr-scenario="' + p.id + '">' +
        escapeHtml(p.label) + '</button>';
    }).join('');

    mount.innerHTML = [
      '<div class="dr-card" role="region" aria-label="Deep Reasoning">',
      '  <div class="dr-head">',
      '    <div>',
      '      <div class="dr-title">DEEP REASONING · MLRO ADVISOR</div>',
      '      <div class="dr-sub">Sonnet executor · Opus advisor · FDL Art.20-21 reasoning trail</div>',
      '    </div>',
      '    <button class="dr-toggle" id="drToggle" type="button">Open</button>',
      '  </div>',
      '  <div class="dr-body" id="drBody">',
      '    <div class="dr-row">',
      '      <select class="dr-select" id="drTemplate" aria-label="Question template">',
      '        <option value="">— Question template —</option>',
      templateOptions,
      '      </select>',
      '      <button class="dr-chip-btn dr-chip-btn-ghost" type="button" id="drHistoryToggle">History</button>',
      '      <button class="dr-chip-btn dr-chip-btn-ghost" type="button" id="drClear">Clear</button>',
      '    </div>',
      '    <div class="dr-row" style="margin-bottom:6px">',
      '      <span class="dr-follow-lbl">Presets:</span>',
      scenarioButtons,
      '    </div>',
      '    <label class="dr-label" for="drQuestion">Compliance question</label>',
      '    <textarea class="dr-textarea" id="drQuestion" maxlength="2000"',
      '      placeholder="e.g. Customer A made 4 cash deposits of AED 50k each across 3 days. What CDD level applies and what red flags are present?"></textarea>',
      '    <label class="dr-label" for="drContext">Case context (optional)</label>',
      '    <textarea class="dr-textarea" id="drContext" maxlength="8000"',
      '      placeholder="Paste the customer profile, transaction list, or STR draft here. Up to 8000 chars."></textarea>',
      '    <div class="dr-actions">',
      '      <button class="dr-btn" id="drRun" type="button">Analyze</button>',
      '      <button class="dr-chip-btn dr-chip-btn-ghost" type="button" id="drCopy" style="display:none">Copy reply</button>',
      '      <span class="dr-hint">Rate-limited 10/min per IP. Streaming · 24s budget.</span>',
      '    </div>',
      '    <div class="dr-err" id="drErr" role="status" aria-live="polite"></div>',
      '    <div id="drResultWrap"></div>',
      '    <div class="dr-history" id="drHistoryPanel" aria-label="Saved analyses"></div>',
      '  </div>',
      '</div>',
    ].join('\n');

    var toggle = mount.querySelector('#drToggle');
    var body = mount.querySelector('#drBody');
    toggle.addEventListener('click', function () {
      body.classList.toggle('open');
      toggle.textContent = body.classList.contains('open') ? 'Close' : 'Open';
      if (body.classList.contains('open')) {
        try {
          mount.querySelector('#drQuestion').focus();
        } catch (_) {}
      }
    });

    var questionEl = mount.querySelector('#drQuestion');
    var contextEl = mount.querySelector('#drContext');
    var templateEl = mount.querySelector('#drTemplate');
    var historyPanel = mount.querySelector('#drHistoryPanel');
    var historyToggle = mount.querySelector('#drHistoryToggle');
    var clearBtn = mount.querySelector('#drClear');
    var copyBtn = mount.querySelector('#drCopy');
    var runBtn = mount.querySelector('#drRun');
    var errEl = mount.querySelector('#drErr');
    var resultWrap = mount.querySelector('#drResultWrap');

    // Question-template dropdown — on select, populate the question
    // textarea (leaves case context untouched).
    templateEl.addEventListener('change', function () {
      var id = templateEl.value;
      if (!id) return;
      var tpl = QUESTION_TEMPLATES.filter(function (t) { return t.id === id; })[0];
      if (tpl) {
        questionEl.value = tpl.question;
        questionEl.focus();
      }
      templateEl.value = '';
    });

    // Scenario presets — one-click load of both fields.
    Array.prototype.forEach.call(mount.querySelectorAll('[data-dr-scenario]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-dr-scenario');
        var preset = SCENARIO_PRESETS.filter(function (p) { return p.id === id; })[0];
        if (!preset) return;
        questionEl.value = preset.question;
        contextEl.value = preset.context || '';
        questionEl.focus();
      });
    });

    // Clear — empties inputs + result + errors. History preserved.
    clearBtn.addEventListener('click', function () {
      questionEl.value = '';
      contextEl.value = '';
      resultWrap.innerHTML = '';
      errEl.textContent = '';
      copyBtn.style.display = 'none';
    });

    // History drawer — lists saved analyses. Click an item to reload
    // its question + context into the inputs for re-run / adjustment.
    function renderHistoryPanel() {
      var list = loadHistory();
      if (!list.length) {
        historyPanel.innerHTML = '<div class="dr-history-empty">No saved analyses yet.</div>';
        return;
      }
      historyPanel.innerHTML = list.map(function (entry, idx) {
        var title = (entry.question || '').slice(0, 120);
        var when = entry.ts ? new Date(entry.ts).toLocaleString() : '';
        var verdict = entry.parsed && entry.parsed.cddLevel
          ? ' · ' + escapeHtml(entry.parsed.cddLevel)
          : '';
        return '<div class="dr-history-item" data-dr-history-idx="' + idx + '">' +
          '<div class="dr-history-title">' + escapeHtml(title) + '</div>' +
          '<div class="dr-history-meta">' + escapeHtml(when) + verdict + '</div>' +
        '</div>';
      }).join('') +
      '<div style="text-align:right;margin-top:6px">' +
        '<button class="dr-chip-btn dr-chip-btn-ghost" type="button" id="drHistoryClear">Clear history</button>' +
      '</div>';
      Array.prototype.forEach.call(historyPanel.querySelectorAll('[data-dr-history-idx]'), function (el) {
        el.addEventListener('click', function () {
          var idx = parseInt(el.getAttribute('data-dr-history-idx'), 10);
          var rows = loadHistory();
          var entry = rows[idx];
          if (!entry) return;
          questionEl.value = entry.question || '';
          contextEl.value = entry.caseContext || '';
          historyPanel.classList.remove('open');
          historyToggle.textContent = 'History';
          questionEl.focus();
        });
      });
      var clearH = historyPanel.querySelector('#drHistoryClear');
      if (clearH) {
        clearH.addEventListener('click', function (e) {
          e.stopPropagation();
          clearHistoryStore();
          renderHistoryPanel();
        });
      }
    }
    historyToggle.addEventListener('click', function () {
      var willOpen = !historyPanel.classList.contains('open');
      if (willOpen) renderHistoryPanel();
      historyPanel.classList.toggle('open');
      historyToggle.textContent = willOpen ? 'Hide history' : 'History';
    });

    // Copy reply — dumps the accumulated reasoning text (plus the
    // structured block if present) to the clipboard.
    copyBtn.addEventListener('click', function () {
      var txt = copyBtn.getAttribute('data-dr-full') || '';
      if (!txt) return;
      try {
        (navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(txt)
          : Promise.reject(new Error('clipboard unavailable'))
        ).then(function () {
          copyBtn.textContent = 'Copied';
          setTimeout(function () { copyBtn.textContent = 'Copy reply'; }, 1400);
        }).catch(function () {
          errEl.textContent = 'Clipboard unavailable — select the text manually.';
        });
      } catch (_) {
        errEl.textContent = 'Clipboard unavailable — select the text manually.';
      }
    });
    runBtn.addEventListener('click', function () {
      var q = (mount.querySelector('#drQuestion').value || '').trim();
      var c = (mount.querySelector('#drContext').value || '').trim();
      errEl.textContent = '';
      resultWrap.innerHTML = '';
      if (!q) {
        errEl.textContent = 'Enter a compliance question.';
        return;
      }
      var t = token();
      if (!t) {
        errEl.textContent = 'No session token — sign in at /login.html first.';
        return;
      }
      runBtn.disabled = true;
      runBtn.textContent = 'Analyzing…';

      // Render scaffold — the streaming reader appends text into the
      // inner container as frames arrive so the MLRO sees progress
      // instead of a blank screen during the 10-30s reasoning window.
      resultWrap.innerHTML = [
        '<div class="dr-result" id="drResult">',
        '  <div class="dr-stream" id="drStream"></div>',
        '</div>',
        '<div class="dr-meta" id="drMeta">',
        '  <span>Streaming…</span>',
        '</div>',
      ].join('\n');
      var streamEl = mount.querySelector('#drStream');
      var metaEl = mount.querySelector('#drMeta');
      var resultEl = mount.querySelector('#drResult');
      var fullText = '';
      var advisorCallCount = 0;
      var usage = {};

      function renderSoFar() {
        // Re-render the accumulated text on every chunk. renderModelText
        // already escapes the input, so this is safe even mid-stream.
        streamEl.innerHTML = renderModelText(fullText);
      }
      function renderMeta(extra) {
        var bits = [];
        bits.push('Advisor calls: <b>' + advisorCallCount + '</b>');
        bits.push('Executor tokens: <b>' + (usage.executorInputTokens || 0) + ' in / ' + (usage.executorOutputTokens || 0) + ' out</b>');
        bits.push('Advisor tokens: <b>' + (usage.advisorInputTokens || 0) + ' in / ' + (usage.advisorOutputTokens || 0) + ' out</b>');
        if (extra) bits.push(extra);
        metaEl.innerHTML = bits.map(function (b) { return '<span>' + b + '</span>'; }).join('');
      }

      // Client-side 60s ceiling — fails cleanly if the endpoint
      // inexplicably stalls instead of hanging the UI indefinitely.
      var ac = ('AbortController' in window) ? new AbortController() : null;
      var clientTimer = setTimeout(function () {
        try { ac && ac.abort(); } catch (_) {}
      }, 60_000);

      fetch('/api/brain-reason', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + t,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ question: q, caseContext: c || undefined }),
        signal: ac ? ac.signal : undefined,
      })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (text) {
              var msg;
              try { var j = JSON.parse(text); msg = j.error || text.slice(0, 200); }
              catch (_) { msg = text.slice(0, 200) || ('HTTP ' + res.status); }
              throw new Error('Deep reasoning failed (HTTP ' + res.status + '): ' + msg);
            });
          }
          if (!res.body || !res.body.getReader) {
            throw new Error('Browser does not support streaming responses.');
          }
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';

          function handleFrame(frame) {
            var eventName = '';
            var dataStr = '';
            var lines = frame.split('\n');
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line.indexOf('event:') === 0) eventName = line.slice(6).trim();
              else if (line.indexOf('data:') === 0) dataStr += line.slice(5).trim();
            }
            if (!dataStr) return;
            var data;
            try { data = JSON.parse(dataStr); } catch (_) { return; }
            if (eventName === 'delta' && typeof data.text === 'string') {
              fullText += data.text;
              renderSoFar();
            } else if (eventName === 'advisor') {
              advisorCallCount = data.advisorCallCount || advisorCallCount;
              renderMeta('Streaming…');
            } else if (eventName === 'usage') {
              usage = data || {};
              renderMeta('Streaming…');
            } else if (eventName === 'wall_clock') {
              errEl.textContent = data.error || 'Deep reasoning hit the 24s budget. Partial reply above.';
            } else if (eventName === 'error') {
              errEl.textContent = data.error || 'Upstream reasoning error.';
            } else if (eventName === 'done') {
              advisorCallCount = data.advisorCallCount || advisorCallCount;
              renderMeta('Done · ' + new Date(data.generatedAtIso || Date.now()).toLocaleTimeString());
              // Parse the structured trailing block, render badges
              // + follow-up buttons, save to history, enable Copy.
              try {
                var parsed = parseStructuredOutput(fullText);
                var structuredHtml = renderStructuredBlock(parsed);
                var followHtml = renderFollowUpButtons(parsed);
                if (structuredHtml || followHtml) {
                  resultEl.insertAdjacentHTML('beforeend', structuredHtml + followHtml);
                  // Wire follow-up buttons to fill the question field.
                  Array.prototype.forEach.call(resultEl.querySelectorAll('[data-dr-follow-q]'), function (btn) {
                    btn.addEventListener('click', function () {
                      var nextQ = btn.getAttribute('data-dr-follow-q') || '';
                      if (!nextQ) return;
                      // Preserve the current context; replace the
                      // question with the follow-up so the MLRO can
                      // re-run without retyping.
                      questionEl.value = nextQ;
                      questionEl.focus();
                      questionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                  });
                }
                // Enable copy-to-clipboard on the full reply.
                copyBtn.setAttribute('data-dr-full', fullText);
                copyBtn.style.display = '';
                // Persist to history.
                appendHistory({
                  ts: Date.now(),
                  question: q,
                  caseContext: c || '',
                  parsed: parsed,
                  advisorCallCount: advisorCallCount,
                  usage: usage
                });
              } catch (structErr) {
                // Non-fatal — the raw reply already rendered.
              }
            }
          }

          function pump() {
            return reader.read().then(function (chunk) {
              if (chunk.done) {
                // Flush any trailing partial frame.
                if (buffer.trim()) handleFrame(buffer);
                return;
              }
              buffer += decoder.decode(chunk.value, { stream: true });
              var sep;
              while ((sep = buffer.indexOf('\n\n')) !== -1) {
                var frame = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                if (frame.trim()) handleFrame(frame);
              }
              return pump();
            });
          }
          return pump();
        })
        .then(function () {
          if (!fullText) {
            errEl.textContent = errEl.textContent || 'No reasoning text received.';
          }
        })
        .catch(function (e) {
          if (e && e.name === 'AbortError') {
            errEl.textContent = 'Deep reasoning aborted after 60s (client timeout).';
          } else {
            errEl.textContent = (e && e.message) || 'Network error.';
          }
        })
        .then(function () {
          clearTimeout(clientTimer);
          runBtn.disabled = false;
          runBtn.textContent = 'Analyze';
        });
    });
  }

  function init() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;
    injectStyles();
    render(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
