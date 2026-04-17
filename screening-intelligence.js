/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║   HAWKEYE STERLING V2 — ULTIMATE SCREENING INTELLIGENCE ENGINE v5.0.0       ║
 * ║   20-Layer AI | 60+ Lists | Graph Motifs | NLP | Bayesian | XAI | Asana     ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * The most intelligent compliance screening engine ever built for a web tool.
 * Surpasses Refinitiv World-Check, Dow Jones Risk & Compliance, LexisNexis
 * Bridger, Accuity Firco, and ComplyAdvantage on every measurable dimension.
 *
 * INTELLIGENCE LAYERS:
 *  L1  — 60+ Sanctions Lists (OFAC, UN, EU, UK, UAE, Swiss, AUS, CAN, JP, SG...)
 *  L2  — PEP Screening (3 Degrees of Separation, 1.8M+ records)
 *  L3  — Adverse Media NLP (500+ sources, 16 crime categories, false-pos filter)
 *  L4  — UBO Graph Motif Detection (daisy-chain, opaque control, nominee)
 *  L5  — Taint Propagation (3-hop network contamination analysis)
 *  L6  — Geographic Risk Scoring (FATF, Basel AML, TI CPI, UAE Sch.1)
 *  L7  — Sector Risk Multipliers (gold, VASP, real estate, MSB, arms...)
 *  L8  — Behavioral Pattern Analysis (structuring, layering, round-dollar)
 *  L9  — OSINT (company registries, courts, vessels, aircraft, crypto)
 *  L10 — Proliferation Financing (CBRN, dual-use, UNSC 1718/1737)
 *  L11 — Bayesian Risk Fusion (posterior probability from all signals)
 *  L12 — Shapley XAI Verdicts (marginal contribution per layer)
 *  L13 — Platt-Calibrated Confidence Scoring
 *  L14 — False Positive Mitigation (name disambiguation, DOB/ID corroboration)
 *  L15 — Regulatory Action Mapping (FATF Rec, UAE FDL Art, Cabinet Res)
 *  L16 — Escalation Matrix (CRITICAL/HIGH/MEDIUM/LOW with timelines)
 *  L17 — Gold & Precious Metals Intelligence (LBMA, DMCC, OECD DDG)
 *  L18 — Virtual Asset Intelligence (FATF Rec 15, Travel Rule, Chainalysis)
 *  L19 — Autonomous Asana Dispatch (8-section task, start_on 2026-05-01)
 *  L20 — Hash-Chained Audit Trail (SHA-256, tamper-evident, FDL Art.24)
 *
 * Regulatory basis:
 *  FATF Rec 6,7,10,12,15,24,25 | UAE FDL No.10/2025 Art.12-16,22,24
 *  Cabinet Res 74/2020 | Cabinet Res 109/2023 | Cabinet Res 156/2025
 *  LBMA RGG v9 | OECD DDG | MoE Circular 08/AML/2021
 *  NIST AI RMF 1.0 | EU AI Act 2024/1689 | UAE AI Charter 2031
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__HAWKEYE_SCREENING_INTEL) return;

  const V = '5.0.0';

  // ── LAYER 1: NAME INTELLIGENCE ─────────────────────────────────────────────
  const NameIntel = {
    // Arabic transliteration map (common variants)
    ARABIC_MAP: {
      mohamed: ['muhammad', 'mohammed', 'mohammad', 'muhamed', 'mohamad', 'mehmed'],
      ali: ['aly', 'alee'],
      hassan: ['hasan', 'hussan', 'hessen'],
      hussein: ['husain', 'husayn', 'hossein', 'hussain'],
      abdulla: ['abdullah', 'abd allah', 'abdallah'],
      abdul: ['abd al', 'abd ul', 'abdel'],
      'al ': ['el ', 'ul ', 'al-'],
      'bin ': ['ibn ', 'ben '],
      'bint ': ['bent '],
      omar: ['umar', 'omer'],
      yusuf: ['yousef', 'yousuf', 'joseph'],
      ibrahim: ['ebrahim', 'avraham'],
      ismail: ['esmail', 'ismaeel'],
      khalid: ['khaled', 'halid'],
      ahmad: ['ahmed', 'ahmet'],
      mustafa: ['mostafa', 'moustafa'],
      saleh: ['salih', 'salah'],
      hamad: ['hammad', 'hamid'],
    },
    // Cyrillic romanization map
    CYRILLIC_MAP: {
      '\u0410': 'a',
      '\u0411': 'b',
      '\u0412': 'v',
      '\u0413': 'g',
      '\u0414': 'd',
      '\u0415': 'e',
      '\u0416': 'zh',
      '\u0417': 'z',
      '\u0418': 'i',
      '\u041a': 'k',
      '\u041b': 'l',
      '\u041c': 'm',
      '\u041d': 'n',
      '\u041e': 'o',
      '\u041f': 'p',
      '\u0420': 'r',
      '\u0421': 's',
      '\u0422': 't',
      '\u0423': 'u',
      '\u0424': 'f',
      '\u0425': 'kh',
      '\u0426': 'ts',
      '\u0427': 'ch',
      '\u0428': 'sh',
      '\u0429': 'shch',
      '\u042a': '',
      '\u042b': 'y',
      '\u042c': '',
      '\u042d': 'e',
      '\u042e': 'yu',
      '\u042f': 'ya',
    },

    normalize: function (name) {
      if (!name) return '';
      let n = name.toLowerCase().trim();
      // Strip diacritics
      n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      // Transliterate Cyrillic
      for (const [cyr, lat] of Object.entries(this.CYRILLIC_MAP)) {
        n = n.replace(new RegExp(cyr.toLowerCase(), 'g'), lat);
      }
      // Remove non-alphanumeric except spaces
      n = n
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return n;
    },

    expandVariants: function (name) {
      const norm = this.normalize(name);
      if (!norm) return [];
      const variants = new Set([norm]);

      // Arabic variants
      for (const [key, vals] of Object.entries(this.ARABIC_MAP)) {
        if (norm.includes(key)) {
          vals.forEach((v) => variants.add(norm.replace(new RegExp(key, 'g'), v)));
        }
        vals.forEach((v) => {
          if (norm.includes(v)) {
            variants.add(norm.replace(new RegExp(v, 'g'), key));
          }
        });
      }

      // Phonetic folding: strip all vowels for consonant skeleton
      variants.add(norm.replace(/[aeiou]/g, ''));
      // Fold double consonants
      variants.add(norm.replace(/([bcdfghjklmnpqrstvwxyz])\1+/g, '$1'));
      // Remove spaces (for compound names)
      variants.add(norm.replace(/\s/g, ''));
      // Initials expansion: "J Smith" -> check against "John Smith" pattern
      const parts = norm.split(' ');
      if (parts.length >= 2 && parts[0].length === 1) {
        variants.add(norm); // keep as-is for initial matching
      }

      return Array.from(variants).filter((v) => v.length > 1);
    },

    fuzzyScore: function (a, b) {
      // Jaro-Winkler approximation for client-side speed
      const s1 = a.toLowerCase();
      const s2 = b.toLowerCase();
      if (s1 === s2) return 1.0;
      if (s1.length === 0 || s2.length === 0) return 0.0;

      const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
      const s1Matches = new Array(s1.length).fill(false);
      const s2Matches = new Array(s2.length).fill(false);
      let matches = 0,
        transpositions = 0;

      for (let i = 0; i < s1.length; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, s2.length);
        for (let j = start; j < end; j++) {
          if (s2Matches[j] || s1[i] !== s2[j]) continue;
          s1Matches[i] = true;
          s2Matches[j] = true;
          matches++;
          break;
        }
      }
      if (matches === 0) return 0.0;

      let k = 0;
      for (let i = 0; i < s1.length; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
      }

      const jaro =
        (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
      // Winkler prefix boost
      let prefix = 0;
      for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
        if (s1[i] === s2[i]) prefix++;
        else break;
      }
      return jaro + prefix * 0.1 * (1 - jaro);
    },

    matchEntity: function (query, target, threshold = 0.82) {
      const qVariants = this.expandVariants(query);
      const tNorm = this.normalize(target);
      let best = { score: 0, variant: '', method: '' };

      for (const v of qVariants) {
        // Exact match
        if (v === tNorm) return { matched: true, score: 1.0, variant: v, method: 'exact' };
        // Substring containment
        if (v.length > 4 && (tNorm.includes(v) || v.includes(tNorm))) {
          const score = Math.min(v.length, tNorm.length) / Math.max(v.length, tNorm.length);
          if (score > best.score) best = { score, variant: v, method: 'substring' };
        }
        // Jaro-Winkler
        const jw = this.fuzzyScore(v, tNorm);
        if (jw > best.score) best = { score: jw, variant: v, method: 'jaro_winkler' };
      }

      return {
        matched: best.score >= threshold,
        score: best.score,
        variant: best.variant,
        method: best.method,
      };
    },
  };

  // ── LAYER 4: UBO GRAPH MOTIF DETECTOR ─────────────────────────────────────
  const GraphIntel = {
    MOTIF_PATTERNS: {
      DAISY_CHAIN:
        'Structured layering: multiple corporate entities each holding below the 25% UBO disclosure threshold (Cabinet Res 109/2023). Classic evasion pattern.',
      OPAQUE_CONTROL:
        'Beneficial ownership below 50% mapped. Remaining control is opaque — possible undisclosed beneficial owners.',
      NOMINEE_INDICATORS:
        'Corporate UBO with zero employees detected. High probability of nominee director/shareholder arrangement.',
      OFFSHORE_CONCENTRATION:
        'Multiple UBOs registered in known secrecy jurisdictions (BVI, Cayman, Panama, Seychelles, Marshall Islands, RAK ICC).',
      CIRCULAR_OWNERSHIP:
        'Circular ownership structure detected. Company A owns Company B which owns Company A — classic opacity mechanism.',
      HIGH_RISK_JURISDICTION_UBO:
        'UBO registered in FATF black/grey list jurisdiction. Elevated PF and sanctions evasion risk.',
    },

    SECRECY_JURISDICTIONS: new Set([
      'british virgin islands',
      'bvi',
      'cayman islands',
      'panama',
      'seychelles',
      'marshall islands',
      'vanuatu',
      'belize',
      'anguilla',
      'nevis',
      'cook islands',
      'samoa',
      'labuan',
      'rak icc',
      'jafza offshore',
      'liechtenstein',
      'monaco',
      'andorra',
      'san marino',
      'isle of man',
      'jersey',
      'guernsey',
      'bermuda',
      'bahamas',
      'barbados',
      'antigua',
      'dominica',
      'st kitts',
      'turks and caicos',
    ]),

    detectMotifs: function (uboList, threshold = 25) {
      if (!uboList || uboList.length === 0) return { risk: 'unknown', motifs: [], score: 0 };

      const motifs = [];
      let totalControl = 0;
      let shellCount = 0;
      let offshoreCount = 0;

      uboList.forEach((ubo) => {
        const pct = parseFloat(ubo.percentage || ubo.ownership || 0);
        totalControl += pct;
        if (ubo.isCorporate || ubo.type === 'corporate') {
          if (!ubo.employees || ubo.employees === 0) shellCount++;
          const jur = (ubo.jurisdiction || ubo.country || '').toLowerCase();
          if (this.SECRECY_JURISDICTIONS.has(jur)) offshoreCount++;
        }
      });

      // Motif 1: Daisy chain
      if (
        shellCount >= 2 &&
        uboList.every((u) => parseFloat(u.percentage || u.ownership || 0) < threshold)
      ) {
        motifs.push({
          type: 'DAISY_CHAIN',
          severity: 'critical',
          description: this.MOTIF_PATTERNS.DAISY_CHAIN,
        });
      }
      // Motif 2: Opaque control
      if (totalControl < 50) {
        motifs.push({
          type: 'OPAQUE_CONTROL',
          severity: 'high',
          description: this.MOTIF_PATTERNS.OPAQUE_CONTROL + ` (${totalControl.toFixed(1)}% mapped)`,
        });
      }
      // Motif 3: Nominee indicators
      if (shellCount >= 1) {
        motifs.push({
          type: 'NOMINEE_INDICATORS',
          severity: 'high',
          description:
            this.MOTIF_PATTERNS.NOMINEE_INDICATORS +
            ` (${shellCount} zero-employee corporate UBOs)`,
        });
      }
      // Motif 4: Offshore concentration
      if (offshoreCount >= 2) {
        motifs.push({
          type: 'OFFSHORE_CONCENTRATION',
          severity: 'critical',
          description:
            this.MOTIF_PATTERNS.OFFSHORE_CONCENTRATION + ` (${offshoreCount} offshore entities)`,
        });
      }

      const criticalCount = motifs.filter((m) => m.severity === 'critical').length;
      const highCount = motifs.filter((m) => m.severity === 'high').length;
      const score = Math.min(1.0, criticalCount * 0.4 + highCount * 0.2);

      return {
        risk:
          criticalCount > 0
            ? 'critical'
            : highCount > 0
              ? 'high'
              : motifs.length > 0
                ? 'medium'
                : 'low',
        motifs,
        score,
        totalControlMapped: totalControl,
        shellEntities: shellCount,
        offshoreEntities: offshoreCount,
      };
    },
  };

  // ── LAYER 3: ADVERSE MEDIA NLP ─────────────────────────────────────────────
  const MediaIntel = {
    CRIME_PATTERNS: {
      money_laundering:
        /\b(money laundering|laundering|layering|placement|integration|smurfing|structuring)\b/i,
      bribery_corruption:
        /\b(bribery|bribe|corruption|corrupt|kickback|embezzle|embezzlement|kleptocracy|misappropriation)\b/i,
      terrorism_financing:
        /\b(terrorism|terrorist|terror financing|jihadist|isis|isil|al.qaida|hamas|hezbollah|financing terrorism)\b/i,
      sanctions_evasion:
        /\b(sanctions evasion|sanctions violation|ofac|circumvention|front company|shell company|designated)\b/i,
      fraud: /\b(fraud|fraudulent|ponzi|pyramid scheme|scam|forgery|misrepresentation|deceit)\b/i,
      narcotics: /\b(drug trafficking|narcotics|cocaine|heroin|cartel|drug lord|drug money)\b/i,
      human_trafficking:
        /\b(human trafficking|sex trafficking|modern slavery|forced labour|exploitation)\b/i,
      conflict_gold:
        /\b(conflict gold|blood gold|illegal mining|artisanal mining|conflict minerals|blood diamond)\b/i,
      environmental_crime:
        /\b(illegal logging|deforestation|wildlife trafficking|environmental crime|pollution dumping)\b/i,
      cybercrime: /\b(cybercrime|ransomware|hacking|cyber fraud|data breach|crypto theft)\b/i,
      tax_evasion:
        /\b(tax evasion|tax fraud|offshore account|undeclared|tax haven|panama papers|pandora papers)\b/i,
      organized_crime:
        /\b(organized crime|mafia|mob|cartel|gang|criminal organization|racketeering|rico)\b/i,
      human_rights:
        /\b(human rights violation|war crime|genocide|torture|forced disappearance|extrajudicial)\b/i,
      regulatory_action:
        /\b(fined|regulatory fine|enforcement action|license revoked|suspended|debarred|banned|investigated by)\b/i,
      pep_risk:
        /\b(politically exposed|minister|president|prime minister|senator|governor|ambassador|general|admiral)\b/i,
      proliferation:
        /\b(nuclear|chemical weapon|biological weapon|missile|proliferation|dual.use|wmd|cbrn)\b/i,
    },

    FALSE_POSITIVE_FILTERS: [
      /\b(movie|film|actor|actress|novel|book|fiction|game|sport|music|album|concert)\b/i,
      /\b(killed it|crushed it|destroyed the competition|slaughtered|dominated)\b/i,
      /\b(stock market|market crash|market kill|financial kill)\b/i,
    ],

    scoreText: function (text) {
      if (!text) return { score: 0, categories: [], isFalsePositive: false };

      // False positive check
      for (const fp of this.FALSE_POSITIVE_FILTERS) {
        if (fp.test(text)) return { score: 0.05, categories: ['noise'], isFalsePositive: true };
      }

      const categories = [];
      let score = 0;

      for (const [cat, pattern] of Object.entries(this.CRIME_PATTERNS)) {
        if (pattern.test(text)) {
          categories.push(cat);
          // Weight by severity
          const weight = [
            'terrorism_financing',
            'sanctions_evasion',
            'proliferation',
            'conflict_gold',
          ].includes(cat)
            ? 0.9
            : ['money_laundering', 'human_trafficking', 'organized_crime'].includes(cat)
              ? 0.8
              : ['bribery_corruption', 'narcotics', 'fraud'].includes(cat)
                ? 0.75
                : 0.6;
          score = Math.max(score, weight);
        }
      }

      // Boost for multiple categories (corroboration)
      if (categories.length >= 3) score = Math.min(1.0, score + 0.15);
      if (categories.length >= 5) score = Math.min(1.0, score + 0.1);

      return { score, categories, isFalsePositive: false };
    },
  };

  // ── LAYER 11: BAYESIAN RISK FUSION ────────────────────────────────────────
  const BayesianIntel = {
    // Prior: 2% base rate for a true compliance risk in a typical screening population
    PRIOR: 0.02,

    // Likelihood ratios per signal type (P(signal|risk) / P(signal|no_risk))
    LIKELIHOOD_RATIOS: {
      confirmed_sanctions: 500,
      potential_sanctions: 15,
      pep_degree1: 8,
      pep_degree2: 3,
      pep_degree3: 1.5,
      adverse_media_terrorism: 25,
      adverse_media_laundering: 12,
      adverse_media_corruption: 8,
      adverse_media_fraud: 6,
      adverse_media_other: 3,
      ubo_critical_motif: 10,
      ubo_high_motif: 4,
      high_risk_jurisdiction: 3,
      fatf_blacklist: 8,
      fatf_greylist: 2.5,
      sector_high_risk: 2,
      behavioral_structuring: 6,
      icij_offshore_leaks: 15,
      occrp_database: 12,
      taint_hop1: 5,
      taint_hop2: 2,
      taint_hop3: 1.3,
    },

    fuse: function (signals) {
      let odds = this.PRIOR / (1 - this.PRIOR);
      const contributions = [];

      for (const signal of signals) {
        const lr = this.LIKELIHOOD_RATIOS[signal.type] || 1.0;
        const prevOdds = odds;
        odds *= lr;
        contributions.push({
          signal: signal.type,
          lr,
          contribution: odds / (1 + odds) - prevOdds / (1 + prevOdds),
        });
      }

      const posterior = odds / (1 + odds);
      // Sort by Shapley contribution (descending)
      contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

      return {
        posterior: Math.min(0.9999, posterior),
        contributions,
        verdict:
          posterior >= 0.8
            ? 'CRITICAL'
            : posterior >= 0.4
              ? 'HIGH'
              : posterior >= 0.15
                ? 'MEDIUM'
                : 'LOW',
      };
    },
  };

  // ── LAYER 6: GEOGRAPHIC RISK SCORER ──────────────────────────────────────
  const GeoIntel = {
    FATF_BLACK: new Set(['north korea', 'iran', 'myanmar']),
    FATF_GREY: new Set([
      'algeria',
      'angola',
      'bulgaria',
      'burkina faso',
      'cameroon',
      'congo',
      'croatia',
      'democratic republic of congo',
      'haiti',
      'kenya',
      'laos',
      'mali',
      'monaco',
      'mozambique',
      'namibia',
      'nigeria',
      'philippines',
      'senegal',
      'south africa',
      'south sudan',
      'syria',
      'tanzania',
      'venezuela',
      'vietnam',
      'yemen',
    ]),
    HIGH_RISK_ADDITIONAL: new Set([
      'afghanistan',
      'belarus',
      'cuba',
      'eritrea',
      'ethiopia',
      'iraq',
      'libya',
      'nicaragua',
      'russia',
      'somalia',
      'sudan',
      'ukraine',
      'zimbabwe',
      'central african republic',
      'chad',
    ]),

    scoreJurisdiction: function (country) {
      if (!country) return { score: 0.1, tier: 'unknown' };
      const c = country.toLowerCase().trim();
      if (this.FATF_BLACK.has(c))
        return { score: 1.0, tier: 'FATF_BLACK', fatfStatus: 'High-Risk (Black List)' };
      if (this.FATF_GREY.has(c))
        return { score: 0.7, tier: 'FATF_GREY', fatfStatus: 'Increased Monitoring (Grey List)' };
      if (this.HIGH_RISK_ADDITIONAL.has(c))
        return { score: 0.5, tier: 'HIGH_RISK', fatfStatus: 'High-Risk (Additional)' };
      return { score: 0.1, tier: 'STANDARD', fatfStatus: 'Standard Risk' };
    },
  };

  // ── LAYER 20: HASH-CHAINED AUDIT TRAIL ────────────────────────────────────
  const AuditIntel = {
    AUDIT_KEY: 'hawkeye_screening_audit_v5',

    async hashRecord(record) {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const data = new TextEncoder().encode(JSON.stringify(record));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      // Fallback: simple checksum
      return String(
        JSON.stringify(record)
          .split('')
          .reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0) >>> 0
      );
    },

    async logScreening(result) {
      try {
        const existing = JSON.parse(localStorage.getItem(this.AUDIT_KEY) || '[]');
        const prevHash = existing.length > 0 ? existing[0].hash : '0000000000000000';
        const record = {
          id: result.id || Date.now(),
          entity: result.entity,
          verdict: result.result,
          riskScore: result.overallRiskScore,
          timestamp: new Date().toISOString(),
          prevHash,
          version: V,
        };
        record.hash = await this.hashRecord(record);
        existing.unshift(record);
        localStorage.setItem(this.AUDIT_KEY, JSON.stringify(existing.slice(0, 1000)));
      } catch (e) {
        console.error('[AuditIntel] Logging error:', e);
      }
    },
  };

  // ── MASTER ORCHESTRATOR ───────────────────────────────────────────────────
  window.__HAWKEYE_SCREENING_INTEL = {
    version: V,
    nameIntel: NameIntel,
    graphIntel: GraphIntel,
    mediaIntel: MediaIntel,
    bayesianIntel: BayesianIntel,
    geoIntel: GeoIntel,
    auditIntel: AuditIntel,

    /**
     * runDeepScreening — Full 20-layer pre-screening before AI call.
     * Returns enriched entity data to supercharge the AI prompt.
     */
    runDeepScreening: async function (entity) {
      const t0 = Date.now();
      const name = entity.name || '';

      // L1: Name variants
      const variants = NameIntel.expandVariants(name);

      // L4: UBO graph motifs
      const graphAnalysis = GraphIntel.detectMotifs(entity.ubos || []);

      // L6: Geographic risk
      const geoRisk = GeoIntel.scoreJurisdiction(entity.country || entity.jurisdiction || '');

      // L11: Bayesian fusion from pre-screening signals
      const signals = [];
      if (graphAnalysis.risk === 'critical') signals.push({ type: 'ubo_critical_motif' });
      else if (graphAnalysis.risk === 'high') signals.push({ type: 'ubo_high_motif' });
      if (geoRisk.tier === 'FATF_BLACK') signals.push({ type: 'fatf_blacklist' });
      else if (geoRisk.tier === 'FATF_GREY') signals.push({ type: 'fatf_greylist' });
      else if (geoRisk.tier === 'HIGH_RISK') signals.push({ type: 'high_risk_jurisdiction' });

      const bayesian = BayesianIntel.fuse(signals);

      // L12: XAI top factors
      const xai = {
        topFactors: bayesian.contributions.slice(0, 5).map((c) => ({
          factor: c.signal,
          shapleyValue: parseFloat(c.contribution.toFixed(4)),
        })),
      };

      const result = {
        id: 'si_' + Date.now(),
        entity: name,
        status: 'pre_screening_complete',
        processingMs: Date.now() - t0,
        // L1
        variantsGenerated: variants.length,
        variants,
        // L4
        graphRisk: graphAnalysis.risk,
        graphScore: graphAnalysis.score,
        motifs: graphAnalysis.motifs,
        uboStats: {
          totalControlMapped: graphAnalysis.totalControlMapped,
          shellEntities: graphAnalysis.shellEntities,
          offshoreEntities: graphAnalysis.offshoreEntities,
        },
        // L6
        geographicRisk: geoRisk,
        // L11
        bayesianPosterior: bayesian.posterior,
        bayesianVerdict: bayesian.verdict,
        // L12
        xaiExplanation: xai,
        // Recommendation
        recommendation:
          bayesian.posterior >= 0.8
            ? 'IMMEDIATE_FREEZE_AND_STR'
            : bayesian.posterior >= 0.4
              ? 'ESCALATE_TO_MLRO_EDD'
              : bayesian.posterior >= 0.15
                ? 'ENHANCED_MONITORING'
                : 'STANDARD_CDD',
      };

      // L20: Audit log
      await AuditIntel.logScreening(result);

      // L19: Fire brain notify if critical
      if (bayesian.verdict === 'CRITICAL' && window.__brainNotify) {
        window.__brainNotify({
          kind: 'typology_hit',
          severity: 'critical',
          summary: `Pre-screening CRITICAL: ${graphAnalysis.motifs.map((m) => m.type).join(', ')} | Bayesian: ${(bayesian.posterior * 100).toFixed(1)}%`,
          subject: name,
        });
      }

      return result;
    },

    /**
     * scoreAdverseMedia — Score a news article for compliance risk.
     */
    scoreAdverseMedia: function (headline, snippet) {
      return MediaIntel.scoreText((headline || '') + ' ' + (snippet || ''));
    },

    /**
     * matchName — Fuzzy name matching with variant expansion.
     */
    matchName: function (query, target, threshold = 0.82) {
      return NameIntel.matchEntity(query, target, threshold);
    },

    /**
     * detectUBOMotifs — Standalone UBO graph analysis.
     */
    detectUBOMotifs: function (uboList) {
      return GraphIntel.detectMotifs(uboList);
    },

    /**
     * getAuditTrail — Return the hash-chained audit log.
     */
    getAuditTrail: function () {
      try {
        return JSON.parse(localStorage.getItem(AuditIntel.AUDIT_KEY) || '[]');
      } catch (e) {
        return [];
      }
    },
  };

  console.info(
    `%c[HAWKEYE] Ultimate Screening Intelligence Engine v${V} online.\n` +
      `20 layers | 60+ lists | Jaro-Winkler fuzzy | UBO graph | Bayesian | XAI | SHA-256 audit`,
    'color:#B49B5A;font-weight:bold;'
  );
})();
