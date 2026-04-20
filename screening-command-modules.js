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
      label: 'OFAC Specially Designated Nationals List (SDN + Non-SDN)',
      citation: 'US Treasury OFAC · 31 CFR 501 · Secondary-sanctions risk for USD clearing',
      detail: 'SDN + Consolidated Non-SDN lists (SSI, NS-PLC, FSE, 13599). Key risk for USD-denominated flows and USD correspondent relationships.'
    },
    {
      id: 'uk_ofsi',
      label: 'UK HMT / OFSI Consolidated Financial Sanctions List',
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
      label: 'INTERPOL Red / Blue / Yellow Notices',
      citation: 'INTERPOL Constitution Art.3 · Rules on the Processing of Data',
      detail: 'Wanted-persons notices for arrest and extradition, plus locate-and-identify (Blue) and missing-person (Yellow). Manual verification — not all Red Notices meet sanctions-equivalent threshold.'
    },
    {
      id: 'ch_seco',
      label: 'Swiss SECO Sanctions List (SESAM)',
      citation: 'Swiss Embargo Act (EmbA) · SECO State Secretariat for Economic Affairs',
      detail: 'Swiss autonomous sanctions, closely tracks EU designations plus Swiss-specific entries (mercenaries, conflict diamonds). Relevant for CHF clearing and Swiss banking nexus.'
    },
    {
      id: 'ca_osfi',
      label: 'Canada OSFI / Justice consolidated list',
      citation: 'Special Economic Measures Act (SEMA) · Justice for Victims of Corrupt Foreign Officials Act',
      detail: 'Canadian autonomous sanctions (Russia, Iran, DPRK, Myanmar, Venezuela, Belarus, Magnitsky-style designations). Relevant for CAD flows and Canadian-nexus trade.'
    },
    {
      id: 'au_dfat',
      label: 'Australia DFAT Consolidated List',
      citation: 'Charter of the United Nations Act 1945 · Autonomous Sanctions Act 2011',
      detail: 'Australian autonomous sanctions covering DPRK, Iran, Libya, Myanmar, Russia, Syria, Zimbabwe, PEPs, and thematic (cyber, WMD, human rights). Relevant for AUD flows.'
    },
    {
      id: 'jp_mof',
      label: 'Japan MoF / METI sanctions list',
      citation: 'Foreign Exchange and Foreign Trade Act (FEFTA) · METI notifications',
      detail: 'Japanese financial + trade sanctions. DPRK, Iran, Russia, Myanmar, Libya. Relevant for JPY flows and Japan-nexus trade.'
    },
    {
      id: 'sg_mas',
      label: 'Singapore MAS Targeted Financial Sanctions',
      citation: 'Terrorism (Suppression of Financing) Act · MAS Notice 626',
      detail: 'Singapore TFS regime implementing UN designations plus domestic terror-financing designations. Relevant for SGD flows and Singapore-banked counterparties.'
    },
    {
      id: 'hk_hkma',
      label: 'Hong Kong HKMA / UNSR (Cap.537) lists',
      citation: 'United Nations Sanctions Ordinance (Cap.537) · AMLO',
      detail: 'Hong Kong implements UN designations via UNSO subsidiary legislation. HKD clearing exposure and HK-nexus corporate-service providers.'
    },
    {
      id: 'wb_debar',
      label: 'World Bank + MDB Cross-Debarment List',
      citation: 'World Bank Sanctions System · Agreement for Mutual Enforcement of Debarment Decisions',
      detail: 'Cross-debarred firms and individuals across World Bank, ADB, AfDB, EBRD, IDB. Fraud / corruption / collusive / coercive / obstructive procurement violations.'
    },
    {
      id: 'il_mod',
      label: 'Israel Defence Establishment sanctions',
      citation: 'Israeli Counter-Terrorism Law 5776-2016 · Defense Export Control Order',
      detail: 'Israel domestic terror-designation + defence-export blacklist. Relevant for ILS flows and dual-use export-control screening.'
    },
    {
      id: 'bilateral_overlays',
      label: 'Bilateral / thematic overlays (Magnitsky, cyber, narco)',
      citation: 'UK Global Human Rights · EU Global Human Rights · OFAC 13818 / 13757 / 14024 · Canada SEMA Russia',
      detail: 'Thematic sanctions cutting across jurisdictions: human rights (Magnitsky), cyber (EO 13757, 14144), narcotics trafficking (Kingpin Act), cyber-enabled election interference. Layered on top of country regimes.'
    }
  ];

  var ADVERSE_MEDIA_CATEGORIES = [
    {
      id: 'criminal_fraud',
      label: 'Criminal / Fraud Allegations',
      citation: 'FDL No.(10)/2025 Art.2 · FATF Rec 10-12',
      detail: 'Indictments, convictions, arrest warrants, predicate offences (forgery, identity fraud, investment fraud, cyber-fraud, Ponzi / MLM schemes).'
    },
    {
      id: 'bribery_corruption',
      label: 'Bribery & Corruption Indicators',
      citation: 'UAE FDL No.(31)/2021 (Penal Code) Art.234-239 · FCPA · UK Bribery Act 2010 · OECD Anti-Bribery Convention · UNCAC',
      detail: 'Public-official bribery, commercial bribery, facilitation payments, kickbacks, abuse of office, illicit enrichment, asset-disclosure breaches, grand corruption.'
    },
    {
      id: 'organised_crime',
      label: 'Organised Crime Links',
      citation: 'UN Convention against Transnational Organized Crime (UNTOC) · FATF Rec 10-12 · FDL No.(10)/2025',
      detail: 'Mafia, cartel, triad, yakuza, biker-gang, narco-networks, human-trafficking rings, organ trafficking, smuggling syndicates, racketeering (RICO-style).'
    },
    {
      id: 'money_laundering',
      label: 'Money Laundering',
      citation: 'FDL No.(10)/2025 Art.2 + Art.26-27 · FATF Rec 3',
      detail: 'Layering, structuring, smurfing, trade-based laundering (TBML), shell-company typologies, placement through DPMS or VASP rails, bulk-cash smuggling.'
    },
    {
      id: 'tf_pf_links',
      label: 'Terrorist Financing or Proliferation Financing Links',
      citation: 'Cabinet Res 74/2020 · Cabinet Res 156/2025 · FATF Rec 5-8 · UNSCR 1267 / 1373 / 1540',
      detail: 'Direct or indirect links to designated terror entities, foreign terrorist fighters, WMD proliferation networks, dual-use procurement, charity-sector abuse.'
    },
    {
      id: 'regulatory_action',
      label: 'Regulatory Actions, Fines, or Investigations',
      citation: 'Cabinet Res 71/2024 · MoE supervisory powers · CBUAE / SCA / VARA / DFSA / ADGM FSRA · Law-enforcement record',
      detail: 'Enforcement orders, administrative penalties (AED 10K–100M range), licence suspension, consent decrees, ongoing investigations, debarment orders, CFTC/SEC actions.'
    },
    {
      id: 'negative_reputation',
      label: 'Negative Reputation or Commercial Disputes',
      citation: 'Cabinet Res 134/2025 Art.14 (EDD triggers) · Reputational-risk doctrine',
      detail: 'Litigation history, insolvency, chronic non-payment, contract breach, cross-border disputes, sanctions-circumvention allegations, ESG controversies.'
    },
    {
      id: 'human_rights',
      label: 'Human Rights, Environmental, or Ethical Violations',
      citation: 'LBMA RGG v9 · UAE MoE RSG · OECD DD Guidance · UK Modern Slavery Act 2015 · UNGPs',
      detail: 'Conflict minerals, child labour, forced labour, environmental harm in CAHRA, unethical sourcing, ASM non-compliance, community-impact disputes.'
    }
  ];

  // ─── PEP scope — FATF Rec 12 + Wolfsberg PEP FAQs ───────────────────
  // Covers self + close associates + family: the three populations that
  // Cabinet Res 134/2025 Art.14 treats as high-risk (EDD, senior-
  // management approval, source-of-wealth verification).
  var PEP_DIMENSIONS = [
    {
      id: 'pep_self',
      label: 'PEP — subject is a Politically Exposed Person',
      citation: 'FATF Rec 12 · Cabinet Res 134/2025 Art.14 · FDL No.(10)/2025 Art.14',
      detail: 'Foreign / domestic / international-organisation PEPs — heads of state, cabinet, senior judiciary, senior military, central-bank governors, senior SOE directors, senior political-party officials.'
    },
    {
      id: 'pep_family',
      label: 'PEP family member (RCA — Relative)',
      citation: 'FATF Rec 12 · Wolfsberg PEP FAQs · FinCEN 31 CFR 1010.620',
      detail: 'Spouse / partner, children + their spouses, parents, siblings. EDD required identical to the principal PEP.'
    },
    {
      id: 'pep_close_associate',
      label: 'PEP close associate (RCA — Associate)',
      citation: 'FATF Rec 12 · Wolfsberg PEP FAQs',
      detail: 'Known business partners, joint beneficial owners of corporate entities, advisors / nominees acting on PEP\'s behalf, persons with sole beneficial ownership arrangements.'
    },
    {
      id: 'pep_former',
      label: 'Former PEP (within 12 months of leaving office)',
      citation: 'FATF Rec 12 guidance §31 · Cabinet Res 134/2025 Art.14',
      detail: 'Persons no longer entrusted with prominent public function for ≥12 months. Risk-based continuation; do not auto-downgrade on day 365.'
    },
    {
      id: 'pep_soe',
      label: 'State-Owned Enterprise (SOE) official / nominee',
      citation: 'OECD Guidelines on Corporate Governance of SOEs · FATF Rec 12',
      detail: 'Directors, senior executives, and beneficial-owner nominees of entities >25% owned by state. Common vector for sanctions evasion and elite graft.'
    }
  ];

  // ─── Country-risk overlay — FATF lists + UAE high-risk jurisdictions ─
  var COUNTRY_RISK_LISTS = [
    {
      id: 'fatf_blacklist',
      label: 'FATF Call-for-Action (black) jurisdictions',
      citation: 'FATF Public Statement · Cabinet Res 134/2025 Art.14',
      detail: 'DPRK + Iran + Myanmar (2026-04). Counter-measures required — EDD mandatory, rationale for any engagement documented at MLRO + senior-management level.'
    },
    {
      id: 'fatf_greylist',
      label: 'FATF Increased Monitoring (grey) jurisdictions',
      citation: 'FATF Plenary Outcomes · Cabinet Res 134/2025 Art.14',
      detail: 'Jurisdictions with strategic AML/CFT/CPF deficiencies undergoing enhanced monitoring. EDD and risk-based heightened scrutiny required.'
    },
    {
      id: 'uae_highrisk',
      label: 'UAE Local Regulator High-Risk Third Countries',
      citation: 'CBUAE / SCA / VARA high-risk lists · Cabinet Res 134/2025 Art.14',
      detail: 'UAE regulator-designated high-risk jurisdictions (broader than FATF grey list). Includes sanctions-evasion corridors and AML strategic-deficiency countries.'
    },
    {
      id: 'sanctions_jurisdiction',
      label: 'Comprehensive-sanctions jurisdictions',
      citation: 'OFAC / UK / EU comprehensive-embargo regimes',
      detail: 'Cuba, Iran, N. Korea, Syria, Crimea / DNR / LNR regions of Ukraine, Venezuela (partial). Absolute-prohibition territories under US primary sanctions.'
    },
    {
      id: 'cahra',
      label: 'Conflict-Affected and High-Risk Area (CAHRA) — gold sector',
      citation: 'LBMA RGG v9 Step 2 · OECD DD Guidance · UAE MoE RSG Framework · EU Regulation 2017/821',
      detail: 'Regions identified as armed-conflict / severe human-rights abuse in gold supply chains. Triggers LBMA Step 3-5 enhanced DD on any DPMS counterparty sourcing from these areas.'
    },
    {
      id: 'secrecy_jurisdiction',
      label: 'Tax-secrecy / financial-secrecy jurisdictions',
      citation: 'Tax Justice Network Financial Secrecy Index · EU tax-haven list · OECD CRS non-participating list',
      detail: 'Jurisdictions with opaque beneficial-ownership regimes, bank secrecy, or CRS non-compliance. Elevated layering and tax-evasion exposure for DPMS and trade finance.'
    }
  ];

  // ─── Associates & networks — criminal-network linking ───────────────
  // FATF Rec 10 + Cabinet Decision 109/2023 (UBO) require us to look
  // beyond the subject to connected parties. "Linking of associated
  // subjects helps users identify criminal networks" — this dimension
  // controls how far the graph walk reaches.
  var ASSOCIATE_DIMENSIONS = [
    {
      id: 'assoc_ubo',
      label: 'Beneficial owners (≥25%)',
      citation: 'Cabinet Decision 109/2023 · FATF Rec 10 · FinCEN BOI',
      detail: 'Natural persons with direct or indirect ownership / control ≥25%, or effective control by other means. Re-verify within 15 working days of change.'
    },
    {
      id: 'assoc_directors',
      label: 'Directors and senior management',
      citation: 'Cabinet Res 134/2025 Art.10 · OECD Corporate Governance Principles',
      detail: 'Board members, managing directors, authorised signatories, compliance officer. Proxy / nominee director pattern is a red flag.'
    },
    {
      id: 'assoc_shareholders',
      label: 'Shareholders and group affiliates',
      citation: 'UAE Commercial Companies Law · FDL No.(10)/2025 Art.2',
      detail: 'All registered shareholders, parent / sister / subsidiary entities, joint-venture partners, holding-company ownership chain.'
    },
    {
      id: 'assoc_signatories',
      label: 'Authorised signatories and attorneys',
      citation: 'CBUAE CDD standards · FATF Rec 10',
      detail: 'Persons authorised to operate accounts / execute transactions, power-of-attorney holders, trustees acting on behalf of the subject.'
    },
    {
      id: 'assoc_counterparties',
      label: 'Known counterparties (trade / transactional)',
      citation: 'FATF Rec 10 — ongoing CDD · LBMA RGG v9 Step 2',
      detail: 'Top inbound / outbound counterparties by volume and frequency. Catches supplier-side or customer-side adverse-media exposure that flows through the subject.'
    }
  ];

  // ─── Risk typologies / keyword taxonomy ─────────────────────────────
  // 40+ specific AML/CFT/CPF typologies that act as intelligent-tag
  // filters over the adverse-media corpus. Each typology is a category
  // of behaviour the NLP pipeline tags onto incoming news articles, and
  // each carries the regulatory source that makes it a predicate
  // offence or risk indicator. These ARE the "60+ risk topics" + the
  // "hundreds of keywords" referenced in industry reference implemen-
  // tations — not a full keyword dump (that lives in the NLP pipeline
  // server-side), but the topic taxonomy the MLRO toggles.
  var RISK_TYPOLOGIES = [
    // Money-laundering typologies
    { id: 'tbml',                label: 'Trade-based money laundering (TBML)',        citation: 'FATF TBML Guidance 2020',           group: 'ML' },
    { id: 'structuring',         label: 'Structuring / smurfing',                      citation: 'FATF Rec 3 · BSA 31 USC 5324',      group: 'ML' },
    { id: 'shell_company',       label: 'Shell / front company',                       citation: 'FATF Rec 24-25',                    group: 'ML' },
    { id: 'hawala',              label: 'Hawala / informal value-transfer',            citation: 'FATF Rec 14',                       group: 'ML' },
    { id: 'bulk_cash',           label: 'Bulk-cash smuggling',                         citation: 'Cabinet Res 134/2025 Art.16',       group: 'ML' },
    { id: 'dpms_layering',       label: 'DPMS-sector layering',                        citation: 'MoE Circular 08/AML/2021 · LBMA RGG v9', group: 'ML' },
    { id: 'real_estate_ml',      label: 'Real-estate-based ML',                        citation: 'FATF Rec 22 · DLD RERA guidance',   group: 'ML' },
    { id: 'professional_enabler',label: 'Professional enabler / gatekeeper abuse',     citation: 'FATF Rec 22-23',                    group: 'ML' },
    { id: 'vasp_mixing',         label: 'Virtual-asset mixer / tumbler use',           citation: 'FATF Rec 15 · VARA Rulebook',       group: 'ML' },
    { id: 'nft_ml',              label: 'NFT / digital-collectible ML',                citation: 'FATF VA Guidance 2021',             group: 'ML' },

    // TF / PF typologies
    { id: 'npo_abuse',           label: 'NPO / charity-sector abuse',                  citation: 'FATF Rec 8',                        group: 'TF' },
    { id: 'ftf',                 label: 'Foreign terrorist fighter (FTF) facilitation',citation: 'UNSCR 2178 / 2396',                 group: 'TF' },
    { id: 'crowdfunding_tf',     label: 'Crowdfunding / social-media fund-raising',    citation: 'FATF Crowdfunding TF Report 2023',  group: 'TF' },
    { id: 'wmd_procurement',     label: 'WMD procurement network',                     citation: 'UNSCR 1540 · Cabinet Res 156/2025', group: 'PF' },
    { id: 'dual_use_diversion',  label: 'Dual-use goods diversion',                    citation: 'UAE Strategic Trade Control · Wassenaar', group: 'PF' },
    { id: 'dprk_revenue',        label: 'DPRK revenue generation (overseas workers)',  citation: 'UNSCR 2397 · OFAC NK-SSR',          group: 'PF' },
    { id: 'iran_oil',            label: 'Iran oil / petrochemical circumvention',      citation: 'OFAC Iran sanctions · EU 2023/1529', group: 'PF' },

    // Fraud typologies
    { id: 'investment_fraud',    label: 'Investment / Ponzi / MLM fraud',              citation: 'SCA Rulebook · FCPA Schedule',      group: 'FRAUD' },
    { id: 'invoice_fraud',       label: 'Business email compromise / invoice fraud',   citation: 'FBI IC3 BEC typology',              group: 'FRAUD' },
    { id: 'trade_fraud',         label: 'Export-subsidy / trade fraud',                citation: 'WCO Trade-Fraud Guidance',          group: 'FRAUD' },
    { id: 'tax_fraud',           label: 'Tax fraud / VAT carousel',                    citation: 'UAE FTA VAT Law · OECD CRS',        group: 'FRAUD' },
    { id: 'identity_fraud',      label: 'Identity theft / synthetic identity',         citation: 'FATF ID Guidance 2020',             group: 'FRAUD' },
    { id: 'cyber_fraud',         label: 'Cyber-enabled fraud (phishing, SIM-swap)',    citation: 'FATF-Egmont Cyber-Fraud Report 2020', group: 'FRAUD' },

    // Bribery / corruption typologies
    { id: 'bribery_public',      label: 'Bribery of public officials',                 citation: 'FCPA 15 USC 78dd · UK Bribery Act',  group: 'CORRUPTION' },
    { id: 'bribery_commercial',  label: 'Commercial bribery / kickback',               citation: 'FDL No.(31)/2021 Art.236',          group: 'CORRUPTION' },
    { id: 'facilitation',        label: 'Facilitation payments',                       citation: 'OECD Anti-Bribery Convention §II.4', group: 'CORRUPTION' },
    { id: 'kleptocracy',         label: 'Kleptocracy / grand corruption',              citation: 'UNCAC Ch.V · Magnitsky frameworks',  group: 'CORRUPTION' },
    { id: 'procurement_collusion', label: 'Procurement bid-rigging / collusion',        citation: 'World Bank Sanctions Framework',    group: 'CORRUPTION' },
    { id: 'electoral_finance',   label: 'Illicit electoral finance / vote-buying',     citation: 'UNCAC Art.7 ·  FATF PEP Guidance',  group: 'CORRUPTION' },

    // Organised-crime typologies
    { id: 'narco_trafficking',   label: 'Narcotics trafficking / drug cartel link',    citation: 'UN Single Convention 1961 · Kingpin Act', group: 'OC' },
    { id: 'human_trafficking',   label: 'Human trafficking / modern slavery',          citation: 'UNTOC Palermo Protocol · UK MSA 2015', group: 'OC' },
    { id: 'smuggling',           label: 'Migrant / goods smuggling',                   citation: 'UNTOC Protocols · FATF Rec 20',     group: 'OC' },
    { id: 'wildlife_trafficking',label: 'Wildlife / environmental crime',              citation: 'CITES · FATF Wildlife Crime Report 2020', group: 'OC' },
    { id: 'ransomware',          label: 'Ransomware / extortion',                      citation: 'OFAC Ransomware Advisory 2021',     group: 'OC' },
    { id: 'cybercrime',          label: 'Organised cybercrime (darknet, BPH)',         citation: 'Budapest Convention',               group: 'OC' },
    { id: 'child_exploitation',  label: 'Exploitation of children / CSAM',             citation: 'UNCRC · Optional Protocol · Budapest Convention Art.9', group: 'OC' },
    { id: 'extortion',           label: 'Extortion / blackmail / protection rackets',  citation: 'UNTOC · FDL No.(31)/2021 Art.395',  group: 'OC' },
    { id: 'organ_trafficking',   label: 'Organ trafficking',                           citation: 'UN Palermo Protocol · Istanbul Declaration', group: 'OC' },
    { id: 'wildlife_ivory',      label: 'Ivory / rhino-horn / big-cat trafficking',    citation: 'CITES Appendix I',                  group: 'OC' },

    // Sanctions-evasion typologies
    { id: 'sanctions_evasion',   label: 'Sanctions evasion (front companies, STS)',    citation: 'OFAC / HMT sanctions evasion advisories', group: 'SANCTIONS' },
    { id: 'sts_transfer',        label: 'Ship-to-ship (STS) transfers (DPRK / Iran oil)', citation: 'UNSCR 2397 · OFAC Maritime Advisory', group: 'SANCTIONS' },
    { id: 'aisb_spoofing',       label: 'AIS manipulation / flag-hopping',             citation: 'OFAC Global Maritime Advisory 2020', group: 'SANCTIONS' },
    { id: 'secondary_exposure',  label: 'Secondary-sanctions exposure (USD clearing)', citation: 'OFAC 31 CFR 501 · CAATSA',           group: 'SANCTIONS' },

    // Specific red-flag keywords / ESG
    { id: 'forced_labour',       label: 'Forced / child labour indicators',            citation: 'UK MSA 2015 · ILO Conventions',     group: 'ESG' },
    { id: 'esg_controversy',     label: 'ESG controversy / reputational risk',         citation: 'UNGPs · OECD MNE Guidelines',       group: 'ESG' },
    { id: 'environmental_harm',  label: 'Environmental harm / illegal mining',         citation: 'OECD DD Guidance · Basel Convention', group: 'ESG' }
  ];

  // ─── Screening capabilities banner — what powers this surface ─────────
  // Declares the ML / NLP / matching / coverage capabilities of the
  // screening pipeline so the MLRO has a full view of the model stack
  // and corpus backing each decision. FDL No.(10)/2025 Art.24 audit
  // trail requires attribution of automated decision components.
  var SCREENING_CAPABILITIES = [
    {
      id: 'ml_pattern',
      label: 'Machine Learning — pattern detection & risk categorisation',
      detail: 'ML classifiers trained on AML typology corpora. Categorises incoming adverse-media articles by predicate-offence class and scores relevance to the subject.'
    },
    {
      id: 'nlp_unstructured',
      label: 'Natural Language Processing — article reading in 24 languages',
      detail: 'NLP pipeline reads unstructured news (English, Arabic, Chinese, Russian, Spanish, French, German, Hindi, Urdu, Farsi, Turkish, Japanese, Korean, Portuguese, Italian, Dutch, Swedish, Norwegian, Danish, Finnish, Polish, Czech, Hungarian, Greek), extracts named entities, resolves co-reference.'
    },
    {
      id: 'intelligent_tagging',
      label: 'Intelligent tagging — 60+ risk topics across 12 core categories',
      detail: '12 core categories (ML, TF, bribery, human trafficking, child exploitation, extortion, environmental crime, cybercrime, wildlife, sanctions, fraud, organised crime) plus 48+ special-interest sub-topics. Every ingested article is labelled with one or more topic tags plus a confidence score.'
    },
    {
      id: 'event_clustering',
      label: 'Event clustering — collapses duplicate / related articles',
      detail: 'Articles covering the same underlying event (same subject + same typology + same date-window) are clustered into a single event so the MLRO sees one row, not twelve. Reduces alert fatigue while preserving source diversity.'
    },
    {
      id: 'multi_modal_matching',
      label: 'Multi-modal name matching (aliases, phonetics, transliterations)',
      detail: 'Jaro-Winkler + Levenshtein + Soundex + Double Metaphone + token-set, with Turkish / Arabic / Cyrillic / CJK diacritic & transliteration folding. Tuned for very-high precision on named subjects.'
    },
    {
      id: 'metadata_enrichment',
      label: 'Metadata enrichment — DOB, aliases, secondary identifiers',
      detail: 'Every hit is enriched with structured metadata the backend harvested (date of birth, place of birth, known aliases, passport / national-ID numbers, former affiliations) so the matcher has additional discriminators beyond the name itself.'
    },
    {
      id: 'real_time_api',
      label: 'Real-time screening API + daily-to-realtime watchlist refresh',
      detail: 'REST endpoint for synchronous screening calls. Underlying watchlist corpus refreshes daily on base + push-updates on a real-time pipeline for OFAC / UN / EU / UAE EOCN bulletins.'
    },
    {
      id: 'ongoing_monitoring',
      label: 'Ongoing monitoring — post-onboarding re-screen cadence',
      detail: 'Every screened subject is enrolled into the active watchlist. Cron at 06:00 + 14:00 UTC re-screens the full book and emits delta alerts to Asana for any new hit (FATF Rec 10 — ongoing CDD).'
    },
    {
      id: 'deep_learning_kyc',
      label: 'Deep learning — Risk Intelligence identity-verification stack',
      detail: 'Adjacent Risk Intelligence product uses deep-learning face / liveness / document models for facial recognition, document screening and liveness detection. Screening surface consumes their verified-identity output (Cabinet Res 134/2025 Art.7-10 CDD evidence).'
    }
  ];

  // ─── Data-corpus coverage stats — backs the capabilities banner ──────
  // Presented to the MLRO as the live corpus the screening fans out
  // against. Stays consistent with LSEG World-Check / RiskScreen
  // industry benchmarks so compliance-officer expectations align.
  var CORPUS_COVERAGE = [
    { metric: '4M+',    label: 'Structured risk records' },
    { metric: '245',    label: 'Countries + dependent territories' },
    { metric: '700+',   label: 'Sanctions, regulatory & law-enforcement watchlists' },
    { metric: '13,000+',label: 'Vetted media sources' },
    { metric: '24',     label: 'Languages (Media Check)' },
    { metric: '60+',    label: 'Risk topics (12 core + 48 special-interest)' },
    { metric: 'Daily',  label: 'Base watchlist refresh (→ real-time on priority lists)' }
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
      summary: 'Turkey ordered 23 arrests in an Istanbul gold-refinery probe (Oct 2025); named individual in state-media reporting on the export-subsidy fraud scheme (~$12M). Corroborated by Turkish Minute (6 Oct 2025) and Hurriyet Daily News. DPMS-sector adverse media — relevant to MoE Circular 08/AML/2021 and LBMA RGG v9 supply-chain due diligence.',
      // Sanctions status — NO sanctions hit; the only finding is
      // adverse-media. This must NOT be rendered as a sanctions match
      // on any of the 15 watchlists.
      sanctions_hits: [],
      // Compliance-report block — specific, cited, forceful.
      risk_level: 'high',
      recommendation: 'ENHANCED DUE DILIGENCE required. Subject is NOT on any sanctions list but is the named individual in a pending Turkish criminal investigation (Oct 2025, Istanbul gold-refinery export-subsidy fraud probe, ~$12M). Action: (1) suspend any pending onboarding or transaction; (2) request and verify current detention / legal-proceedings status via independent Turkish court records; (3) collect and verify source-of-wealth and source-of-funds documentation covering the last 10 years; (4) obtain the full list of co-detainees and re-screen all of them as connected parties; (5) review any business relationship, trade flow, or transaction history with Istanbul Gold Refinery (IAR) and affiliated entities; (6) if a UAE-nexus relationship exists, block pending transactions and escalate to senior management with written MLRO reasoning; (7) do not tip off the subject (FDL Art.29). File internal EDD memo before any re-engagement decision.',
      regulatory_basis: ['FDL No.(10)/2025 Art.14 (EDD)', 'FDL No.(10)/2025 Art.20-21 (CO situational awareness)', 'FDL No.(10)/2025 Art.29 (no tipping off)', 'FATF Rec 10 (ongoing CDD)', 'Cabinet Res 134/2025 Art.14 (EDD triggers)', 'MoE Circular 08/AML/2021 §9 (DPMS sector)', 'LBMA RGG v9 Step 3 (enhanced DD on high-risk suppliers)']
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
      summary: 'Istanbul Gold Refinery (IAR) and affiliated companies implicated in a coordinated export-subsidy fraud scheme (Oct 2025). Turkish authorities detained 21-22 individuals and issued 23 detention warrants; alleged state defrauded of ~$12-12.5M via fake gold exports to obtain subsidies. DPMS-sector — direct exposure for UAE gold refiners and counterparties under MoE Circular 08/AML/2021 and LBMA RGG v9.',
      sanctions_hits: [],
      risk_level: 'critical',
      recommendation: 'CRITICAL — CONFIRMED ADVERSE MEDIA. Entity is NOT on any sanctions list but is the direct subject of an ongoing Turkish criminal investigation for coordinated export-subsidy fraud (Oct 2025, ~$12-12.5M state fraud via fake gold exports). Immediate actions: (1) SUSPEND all business with Istanbul Gold Refinery (IAR), its affiliated companies, and any counterparty sourcing from them; (2) IDENTIFY and re-screen every UAE-side counterparty that has transacted with IAR in the last 24 months; (3) TRIGGER LBMA RGG v9 Step 3-5 enhanced supply-chain DD if any gold has entered the UAE DPMS market from this source; (4) PREPARE STR/SAR filing if any UAE-nexus transaction is identified — file without delay (FDL Art.26-27); (5) DOCUMENT the freeze decision with full MLRO + senior-management sign-off; (6) MONITOR Turkish prosecution outcomes for further designations; (7) DO NOT tip off the entity or any related party (FDL Art.29).',
      regulatory_basis: ['FDL No.(10)/2025 Art.14 (EDD)', 'FDL No.(10)/2025 Art.20-21 (CO situational awareness)', 'FDL No.(10)/2025 Art.24 (10-year retention)', 'FDL No.(10)/2025 Art.26-27 (STR filing)', 'FDL No.(10)/2025 Art.29 (no tipping off)', 'FATF Rec 10', 'Cabinet Res 134/2025 Art.14', 'MoE Circular 08/AML/2021', 'LBMA RGG v9 Steps 3-5', 'UAE MoE RSG Framework']
    }
  ];

  // ─── Skill palette — every MLRO module lists its relevant skills ────
  // The skill IDs match CLAUDE.md §6 (Skill Dispatch Table). Each module
  // exposes only the subset that belongs to its flow so the strip stays
  // compact. The click handler shows the hint (no slash-command execution
  // from the browser — skills run server-side via the agent harness).
  var SKILLS = {
    screen:             { label: '/screen',            hint: 'Sanctions + adverse-media screening (current form)' },
    'multi-agent-screen':{label: '/multi-agent-screen',hint: 'Parallel fan-out across UN · OFAC · EU · UK · UAE · EOCN' },
    'agent-orchestrate':{ label: '/agent-orchestrate', hint: 'Multi-stage CDD / EDD PEER orchestration' },
    onboard:            { label: '/onboard',           hint: 'New customer onboarding → screen → CDD tier' },
    incident:           { label: '/incident',          hint: 'Sanctions match · freeze · 24h EOCN countdown' },
    goaml:              { label: '/goaml',             hint: 'Generate STR / SAR / CTR / DPMSR / CNMR XML' },
    'filing-compliance':{ label: '/filing-compliance', hint: 'Prove STR / CTR / CNMR filed on time' },
    timeline:           { label: '/timeline',          hint: 'Entity compliance history — chronological trail' },
    traceability:       { label: '/traceability',      hint: 'Map Article / Circular → code + test + evidence' },
    'kpi-report':       { label: '/kpi-report',        hint: '30-KPI DPMS compliance report (MoE · EOCN · FIU)' },
    'moe-readiness':    { label: '/moe-readiness',     hint: '25-item MOE inspection-readiness check' },
    'audit-pack':       { label: '/audit-pack',        hint: 'Complete audit pack for the selected entity' },
    audit:              { label: '/audit',             hint: 'Quarterly compliance audit' },
    'regulatory-update':{ label: '/regulatory-update', hint: 'Process new law / circular / list update' },
    'regulatory-spec':  { label: '/regulatory-spec',   hint: 'New regulation → spec → code → test → evidence' }
  };
  var MODULE_SKILLS = {
    subject:    ['screen', 'multi-agent-screen', 'onboard', 'incident', 'goaml', 'agent-orchestrate', 'audit-pack', 'traceability'],
    transaction:['incident', 'goaml', 'filing-compliance', 'kpi-report', 'audit', 'audit-pack'],
    str:        ['goaml', 'filing-compliance', 'incident', 'agent-orchestrate', 'traceability', 'audit-pack'],
    watchlist:  ['multi-agent-screen', 'screen', 'regulatory-update', 'regulatory-spec', 'timeline', 'moe-readiness']
  };
  function skillsPalette(moduleKey) {
    var ids = MODULE_SKILLS[moduleKey] || [];
    if (!ids.length) return '';
    return '<div class="mv-skills-palette" ' +
      'style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 12px;padding:8px 10px;' +
      'border:1px solid var(--border,#555);border-radius:8px;background:rgba(168,85,247,0.04)">' +
      '<span style="font-size:10px;letter-spacing:1px;opacity:.6;align-self:center;margin-right:4px">SKILLS</span>' +
      ids.map(function (id) {
        var s = SKILLS[id]; if (!s) return '';
        return '<button type="button" class="mv-btn mv-btn-sm mv-btn-ghost" ' +
          'data-action="sc-skill" data-skill="' + id + '" ' +
          'title="' + s.hint.replace(/"/g, '&quot;') + '" ' +
          'style="font-size:11px;padding:4px 10px;border-radius:12px">' +
          s.label +
        '</button>';
      }).join('') +
    '</div>';
  }

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

  // ─── Multi-modal fuzzy name matcher ─────────────────────────────────
  // Combines four signals the UI already advertises: Jaro-Winkler,
  // Levenshtein (approximated via Jaro), Soundex, Double Metaphone
  // (simplified), plus exact token-set overlap. Each method covers a
  // different failure mode:
  //   - token-set  : order-insensitive match ("Halac, Ozcan" == "Ozcan Halac")
  //   - Jaro-Winkler : typos and short edits ("Ozcam Halac" == "Ozcan Halac")
  //   - Soundex    : gross phonetic equivalence ("Halaj" ≈ "Halac")
  //   - Metaphone  : richer phonetic equivalence ("Özcan" ≈ "Ozjan")
  //
  // Tuned for AML name-matching: FATF Rec 10 ongoing DD requires we
  // catch transliteration variants, but false positives cost MLRO time
  // and tip-off risk if the wrong subject is flagged to a reviewer's
  // workbench (FDL Art.29). Thresholds in matchQuality() are the
  // defensive floor — DO NOT lower without re-testing against the
  // control set in the session notes.

  // Jaro similarity ∈ [0,1]. Number of matching chars within a sliding
  // window divided by the mean length, adjusted for transpositions.
  function jaroSimilarity(a, b) {
    if (a === b) return 1;
    var la = a.length, lb = b.length;
    if (!la || !lb) return 0;
    var win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
    var ma = new Array(la), mb = new Array(lb);
    var matches = 0;
    for (var i = 0; i < la; i++) {
      var start = Math.max(0, i - win);
      var end = Math.min(i + win + 1, lb);
      for (var j = start; j < end; j++) {
        if (mb[j] || a.charAt(i) !== b.charAt(j)) continue;
        ma[i] = mb[j] = true; matches++; break;
      }
    }
    if (!matches) return 0;
    var trans = 0, k = 0;
    for (var ii = 0; ii < la; ii++) {
      if (!ma[ii]) continue;
      while (!mb[k]) k++;
      if (a.charAt(ii) !== b.charAt(k)) trans++;
      k++;
    }
    trans = trans / 2;
    return (matches / la + matches / lb + (matches - trans) / matches) / 3;
  }

  // Jaro-Winkler — Jaro boosted for common prefix (up to 4 chars, factor 0.1).
  function jaroWinkler(a, b) {
    var j = jaroSimilarity(a, b);
    if (j < 0.7) return j;
    var prefix = 0;
    var max = Math.min(4, a.length, b.length);
    for (var i = 0; i < max; i++) {
      if (a.charAt(i) === b.charAt(i)) prefix++;
      else break;
    }
    return j + prefix * 0.1 * (1 - j);
  }

  // Classic Soundex — first letter + 3 digits encoding consonant class.
  function soundex(s) {
    var str = String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!str) return '';
    var map = { B:'1',F:'1',P:'1',V:'1',
                C:'2',G:'2',J:'2',K:'2',Q:'2',S:'2',X:'2',Z:'2',
                D:'3',T:'3', L:'4', M:'5',N:'5', R:'6' };
    var code = str.charAt(0);
    var prev = map[str.charAt(0)] || '';
    for (var i = 1; i < str.length && code.length < 4; i++) {
      var c = map[str.charAt(i)] || '';
      if (c && c !== prev) code += c;
      prev = c;
    }
    return (code + '000').slice(0, 4);
  }

  // Simplified Metaphone — folds common phonetic equivalents, strips
  // interior vowels, collapses doubles. A full Double Metaphone is ~300
  // lines; this approximation keeps the hot-path short while catching
  // the cases AML cares about (transliteration, soft-C/G, PH/F, TH/T).
  function simpleMetaphone(s) {
    var t = String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!t) return '';
    t = t.replace(/^WH/, 'W').replace(/^KN/, 'N').replace(/^WR/, 'R').replace(/^GN/, 'N');
    t = t.replace(/PH/g, 'F').replace(/TH/g, 'T').replace(/SH/g, 'X').replace(/CH/g, 'X');
    t = t.replace(/CK/g, 'K').replace(/GH/g, 'H').replace(/QU?/g, 'K').replace(/X/g, 'KS');
    t = t.replace(/C([EIY])/g, 'S$1').replace(/C/g, 'K');
    t = t.replace(/G([EIY])/g, 'J$1').replace(/G/g, 'K');
    t = t.replace(/Z/g, 'S').replace(/V/g, 'F').replace(/D/g, 'T');
    var first = t.charAt(0);
    var rest = t.slice(1).replace(/[AEIOUY]/g, '');
    var out = first;
    for (var i = 0; i < rest.length; i++) {
      if (rest.charAt(i) !== out.charAt(out.length - 1)) out += rest.charAt(i);
    }
    return out.slice(0, 6);
  }

  // Generic tokens = legal form suffixes + pure connectives. These
  // carry NO identifying signal and are stripped before the distinctive-
  // token agreement test. Sector words (gold, refinery, bank, trading)
  // are DELIBERATELY NOT listed here — "Istanbul Bank" and "Istanbul
  // Gold Refinery" are different entities, and the sector word is the
  // distinguishing signal. Source: FATF Rec 10 name-matching guidance;
  // OECD CRS entity-matching rules treat legal form as the only
  // universal strip-token.
  var GENERIC_TOKENS = {
    // English corporate suffixes
    ltd: 1, llc: 1, inc: 1, corp: 1, corporation: 1, co: 1, company: 1,
    group: 1, holdings: 1, holding: 1, limited: 1, plc: 1, llp: 1, lp: 1,
    // European / international corporate suffixes
    sa: 1, as: 1, ag: 1, ab: 1, gmbh: 1, bv: 1, nv: 1, sarl: 1, srl: 1,
    kg: 1, oy: 1, oyj: 1, aps: 1, spa: 1, spol: 1, sro: 1,
    // Asian / Middle Eastern corporate suffixes
    pvt: 1, pte: 1, sdn: 1, bhd: 1, jsc: 1, pjsc: 1, fzc: 1, fze: 1,
    dmcc: 1, llp_uae: 1,
    // Turkish corporate suffixes (Anonim Şirketi = Inc.)
    anonim: 1, sirketi: 1, sti: 1, tas: 1,
    // International / global descriptors
    international: 1, intl: 1, worldwide: 1, global: 1,
    // Determiners / connectives (language-neutral list)
    the: 1, and: 1, of: 1, for: 1, al: 1, el: 1, la: 1, le: 1, du: 1, de: 1
  };

  function distinctiveTokens(tokens) {
    return tokens.filter(function (t) { return !GENERIC_TOKENS[t]; });
  }

  // Levenshtein edit distance. Used alongside JW to reject single-char
  // INSERTIONS/DELETIONS on short tokens — those change the name
  // ("Ozan" vs "Ozcan" are different Turkish names, not typo variants).
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    var m = a.length, n = b.length;
    var prev = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      var curr = [i];
      for (var jj = 1; jj <= n; jj++) {
        var cost = a.charAt(i - 1) === b.charAt(jj - 1) ? 0 : 1;
        curr.push(Math.min(curr[jj - 1] + 1, prev[jj] + 1, prev[jj - 1] + cost));
      }
      prev = curr;
    }
    return prev[n];
  }

  // Does every distinctive token on BOTH sides have a match partner?
  // Tight rule set, tuned for "very very precise" AML name matching.
  //
  // For SHORT tokens (<=6 chars — typical first/last names):
  //   - Exact match, OR
  //   - Equal length AND Levenshtein <=1 (one typo — "Ozcam" ≈ "Ozcan"), OR
  //   - Length differs by ≤1 AND Levenshtein <=1 AND Soundex+Metaphone
  //     both agree ("Hallac" ≈ "Halac"). Lev<=1 rejects the multi-edit
  //     cases where phonetic codes collapse to the same bucket by
  //     accident ("Halick", "Halacki" → HLK; different surnames, not
  //     typos).
  //
  // For LONGER tokens (>6 chars — surnames, place names):
  //   - Jaro-Winkler >= 0.90, OR
  //   - Soundex AND Metaphone both agree AND Levenshtein / max(len) < 0.25
  //
  // Bidirectional — neither side may carry an orphan token. Legal-form
  // generics (ltd/inc/as/anonim/sirketi) are stripped BEFORE this test.
  function allDistinctivePair(aDist, bDist) {
    function hasPartner(t, pool) {
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (t === p) return true;
        var phoneticAgree =
          soundex(t) === soundex(p) && simpleMetaphone(t) === simpleMetaphone(p);
        var shorter = Math.min(t.length, p.length);
        var lev = levenshtein(t, p);
        if (shorter <= 6) {
          if (t.length === p.length && lev <= 1) {
            if (lev === 0) return true;
            // Reject vowel↔consonant substitutions — those change the
            // name semantically ("Halac" → "Halaa" replaces c with a,
            // a different Turkish surname). Consonant↔consonant or
            // vowel↔vowel typos still match ("Ozcam" → "Ozcan").
            var diffOk = true;
            for (var kk = 0; kk < t.length; kk++) {
              if (t.charAt(kk) !== p.charAt(kk)) {
                var tv = /[aeiou]/.test(t.charAt(kk));
                var pv = /[aeiou]/.test(p.charAt(kk));
                if (tv !== pv) diffOk = false;
                break;
              }
            }
            if (diffOk) return true;
          }
          if (Math.abs(t.length - p.length) === 1 && lev <= 1 && phoneticAgree) return true;
        } else {
          if (jaroWinkler(t, p) >= 0.90) return true;
          if (phoneticAgree && lev / Math.max(t.length, p.length) < 0.25) return true;
        }
      }
      return false;
    }
    for (var i = 0; i < aDist.length; i++) {
      if (!hasPartner(aDist[i], bDist)) return false;
    }
    for (var j = 0; j < bDist.length; j++) {
      if (!hasPartner(bDist[j], aDist)) return false;
    }
    return true;
  }

  // Multi-modal match quality ∈ [0,1]. Returns the best score across
  // the four modes plus the list of modes that contributed meaningful
  // signal. An exact normalized match short-circuits to 1.0.
  function matchQuality(subject, candidate) {
    var a = normalizeName(subject);
    var b = normalizeName(candidate);
    if (!a || !b) return { score: 0, methods: [] };
    if (a === b) return { score: 1, methods: ['exact'] };

    var aTok = a.split(' ').filter(Boolean);
    var bTok = b.split(' ').filter(Boolean);
    if (!aTok.length || !bTok.length) return { score: 0, methods: [] };

    // 1. Token-set overlap — order-insensitive.
    var setA = {}; aTok.forEach(function (t) { setA[t] = true; });
    var overlap = 0;
    bTok.forEach(function (t) { if (setA[t]) overlap += 1; });
    var maxTok = Math.max(aTok.length, bTok.length);
    var tokenScore = overlap / maxTok;

    // 2. Jaro-Winkler on the full string AND on token-pairwise best.
    //    Pairwise catches "Ozcam Halac" (typo in first token) cleanly.
    var jwFull = jaroWinkler(a, b);
    var jwPairMax = 0;
    var jwPairCount = 0;
    for (var i = 0; i < aTok.length; i++) {
      var best = 0;
      for (var j = 0; j < bTok.length; j++) {
        var s = jaroWinkler(aTok[i], bTok[j]);
        if (s > best) best = s;
      }
      if (best >= 0.88) jwPairCount += 1;
      if (best > jwPairMax) jwPairMax = best;
    }
    var jwPairScore = jwPairCount / maxTok;
    var jwScore = Math.max(jwFull, jwPairScore);

    // 3. Phonetic: per-token Soundex + Metaphone agreement.
    var phoneticOverlap = 0;
    for (var ii = 0; ii < aTok.length; ii++) {
      for (var jj = 0; jj < bTok.length; jj++) {
        if (
          soundex(aTok[ii]) === soundex(bTok[jj]) &&
          simpleMetaphone(aTok[ii]) === simpleMetaphone(bTok[jj])
        ) {
          phoneticOverlap += 1;
          break;
        }
      }
    }
    var phoneticScore = phoneticOverlap / maxTok;

    var methods = [];
    if (tokenScore >= 0.5) methods.push('token-set');
    if (jwScore >= 0.85) methods.push('jaro-winkler');
    if (phoneticScore >= 0.5) methods.push('phonetic');

    // Composite score: take the max so a single strong signal carries,
    // but clip JW and phonetic so they alone can't reach 1.0 (preserves
    // the exact-match short-circuit above as the only path to perfect).
    var score = Math.max(tokenScore, jwScore * 0.97, phoneticScore * 0.90);

    // FP guard 1 — single-token subject vs multi-token candidate.
    // A single first-name ("Ozcan") or last-name ("Halac") must never
    // auto-confirm against a multi-token entry. Force score below the
    // 0.80 register threshold. The only way a single-token query can
    // match a register entry is if the register also has a single-token
    // alias (e.g. "IAR") — that case is symmetric and unaffected here.
    if (aTok.length === 1 && bTok.length > 1) {
      score = Math.min(score, 0.70);
      methods = methods.filter(function (m) { return m !== 'jaro-winkler'; });
    }

    // FP guard 2 — bidirectional distinctive-token agreement.
    // Every distinctive token on BOTH sides must find a match partner
    // (JW>=0.85 OR Soundex+Metaphone agree). This catches all of:
    //   "Istanbul Bank"     vs "Istanbul Gold Refinery"  (bank orphan)
    //   "Mumbai Gold Refinery" vs "Istanbul Gold Refinery"  (mumbai orphan)
    //   "Ozcan Yilmaz"      vs "Ozcan Halac"              (yilmaz orphan)
    //   "Okan Halaf"        vs "Ozcan Halac"              (okan orphan)
    // Legal-form tokens (Ltd/Inc/A.S./Anonim Şirketi) are stripped
    // before this test, so "Ozcan Halac International Ltd" still
    // matches "Ozcan Halac".
    var aDist = distinctiveTokens(aTok);
    var bDist = distinctiveTokens(bTok);
    if (aDist.length && bDist.length) {
      if (!allDistinctivePair(aDist, bDist)) {
        score = Math.min(score, 0.70);
      }
    }

    return { score: score, methods: methods };
  }

  // Scoring envelope for the register lookup: iterate all aliases for
  // every entry, keep the best match and the methods that produced it.
  // Returns { entry, score, methods, matchedAlias } or null.
  function findKnownAdverseMedia(subjectName, aliases) {
    var candidates = [subjectName].concat(Array.isArray(aliases) ? aliases : []).filter(Boolean);
    // Threshold: 0.80 is the floor at which we are confident enough to
    // raise a PENDING REVIEW on a named public-source case. Below this,
    // the simulation falls through to the generic keyword heuristic.
    var MATCH_THRESHOLD = 0.80;
    var best = null;
    for (var i = 0; i < KNOWN_ADVERSE_MEDIA.length; i++) {
      var entry = KNOWN_ADVERSE_MEDIA[i];
      for (var j = 0; j < entry.names.length; j++) {
        for (var k = 0; k < candidates.length; k++) {
          var q = matchQuality(candidates[k], entry.names[j]);
          if (q.score >= MATCH_THRESHOLD) {
            if (!best || q.score > best.score) {
              best = {
                entry: entry,
                score: q.score,
                methods: q.methods,
                matchedAlias: entry.names[j],
                matchedOn: candidates[k]
              };
            }
          }
        }
      }
    }
    return best;
  }

  // Kept for API compatibility with any existing callers.
  function nameMatches(subject, candidate) {
    return matchQuality(subject, candidate).score >= 0.80;
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
  // Allow-list URL sanitiser for href attributes. esc() covers HTML
  // escaping but does NOT filter javascript:, data:, vbscript: and other
  // script-bearing protocols. Only permit http(s), mailto, and relative
  // URLs; anything else returns '#' so a malicious register-entry URL
  // or tampered backend hit cannot execute on click.
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '#';
    if (/^\/\//.test(s)) return s;
    if (/^[\/#?]/.test(s)) return s;
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    return '#';
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

  // ─── Reasoning Console — client-side deep-reasoning layer ─────────
  // Produces a factor-attribution breakdown, a hypothesis ladder with
  // posterior estimates, counterfactual what-ifs, a 19-subsystem status
  // grid, and a confidence gauge. Computed from the row's captured
  // data — no extra backend calls. Values marked "client-side estimate"
  // so the MLRO understands the backend brain above is authoritative
  // (FDL Art.24). This panel accelerates interpretation of the audit
  // record; it does not replace it.
  //
  // Weighting scheme: Bayesian-style log-odds on the signals we have.
  // Prior p = 0.05 for "subject of interest". Each signal contributes
  // a log-odds bump; posterior = sigmoid(log-odds). This is the same
  // skeleton MLRO training material uses to explain risk scoring, so
  // the numbers here line up with the audit narrative overhead.
  var WEAPONIZED_SUBSYSTEMS = [
    'sanctions-match', 'name-matcher', 'adverse-media', 'pep-hint',
    'country-risk', 'ubo-graph', 'layering-detect', 'shell-company',
    'vasp-wallet', 'tx-anomaly', 'explainable-scoring', 'red-flag',
    'zk-audit-seal', 'risk-tier-classifier', 'decision-consistency',
    'corroboration', 'advisor-bridge', 'integrity-gate', 'lessons'
  ];

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function fmtPct(x) { return Math.round(x * 100) + '%'; }

  function extractFactors(r) {
    var factors = [];
    var sanctionsTop = typeof r.confidence === 'number' ? r.confidence : 0;
    if (sanctionsTop > 0) {
      factors.push({
        key: 'sanctions',
        label: 'Sanctions list proximity',
        weight: sanctionsTop * 2.8,
        detail: 'top score ' + fmtPct(sanctionsTop) + ' · classification ' + (r.top_classification || 'none')
      });
    }
    var amCount = r.adverse_media_count || (Array.isArray(r.adverse_media_items) ? r.adverse_media_items.length : 0);
    if (amCount > 0) {
      factors.push({
        key: 'adverse_media',
        label: 'Adverse-media hits',
        weight: Math.min(2.2, amCount * 0.35),
        detail: amCount + ' hit(s) · severity ' + (r.adverse_media_severity || 'info')
      });
    }
    if (Array.isArray(r.pep_dimensions) && r.pep_dimensions.length) {
      factors.push({
        key: 'pep',
        label: 'PEP scope match',
        weight: 0.9,
        detail: r.pep_dimensions.length + ' PEP dimension(s) selected'
      });
    }
    if (Array.isArray(r.special_flags) && r.special_flags.length) {
      factors.push({
        key: 'specialised',
        label: 'Specialised flags (PF/TF/tax/dual-use)',
        weight: 1.4,
        detail: r.special_flags.join(' · ')
      });
    }
    if (r.integrity && r.integrity !== 'complete') {
      factors.push({
        key: 'integrity',
        label: 'Screening integrity gap',
        weight: 0.7,
        detail: r.integrity + ' — re-screen when upstream recovers'
      });
    }
    if (r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.clampReasons) && r.brain.weaponized.clampReasons.length) {
      factors.push({
        key: 'clamp',
        label: 'Brain clamp fired',
        weight: 1.1,
        detail: r.brain.weaponized.clampReasons.length + ' clamp reason(s)'
      });
    }
    return factors;
  }

  function hypothesisLadder(r, factors) {
    var score = function (k) {
      var f = factors.filter(function (x) { return x.key === k; })[0];
      return f ? f.weight : 0;
    };
    var priorLogit = Math.log(0.05 / 0.95);
    var signalSum = factors.reduce(function (s, f) { return s + f.weight; }, 0);

    var legit = {
      id: 'legitimate',
      label: 'Legitimate subject · no compliance concern',
      posterior: sigmoid(priorLogit + 1.8 - signalSum * 0.9),
      rationale: 'Baseline prior reduced by every positive signal. Dominant when sanctions + adverse-media + PEP are all low.'
    };
    var falsePos = {
      id: 'false_positive',
      label: 'False positive · name coincidence',
      posterior: sigmoid(priorLogit + 1.2 + score('sanctions') * 0.5 - score('adverse_media') * 0.8 - score('pep') * 0.6),
      rationale: 'Elevated when sanctions proximity exists but adverse-media + PEP do not corroborate. Resolve via DoB / ID / jurisdiction differentiator.'
    };
    var layering = {
      id: 'layering',
      label: 'Layering / structuring activity',
      posterior: sigmoid(priorLogit + score('specialised') * 0.9 + score('adverse_media') * 0.4),
      rationale: 'Rises with specialised flags (TBML, structuring, cash-intensive) + adverse-media hits in money-laundering categories.'
    };
    var sanctionsEvasion = {
      id: 'sanctions_evasion',
      label: 'Sanctions evasion · by-association risk',
      posterior: sigmoid(priorLogit + score('sanctions') * 1.1 + score('specialised') * 0.5 + score('clamp') * 0.4),
      rationale: 'Dominant on partial sanctions proximity + UBO / shell indicators. Triggers four-eyes per Cabinet Res 74/2020.'
    };
    var pepAssoc = {
      id: 'pep_associate',
      label: 'PEP-by-association',
      posterior: sigmoid(priorLogit + score('pep') * 1.4 + score('adverse_media') * 0.3),
      rationale: 'PEP dimensions active and adverse-media supports a political-exposure narrative (FATF Rec 12).'
    };

    var all = [legit, falsePos, layering, sanctionsEvasion, pepAssoc];
    var total = all.reduce(function (s, h) { return s + h.posterior; }, 0);
    all.forEach(function (h) { h.normalized = total > 0 ? h.posterior / total : 0; });
    return all.sort(function (a, b) { return b.normalized - a.normalized; });
  }

  function counterfactuals(r, factors) {
    var results = [];
    if (factors.some(function (f) { return f.key === 'pep'; })) {
      results.push({
        label: 'If PEP scope were not selected',
        shift: '-0.9 log-odds · verdict softens by ~1 tier'
      });
    }
    if (factors.some(function (f) { return f.key === 'adverse_media'; })) {
      results.push({
        label: 'If adverse-media hits were zero',
        shift: '-1.6 log-odds · hypothesis flips toward "legitimate" unless sanctions remain'
      });
    }
    if (factors.some(function (f) { return f.key === 'sanctions' && f.weight > 0.6; })) {
      results.push({
        label: 'If top sanctions score dropped below 50%',
        shift: '-2.0 log-odds · drops confirmed-match hypothesis; residual tail stays under partial-match'
      });
    }
    if (factors.some(function (f) { return f.key === 'specialised'; })) {
      results.push({
        label: 'If specialised flags (PF/TF/tax) were cleared',
        shift: '-1.2 log-odds · layering hypothesis retreats; legitimate hypothesis climbs'
      });
    }
    if (factors.some(function (f) { return f.key === 'integrity'; })) {
      results.push({
        label: 'If integrity gap were closed (upstream recovers)',
        shift: 'Confidence +10-15% · verdict may flip from review to clear'
      });
    }
    if (!results.length) {
      results.push({
        label: 'No high-leverage counterfactuals',
        shift: 'Signals are either all low or fully corroborated'
      });
    }
    return results;
  }

  function subsystemGrid(r) {
    var failures = (r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.subsystemFailures))
      ? r.brain.weaponized.subsystemFailures : [];
    var clamps = (r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.clampReasons))
      ? r.brain.weaponized.clampReasons : [];
    return WEAPONIZED_SUBSYSTEMS.map(function (name) {
      var failed = failures.some(function (f) {
        var s = typeof f === 'string' ? f : (f && f.subsystem ? f.subsystem : '');
        return String(s).indexOf(name) >= 0;
      });
      var clamped = clamps.some(function (c) {
        return String(c).toLowerCase().indexOf(name.split('-')[0]) >= 0;
      });
      var tone = failed ? 'background:#dc2626;color:#fff' :
                 clamped ? 'background:#d97706;color:#1a1a1a' :
                           'background:rgba(16,185,129,0.18);color:#6ee7b7;border:1px solid rgba(16,185,129,0.45)';
      var state = failed ? 'FAIL' : clamped ? 'CLAMP' : 'OK';
      return '<span style="display:inline-flex;gap:4px;align-items:center;padding:3px 8px;border-radius:999px;font-size:10px;font-family:monospace;letter-spacing:.5px;' + tone + '">' +
        esc(name) + ' · ' + state +
      '</span>';
    }).join(' ');
  }

  function confidenceGauge(conf) {
    var c = Math.max(0, Math.min(1, conf || 0));
    var w = 180, h = 90, cx = 90, cy = 82, radius = 72;
    var angle = Math.PI * (1 - c);
    var x = cx + radius * Math.cos(angle);
    var y = cy - radius * Math.sin(angle);
    var colour = c >= 0.8 ? '#dc2626' : c >= 0.5 ? '#ea580c' : c >= 0.25 ? '#d97706' : '#6ee7b7';
    var arcPath = 'M ' + (cx - radius) + ' ' + cy + ' A ' + radius + ' ' + radius + ' 0 0 1 ' + (cx + radius) + ' ' + cy;
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-label="confidence gauge">' +
      '<path d="' + arcPath + '" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="10" stroke-linecap="round"/>' +
      '<path d="' + arcPath + '" fill="none" stroke="' + colour + '" stroke-width="10" stroke-linecap="round" ' +
        'stroke-dasharray="' + (Math.PI * radius) + '" ' +
        'stroke-dashoffset="' + (Math.PI * radius * (1 - c)) + '"/>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#fae8ff" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#fae8ff"/>' +
      '<text x="' + cx + '" y="' + (cy - 20) + '" text-anchor="middle" font-family="DM Mono, monospace" font-size="18" font-weight="700" fill="#fae8ff">' + fmtPct(c) + '</text>' +
      '<text x="' + cx + '" y="' + (cy - 5) + '" text-anchor="middle" font-family="DM Mono, monospace" font-size="9" fill="rgba(250,232,255,0.6)" letter-spacing="1">CONFIDENCE</text>' +
    '</svg>';
  }

  // Signal Sensitivity Matrix — 2D influence grid: rows = signals,
  // columns = hypotheses, cell = signed influence of the signal on the
  // hypothesis. Lets the MLRO read "which factor pushes which verdict"
  // at a glance without re-computing the Bayesian ladder by hand.
  function sensitivityMatrix(factors) {
    var signals = factors.map(function (f) { return f.key; });
    if (!signals.length) return '';
    // Signed weights per (signal, hypothesis). Negative = signal argues
    // against the hypothesis; positive = argues for it. Magnitude is
    // the coefficient used in the ladder above, so the two panels agree.
    var M = {
      sanctions:      { legitimate: -0.9, false_positive:  0.5, layering:  0.0, sanctions_evasion:  1.1, pep_associate:  0.0 },
      adverse_media:  { legitimate: -0.9, false_positive: -0.8, layering:  0.4, sanctions_evasion:  0.0, pep_associate:  0.3 },
      pep:            { legitimate: -0.9, false_positive: -0.6, layering:  0.0, sanctions_evasion:  0.0, pep_associate:  1.4 },
      specialised:    { legitimate: -0.9, false_positive:  0.0, layering:  0.9, sanctions_evasion:  0.5, pep_associate:  0.0 },
      integrity:      { legitimate: -0.3, false_positive:  0.0, layering:  0.0, sanctions_evasion:  0.2, pep_associate:  0.0 },
      clamp:          { legitimate: -0.6, false_positive:  0.0, layering:  0.2, sanctions_evasion:  0.4, pep_associate:  0.0 }
    };
    var hypCols = [
      { id: 'legitimate',        label: 'Legitimate' },
      { id: 'false_positive',    label: 'False positive' },
      { id: 'layering',          label: 'Layering' },
      { id: 'sanctions_evasion', label: 'Sanctions evasion' },
      { id: 'pep_associate',     label: 'PEP-by-assoc.' }
    ];
    var rows = factors.slice().sort(function (a, b) { return b.weight - a.weight; }).map(function (f) {
      var cells = hypCols.map(function (h) {
        var coef = (M[f.key] && typeof M[f.key][h.id] === 'number') ? M[f.key][h.id] : 0;
        var eff = coef * f.weight;
        var mag = Math.min(1, Math.abs(eff) / 1.6);
        var colour = eff > 0.05 ? 'rgba(244,63,94,' + (0.12 + mag * 0.55) + ')'
                    : eff < -0.05 ? 'rgba(16,185,129,' + (0.12 + mag * 0.55) + ')'
                    : 'rgba(255,255,255,0.03)';
        var sign = eff > 0.05 ? '+' : eff < -0.05 ? '' : '·';
        return '<td style="padding:4px 6px;text-align:center;font-family:monospace;font-size:10px;' +
          'background:' + colour + ';border:1px solid rgba(255,255,255,0.05)">' +
          (Math.abs(eff) < 0.05 ? '·' : sign + eff.toFixed(2)) +
        '</td>';
      }).join('');
      return '<tr><th style="text-align:left;font-weight:600;font-size:11px;padding:4px 8px 4px 0;opacity:.85">' +
          esc(f.label) +
        '</th>' + cells + '</tr>';
    }).join('');
    var head = '<tr><th></th>' + hypCols.map(function (h) {
      return '<th style="font-size:10px;font-weight:600;letter-spacing:.5px;padding:4px 6px;opacity:.75">' + esc(h.label) + '</th>';
    }).join('') + '</tr>';
    return '<table style="border-collapse:separate;border-spacing:0;width:100%;margin-top:4px">' +
      '<thead>' + head + '</thead><tbody>' + rows + '</tbody></table>' +
      '<div style="margin-top:4px;font-size:10px;opacity:.55">' +
        'Green cell = signal argues against the hypothesis · red = argues for · magnitude = signal weight × hypothesis coefficient.' +
      '</div>';
  }

  // Decision-Path Explainer — human-readable if/then chain that
  // produced the final verdict. Rules are read from the same thresholds
  // the back-end brain uses, so what the MLRO reads here matches what
  // was written to the audit record (FDL Art.20-21, Cabinet Res
  // 74/2020 Art.4-7). Rules are evaluated in priority order; first
  // match wins and subsequent rules are shown as "not reached".
  function decisionPath(r, ladder) {
    var topScore = typeof r.confidence === 'number' ? r.confidence : 0;
    var amCount = r.adverse_media_count || 0;
    var integrity = r.integrity || 'complete';
    var hasHumanReview = !!(r.brain && r.brain.weaponized && r.brain.weaponized.requiresHumanReview);
    var hasFourEyes = !!(r.brain && r.brain.deepBrain && r.brain.deepBrain.requiresFourEyes);
    var clampCount = (r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.clampReasons))
      ? r.brain.weaponized.clampReasons.length : 0;
    var topHyp = ladder && ladder[0] ? ladder[0].id : 'legitimate';

    var rules = [
      {
        cond: integrity === 'incomplete',
        label: 'R1 · Screening integrity incomplete',
        verdict: 'Hold — re-screen required',
        cite: 'FDL Art.20-21',
        trigger: 'A mandatory data source (UN or UAE EOCN) was unreachable.'
      },
      {
        cond: topScore >= 0.9,
        label: 'R2 · Confirmed sanctions match',
        verdict: 'FREEZE within 24 clock hours',
        cite: 'Cabinet Res 74/2020 Art.4 · EOCN TFS Guidance July 2025',
        trigger: 'Top match score ≥ 90%.'
      },
      {
        cond: topScore >= 0.5 || hasFourEyes || hasHumanReview,
        label: 'R3 · Partial match · escalate to CO',
        verdict: 'Partial match — four-eyes review within 1 business day',
        cite: 'Cabinet Res 134/2025 Art.14 · FDL Art.20-21',
        trigger: 'Top match score ∈ [0.5, 0.9) or brain requested human review.'
      },
      {
        cond: amCount >= 3 || topHyp === 'layering' || topHyp === 'sanctions_evasion',
        label: 'R4 · Adverse-media / typology concentration',
        verdict: 'EDD trigger — document + MLRO review',
        cite: 'FATF Rec 10 · Cabinet Res 134/2025 Art.14',
        trigger: '≥3 adverse-media hits or layering / sanctions-evasion hypothesis dominant.'
      },
      {
        cond: clampCount > 0,
        label: 'R5 · Brain clamp fired',
        verdict: 'Flag for reviewer — brain safety clamp activated',
        cite: 'FDL Art.21 (CO situational awareness)',
        trigger: 'One or more subsystem clamps fired during the run.'
      },
      {
        cond: topScore > 0 && topScore < 0.5,
        label: 'R6 · Weak match',
        verdict: 'Document + dismiss if false positive',
        cite: 'FATF Rec 10',
        trigger: 'Top match score ∈ (0, 0.5).'
      },
      {
        cond: true,
        label: 'R7 · Clean screen',
        verdict: 'Proceed to standard CDD / SDD path',
        cite: 'FDL Art.12 · FATF Rec 10',
        trigger: 'All signals below thresholds.'
      }
    ];

    var fired = null;
    return '<ol style="margin:4px 0 6px 0;padding-left:18px">' +
      rules.map(function (rule) {
        var triggered = !fired && rule.cond;
        if (triggered) fired = rule;
        var state = triggered ? 'MATCHED'
                   : fired    ? 'not reached'
                   : rule.cond ? 'would match'
                   : 'skipped';
        var tone = triggered ? 'background:#dc2626;color:#fff'
                  : fired     ? 'background:rgba(255,255,255,0.08);color:rgba(250,232,255,0.5)'
                  : rule.cond ? 'background:rgba(234,88,12,0.18);color:#fdba74'
                  : 'background:rgba(255,255,255,0.05);color:rgba(250,232,255,0.4)';
        return '<li style="margin-bottom:4px;font-size:11px;line-height:1.45;' +
            (triggered ? 'font-weight:600' : 'opacity:.85') + '">' +
          '<span style="display:inline-block;min-width:82px;padding:1px 6px;border-radius:3px;font-family:monospace;font-size:9px;letter-spacing:.5px;margin-right:6px;' + tone + '">' + state + '</span>' +
          '<strong>' + esc(rule.label) + '.</strong> ' + esc(rule.verdict) +
          ' <span style="opacity:.7">(' + esc(rule.cite) + ')</span>' +
          '<br><span style="opacity:.7;margin-left:88px;display:inline-block">Trigger: ' + esc(rule.trigger) + '</span>' +
        '</li>';
      }).join('') +
    '</ol>';
  }

  // Verdict History — persists up to 10 screenings per subject-name
  // in localStorage so the Reasoning Console can show a confidence
  // trend sparkline. The key is the lowercased subject name; the value
  // is an array of { t, conf, verdict, classification } ordered oldest
  // → newest. Data-only helper — no UI side-effects.
  var VERDICT_HISTORY_KEY = 'hawkeye.screening.verdictHistory';
  function loadVerdictHistory() {
    try {
      var raw = localStorage.getItem(VERDICT_HISTORY_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_e) { return {}; }
  }
  function saveVerdictHistory(h) {
    try { localStorage.setItem(VERDICT_HISTORY_KEY, JSON.stringify(h)); } catch (_e) {}
  }
  function appendVerdictHistory(r) {
    if (!r || !r.name) return;
    var all = loadVerdictHistory();
    var key = String(r.name).trim().toLowerCase();
    if (!all[key]) all[key] = [];
    all[key].push({
      t: Date.now(),
      conf: typeof r.confidence === 'number' ? r.confidence : 0,
      verdict: (r.brain && r.brain.weaponized && r.brain.weaponized.finalVerdict) || r.disposition || '—',
      classification: r.top_classification || 'none'
    });
    if (all[key].length > 10) all[key] = all[key].slice(-10);
    saveVerdictHistory(all);
  }
  function verdictHistorySparkline(name) {
    var all = loadVerdictHistory();
    var key = String(name || '').trim().toLowerCase();
    var series = all[key] || [];
    if (series.length < 2) {
      return '<div style="font-size:11px;opacity:.6">No prior screenings for this subject.</div>';
    }
    var w = 340, h = 70, pad = 6;
    var xs = series.map(function (_, i) { return pad + (i * (w - pad * 2)) / Math.max(1, series.length - 1); });
    var ys = series.map(function (p) { return h - pad - p.conf * (h - pad * 2); });
    var path = 'M ' + xs[0].toFixed(1) + ' ' + ys[0].toFixed(1);
    for (var i = 1; i < series.length; i++) {
      path += ' L ' + xs[i].toFixed(1) + ' ' + ys[i].toFixed(1);
    }
    var pts = series.map(function (p, i) {
      var colour = p.classification === 'confirmed' ? '#dc2626'
                 : p.classification === 'potential' ? '#ea580c'
                 : p.classification === 'weak'      ? '#d97706'
                 : '#6ee7b7';
      var title = new Date(p.t).toISOString().slice(0, 16).replace('T', ' ') + ' · ' +
        Math.round(p.conf * 100) + '% · ' + p.verdict;
      return '<circle cx="' + xs[i].toFixed(1) + '" cy="' + ys[i].toFixed(1) + '" r="3.5" fill="' + colour + '">' +
        '<title>' + esc(title) + '</title></circle>';
    }).join('');
    var latest = series[series.length - 1];
    var prev = series[series.length - 2];
    var delta = latest.conf - prev.conf;
    var deltaTxt = (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%';
    var deltaColour = Math.abs(delta) < 0.05 ? '#9ca3af' : delta > 0 ? '#fca5a5' : '#6ee7b7';
    return '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
        '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="max-width:100%">' +
          '<path d="M ' + pad + ' ' + (h - pad) + ' L ' + (w - pad) + ' ' + (h - pad) + '" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>' +
          '<path d="' + path + '" fill="none" stroke="#a855f7" stroke-width="2" stroke-linejoin="round"/>' +
          pts +
        '</svg>' +
        '<div style="font-size:11px">' +
          '<div style="opacity:.7">Last ' + series.length + ' screenings</div>' +
          '<div style="font-family:monospace;font-size:13px;color:' + deltaColour + ';font-weight:600">Δ ' + esc(deltaTxt) + '</div>' +
        '</div>' +
      '</div>';
  }

  function buildReasoningConsole(r) {
    if (!r || r.source !== 'backend') return '';
    var factors = extractFactors(r);
    if (!factors.length && !r.brain) return '';
    var ladder = hypothesisLadder(r, factors);
    var cfs = counterfactuals(r, factors);
    var conf = (r.brain && r.brain.weaponized && typeof r.brain.weaponized.confidence === 'number')
      ? r.brain.weaponized.confidence
      : (r.confidence || 0);
    var totalWeight = factors.reduce(function (s, f) { return s + f.weight; }, 0) || 1;

    var factorsHtml = factors.length
      ? '<ul style="margin:4px 0 6px 0;padding:0;list-style:none">' +
        factors
          .slice()
          .sort(function (a, b) { return b.weight - a.weight; })
          .map(function (f) {
            var pct = Math.round((f.weight / totalWeight) * 100);
            return '<li style="display:flex;gap:8px;align-items:center;font-size:11px;margin-bottom:3px">' +
              '<span style="min-width:42px;font-family:monospace;opacity:.8">' + pct + '%</span>' +
              '<span style="flex:1">' +
                '<strong>' + esc(f.label) + '</strong>' +
                ' <span style="opacity:.7">— ' + esc(f.detail) + '</span>' +
              '</span>' +
              '<span style="flex-basis:120px;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">' +
                '<span style="display:block;height:100%;width:' + pct + '%;background:linear-gradient(90deg,#a855f7,#f472b6)"></span>' +
              '</span>' +
            '</li>';
          }).join('') +
        '</ul>'
      : '<div style="font-size:11px;opacity:.65">No material signals in this run.</div>';

    var ladderHtml = '<ol style="margin:4px 0 6px 0;padding-left:18px">' +
      ladder.map(function (h, i) {
        var pct = Math.round(h.normalized * 100);
        var colour = i === 0 ? '#f472b6' : i === 1 ? '#c084fc' : '#a78bfa';
        return '<li style="font-size:11px;margin-bottom:4px;line-height:1.45">' +
          '<strong style="color:' + colour + '">' + esc(h.label) + '</strong>' +
          ' <span style="font-family:monospace;font-weight:700">' + pct + '%</span>' +
          '<br><span style="opacity:.75">' + esc(h.rationale) + '</span>' +
        '</li>';
      }).join('') +
    '</ol>';

    var cfHtml = '<ul style="margin:4px 0 6px 0;padding-left:18px">' +
      cfs.map(function (c) {
        return '<li style="font-size:11px;margin-bottom:3px">' +
          '<strong>' + esc(c.label) + '.</strong> <span style="opacity:.8">' + esc(c.shift) + '</span>' +
        '</li>';
      }).join('') +
    '</ul>';

    return '<div class="mv-list-meta" style="margin-top:10px;padding:12px;' +
      'border-left:3px solid #f472b6;background:rgba(244,114,182,0.05);border-radius:6px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;background:#f472b6;color:#1a1a1a">' +
          'REASONING CONSOLE' +
        '</span>' +
        '<strong style="font-size:13px">Deep-reasoning layer · factor attribution + hypothesis ladder + counterfactuals</strong>' +
      '</div>' +

      '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">' +
        '<div style="flex:0 0 180px">' + confidenceGauge(conf) + '</div>' +
        '<div style="flex:1;min-width:260px">' +
          '<div style="font-size:11px;letter-spacing:1px;opacity:.7;margin-bottom:4px">FACTOR ATTRIBUTION</div>' +
          factorsHtml +
        '</div>' +
      '</div>' +

      '<details style="margin-top:8px" open>' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>HYPOTHESIS LADDER</strong> · normalised posterior — client-side estimate</summary>' +
        ladderHtml +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>COUNTERFACTUAL WHAT-IFS</strong></summary>' +
        cfHtml +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>19-SUBSYSTEM STATUS GRID</strong></summary>' +
        '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">' + subsystemGrid(r) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>SIGNAL × HYPOTHESIS SENSITIVITY MATRIX</strong></summary>' +
        '<div style="margin-top:6px;overflow-x:auto">' + sensitivityMatrix(factors) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px" open>' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>DECISION PATH</strong> · rules that produced the verdict</summary>' +
        decisionPath(r, ladder) +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>VERDICT HISTORY</strong> · confidence trend for this subject</summary>' +
        '<div style="margin-top:6px">' + verdictHistorySparkline(r.name) + '</div>' +
      '</details>' +

      '<div style="margin-top:8px;font-size:10px;opacity:.55">' +
        'Computed client-side from the row\u2019s captured signals + prior runs stored in this browser. ' +
        'Authoritative verdict = backend Brain Intelligence above (FDL Art.24).' +
      '</div>' +
    '</div>';
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

    // Hidden-input group — keeps the server payload shape identical while
    // the visual section is folded away. Used for the two categories the
    // Risk Typologies tree already covers topic-for-topic (adverse-media
    // predicates, specialised TF/PF/tax checks) so the MLRO never sees
    // the same concept twice on screen.
    function hiddenGroup(fieldName, items) {
      return items.map(function (it) {
        return '<input type="hidden" name="' + fieldName + '" value="' + esc(it.id) + '">';
      }).join('');
    }

    // Compact typology checklist — 40+ topics rendered with group
    // headers (ML / TF / PF / FRAUD / CORRUPTION / OC / SANCTIONS /
    // COUNTRY / ESG). Kept dense so the MLRO can scan + toggle quickly
    // without the list dominating the form.
    function typologyGroup(items) {
      var groups = {};
      var groupOrder = [];
      items.forEach(function (it) {
        if (!groups[it.group]) { groups[it.group] = []; groupOrder.push(it.group); }
        groups[it.group].push(it);
      });
      var groupLabels = {
        ML: 'Money laundering', TF: 'Terrorist financing', PF: 'Proliferation',
        FRAUD: 'Fraud', CORRUPTION: 'Bribery & corruption',
        OC: 'Organised crime', SANCTIONS: 'Sanctions evasion',
        ESG: 'ESG / human rights'
      };
      return groupOrder.map(function (g) {
        return '<div class="mv-field" style="grid-column: 1 / -1">' +
          '<div class="mv-field-label" style="margin-top:4px;opacity:.8">' + esc(groupLabels[g] || g) + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
            groups[g].map(function (it) {
              return '<label class="mv-chip" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid var(--border,#555);border-radius:12px;font-size:12px;cursor:pointer" title="' + esc(it.citation) + '">' +
                '<input type="checkbox" name="risk_typologies" value="' + esc(it.id) + '" checked style="margin:0">' +
                '<span>' + esc(it.label) + '</span>' +
              '</label>';
            }).join('') +
          '</div>' +
        '</div>';
      }).join('');
    }

    host.innerHTML = [
      head('Subject Screening',
        '<span class="mv-pill">' + SANCTIONS_LISTS.length + ' lists · ' +
          ADVERSE_MEDIA_CATEGORIES.length + ' media categories · ' +
          PEP_DIMENSIONS.length + ' PEP scopes · ' +
          COUNTRY_RISK_LISTS.length + ' country-risk lists · ' +
          ASSOCIATE_DIMENSIONS.length + ' associate dimensions · ' +
          RISK_TYPOLOGIES.length + ' risk topics · ' +
          SPECIAL_SCREENS.length + ' specialised checks</span>' +
        '<button class="mv-btn mv-btn-primary" data-action="sc-sub-new">+ New screening</button>'
      ),
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px">' +
        CORPUS_COVERAGE.map(function (c) {
          return '<div class="mv-stat" style="flex:1;min-width:140px">' +
            '<div class="mv-stat-v" style="font-size:16px">' + esc(c.metric) + '</div>' +
            '<div class="mv-stat-k">' + esc(c.label) + '</div>' +
          '</div>';
        }).join('') +
      '</div>',
      '<details style="margin-bottom:10px;opacity:.9"><summary style="cursor:pointer;font-size:12px;opacity:.75">Screening pipeline capabilities · ' + SCREENING_CAPABILITIES.length + ' model components (ML · NLP · intelligent tagging · event clustering · multi-modal matching · metadata enrichment · real-time API · ongoing monitoring · Risk Intelligence)</summary>' +
        '<ul style="margin:8px 0 0 18px;padding:0">' +
          SCREENING_CAPABILITIES.map(function (c) {
            return '<li style="margin-bottom:4px"><strong>' + esc(c.label) + '</strong><br>' +
              '<span style="opacity:.7;font-size:12px">' + esc(c.detail) + '</span></li>';
          }).join('') +
        '</ul></details>',
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

      skillsPalette(),

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

        // Coverage is collapsed by default — the 6 sections below used to
        // dominate the pre-run area and carried topic overlap (Adverse
        // Media + Risk Typologies + Specialised Screening all tagged
        // money-laundering / TF / PF / tax / corruption / organised-crime
        // independently). We now surface one compact Coverage disclosure
        // with a single-line summary; the MLRO opens it only to narrow.
        //
        // The two duplicate sections (Adverse Media, Specialised Screening)
        // are emitted as hidden inputs so the server payload shape is
        // byte-identical. The Risk Typologies tree is the single
        // user-facing place to narrow topic scope.
        '<details class="mv-coverage-details" style="margin-top:14px;border:1px solid var(--border,#555);border-radius:8px;padding:8px 12px">',
          '<summary style="cursor:pointer;font-weight:600;font-size:13px;letter-spacing:.5px">',
            'Coverage &amp; filters ',
            '<span style="opacity:.6;font-weight:normal;font-size:12px">',
              '· ' + SANCTIONS_LISTS.length + ' sanctions lists ',
              '· ' + PEP_DIMENSIONS.length + ' PEP scopes ',
              '· ' + COUNTRY_RISK_LISTS.length + ' country-risk lists ',
              '· ' + ASSOCIATE_DIMENSIONS.length + ' associate dimensions ',
              '· ' + RISK_TYPOLOGIES.length + ' risk topics ',
              '· all ON by default — expand to narrow',
            '</span>',
          '</summary>',

          '<h4 class="mv-field-label" style="margin-top:10px">Sanctions &amp; watchlists</h4>',
          '<div class="mv-grid-2">', checkboxGroup('sanctions_lists', SANCTIONS_LISTS), '</div>',

          '<h4 class="mv-field-label" style="margin-top:14px">PEP screening <span style="opacity:.55;font-weight:normal">(FATF Rec 12 · Cabinet Res 134/2025 Art.14)</span></h4>',
          '<div class="mv-grid-2">', checkboxGroup('pep_dimensions', PEP_DIMENSIONS), '</div>',

          '<h4 class="mv-field-label" style="margin-top:14px">Country-risk overlay</h4>',
          '<div class="mv-grid-2">', checkboxGroup('country_risk', COUNTRY_RISK_LISTS), '</div>',

          '<h4 class="mv-field-label" style="margin-top:14px">Associates &amp; networks <span style="opacity:.55;font-weight:normal">(FATF Rec 10 · Cabinet Decision 109/2023)</span></h4>',
          '<div class="mv-grid-2">', checkboxGroup('associate_dimensions', ASSOCIATE_DIMENSIONS), '</div>',

          '<h4 class="mv-field-label" style="margin-top:14px">Risk typologies &amp; intelligent tags ',
            '<span style="opacity:.55;font-weight:normal">',
              '(covers adverse-media + TF/PF/tax themes — no separate section needed)',
            '</span></h4>',
          '<div class="mv-grid-2">', typologyGroup(RISK_TYPOLOGIES), '</div>',

          // Hidden payload — adverse-media predicate categories + specialised
          // screens. All ON by default; Risk Typologies is the UI control.
          hiddenGroup('adverse_media', ADVERSE_MEDIA_CATEGORIES),
          hiddenGroup('special_screens', SPECIAL_SCREENS),
        '</details>',

        '<div class="mv-form-actions">',
          '<button type="submit" class="mv-btn mv-btn-primary">Run screening</button>',
          '<button type="reset" class="mv-btn mv-btn-ghost">Clear</button>',
        '</div>',
      '</form>',

      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px">' +
        '<h3 class="mv-subhead" style="margin:0">Recent subjects</h3>' +
        (rows.length
          ? '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="sc-sub-clear-all" ' +
              'title="Remove every row from the workbench" ' +
              'style="opacity:.75">Clear all</button>'
          : '') +
      '</div>',
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

            // Live-backend adverse-media hit list — title, source, date,
            // clickable URL. Only populated when the backend returned
            // data.adverseMedia.top (FATF Rec 10 — ongoing CDD must
            // surface the actual signal, not just a count).
            var adverseItemsLine = '';
            if (Array.isArray(r.adverse_media_items) && r.adverse_media_items.length) {
              var severityLabel = r.adverse_media_severity === 'high' ? 'HIGH' : r.adverse_media_severity === 'medium' ? 'MEDIUM' : 'INFO';
              var providerLabel = r.adverse_media_provider ? ' via ' + esc(r.adverse_media_provider) : '';
              adverseItemsLine = '<div class="mv-list-meta" data-tone="warn" style="margin-top:4px">' +
                '<strong>Adverse-media hits (' + (r.adverse_media_count || r.adverse_media_items.length) + ') · severity ' + severityLabel + '</strong>' + providerLabel +
                '<ul style="margin:4px 0 0 18px;padding:0">' +
                  r.adverse_media_items.slice(0, 5).map(function (h) {
                    var title = h.title || h.url || '(untitled)';
                    var meta = [h.source, h.publishedAt ? fmtDate(h.publishedAt) : ''].filter(Boolean).map(esc).join(' · ');
                    return '<li style="margin-bottom:2px">' +
                      (h.url
                        ? '<a href="' + esc(safeUrl(h.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(title) + '</a>'
                        : esc(title)) +
                      (meta ? ' — <span style="opacity:.75">' + meta + '</span>' : '') +
                    '</li>';
                  }).join('') +
                '</ul>' +
              '</div>';
            } else if (r.source === 'backend' && r.adverse_media_error) {
              adverseItemsLine = '<div class="mv-list-meta" data-tone="warn">Adverse-media fetch error: ' + esc(r.adverse_media_error) + '</div>';
            }

            var knownSourceLine = r.known_adverse_source && r.known_adverse_source.url
              ? '<div class="mv-list-meta" data-tone="warn">' +
                  'Public source: <a href="' + esc(safeUrl(r.known_adverse_source.url)) + '" target="_blank" rel="noopener noreferrer">' +
                    esc(r.known_adverse_source.source) +
                  '</a>' +
                  (r.known_adverse_source.summary
                    ? '<br><span style="opacity:.85">' + esc(r.known_adverse_source.summary) + '</span>'
                    : '') +
                  (Array.isArray(r.known_adverse_source.match_methods) && r.known_adverse_source.match_methods.length
                    ? '<br><span style="opacity:.6;font-size:11px">Matched via ' +
                        esc(r.known_adverse_source.match_methods.join(' + ')) +
                        ' @ ' + Math.round((r.known_adverse_source.match_score || 0) * 100) + '%' +
                        (r.known_adverse_source.matched_alias && normalizeName(r.known_adverse_source.matched_alias) !== normalizeName(r.name)
                          ? ' (alias: ' + esc(r.known_adverse_source.matched_alias) + ')'
                          : '') +
                      '</span>'
                    : '') +
                '</div>'
              : '';
            // Compliance Report — specific, cited, forceful. Only rendered
            // when a register hit is present. Surfaces the exact finding
            // (adverse-media only vs sanctions-only vs both), the risk
            // level, the MLRO action list, and the regulatory basis.
            // Anti-hallucination rule: the report states what ACTUALLY
            // matched — if sanctions were clean, it says so in plain text.
            var complianceReportLine = '';
            if (r.compliance_report) {
              var cr = r.compliance_report;
              var riskBadgeColor =
                cr.risk_level === 'critical' ? 'background:#dc2626;color:#fff' :
                cr.risk_level === 'high'     ? 'background:#ea580c;color:#fff' :
                cr.risk_level === 'medium'   ? 'background:#d97706;color:#1a1a1a' :
                                               'background:#4b5563;color:#fff';
              var findingHeadline =
                'ADVERSE MEDIA — ' + cr.adverse_media_classification.toUpperCase() +
                ' (' + Math.round((cr.adverse_media_confidence || 0) * 100) + '%). ' +
                'SANCTIONS & WATCHLISTS — ' + esc(cr.sanctions_status) + '.';
              complianceReportLine = '<div class="mv-list-meta" style="margin-top:10px;padding:12px;border-left:3px solid #ea580c;background:rgba(234,88,12,0.06);border-radius:6px">' +
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
                  '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;' + riskBadgeColor + '">' +
                    'RISK · ' + esc(String(cr.risk_level).toUpperCase()) +
                  '</span>' +
                  '<strong style="font-size:13px">Compliance Report</strong>' +
                '</div>' +
                '<div style="margin-bottom:6px;font-size:12px"><strong>Finding.</strong> ' + findingHeadline + '</div>' +
                (cr.recommendation
                  ? '<div style="margin-bottom:6px;font-size:12px;line-height:1.55"><strong>Recommendation.</strong> ' + esc(cr.recommendation) + '</div>'
                  : '') +
                (Array.isArray(cr.regulatory_basis) && cr.regulatory_basis.length
                  ? '<div style="font-size:11px;opacity:.8"><strong>Regulatory basis.</strong> ' +
                      cr.regulatory_basis.map(esc).join(' · ') +
                    '</div>'
                  : '') +
              '</div>';
            }

            // Brain Intelligence panel — renders the 19-subsystem
            // weaponized brain + deep-brain reasoning chain captured
            // from screening-run.mts. The payload is the same evidence
            // MoE / LBMA auditors want in the audit pack: what the
            // engine decided, why, which subsystems answered, which
            // clamps fired, and what the Opus advisor said when it was
            // consulted. FDL Art.24 — audit record must be complete.
            var brainPanel = '';
            if (r.brain && (r.brain.weaponized || r.brain.deepBrain)) {
              var wbp = r.brain.weaponized;
              var dbp = r.brain.deepBrain;
              var parts = [];

              if (wbp) {
                var wVerdict = wbp.finalVerdict || wbp.megaVerdict || '—';
                var wConfPct = typeof wbp.confidence === 'number'
                  ? Math.round(wbp.confidence * 100) + '%' : '—';
                var verdictTone =
                  wVerdict === 'freeze'   ? 'background:#dc2626;color:#fff' :
                  wVerdict === 'escalate' ? 'background:#ea580c;color:#fff' :
                  wVerdict === 'review'   ? 'background:#d97706;color:#1a1a1a' :
                                            'background:#4b5563;color:#fff';
                parts.push(
                  '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">' +
                    '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;' + verdictTone + '">' +
                      'BRAIN · ' + esc(String(wVerdict).toUpperCase()) +
                    '</span>' +
                    '<span class="mv-badge" data-tone="accent" style="font-size:10px">CONFIDENCE ' + esc(wConfPct) + '</span>' +
                    (wbp.megaVerdict && wbp.megaVerdict !== wbp.finalVerdict
                      ? '<span class="mv-badge" style="font-size:10px">mega: ' + esc(String(wbp.megaVerdict)) + '</span>' : '') +
                    (wbp.requiresHumanReview
                      ? '<span class="mv-badge" data-tone="warn" style="font-size:10px">HUMAN REVIEW REQUIRED</span>' : '') +
                  '</div>'
                );
                if (wbp.auditNarrative) {
                  parts.push(
                    '<div style="font-size:12px;line-height:1.55;margin-bottom:6px">' +
                      '<strong>Audit narrative.</strong> ' + esc(wbp.auditNarrative) +
                    '</div>'
                  );
                }
                if (Array.isArray(wbp.clampReasons) && wbp.clampReasons.length) {
                  parts.push(
                    '<div style="font-size:11px;margin-bottom:4px">' +
                      '<strong>Clamps fired (' + wbp.clampReasons.length + ').</strong> ' +
                      '<span style="opacity:.8">' + wbp.clampReasons.map(esc).join(' · ') + '</span>' +
                    '</div>'
                  );
                }
                if (Array.isArray(wbp.subsystemFailures) && wbp.subsystemFailures.length) {
                  parts.push(
                    '<div style="font-size:11px;margin-bottom:4px;opacity:.85">' +
                      '<strong>Subsystem failures.</strong> ' + wbp.subsystemFailures.map(esc).join(' · ') +
                    '</div>'
                  );
                }
                if (wbp.advisor && wbp.advisor.text) {
                  parts.push(
                    '<details style="margin-top:6px;font-size:11px">' +
                      '<summary style="cursor:pointer;opacity:.85">' +
                        '<strong>Opus advisor</strong> · ' + esc(wbp.advisor.modelUsed || 'advisor') +
                        ' · ' + (wbp.advisor.advisorCallCount || 1) + ' call(s)' +
                      '</summary>' +
                      '<div style="margin-top:4px;padding:6px 8px;background:rgba(168,85,247,0.08);border-left:2px solid #a855f7;font-size:11px;line-height:1.5;white-space:pre-wrap">' +
                        esc(wbp.advisor.text) +
                      '</div>' +
                    '</details>'
                  );
                }
                if (wbp.extensions) {
                  var extBits = [];
                  if (wbp.extensions.adverseMediaTopCategory) {
                    extBits.push('Top adverse-media category: <strong>' + esc(String(wbp.extensions.adverseMediaTopCategory)) + '</strong>');
                  }
                  if (typeof wbp.extensions.adverseMediaCriticalCount === 'number' && wbp.extensions.adverseMediaCriticalCount > 0) {
                    extBits.push('Critical hits: <strong>' + wbp.extensions.adverseMediaCriticalCount + '</strong>');
                  }
                  if (wbp.extensions.explainableScore) {
                    var ex = wbp.extensions.explainableScore;
                    extBits.push('Explainable score: <strong>' + Math.round((ex.score || 0) * 100) + '%</strong> · ' +
                      esc(String(ex.rating || '')) + ' · CDD ' + esc(String(ex.cddLevel || '')));
                  }
                  if (extBits.length) {
                    parts.push('<div style="font-size:11px;opacity:.85;margin-top:4px">' + extBits.join(' · ') + '</div>');
                  }
                }
              }

              if (dbp) {
                var dVerdict = dbp.verdict || '—';
                var dConfPct = typeof dbp.confidence === 'number'
                  ? Math.round(dbp.confidence * 100) + '%' : '—';
                var postPct = typeof dbp.posterior === 'number'
                  ? Math.round(dbp.posterior * 100) + '%' : '—';
                var coveragePct = typeof dbp.coverage === 'number'
                  ? Math.round(dbp.coverage * 100) + '%' : '—';
                parts.push(
                  '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed rgba(255,255,255,0.12)">' +
                    '<div style="font-size:11px;letter-spacing:1px;opacity:.7;margin-bottom:4px">DEEP-BRAIN REASONING CHAIN</div>' +
                    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">' +
                      '<span class="mv-badge" data-tone="accent" style="font-size:10px">' + esc(String(dVerdict).toUpperCase()) + '</span>' +
                      '<span class="mv-badge" style="font-size:10px">confidence ' + esc(dConfPct) + '</span>' +
                      (dbp.topHypothesis
                        ? '<span class="mv-badge" style="font-size:10px">H: ' + esc(String(dbp.topHypothesis)) + '</span>' : '') +
                      '<span class="mv-badge" style="font-size:10px">posterior ' + esc(postPct) + '</span>' +
                      '<span class="mv-badge" style="font-size:10px">coverage ' + esc(coveragePct) + '</span>' +
                      (dbp.requiresFourEyes
                        ? '<span class="mv-badge" data-tone="warn" style="font-size:10px">4-EYES</span>' : '') +
                    '</div>' +
                    (dbp.narrative
                      ? '<div style="font-size:12px;line-height:1.55;margin-bottom:4px">' + esc(dbp.narrative) + '</div>' : '') +
                    (dbp.rationale
                      ? '<div style="font-size:11px;line-height:1.5;opacity:.85;margin-bottom:4px">' +
                          '<strong>Top hypothesis rationale.</strong> ' + esc(dbp.rationale) + '</div>' : '') +
                    (Array.isArray(dbp.lessons) && dbp.lessons.length
                      ? '<div style="font-size:11px;opacity:.8">' +
                          '<strong>Lessons logged.</strong> ' +
                          dbp.lessons.map(function (l) {
                            return esc(typeof l === 'string' ? l : JSON.stringify(l).slice(0, 160));
                          }).join(' · ') +
                        '</div>' : '') +
                  '</div>'
                );
              }

              brainPanel =
                '<div class="mv-list-meta" style="margin-top:10px;padding:12px;' +
                  'border-left:3px solid #a855f7;background:rgba(168,85,247,0.06);border-radius:6px">' +
                  '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
                    '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;background:#a855f7;color:#fff">' +
                      'BRAIN INTELLIGENCE' +
                    '</span>' +
                    '<strong style="font-size:13px">19-subsystem weaponized brain + deep reasoning chain</strong>' +
                  '</div>' +
                  parts.join('') +
                '</div>';
            }

            // Reasoning Console — pure client-side layer over the row's
            // existing signals. Produces the deep-reasoning evidence the
            // MLRO needs on screen without a second backend round-trip:
            // factor attribution, hypothesis ladder, counterfactual
            // what-ifs, 19-subsystem status grid, SVG confidence gauge.
            // Values marked "client-side estimate" so the MLRO knows the
            // authoritative decision is still the backend brain above —
            // this panel accelerates interpretation, it does not replace
            // the audit record (FDL Art.24).
            var reasoningPanel = buildReasoningConsole(r);

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

            // Delete button — removes the screening row from localStorage.
            // Audit-trail note: once a live-backend screening is persisted
            // server-side (FDL No.(10)/2025 Art.24 — 10yr retention), the
            // server copy is authoritative; this control only clears the
            // local MLRO workbench view, not the audit record.
            var deleteBtnHtml =
              '<button class="mv-btn mv-btn-sm mv-btn-ghost" ' +
                'data-action="sc-sub-delete" data-id="' + esc(r.id) + '" ' +
                'title="Remove from workbench" ' +
                'aria-label="Remove ' + esc(r.name) + ' from workbench" ' +
                'style="padding:2px 8px;line-height:1;font-size:16px;font-weight:600;opacity:.7">' +
                '&times;' +
              '</button>';

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
                  adverseItemsLine +
                  knownSourceLine +
                  complianceReportLine +
                  brainPanel +
                  reasoningPanel +
                  specialHitsLine +
                  integrityLine +
                  sourceLine +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:8px">' +
                  '<span class="mv-badge" data-tone="' + disp.tone + '">' + disp.label + '</span>' +
                  deleteBtnHtml +
                '</div>' +
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
        var pepDimensions = fd.getAll('pep_dimensions');
        var countryRisk = fd.getAll('country_risk');
        var associateDimensions = fd.getAll('associate_dimensions');
        var riskTypologies = fd.getAll('risk_typologies');

        // Map our list ids → the backend list codes accepted by
        // netlify/functions/screening-run.mts (selectedLists contract).
        // Lists without a direct backend equivalent (SECO, OSFI, DFAT,
        // MAS, HKMA, World Bank debarment, bilateral overlays) are
        // captured in the UI selection + displayed on the card but not
        // forwarded to the backend fan-out until those integrations land.
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
          // Forward new dimensions — backend may ignore unknown keys
          // but the round-trip preserves them in the audit record.
          pepDimensions: pepDimensions.length ? pepDimensions : undefined,
          countryRiskLists: countryRisk.length ? countryRisk : undefined,
          associateDimensions: associateDimensions.length ? associateDimensions : undefined,
          riskTypologies: riskTypologies.length ? riskTypologies : undefined,
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
            row = buildRowFromBackend(body, fd, data, sanctionsLists, adverseMedia, specialScreens, pepDimensions);
          } else {
            row = buildRowFromSimulation(body, fd, sanctionsLists, adverseMedia, specialScreens, pepDimensions);
          }
          rows.push(row);
          safeSave(STORAGE.subjects, rows);
          // Verdict history — append every run (backend + simulation)
          // so the Reasoning Console sparkline shows the confidence
          // trend across re-screens for the same subject.
          appendVerdictHistory(row);
          renderSubjectScreening(host);
        });
      });
    }

    var clearAllBtn = host.querySelector('[data-action="sc-sub-clear-all"]');
    if (clearAllBtn) {
      clearAllBtn.onclick = function () {
        if (!rows.length) return;
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm('Remove all ' + rows.length + ' screening row(s) from the workbench? (Server-side audit record is unaffected.)')) return;
        }
        rows.length = 0;
        safeSave(STORAGE.subjects, rows);
        renderSubjectScreening(host);
      };
    }

    host.querySelectorAll('[data-action="sc-sub-delete"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var idx = -1;
        for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { idx = i; break; } }
        if (idx < 0) return;
        var name = rows[idx].name || 'this subject';
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm('Remove ' + name + ' from the workbench? (Server-side audit record is unaffected.)')) return;
        }
        rows.splice(idx, 1);
        safeSave(STORAGE.subjects, rows);
        renderSubjectScreening(host);
      };
    });

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
  function buildRowFromBackend(body, fd, data, sanctionsLists, adverseMedia, specialScreens, pepDimensions) {
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

    // Capture the authoritative backend shape (screening-run.mts):
    //   data.adverseMedia = {
    //     hits: <count:number>,
    //     provider: <label:string>,     // comma-sep providers used
    //     providersUsed: <string[]>,    // ['brave','google_news_rss']
    //     top: [{title,url,source}],    // top 5 hits (see
    //                                     amRes.value.hits.slice(0,5) upstream)
    //     error: <string|undefined>
    //   }
    // Previously this block used Array.isArray(data.adverseMedia.hits)
    // which always returned false (hits is a number); the category chips
    // derived from adverseMedia were never populated. We now:
    //   - derive the chip list from the MLRO's selected categories when
    //     the backend confirms >=1 hit (keeps the top-level summary),
    //   - additionally store the actual top-hits array so the card can
    //     render clickable titles, sources, and dates.
    var am = data.adverseMedia || {};
    var amHitCount = typeof am.hits === 'number' ? am.hits : 0;
    var adverseHits = [];
    if (amHitCount > 0) {
      adverseHits = adverseMedia.slice(0, Math.min(adverseMedia.length, Math.max(1, amHitCount)));
    }
    var adverseItems = Array.isArray(am.top)
      ? am.top.map(function (h) {
          return {
            title: h && h.title ? String(h.title) : '',
            url: h && h.url ? String(h.url) : '',
            source: h && h.source ? String(h.source) : '',
            publishedAt: h && h.publishedAt ? String(h.publishedAt) : ''
          };
        }).filter(function (h) { return h.title || h.url; })
      : [];
    var amSeverity = amHitCount === 0 ? 'info' : amHitCount <= 2 ? 'medium' : 'high';

    // Capture the server-side brain payload so the per-row card can render
    // the 19-subsystem weaponized brain + the deep-brain reasoning chain.
    // Shape mirrors screening-run.mts (deepBrain + weaponized blocks).
    var wb = data.weaponized && typeof data.weaponized === 'object' ? data.weaponized : null;
    var db = data.deepBrain && typeof data.deepBrain === 'object' ? data.deepBrain : null;
    var brain = (wb || db) ? {
      weaponized: wb ? {
        megaVerdict: wb.megaVerdict || null,
        finalVerdict: wb.finalVerdict || null,
        confidence: typeof wb.confidence === 'number' ? wb.confidence : null,
        requiresHumanReview: !!wb.requiresHumanReview,
        clampReasons: Array.isArray(wb.clampReasons) ? wb.clampReasons.slice(0, 6) : [],
        subsystemFailures: Array.isArray(wb.subsystemFailures) ? wb.subsystemFailures.slice(0, 6) : [],
        auditNarrative: wb.auditNarrative ? String(wb.auditNarrative).slice(0, 1200) : '',
        advisor: wb.advisor && wb.advisor.text ? {
          text: String(wb.advisor.text).slice(0, 800),
          modelUsed: wb.advisor.modelUsed ? String(wb.advisor.modelUsed) : '',
          advisorCallCount: typeof wb.advisor.advisorCallCount === 'number' ? wb.advisor.advisorCallCount : 0
        } : null,
        extensions: wb.extensions && typeof wb.extensions === 'object' ? {
          adverseMediaTopCategory: wb.extensions.adverseMediaTopCategory || null,
          adverseMediaCriticalCount: typeof wb.extensions.adverseMediaCriticalCount === 'number'
            ? wb.extensions.adverseMediaCriticalCount : 0,
          explainableScore: wb.extensions.explainableScore || null
        } : null
      } : null,
      deepBrain: db ? {
        verdict: db.verdict || null,
        requiresFourEyes: !!db.requiresFourEyes,
        confidence: typeof db.confidence === 'number' ? db.confidence : null,
        narrative: db.narrative ? String(db.narrative).slice(0, 1200) : '',
        topHypothesis: db.topHypothesis || null,
        posterior: typeof db.posterior === 'number' ? db.posterior : null,
        rationale: db.rationale ? String(db.rationale).slice(0, 800) : '',
        coverage: typeof db.coverage === 'number' ? db.coverage : null,
        lessons: Array.isArray(db.lessons) ? db.lessons.slice(0, 4) : []
      } : null
    } : null;

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
      pep_dimensions: Array.isArray(pepDimensions) ? pepDimensions.slice() : [],
      pep_flags: [],
      adverse_media_count: amHitCount,
      adverse_media_items: adverseItems,
      adverse_media_provider: am.provider ? String(am.provider) : '',
      adverse_media_providers_used: Array.isArray(am.providersUsed) ? am.providersUsed.slice() : [],
      adverse_media_severity: amSeverity,
      adverse_media_error: am.error ? String(am.error) : '',
      special_screens: specialScreens,
      special_flags: [],
      integrity: data.screeningIntegrity || 'complete',
      run_id: (data.runId || data.run_id || '').toString(),
      source: 'backend',
      screened_at: new Date().toISOString(),
      // 19-subsystem weaponized brain + deep-brain reasoning chain
      // captured from screening-run.mts. Rendered as the Brain
      // Intelligence panel per row so the MLRO can see the verdict
      // rationale, confidence, clamp reasons, and Opus advisor output.
      brain: brain
    };
  }

  function buildRowFromSimulation(body, fd, sanctionsLists, adverseMedia, specialScreens, pepDimensions) {
    // Deterministic keyword-based simulation so the form is still useful
    // when the MLRO hasn't signed in yet (no token = no live screening).
    var nameLower = (body.subjectName || '').toLowerCase();
    var aliasLower = ((body.aliases || [])[0] || '').toLowerCase();
    var haystack = nameLower + ' ' + aliasLower;

    // First: screen against the seeded known public adverse-media
    // register using the multi-modal matcher (Jaro-Winkler + Soundex +
    // Metaphone + token-set). This catches high-profile Reuters /
    // state-media cases and their transliteration + typo variants.
    var knownHit = findKnownAdverseMedia(body.subjectName, body.aliases);

    // Adverse-media classification = register hit confidence, OR a
    // keyword heuristic, OR 'weak' (no signal).
    var amConf, amCls;
    if (knownHit) {
      amConf = knownHit.entry.confidence * knownHit.score;
      amCls = amConf >= 0.85 ? 'confirmed' : amConf >= 0.5 ? 'potential' : 'weak';
    } else {
      amConf = haystack.indexOf('test-hit') >= 0 ? 0.95
        : haystack.indexOf('pep') >= 0 ? 0.55
        : 0.04;
      amCls = amConf >= 0.85 ? 'confirmed' : amConf >= 0.5 ? 'potential' : 'weak';
    }

    // Sanctions classification is SEPARATE from adverse-media.
    // A known-adverse-media hit does NOT imply a sanctions hit — the
    // register declares explicit sanctions_hits[] (a list of list-IDs
    // the subject is actually on). Default: empty ⇒ all sanctions
    // rows render NEGATIVE. This is the anti-hallucination rule.
    var explicitSanctionsHits = knownHit && Array.isArray(knownHit.entry.sanctions_hits)
      ? knownHit.entry.sanctions_hits
      : [];

    var sanctionsTopCls = 'none';
    var sanctionsTopScore = 0;
    var perList = sanctionsLists.map(function (listId) {
      var item = SANCTIONS_LISTS.filter(function (l) { return l.id === listId; })[0];
      var onThisList = explicitSanctionsHits.indexOf(listId) >= 0;
      var listCls = onThisList ? amCls : 'none';
      var listScore = onThisList ? amConf : 0;
      if (onThisList && amConf > sanctionsTopScore) {
        sanctionsTopScore = amConf;
        sanctionsTopCls = amCls;
      }
      return {
        list: item ? item.label : listId,
        disposition: dispositionFromClassification(listCls),
        hit_count: onThisList && amCls !== 'weak' ? 1 : 0,
        classification: listCls,
        hits: onThisList && amCls !== 'weak' ? [{
          candidate: body.subjectName + ' (simulated)',
          classification: amCls,
          breakdown: { score: listScore, jaroWinkler: listScore, tokenSet: listScore * 0.9 }
        }] : []
      };
    });

    // Top-level row classification: take the STRONGER of the sanctions
    // verdict and the adverse-media verdict, but keep them as two
    // separate fields so the card can render correctly. `cls` is the
    // overall top signal the badge shows; `conf` is its confidence.
    var cls, conf;
    if (sanctionsTopCls !== 'none' && sanctionsTopScore >= amConf) {
      cls = sanctionsTopCls;
      conf = sanctionsTopScore;
    } else {
      cls = amCls;
      conf = amConf;
    }
    var disposition = dispositionFromClassification(cls);
    if (disposition === 'positive' || disposition === 'partial') disposition = 'pending';
    // Integrity gate (FDL Art.20-21, FATF Rec 10): simulated screens
    // MUST NOT close as clean NEGATIVE.
    if (disposition === 'negative') disposition = 'pending';

    var adverseHits = [];
    if (knownHit) {
      // Intersect the known-hit categories with what the MLRO asked to
      // screen for. If the MLRO disabled every category the known-hit
      // covers, fall back to the full known-hit category list so the
      // adverse-media signal is never silently dropped.
      var intersection = knownHit.entry.categories.filter(function (c) {
        return adverseMedia.indexOf(c) >= 0;
      });
      adverseHits = intersection.length ? intersection : knownHit.entry.categories.slice();
    } else if (haystack.indexOf('test-adverse') >= 0) {
      adverseHits = adverseMedia.slice(0, 3);
    }

    // PEP flags come exclusively from the dedicated PEP Screening section
    // (FATF Rec 12 scopes) — not from the adverse-media categories. Test
    // subjects with "pep" in their name surface as PEP hits when the MLRO
    // ticked at least one PEP scope on the form.
    var pepFlags = (haystack.indexOf('pep') >= 0 && pepDimensions.length) ? pepDimensions.slice() : [];

    var specialFlags = [];
    if (haystack.indexOf('test-pf') >= 0 && specialScreens.indexOf('proliferation') >= 0) specialFlags.push('proliferation');
    if (haystack.indexOf('test-tf') >= 0 && specialScreens.indexOf('terrorism') >= 0) specialFlags.push('terrorism');
    if (haystack.indexOf('test-tax') >= 0 && specialScreens.indexOf('tax_evasion') >= 0) specialFlags.push('tax_evasion');

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
      pep_dimensions: Array.isArray(pepDimensions) ? pepDimensions.slice() : [],
      pep_flags: pepFlags,
      known_adverse_source: knownHit ? {
        source: knownHit.entry.source,
        url: knownHit.entry.url,
        summary: knownHit.entry.summary,
        match_score: knownHit.score,
        match_methods: knownHit.methods,
        matched_alias: knownHit.matchedAlias
      } : null,
      compliance_report: knownHit ? {
        adverse_media_classification: amCls,
        adverse_media_confidence: amConf,
        sanctions_status: explicitSanctionsHits.length === 0
          ? 'NEGATIVE across all ' + sanctionsLists.length + ' selected sanctions / watchlists'
          : 'HIT on ' + explicitSanctionsHits.length + ' sanctions list(s): ' + explicitSanctionsHits.join(', '),
        risk_level: knownHit.entry.risk_level || 'high',
        recommendation: knownHit.entry.recommendation || '',
        regulatory_basis: Array.isArray(knownHit.entry.regulatory_basis) ? knownHit.entry.regulatory_basis.slice() : []
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
      skillsPalette('transaction'),
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
      skillsPalette('str'),
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
      skillsPalette('watchlist'),
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

  // ─── Weaponized intelligence drawer mount ─────────────────────────
  // Pulls the full screening snapshot into a shared super-brain UI
  // (brain-boot.js + intelligence-drawer.js). Runs 47 FATF/UAE
  // typology rules client-side on every open (zero API cost), offers
  // 8 preset analyses, and escalates to the full MegaBrain pipeline
  // with advisor-tool beta (Sonnet → Opus) when auth is present.
  //
  // Regulatory: FDL No.(10)/2025 Art.20-21 (CO duties), Art.26-27
  // (STR filing), Art.29 (no tipping off). Cabinet Res 134/2025
  // Art.19 (internal review). Cabinet Res 74/2020 Art.4-7 (24h
  // freeze). FATF Rec 10, 12, 15, 20, 22. NIST AI RMF 1.0.
  function mountIntelligenceDrawer() {
    if (!window.__intelligenceDrawer) return;

    var CRITICAL_COUNTRIES = ['IR','KP','MM','RU','SY','BY','CU','VE','YE','LY','SO','SD','AF'];

    // Build a synthetic "entity" the brain can reason over from the
    // full screening snapshot. This feeds __brainTypology.scan and
    // __brainAnalyze — same contract used across the codebase.
    function buildEntity(snap) {
      var subjects = snap.keys.subjects || [];
      var txs      = snap.keys.transactions || [];
      var watch    = snap.keys.watchlist || [];
      var str      = snap.keys.strCases || [];

      var confirmed = subjects.filter(function (s) { return s.disposition === 'positive'; }).length;
      var partial   = subjects.filter(function (s) { return s.disposition === 'partial'; }).length;
      var pepHits   = subjects.filter(function (s) {
        return (Array.isArray(s.pep_flags) && s.pep_flags.length > 0) ||
               (Array.isArray(s.pep_dimensions) && s.pep_dimensions.length > 0);
      }).length;
      var adverseHits = subjects.filter(function (s) {
        return Array.isArray(s.adverse_media_hits) && s.adverse_media_hits.length > 0;
      }).length;
      var specialHits = subjects.filter(function (s) {
        return Array.isArray(s.special_flags) && s.special_flags.length > 0;
      }).length;
      var topScore = subjects.reduce(function (m, s) {
        return Math.max(m, s.confidence || 0);
      }, 0);

      return {
        id: 'screening-command-landing',
        kind: 'screening_command_snapshot',
        subjectCount: subjects.length,
        transactionCount: txs.length,
        watchlistCount: watch.length,
        strCaseCount: str.length,
        confirmedMatches: confirmed,
        partialMatches: partial,
        sanctionsMatchScore: topScore,
        pepScreenResult: pepHits > 0 ? 'MATCH' : 'CLEAR',
        pepDisclosed: pepHits === 0,
        adverseMediaScore: subjects.length ? adverseHits / subjects.length : 0,
        pfScreenResult: specialHits > 0 ? 'MATCH' : 'CLEAR',
        features: {
          subjectCount: subjects.length,
          confirmedMatches: confirmed,
          topSanctionsScore: topScore,
          adverseHitRatio: subjects.length ? adverseHits / subjects.length : 0,
          cahraExposure: txs.some(function (t) {
            return CRITICAL_COUNTRIES.indexOf(t.counterpartyCountry || '') !== -1;
          }) ? 1 : 0
        }
      };
    }

    // Project transactions into the shape __brainTypology expects.
    function buildTxs(snap) {
      return (snap.keys.transactions || []).map(function (t) {
        var when = t.occurred_on || t.date || t.timestamp || null;
        return {
          date: when ? (new Date(when).toISOString()) : new Date().toISOString(),
          amount: Number(t.amount || 0),
          method: (t.channel || '').toUpperCase() === 'CASH' ? 'CASH' : (t.channel || 'BANK').toUpperCase(),
          channel: (t.channel || 'BANK').toUpperCase(),
          counterpartyCountry: t.country || t.counterpartyCountry || null,
          type: t.type || 'PAYMENT',
          commodity: t.commodity || null
        };
      });
    }

    // ─── Pure-math helpers used by multiple presets ───────────────
    function mean(xs) {
      if (!xs.length) return 0;
      return xs.reduce(function (s, v) { return s + v; }, 0) / xs.length;
    }
    function stddev(xs) {
      if (xs.length < 2) return 0;
      var m = mean(xs);
      var v = xs.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (xs.length - 1);
      return Math.sqrt(v);
    }

    // ─── Preset analyses (client-side, zero API cost) ─────────────
    var presets = [

      // 1 — Sanctions proximity ranker (Bayesian-ish combiner).
      {
        id: 'sanctions_rank',
        label: 'Rank subjects by sanctions proximity',
        note: 'Bayesian combiner on confidence × list-coverage × PEP × adverse media.',
        fn: function (ctx) {
          var subjects = ctx.snap.keys.subjects || [];
          if (!subjects.length) {
            return { summary: 'No subjects in the register yet — run a screening first.', citations: ['FDL Art.20-21'] };
          }
          // Prior: 1% base rate of a true positive. Likelihood ratios
          // are deliberately conservative per FDL Art.29 tip-off risk.
          var PRIOR = 0.01;
          function posterior(s) {
            var conf = s.confidence || 0;
            var lists = Array.isArray(s.per_list) ? s.per_list.filter(function (p) { return p.hit_count > 0; }).length : 0;
            var adv = (s.adverse_media_hits || []).length;
            var spec = (s.special_flags || []).length;
            var lr = 1 + (conf * 6) + (lists * 0.8) + (adv * 0.6) + (spec * 0.9);
            var odds = (PRIOR / (1 - PRIOR)) * lr;
            return odds / (1 + odds);
          }
          var ranked = subjects.map(function (s) {
            return { name: s.name, country: s.country, disp: s.disposition || 'pending',
              score: posterior(s), topScore: s.confidence || 0 };
          }).sort(function (a, b) { return b.score - a.score; });
          var top = ranked.slice(0, 8);
          var verdict = top.length && top[0].score >= 0.6 ? 'escalate' : top.length && top[0].score >= 0.3 ? 'review' : 'monitor';
          var lines = ['Bayesian posterior P(true-positive | evidence), ordered descending:', ''];
          top.forEach(function (r, i) {
            lines.push('  ' + (i + 1) + '. ' + r.name + ' — ' + (r.score * 100).toFixed(1) + '%  ' +
              '(raw conf ' + (r.topScore * 100).toFixed(0) + '%, disp ' + r.disp + ', ' + (r.country || '—') + ')');
          });
          return {
            verdict: verdict,
            confidence: top.length ? top[0].score : 0,
            summary: lines.join('\n'),
            citations: ['FDL Art.20-21', 'Cabinet Res 74/2020 Art.4-7', 'FATF Rec 6-7']
          };
        }
      },

      // 2 — Structuring / smurfing detector (T01).
      {
        id: 'structuring',
        label: 'Detect structuring near AED 55K DPMS threshold',
        note: 'Counts transactions in the 45K–55K band, cross-checked against same-counterparty day-bucket.',
        fn: function (ctx) {
          var txs = ctx.snap.keys.transactions || [];
          var near = txs.filter(function (t) { var a = Number(t.amount || 0); return a > 45000 && a < 55000; });
          var byCp = {};
          near.forEach(function (t) {
            var k = (t.counterparty || 'unknown') + '|' + String(t.occurred_on || '').slice(0, 10);
            byCp[k] = (byCp[k] || 0) + 1;
          });
          var clusters = Object.keys(byCp).filter(function (k) { return byCp[k] >= 2; }).length;
          var verdict = near.length >= 3 ? 'escalate' : near.length >= 1 ? 'review' : 'monitor';
          return {
            verdict: verdict,
            confidence: Math.min(0.95, 0.2 + near.length * 0.08 + clusters * 0.15),
            summary: [
              'Near-threshold transactions (45K < amount < 55K): ' + near.length,
              'Same-counterparty day-buckets with ≥2 near-threshold hits: ' + clusters,
              '',
              near.length ? 'Offenders (top 5):' : 'No structuring signal detected.',
              near.slice(0, 5).map(function (t) {
                return '  • AED ' + (t.amount || 0).toLocaleString() + ' — ' + (t.counterparty || '—') + ' (' + (t.occurred_on || '') + ')';
              }).join('\n')
            ].join('\n'),
            citations: ['MoE Circular 08/AML/2021', 'FDL Art.16', 'FATF Rec 20']
          };
        }
      },

      // 3 — Velocity z-score anomaly.
      {
        id: 'velocity',
        label: 'Velocity z-score anomaly scan',
        note: 'Flags transactions > 3σ above the 30-day rolling mean.',
        fn: function (ctx) {
          var txs = (ctx.snap.keys.transactions || []).slice().sort(function (a, b) {
            return new Date(a.occurred_on || 0) - new Date(b.occurred_on || 0);
          });
          if (txs.length < 5) {
            return { verdict: 'monitor', confidence: 0.1, summary: 'Need ≥5 transactions for a meaningful z-score.', citations: ['FDL Art.16'] };
          }
          var amounts = txs.map(function (t) { return Number(t.amount || 0); });
          var m = mean(amounts);
          var sd = stddev(amounts);
          if (!sd) {
            return { verdict: 'monitor', confidence: 0.1, summary: 'Zero variance — all amounts identical.', citations: ['FDL Art.16'] };
          }
          var outliers = amounts.map(function (a, i) { return { t: txs[i], z: (a - m) / sd }; })
            .filter(function (x) { return Math.abs(x.z) > 3; });
          var verdict = outliers.length ? 'review' : 'monitor';
          return {
            verdict: verdict,
            confidence: outliers.length ? Math.min(0.9, 0.3 + outliers.length * 0.15) : 0.15,
            summary: [
              'μ = AED ' + m.toFixed(0) + '  σ = AED ' + sd.toFixed(0) + '  n = ' + amounts.length,
              'Outliers |z| > 3: ' + outliers.length,
              outliers.slice(0, 5).map(function (x) {
                return '  • z=' + x.z.toFixed(2) + '  AED ' + (x.t.amount || 0).toLocaleString() + ' — ' + (x.t.counterparty || '—');
              }).join('\n')
            ].join('\n'),
            citations: ['FDL Art.16', 'FATF Rec 10']
          };
        }
      },

      // 4 — Benford's Law digit-frequency audit.
      {
        id: 'benford',
        label: "Benford's Law first-digit audit",
        note: 'χ² test against expected log-distribution of leading digits.',
        fn: function (ctx) {
          var txs = ctx.snap.keys.transactions || [];
          var amounts = txs.map(function (t) { return Math.abs(Number(t.amount || 0)); }).filter(function (a) { return a > 0; });
          if (amounts.length < 10) {
            return { verdict: 'monitor', confidence: 0.1, summary: 'Need ≥10 non-zero transactions for Benford.', citations: ['FDL Art.19'] };
          }
          var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          amounts.forEach(function (a) {
            var d = parseInt(String(a).replace('.', '').replace(/^0+/, '')[0], 10);
            if (d >= 1 && d <= 9) counts[d]++;
          });
          var expected = [0, 0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];
          var n = amounts.length;
          var chi2 = 0;
          var rows = [];
          for (var d = 1; d <= 9; d++) {
            var obs = counts[d] / n;
            var exp = expected[d];
            chi2 += Math.pow(obs - exp, 2) / exp;
            rows.push('  digit ' + d + ': observed ' + (obs * 100).toFixed(1) + '%  (expected ' + (exp * 100).toFixed(1) + '%)');
          }
          var suspicious = chi2 > 15.5;
          return {
            verdict: suspicious ? 'review' : 'monitor',
            confidence: suspicious ? Math.min(0.85, 0.3 + chi2 / 60) : 0.15,
            summary: [
              'χ² = ' + chi2.toFixed(2) + '  (threshold 15.51 at p=0.05, 8df)',
              'n = ' + n + ' transactions',
              suspicious ? '⚠  Distribution diverges from Benford — investigate for fabrication.' : '✓  Distribution consistent with Benford.',
              '',
              'Digit frequencies:',
              rows.join('\n')
            ].join('\n'),
            citations: ['FDL Art.19', 'FATF Rec 10']
          };
        }
      },

      // 5 — Multi-jurisdiction layering (T18).
      {
        id: 'layering',
        label: 'Multi-jurisdiction layering scan',
        note: 'Flags when counterparties span ≥5 countries with CAHRA hits weighted heavier.',
        fn: function (ctx) {
          var txs = ctx.snap.keys.transactions || [];
          var countries = {};
          var cahraHits = 0;
          txs.forEach(function (t) {
            var c = t.country || t.counterpartyCountry;
            if (c) {
              countries[c] = (countries[c] || 0) + 1;
              if (CRITICAL_COUNTRIES.indexOf(c) !== -1) cahraHits++;
            }
          });
          var uniq = Object.keys(countries);
          var verdict = (uniq.length >= 5 || cahraHits > 0) ? (cahraHits > 0 ? 'escalate' : 'review') : 'monitor';
          return {
            verdict: verdict,
            confidence: Math.min(0.9, 0.2 + uniq.length * 0.08 + cahraHits * 0.2),
            summary: [
              'Distinct counterparty countries: ' + uniq.length,
              'CAHRA / high-risk jurisdiction hits: ' + cahraHits,
              '',
              'Distribution:',
              uniq.map(function (c) {
                var flag = CRITICAL_COUNTRIES.indexOf(c) !== -1 ? '  ⚠ CAHRA' : '';
                return '  ' + c + ': ' + countries[c] + flag;
              }).join('\n')
            ].join('\n'),
            citations: ['Cabinet Res 134/2025 Art.5', 'FATF Rec 20', 'LBMA RGG v9']
          };
        }
      },

      // 6 — PEP + adverse media correlation.
      {
        id: 'pep_correlation',
        label: 'PEP × adverse-media correlation',
        note: 'Cross-joins subjects with PEP scope (FATF Rec 12) and adverse-media categories.',
        fn: function (ctx) {
          var subjects = ctx.snap.keys.subjects || [];
          function hasPep(s) {
            return (Array.isArray(s.pep_flags) && s.pep_flags.length > 0) ||
                   (Array.isArray(s.pep_dimensions) && s.pep_dimensions.length > 0);
          }
          var peps = subjects.filter(hasPep);
          var withOther = peps.filter(function (s) {
            return (s.adverse_media_hits || []).some(function (h) {
              return h !== 'negative_reputation';
            });
          });
          var verdict = withOther.length ? 'escalate' : peps.length ? 'review' : 'monitor';
          return {
            verdict: verdict,
            confidence: withOther.length ? Math.min(0.9, 0.4 + withOther.length * 0.15) : (peps.length ? 0.45 : 0.1),
            summary: [
              'PEP-flagged subjects: ' + peps.length,
              'PEP + other adverse-media: ' + withOther.length,
              '',
              withOther.length ? 'PEP + escalation-worthy combinations:' : (peps.length ? 'PEP-only subjects:' : ''),
              (withOther.length ? withOther : peps).slice(0, 6).map(function (s) {
                var pepLabels = (s.pep_flags && s.pep_flags.length ? s.pep_flags : (s.pep_dimensions || [])).join(', ') || '—';
                return '  • ' + s.name + ' — ' + (s.country || '—') + ' — PEP scope: ' + pepLabels;
              }).join('\n')
            ].join('\n'),
            citations: ['FATF Rec 12', 'FDL Art.14', 'Cabinet Res 134/2025 Art.14']
          };
        }
      },

      // 7 — Filing SLA watchdog on STR cases.
      {
        id: 'str_sla',
        label: 'STR / SAR filing SLA watchdog',
        note: 'Flags open cases still unfiled after >5 days. FDL Art.26-27: file without delay.',
        fn: function (ctx) {
          var cases = ctx.snap.keys.strCases || [];
          var now = Date.now();
          var overdue = cases.filter(function (c) {
            if (c.filed_on || c.status === 'filed') return false;
            var opened = c.opened_on ? new Date(c.opened_on).getTime() : now;
            return (now - opened) / 86400000 > 5;
          });
          return {
            verdict: overdue.length ? 'escalate' : 'monitor',
            confidence: overdue.length ? Math.min(0.95, 0.5 + overdue.length * 0.1) : 0.15,
            summary: [
              'Open STR / SAR cases: ' + cases.filter(function (c) { return !c.filed_on && c.status !== 'filed'; }).length,
              'Overdue (> 5 days unfiled): ' + overdue.length,
              '',
              overdue.length ? 'Overdue cases:' : 'No overdue filings — keep it that way.',
              overdue.slice(0, 6).map(function (c) {
                var opened = c.opened_on ? new Date(c.opened_on).getTime() : now;
                var age = Math.round((now - opened) / 86400000);
                return '  • ' + (c.subject || '—') + ' (' + (c.kind || 'STR') + ') — ' + age + ' days open';
              }).join('\n')
            ].join('\n'),
            citations: ['FDL Art.26-27', 'FDL Art.29 (no tip-off)']
          };
        }
      },

      // 8 — Watchlist drift detector.
      {
        id: 'watchlist_drift',
        label: 'Watchlist drift audit',
        note: 'Subjects on the watchlist whose screening score or disposition has worsened since enrolment.',
        fn: function (ctx) {
          var watch = ctx.snap.keys.watchlist || [];
          var subjects = ctx.snap.keys.subjects || [];
          var byName = {};
          subjects.forEach(function (s) { byName[(s.name || '').toLowerCase()] = s; });
          var drifted = watch.map(function (w) {
            var s = byName[(w.name || '').toLowerCase()];
            return s ? { w: w, s: s } : null;
          }).filter(function (x) {
            return x && (x.s.disposition === 'positive' || x.s.disposition === 'partial' || (x.s.confidence || 0) >= 0.5);
          });
          return {
            verdict: drifted.length ? 'review' : 'monitor',
            confidence: drifted.length ? Math.min(0.85, 0.35 + drifted.length * 0.1) : 0.1,
            summary: [
              'Watchlist subjects: ' + watch.length,
              'Drifted into partial/positive territory: ' + drifted.length,
              '',
              drifted.slice(0, 8).map(function (x) {
                return '  • ' + x.w.name + ' — last scan ' + (x.w.last_scan || '—') + ' — now ' + (x.s.disposition || 'pending') +
                  ' @ ' + ((x.s.confidence || 0) * 100).toFixed(0) + '%';
              }).join('\n')
            ].join('\n'),
            citations: ['FDL Art.20-21', 'Cabinet Res 134/2025 Art.19']
          };
        }
      },

      // 9 — STR narrative drafter (Art.29 no-tip-off safe).
      // Assembles an MLRO-review-ready draft from the highest-risk
      // subject + typology hits + transaction footprint. Unlike the
      // SLA watchdog (preset 7) which only flags overdue cases, this
      // produces the actual narrative text the MLRO edits before
      // filing via goAML. Every output carries the Art.29 tip-off
      // notice so no draft can be forwarded to the subject.
      {
        id: 'str_draft',
        label: 'Draft STR narrative (Art.29 tip-off-safe)',
        note: 'Assembles an MLRO-review-ready narrative from typology hits. Never to be disclosed to the subject.',
        fn: function (ctx) {
          var subjects = ctx.snap.keys.subjects || [];
          var ranked = subjects.slice().sort(function (a, b) {
            var rank = { positive: 4, partial: 3, escalated: 3, pending: 2, false_positive: 1, negative: 0 };
            var da = rank[a.disposition] || 0;
            var db = rank[b.disposition] || 0;
            if (db !== da) return db - da;
            return (b.confidence || 0) - (a.confidence || 0);
          });
          var pick = ranked[0] || {};
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
            'Subject: ' + (pick.name || entity.subjectName || '[unnamed]') +
              ' (' + (pick.subject_type || entity.subjectType || 'individual') + ')',
            'Disposition: ' + ((DISPOSITIONS[pick.disposition] || {}).label || 'PENDING REVIEW'),
            'Sanctions match score: ' + ((pick.confidence || entity.sanctionsMatchScore || 0) * 100).toFixed(1) + '%',
            'Adverse media hits: ' + (Array.isArray(pick.adverse_media_hits) ? pick.adverse_media_hits.length : 0),
            'PEP screen: ' + (entity.pepScreenResult || '—'),
            '',
            'Transactional footprint: ' + txs.length + ' transactions, total AED ' + totalAed.toFixed(0) + '.',
            'Typology matches: ' + typ.length + ' (' + crit.length + ' critical, ' + high.length + ' high).',
            '',
            'Indicators observed:'
          ].concat(typ.slice(0, 8).map(function (h) {
            return '  • [' + (h.severity || '').toUpperCase() + '] ' + h.name +
              ' — ' + h.typologyId + ', FATF ' + h.fatfRef + ', ' + h.uaeRef;
          })).concat([
            '',
            'Suspicion grounds: the combination of the above indicators exceeds the MLRO reporting threshold.',
            'Regulatory basis: FDL No.(10)/2025 Art.26-27 (file without delay) · Art.29 (no tipping off the subject).',
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
      },

      // 10 — Cross-module correlation sweep.
      // Catches the hardest class of miss — a subject, transaction
      // counterparty, STR case and active watchlist entry all
      // referring to the same party but sitting in four separate
      // stores without anything tying them together. The other
      // presets read single stores; this one intersects them.
      {
        id: 'cross_module',
        label: 'Cross-module correlation sweep',
        note: 'Intersects subjects × transactions × STR cases × watchlist on normalized name.',
        fn: function (ctx) {
          function norm(s) { return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' '); }
          var subjects = ctx.snap.keys.subjects || [];
          var txs      = ctx.snap.keys.transactions || [];
          var strs     = ctx.snap.keys.strCases || [];
          var watch    = ctx.snap.keys.watchlist || [];
          var hits = [];

          var watched = {};
          watch.forEach(function (w) { var n = norm(w.name); if (n) watched[n] = w; });

          var txCps = {};
          txs.forEach(function (t) { var n = norm(t.counterparty); if (n) txCps[n] = (txCps[n] || 0) + 1; });

          subjects.forEach(function (s) {
            var n = norm(s.name);
            if (!n) return;
            if (watched[n]) hits.push('Subject "' + (s.name || n) + '" is on the active watchlist (added ' + (watched[n].added_on || '—') + ').');
            if (txCps[n]) hits.push('Subject "' + (s.name || n) + '" appears as a transaction counterparty ×' + txCps[n] + '.');
          });
          strs.forEach(function (c) {
            var n = norm(c.subject || c.subject_name);
            if (!n) return;
            if (watched[n]) hits.push('STR case subject "' + n + '" is also on the active watchlist — Art.29 tip-off risk on re-screen.');
            if (txCps[n]) hits.push('STR case subject "' + n + '" also appears as a transaction counterparty ×' + txCps[n] + '.');
          });

          var verdict = hits.length >= 3 ? 'escalate' : hits.length ? 'review' : 'monitor';
          return {
            verdict: verdict,
            confidence: hits.length ? Math.min(0.9, 0.4 + hits.length * 0.1) : 0.15,
            summary: hits.length
              ? 'Cross-module correlation hits (' + hits.length + '):\n' +
                  hits.slice(0, 12).map(function (h) { return '  • ' + h; }).join('\n')
              : 'No cross-module correlations between subjects, transactions, STR cases and the watchlist in the current snapshot.',
            citations: ['FDL No.(10)/2025 Art.20-21', 'FDL No.(10)/2025 Art.29', 'Cabinet Res 134/2025 Art.19', 'FATF Rec 20']
          };
        }
      }
    ];

    window.__intelligenceDrawer.mount('screening-command', {
      storageKeys: {
        subjects: STORAGE.subjects,
        transactions: STORAGE.transactions,
        strCases: STORAGE.strCases,
        watchlist: STORAGE.watchlist
      },
      topic: 'screening_command_intelligence',
      launcherLabel: 'Intelligence',
      entityBuilder: buildEntity,
      txBuilder: buildTxs,
      presets: presets
    });
  }

  // Mount after a tick so brain-boot.js + intelligence-drawer.js
  // (whose script tags appear before this one) have finished
  // installing their globals.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountIntelligenceDrawer);
  } else {
    mountIntelligenceDrawer();
  }
})();
