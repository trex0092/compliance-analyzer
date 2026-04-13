/**
 * ESG Portfolio client — SPA tab renderer.
 *
 * Keeps a local list of customer ESG scores in `localStorage` under
 * `fgl_esg_records` and renders an aggregate portfolio scorecard in
 * the `#esgContainer` element of the ESG tab.
 *
 * The scoring algorithm here is a JS port of the production
 * `src/services/esgScorer.ts` weights — same pillar maxima (33.3
 * each), same grade boundaries, same risk levels. A future revision
 * can call the TS version via /api/decision once the brain wires
 * ESG into the decision engine.
 *
 * Exposes:
 *   window.esgRefresh()       — re-render from localStorage
 *   window.esgOpenForm()      — open the score-customer modal
 *   window.esgSaveScore()     — persist a score from the modal
 *   window.esgExportCsv()     — download a per-customer CSV
 *
 * Regulatory basis:
 *   GRI Universal Standards 2021
 *   ISSB IFRS S1 + S2
 *   LBMA RGG v9 Step 5
 *   TCFD
 *   UAE Vision 2031 + UAE Net Zero 2050
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var STORAGE_KEY = 'fgl_esg_records';

  function el(id) {
    return document.getElementById(id);
  }
  function escHtml(s) {
    if (s === null || s === undefined) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
  function readRecords() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }
  function writeRecords(records) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (_) {
      /* quota — ignore */
    }
  }

  // -------------------------------------------------------------------
  // Scorer — pure functions, mirrors src/services/esgScorer.ts weights.
  // -------------------------------------------------------------------

  function clamp01(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function scoreEnvironmental(input) {
    var pts = 0;
    var max = 33.33;
    var disclosures = 0;
    if (typeof input.carbonIntensity === 'number') {
      disclosures++;
      var benchmark = input.carbonBenchmark || 20;
      var ratio = clamp01(1 - (input.carbonIntensity / benchmark));
      pts += ratio * 12;
    }
    if (typeof input.renewableEnergyPct === 'number') {
      disclosures++;
      pts += (clamp01(input.renewableEnergyPct / 100)) * 8;
    }
    if (typeof input.environmentalIncidents === 'number') {
      disclosures++;
      pts += clamp01(1 - input.environmentalIncidents / 5) * 8;
    }
    if (input.iso14001 === 'yes') {
      disclosures++;
      pts += 5;
    }
    return { score: Math.min(pts, max), max: max, disclosures: disclosures };
  }

  function scoreSocial(input) {
    var pts = 0;
    var max = 33.33;
    var disclosures = 0;
    if (typeof input.ltifr === 'number') {
      disclosures++;
      pts += clamp01(1 - input.ltifr / 5) * 10;
    }
    if (typeof input.livingWagePct === 'number') {
      disclosures++;
      pts += clamp01(input.livingWagePct / 100) * 12;
    }
    if (input.modernSlaveryStatement === 'yes') {
      disclosures++;
      pts += 6;
    }
    if (input.supplierCodeOfConduct === 'yes') {
      disclosures++;
      pts += 5;
    }
    return { score: Math.min(pts, max), max: max, disclosures: disclosures };
  }

  function scoreGovernance(input) {
    var pts = 0;
    var max = 33.34;
    var disclosures = 0;
    if (typeof input.boardIndependencePct === 'number') {
      disclosures++;
      pts += clamp01(input.boardIndependencePct / 100) * 12;
    }
    if (input.antiCorruptionProgramme === 'yes') {
      disclosures++;
      pts += 8;
    }
    if (input.whistleblowerChannel === 'yes') {
      disclosures++;
      pts += 8;
    }
    if (input.taxTransparency === 'yes') {
      disclosures++;
      pts += 5;
    }
    return { score: Math.min(pts, max), max: max, disclosures: disclosures };
  }

  function gradeFromScore(s) {
    if (s >= 80) return 'A';
    if (s >= 60) return 'B';
    if (s >= 40) return 'C';
    if (s >= 20) return 'D';
    return 'F';
  }

  function riskFromScore(s) {
    if (s >= 75) return 'low';
    if (s >= 55) return 'medium';
    if (s >= 35) return 'high';
    return 'critical';
  }

  function scoreCustomer(input) {
    var E = scoreEnvironmental(input);
    var S = scoreSocial(input);
    var G = scoreGovernance(input);
    var totalScore = Math.round((E.score + S.score + G.score) * 100) / 100;
    return {
      entityId: input.entityId,
      totalScore: totalScore,
      grade: gradeFromScore(totalScore),
      riskLevel: riskFromScore(totalScore),
      pillars: {
        E: { score: Math.round(E.score * 100) / 100, max: E.max },
        S: { score: Math.round(S.score * 100) / 100, max: S.max },
        G: { score: Math.round(G.score * 100) / 100, max: G.max },
      },
      disclosureCompleteness: Math.round(((E.disclosures + S.disclosures + G.disclosures) / 12) * 100),
    };
  }

  // -------------------------------------------------------------------
  // Aggregator — mirrors src/services/esgPortfolioScorecard.ts shape.
  // -------------------------------------------------------------------

  function average(values) {
    if (!values.length) return 0;
    var s = 0;
    for (var i = 0; i < values.length; i++) s += values[i];
    return Math.round((s / values.length) * 100) / 100;
  }

  function buildScorecard(records) {
    if (!records.length) {
      return {
        totalCustomers: 0,
        pillarAverages: { environmentalAvg: 0, socialAvg: 0, governanceAvg: 0, overallAvg: 0 },
        gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
        riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
        bySector: [],
        topRisks: [],
        notes: ['No customers in scope.'],
      };
    }
    var envS = [],
      socS = [],
      govS = [],
      overall = [];
    var gradeDist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    var riskDist = { low: 0, medium: 0, high: 0, critical: 0 };
    var sectorBuckets = {};
    records.forEach(function (r) {
      envS.push(r.score.pillars.E.score);
      socS.push(r.score.pillars.S.score);
      govS.push(r.score.pillars.G.score);
      overall.push(r.score.totalScore);
      gradeDist[r.score.grade]++;
      riskDist[r.score.riskLevel]++;
      if (r.sector) {
        if (!sectorBuckets[r.sector]) sectorBuckets[r.sector] = [];
        sectorBuckets[r.sector].push(r.score.totalScore);
      }
    });
    var topRisks = records
      .slice()
      .sort(function (a, b) {
        return a.score.totalScore - b.score.totalScore;
      })
      .slice(0, 10);

    var bySector = Object.keys(sectorBuckets)
      .map(function (sector) {
        var avg = average(sectorBuckets[sector]);
        return {
          sector: sector,
          count: sectorBuckets[sector].length,
          overallAvg: avg,
          grade: gradeFromScore(avg),
          risk: riskFromScore(avg),
        };
      })
      .sort(function (a, b) {
        return a.overallAvg - b.overallAvg;
      });

    var overallAvg = average(overall);
    var notes = [];
    if (overallAvg < 55) notes.push('Portfolio overall ESG average is ' + overallAvg + ' — below 55. Trigger EDD per FATF Rec 1.');
    if (riskDist.critical > 0) notes.push(riskDist.critical + ' customer(s) at critical ESG risk. Review for STR / exit per FDL Art.20.');
    if (gradeDist.F > 0) notes.push(gradeDist.F + ' grade-F customer(s) eligible for immediate EDD escalation.');
    if (notes.length === 0) notes.push('Portfolio ESG profile is within tolerance.');

    return {
      totalCustomers: records.length,
      pillarAverages: {
        environmentalAvg: average(envS),
        socialAvg: average(socS),
        governanceAvg: average(govS),
        overallAvg: overallAvg,
      },
      gradeDistribution: gradeDist,
      riskDistribution: riskDist,
      bySector: bySector,
      topRisks: topRisks,
      notes: notes,
    };
  }

  // -------------------------------------------------------------------
  // Renderer
  // -------------------------------------------------------------------

  var ACCENT = {
    A: '#3DA876',
    B: '#8FB849',
    C: '#E8A030',
    D: '#D94F4F',
    F: '#A33',
    low: '#3DA876',
    medium: '#E8A030',
    high: '#D94F4F',
    critical: '#A33',
  };

  function tile(label, value, color) {
    return (
      '<div style="background:var(--surface2);border:1px solid ' +
      color +
      '44;border-left:4px solid ' +
      color +
      ';border-radius:4px;padding:12px;min-width:120px">' +
      '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">' +
      escHtml(label) +
      '</div>' +
      '<div style="font-size:22px;font-weight:600;color:' +
      color +
      ';margin-top:4px">' +
      escHtml(value) +
      '</div></div>'
    );
  }

  // Section header used to group tiles into named blocks. Mirrors the
  // "PILLAR AVERAGES / RISK DISTRIBUTION / GRADE DISTRIBUTION" layout
  // that MLRO requested after the unorganised flat tile-row was shown.
  function sectionHeader(label, sub) {
    return (
      '<div style="margin:14px 0 6px 0;display:flex;align-items:baseline;gap:8px">' +
      '<span style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#d4a843;text-transform:uppercase">' +
      escHtml(label) +
      '</span>' +
      (sub
        ? '<span style="font-size:10px;color:var(--muted)">' + escHtml(sub) + '</span>'
        : '') +
      '</div>'
    );
  }

  function tileGrid(tiles) {
    return (
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">' +
      tiles.join('') +
      '</div>'
    );
  }

  function render() {
    var container = el('esgContainer');
    if (!container) return;
    var records = readRecords();
    var card = buildScorecard(records);

    var html = '<div class="card" style="padding:16px">';
    // Header summary
    html +=
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">' +
      '<div style="font-size:14px;font-weight:600">Portfolio scorecard — ' +
      card.totalCustomers +
      ' customer(s)</div>' +
      '<div style="font-size:10px;color:var(--muted);text-align:right">' +
      'Pillars max 33.3 each · Grades A≥85 · B≥70 · C≥55 · D≥40 · F&lt;40' +
      '</div></div>';

    // ── 1. Pillar averages ──
    html += sectionHeader('Pillar averages', 'GRI 2021 · ISSB IFRS S1/S2');
    html += tileGrid([
      tile('Overall avg', card.pillarAverages.overallAvg, ACCENT[gradeFromScore(card.pillarAverages.overallAvg)] || '#7a7870'),
      tile('Environmental', card.pillarAverages.environmentalAvg, '#3DA876'),
      tile('Social', card.pillarAverages.socialAvg, '#4A8FC1'),
      tile('Governance', card.pillarAverages.governanceAvg, '#E8A030'),
    ]);

    // ── 2. Risk distribution ──
    html += sectionHeader('Risk distribution', 'FDL Art.20-21 · LBMA RGG v9 Step 5');
    html += tileGrid([
      tile('Critical', card.riskDistribution.critical, ACCENT.critical),
      tile('High', card.riskDistribution.high, ACCENT.high),
      tile('Medium', card.riskDistribution.medium, ACCENT.medium),
      tile('Low', card.riskDistribution.low, ACCENT.low),
    ]);

    // ── 3. Grade distribution ──
    html += sectionHeader('Grade distribution', 'A excellent · F critical');
    html += tileGrid([
      tile('Grade A', card.gradeDistribution.A, ACCENT.A),
      tile('Grade B', card.gradeDistribution.B, ACCENT.B),
      tile('Grade C', card.gradeDistribution.C, ACCENT.C),
      tile('Grade D', card.gradeDistribution.D, ACCENT.D),
      tile('Grade F', card.gradeDistribution.F, ACCENT.F),
    ]);

    // ── 4. Notes / regulator cues ──
    html += sectionHeader('Compliance notes');
    if (card.notes.length) {
      html +=
        '<div style="background:#181818;border-radius:4px;padding:10px;font-size:12px;color:#cdcdcd">';
      card.notes.forEach(function (n) {
        html += '<div>• ' + escHtml(n) + '</div>';
      });
      html += '</div>';
    } else {
      html +=
        '<div style="font-size:11px;color:var(--muted);padding:4px 0">No notes generated.</div>';
    }

    // ── 5. By sector ──
    if (card.bySector.length) {
      html += sectionHeader('By sector', 'Lowest grade first');
      html += '<div style="background:#181818;border-radius:4px">';
      card.bySector.forEach(function (b) {
        var color = ACCENT[b.grade] || '#7a7870';
        html += '<div style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #2a2a2a">';
        html +=
          '<span style="background:' +
          color +
          '22;color:' +
          color +
          ';border:1px solid ' +
          color +
          '44;border-radius:3px;padding:2px 8px;font-size:10px;text-transform:uppercase;min-width:32px;text-align:center">' +
          b.grade +
          '</span>';
        html +=
          '<div style="flex:1"><div style="font-size:12px;color:#f5f5f5">' +
          escHtml(b.sector) +
          ' <span style="color:var(--muted)">(' +
          b.count +
          ')</span></div></div>';
        html += '<div style="font-size:12px;color:' + color + '">' + b.overallAvg + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // ── 6. Top 10 highest risk ──
    if (card.topRisks.length) {
      html += sectionHeader('Top 10 highest ESG risk', 'Sorted ascending by total score');
      html += '<div style="background:#181818;border-radius:4px">';
      card.topRisks.forEach(function (r) {
        var color = ACCENT[r.score.riskLevel] || '#7a7870';
        html += '<div style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #2a2a2a">';
        html +=
          '<span style="background:' +
          color +
          '22;color:' +
          color +
          ';border:1px solid ' +
          color +
          '44;border-radius:3px;padding:2px 8px;font-size:10px;text-transform:uppercase;min-width:60px;text-align:center">' +
          escHtml(r.score.riskLevel) +
          '</span>';
        html +=
          '<div style="flex:1"><div style="font-size:12px;font-weight:500;color:#f5f5f5">' +
          escHtml(r.displayName) +
          '</div>';
        html +=
          '<div style="font-size:10px;color:#7a7870">' +
          escHtml(r.sector || '—') +
          ' · grade ' +
          escHtml(r.score.grade) +
          ' · disclosure ' +
          escHtml(r.score.disclosureCompleteness) +
          '%</div></div>';
        html += '<div style="font-size:13px;color:' + color + '">' + r.score.totalScore + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  // -------------------------------------------------------------------
  // Public actions
  // -------------------------------------------------------------------

  function readNumber(id) {
    var v = el(id) ? el(id).value : '';
    if (v === '') return undefined;
    var n = parseFloat(v);
    return isFinite(n) ? n : undefined;
  }
  function readString(id) {
    var v = el(id) ? el(id).value : '';
    return v || undefined;
  }

  window.esgRefresh = render;

  window.esgOpenForm = function () {
    [
      'esg-customer-name',
      'esg-carbon',
      'esg-renewable',
      'esg-incidents',
      'esg-ltifr',
      'esg-living-wage',
      'esg-board-indep',
    ].forEach(function (id) {
      var e = el(id);
      if (e) e.value = '';
    });
    ['esg-sector', 'esg-mss', 'esg-anticorr', 'esg-whistle'].forEach(function (id) {
      var e = el(id);
      if (e) e.value = '';
    });
    var modal = el('esgModal');
    if (modal) modal.classList.add('open');
  };

  window.esgSaveScore = function () {
    var name = (el('esg-customer-name') && el('esg-customer-name').value || '').trim();
    if (!name) {
      if (typeof toast === 'function') toast('Customer name is required.', 'error');
      return;
    }
    var entityId = 'esg-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    var input = {
      entityId: entityId,
      carbonIntensity: readNumber('esg-carbon'),
      renewableEnergyPct: readNumber('esg-renewable'),
      environmentalIncidents: readNumber('esg-incidents'),
      ltifr: readNumber('esg-ltifr'),
      livingWagePct: readNumber('esg-living-wage'),
      modernSlaveryStatement: readString('esg-mss'),
      boardIndependencePct: readNumber('esg-board-indep'),
      antiCorruptionProgramme: readString('esg-anticorr'),
      whistleblowerChannel: readString('esg-whistle'),
    };
    var score = scoreCustomer(input);
    var displayName =
      typeof window.cs2HashSubject === 'function' ? window.cs2HashSubject(name) : name;
    var records = readRecords();
    records.push({
      customerId: entityId,
      displayName: displayName,
      sector: readString('esg-sector'),
      score: score,
      at: new Date().toISOString(),
    });
    writeRecords(records);
    if (typeof logAudit === 'function') logAudit('esg', 'Scored ' + displayName + ' grade ' + score.grade);
    var modal = el('esgModal');
    if (modal) modal.classList.remove('open');
    if (typeof toast === 'function') toast('ESG score recorded — grade ' + score.grade, 'success');
    render();
  };

  window.esgExportCsv = function () {
    var records = readRecords();
    if (!records.length) {
      if (typeof toast === 'function') toast('No ESG records to export.', 'error');
      return;
    }
    var headers = ['customerId', 'displayName', 'sector', 'totalScore', 'grade', 'riskLevel', 'E', 'S', 'G', 'disclosure%'];
    var csvSafe = function (v) {
      var s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    var rows = records.map(function (r) {
      return [
        r.customerId,
        r.displayName,
        r.sector || '',
        r.score.totalScore,
        r.score.grade,
        r.score.riskLevel,
        r.score.pillars.E.score,
        r.score.pillars.S.score,
        r.score.pillars.G.score,
        r.score.disclosureCompleteness,
      ]
        .map(csvSafe)
        .join(',');
    });
    var csv = [headers.map(csvSafe).join(','), ...rows].join('\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'esg-portfolio-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Auto-render when the ESG tab becomes active.
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.dataset) return;
    if (t.dataset.action === 'switchTab' && t.dataset.arg === 'esg') {
      setTimeout(render, 50);
    }
  });
})();
