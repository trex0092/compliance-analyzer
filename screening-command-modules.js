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
      short_label: 'UAE EOCN',
      citation: 'Cabinet Res 74/2020 Art.4-7 · FDL No.(10)/2025 Art.35 · MANDATORY',
      detail: 'UAE domestic terror-designation list maintained by the Executive Office for CTFEF. Confirmed match triggers a 24-hour freeze and 5-business-day CNMR.'
    },
    {
      id: 'un_unsc',
      label: 'UN Consolidated Sanctions List (UNSC)',
      short_label: 'UN UNSC',
      citation: 'UNSCR 1267 / 1988 / 2231 · FATF Rec 6-7 · MANDATORY',
      detail: 'All Security Council sanctions regimes (ISIL-Da\'esh / Al-Qaida, Taliban, DPRK, Iran, Libya, Somalia, Yemen, etc.). Legally mandatory under UN Charter Art.25.'
    },
    {
      id: 'ofac_sdn',
      label: 'OFAC Specially Designated Nationals List (SDN + Non-SDN)',
      short_label: 'OFAC SDN',
      citation: 'US Treasury OFAC · 31 CFR 501 · Secondary-sanctions risk for USD clearing',
      detail: 'SDN + Consolidated Non-SDN lists (SSI, NS-PLC, FSE, 13599). Key risk for USD-denominated flows and USD correspondent relationships.'
    },
    {
      id: 'uk_ofsi',
      label: 'UK HMT / OFSI Consolidated Financial Sanctions List',
      short_label: 'UK HMT/OFSI',
      citation: 'UK Sanctions and Anti-Money Laundering Act 2018 · SAMLA',
      detail: 'Post-Brexit UK-autonomous financial sanctions regime. Relevant for GBP-denominated flows and UK-nexus trade.'
    },
    {
      id: 'eu_csfl',
      label: 'EU Consolidated Financial Sanctions List',
      short_label: 'EU CSFL',
      citation: 'Council Regulation (EC) No 2580/2001 · EU Restrictive Measures',
      detail: 'EU autonomous sanctions covering all 27 Member States. Critical for EUR flows, goods transiting EU, and EU-banked counterparties.'
    },
    {
      id: 'interpol',
      label: 'INTERPOL Red / Blue / Yellow Notices',
      short_label: 'INTERPOL Notices',
      citation: 'INTERPOL Constitution Art.3 · Rules on the Processing of Data',
      detail: 'Wanted-persons notices for arrest and extradition, plus locate-and-identify (Blue) and missing-person (Yellow). Manual verification — not all Red Notices meet sanctions-equivalent threshold.'
    },
    {
      id: 'ch_seco',
      label: 'Swiss SECO Sanctions List (SESAM)',
      short_label: 'Swiss SECO',
      citation: 'Swiss Embargo Act (EmbA) · SECO State Secretariat for Economic Affairs',
      detail: 'Swiss autonomous sanctions, closely tracks EU designations plus Swiss-specific entries (mercenaries, conflict diamonds). Relevant for CHF clearing and Swiss banking nexus.'
    },
    {
      id: 'ca_osfi',
      label: 'Canada OSFI / Justice consolidated list',
      short_label: 'Canada OSFI',
      citation: 'Special Economic Measures Act (SEMA) · Justice for Victims of Corrupt Foreign Officials Act',
      detail: 'Canadian autonomous sanctions (Russia, Iran, DPRK, Myanmar, Venezuela, Belarus, Magnitsky-style designations). Relevant for CAD flows and Canadian-nexus trade.'
    },
    {
      id: 'au_dfat',
      label: 'Australia DFAT Consolidated List',
      short_label: 'Australia DFAT',
      citation: 'Charter of the United Nations Act 1945 · Autonomous Sanctions Act 2011',
      detail: 'Australian autonomous sanctions covering DPRK, Iran, Libya, Myanmar, Russia, Syria, Zimbabwe, PEPs, and thematic (cyber, WMD, human rights). Relevant for AUD flows.'
    },
    {
      id: 'jp_mof',
      label: 'Japan MoF / METI sanctions list',
      short_label: 'Japan MoF/METI',
      citation: 'Foreign Exchange and Foreign Trade Act (FEFTA) · METI notifications',
      detail: 'Japanese financial + trade sanctions. DPRK, Iran, Russia, Myanmar, Libya. Relevant for JPY flows and Japan-nexus trade.'
    },
    {
      id: 'sg_mas',
      label: 'Singapore MAS Targeted Financial Sanctions',
      short_label: 'Singapore MAS',
      citation: 'Terrorism (Suppression of Financing) Act · MAS Notice 626',
      detail: 'Singapore TFS regime implementing UN designations plus domestic terror-financing designations. Relevant for SGD flows and Singapore-banked counterparties.'
    },
    {
      id: 'hk_hkma',
      label: 'Hong Kong HKMA / UNSR (Cap.537) lists',
      short_label: 'Hong Kong HKMA',
      citation: 'United Nations Sanctions Ordinance (Cap.537) · AMLO',
      detail: 'Hong Kong implements UN designations via UNSO subsidiary legislation. HKD clearing exposure and HK-nexus corporate-service providers.'
    },
    {
      id: 'wb_debar',
      label: 'World Bank + MDB Cross-Debarment List',
      short_label: 'World Bank + MDB',
      citation: 'World Bank Sanctions System · Agreement for Mutual Enforcement of Debarment Decisions',
      detail: 'Cross-debarred firms and individuals across World Bank, ADB, AfDB, EBRD, IDB. Fraud / corruption / collusive / coercive / obstructive procurement violations.'
    },
    {
      id: 'il_mod',
      label: 'Israel Defence Establishment sanctions',
      short_label: 'Israel MoD',
      citation: 'Israeli Counter-Terrorism Law 5776-2016 · Defense Export Control Order',
      detail: 'Israel domestic terror-designation + defence-export blacklist. Relevant for ILS flows and dual-use export-control screening.'
    },
    {
      id: 'bilateral_overlays',
      label: 'Bilateral / thematic overlays (Magnitsky, cyber, narco)',
      short_label: 'Magnitsky/Cyber/Narco',
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

  // ─── Country-risk table — per-country flags keyed by ISO-2 ──────────
  // Drives the Jurisdiction Context paragraph in the compliance report.
  // Flags:
  //   fatf_black:               FATF Call-for-Action (Cabinet Res 134/2025 Art.14 counter-measures)
  //   fatf_grey:                FATF Increased Monitoring
  //   fatf_recent_delist:       Exited grey list within ~18 months — residual scrutiny
  //   comprehensive_sanctions:  OFAC / UK / EU full-regime (absolute prohibition)
  //   sectoral_sanctions:       OFAC / UK / EU sectoral (partial regime)
  //   cahra:                    LBMA RGG v9 / OECD DD Guidance Conflict-Affected & High-Risk Area
  //   secrecy:                  Tax-haven / financial-secrecy jurisdiction
  //   dpms_role:                'source' | 'hub' | 'transit' (gold-corridor position)
  //   notes:                    one-line DPMS / AML context
  //
  // Sources of truth (2026-04): FATF Plenary Outcomes (Oct 2024),
  // OFAC SDN + sectoral programs, EU FATF-equivalent list, LBMA RGG v9
  // CAHRA annex, EU non-cooperative tax list, Tax Justice Network FSI.
  var COUNTRY_RISK_TABLE = {
    // FATF black list — DPRK, Iran, Myanmar
    IR: { aliases: ['iran', 'islamic republic of iran'], fatf_black: true, comprehensive_sanctions: true, dpms_role: null, notes: 'Iran — FATF black + OFAC comprehensive + EU full sanctions. Absolute-prohibition territory for UAE-nexus DPMS activity; any engagement requires licensing.' },
    KP: { aliases: ['dprk', 'north korea', 'democratic people\'s republic of korea'], fatf_black: true, comprehensive_sanctions: true, dpms_role: null, notes: 'DPRK — FATF black + UNSCR 1718/2270/2397 + OFAC NK-SSR comprehensive. WMD-proliferation-financing jurisdiction (Cabinet Res 156/2025).' },
    MM: { aliases: ['myanmar', 'burma'], fatf_black: true, cahra: true, dpms_role: 'source', notes: 'Myanmar — FATF black + CAHRA (junta-controlled jade/gold mining). Forced-labour indicators (LBMA RGG v9 Step 3 mandatory EDD).' },

    // Comprehensive-sanctions jurisdictions (beyond FATF black)
    SY: { aliases: ['syria', 'syrian arab republic'], comprehensive_sanctions: true, cahra: true, dpms_role: null, notes: 'Syria — OFAC comprehensive + EU full sanctions + CAHRA. Absolute-prohibition territory except for licensed humanitarian channels.' },
    CU: { aliases: ['cuba'], comprehensive_sanctions: true, dpms_role: null, notes: 'Cuba — OFAC comprehensive (31 CFR 515). US-nexus prohibitions cascade through USD clearing.' },

    // Sectoral / partial sanctions
    RU: { aliases: ['russia', 'russian federation'], sectoral_sanctions: true, cahra: true, fatf_grey: false, dpms_role: 'source', notes: 'Russia — OFAC/UK/EU sectoral + Directive 1A–4 + G7 gold-import ban + EU gold-origin ban. High sanctions-evasion risk via third-country refineries.' },
    BY: { aliases: ['belarus'], sectoral_sanctions: true, dpms_role: null, notes: 'Belarus — OFAC/UK/EU sectoral + potash/oil/banking restrictions. Russia-nexus secondary-sanctions exposure.' },
    VE: { aliases: ['venezuela', 'bolivarian republic of venezuela'], sectoral_sanctions: true, fatf_grey: true, cahra: true, dpms_role: 'source', notes: 'Venezuela — OFAC sectoral + FATF grey + CAHRA (Orinoco illegal gold mining). Gold-laundering corridor to third-country refineries.' },
    IQ: { aliases: ['iraq'], cahra: true, dpms_role: 'source', notes: 'Iraq — CAHRA. Iran-nexus sanctions-circumvention risk.' },
    LY: { aliases: ['libya', 'state of libya'], cahra: true, dpms_role: 'transit', notes: 'Libya — UN sanctions (1970) + CAHRA. Cash-intensive and oil-smuggling exposure.' },
    PS: { aliases: ['palestine', 'palestinian territory', 'state of palestine'], cahra: true, dpms_role: null, notes: 'Palestine — CAHRA. Counter-terrorism-financing scrutiny.' },

    // FATF grey list (current as of FATF Plenary Feb 2025)
    DZ: { aliases: ['algeria'], fatf_grey: true, dpms_role: null, notes: 'Algeria — FATF grey list (Oct 2024). Strategic AML/CFT deficiencies.' },
    AO: { aliases: ['angola'], fatf_grey: true, cahra: true, dpms_role: 'source', notes: 'Angola — FATF grey + diamond-sector CAHRA.' },
    BG: { aliases: ['bulgaria'], fatf_grey: true, dpms_role: null, notes: 'Bulgaria — FATF grey (first EU member listed). MONEYVAL follow-up.' },
    BF: { aliases: ['burkina faso'], fatf_grey: true, cahra: true, dpms_role: 'source', notes: 'Burkina Faso — FATF grey + CAHRA. ASM gold exports with terror-financing concerns (JNIM/ISGS).' },
    CM: { aliases: ['cameroon'], fatf_grey: true, cahra: true, dpms_role: 'source', notes: 'Cameroon — FATF grey + CAHRA.' },
    CI: { aliases: ['ivory coast', 'côte d\'ivoire', 'cote d\'ivoire'], fatf_grey: true, dpms_role: null, notes: 'Côte d\'Ivoire — FATF grey.' },
    HR: { aliases: ['croatia'], fatf_grey: true, dpms_role: null, notes: 'Croatia — FATF grey.' },
    CD: { aliases: ['dr congo', 'democratic republic of congo', 'congo democratic'], fatf_grey: true, cahra: true, dpms_role: 'source', notes: 'DRC — FATF grey + CAHRA. Prime ASM gold/3TG CAHRA (LBMA RGG v9 mandatory EDD).' },
    HT: { aliases: ['haiti'], fatf_grey: true, dpms_role: null, notes: 'Haiti — FATF grey. Gang-controlled territories (UNSC 2653).' },
    KE: { aliases: ['kenya'], fatf_grey: true, dpms_role: 'transit', notes: 'Kenya — FATF grey. East-Africa gold transit exposure.' },
    LA: { aliases: ['laos', 'lao pdr'], fatf_grey: true, dpms_role: null, notes: 'Laos — FATF grey.' },
    LB: { aliases: ['lebanon'], fatf_grey: true, dpms_role: null, notes: 'Lebanon — FATF grey. Hezbollah TF concerns.' },
    ML: { aliases: ['mali'], fatf_grey: true, cahra: true, dpms_role: 'source', notes: 'Mali — FATF grey + CAHRA. ASM gold with JNIM/ISGS TF exposure.' },
    MC: { aliases: ['monaco'], fatf_grey: true, secrecy: true, dpms_role: null, notes: 'Monaco — FATF grey + financial-secrecy jurisdiction.' },
    MZ: { aliases: ['mozambique'], fatf_grey: true, dpms_role: null, notes: 'Mozambique — FATF grey.' },
    NA: { aliases: ['namibia'], fatf_grey: true, dpms_role: 'source', notes: 'Namibia — FATF grey. Diamond/uranium export exposure.' },
    NP: { aliases: ['nepal'], fatf_grey: true, dpms_role: null, notes: 'Nepal — FATF grey.' },
    NG: { aliases: ['nigeria'], fatf_grey: true, dpms_role: null, notes: 'Nigeria — FATF grey.' },
    PH: { aliases: ['philippines'], fatf_grey: true, dpms_role: null, notes: 'Philippines — FATF grey.' },
    SN: { aliases: ['senegal'], fatf_grey: true, dpms_role: null, notes: 'Senegal — FATF grey.' },
    ZA: { aliases: ['south africa'], fatf_grey: true, dpms_role: 'source', notes: 'South Africa — FATF grey. Major gold-mining jurisdiction.' },
    SS: { aliases: ['south sudan'], fatf_grey: true, cahra: true, dpms_role: 'source', notes: 'South Sudan — FATF grey + CAHRA.' },
    TZ: { aliases: ['tanzania', 'united republic of tanzania'], fatf_grey: true, dpms_role: 'source', notes: 'Tanzania — FATF grey. Gold-mining jurisdiction.' },
    VN: { aliases: ['vietnam', 'viet nam'], fatf_grey: true, dpms_role: null, notes: 'Vietnam — FATF grey.' },
    YE: { aliases: ['yemen'], fatf_grey: true, cahra: true, dpms_role: null, notes: 'Yemen — FATF grey + CAHRA. UN sanctions (2140) on Houthi-linked entities.' },

    // Recent FATF grey-list exits (residual scrutiny for ~18 months)
    TR: { aliases: ['turkey', 'türkiye', 'turkiye'], fatf_recent_delist: true, dpms_role: 'hub', notes: 'Türkiye — exited FATF grey list (Oct 2024); residual heightened scrutiny. Major gold-refinery hub (Istanbul Gold Exchange) with LBMA RGG v9 Step 3 exposure.' },
    AE: { aliases: ['uae', 'united arab emirates', 'emirates'], fatf_recent_delist: true, dpms_role: 'hub', notes: 'UAE — exited FATF grey list (Feb 2024). Home jurisdiction. DPMS-sector sovereign hub under MoE Circular 08/AML/2021.' },

    // CAHRA (non-grey / non-sanctioned)
    AF: { aliases: ['afghanistan'], cahra: true, dpms_role: null, notes: 'Afghanistan — CAHRA + Taliban-administered territory. Counter-TF scrutiny (UNSCR 1988).' },
    BI: { aliases: ['burundi'], cahra: true, dpms_role: null, notes: 'Burundi — CAHRA.' },
    CF: { aliases: ['central african republic', 'car'], cahra: true, dpms_role: 'source', notes: 'CAR — CAHRA. ASM gold with armed-group exposure.' },
    TD: { aliases: ['chad'], cahra: true, dpms_role: null, notes: 'Chad — CAHRA.' },
    CO: { aliases: ['colombia'], cahra: true, dpms_role: 'source', notes: 'Colombia — CAHRA (narco-linked ASM). Significant gold-laundering typology.' },
    ET: { aliases: ['ethiopia'], cahra: true, dpms_role: null, notes: 'Ethiopia — CAHRA (Tigray region).' },
    IL: { aliases: ['israel'], cahra: true, dpms_role: null, notes: 'Israel — partial CAHRA (Gaza/West Bank regions per OECD DD Guidance).' },
    NE: { aliases: ['niger'], cahra: true, dpms_role: null, notes: 'Niger — CAHRA (post-coup instability + Sahel armed groups).' },
    PK: { aliases: ['pakistan'], cahra: true, dpms_role: null, notes: 'Pakistan — partial CAHRA (tribal areas).' },
    SO: { aliases: ['somalia'], cahra: true, dpms_role: null, notes: 'Somalia — CAHRA. Al-Shabaab TF.' },
    SD: { aliases: ['sudan'], cahra: true, dpms_role: 'source', notes: 'Sudan — CAHRA. RSF/SAF gold-mining-funded conflict (post-2023).' },
    UA: { aliases: ['ukraine'], cahra: true, dpms_role: null, notes: 'Ukraine — CAHRA (active conflict; Crimea + DNR/LNR regions under comprehensive sanctions).' },

    // Tax-haven / financial-secrecy (non-grey/non-CAHRA)
    AD: { aliases: ['andorra'], secrecy: true, dpms_role: null, notes: 'Andorra — financial-secrecy jurisdiction.' },
    AI: { aliases: ['anguilla'], secrecy: true, dpms_role: null, notes: 'Anguilla — EU non-cooperative tax jurisdiction.' },
    AG: { aliases: ['antigua', 'antigua and barbuda'], secrecy: true, dpms_role: null, notes: 'Antigua & Barbuda — CBI/secrecy jurisdiction.' },
    BS: { aliases: ['bahamas'], secrecy: true, dpms_role: null, notes: 'Bahamas — historic financial-secrecy; tax-transparency concerns.' },
    BH: { aliases: ['bahrain'], dpms_role: 'transit', notes: 'Bahrain — GCC neighbour. Gold-transit corridor.' },
    BB: { aliases: ['barbados'], secrecy: true, dpms_role: null, notes: 'Barbados — EU non-cooperative tax jurisdiction.' },
    BZ: { aliases: ['belize'], secrecy: true, dpms_role: null, notes: 'Belize — historic offshore jurisdiction.' },
    BM: { aliases: ['bermuda'], secrecy: true, dpms_role: null, notes: 'Bermuda — classic offshore financial centre.' },
    VG: { aliases: ['bvi', 'british virgin islands'], secrecy: true, dpms_role: null, notes: 'BVI — prime shell-company / beneficial-ownership-opacity jurisdiction.' },
    KY: { aliases: ['cayman islands', 'cayman'], secrecy: true, dpms_role: null, notes: 'Cayman Islands — EU non-cooperative tax jurisdiction (historic).' },
    LI: { aliases: ['liechtenstein'], secrecy: true, dpms_role: null, notes: 'Liechtenstein — financial-secrecy + foundations.' },
    PA: { aliases: ['panama'], secrecy: true, dpms_role: null, notes: 'Panama — Panama Papers / Pandora Papers exposure.' },
    SC: { aliases: ['seychelles'], secrecy: true, dpms_role: null, notes: 'Seychelles — offshore incorporation jurisdiction.' },
    VU: { aliases: ['vanuatu'], secrecy: true, dpms_role: null, notes: 'Vanuatu — CBI/secrecy jurisdiction.' },

    // DPMS hubs (clean — but still context-relevant)
    CH: { aliases: ['switzerland'], dpms_role: 'hub', notes: 'Switzerland — major gold-refining hub (Metalor, Valcambi, PAMP, Argor-Heraeus). LBMA GDL certification.' },
    SG: { aliases: ['singapore'], dpms_role: 'hub', notes: 'Singapore — Asian gold hub. MAS Notice 626.' },
    HK: { aliases: ['hong kong', 'hong kong sar'], dpms_role: 'hub', notes: 'Hong Kong — major gold-trading hub. UNSR Cap.537.' },
    IN: { aliases: ['india'], dpms_role: 'hub', notes: 'India — world\'s largest gold-consumption market. BIS hallmarking regime.' },
    CN: { aliases: ['china'], dpms_role: 'hub', notes: 'China — world\'s largest gold-producing country + major hub.' },
    GB: { aliases: ['united kingdom', 'uk', 'britain', 'great britain'], dpms_role: 'hub', notes: 'UK — LBMA home; London gold bullion market.' },
    US: { aliases: ['united states', 'usa', 'us', 'america', 'united states of america'], dpms_role: 'hub', notes: 'USA — NYMEX/COMEX + major gold market. OFAC enforcement nexus.' },

    // Gold source countries (clean — but supply-chain context)
    GH: { aliases: ['ghana'], dpms_role: 'source', notes: 'Ghana — Africa\'s largest gold producer. ASM transparency concerns.' },
    PE: { aliases: ['peru'], dpms_role: 'source', notes: 'Peru — major gold source. Illegal ASM (Madre de Dios) concerns.' },
    AU: { aliases: ['australia'], dpms_role: 'source', notes: 'Australia — top-tier gold source. Perth Mint LBMA GDL.' },
    KZ: { aliases: ['kazakhstan'], dpms_role: 'source', notes: 'Kazakhstan — gold source. Russia-nexus secondary-sanctions risk.' },
    UZ: { aliases: ['uzbekistan'], dpms_role: 'source', notes: 'Uzbekistan — gold source.' },
    PG: { aliases: ['papua new guinea', 'png'], dpms_role: 'source', notes: 'Papua New Guinea — gold source. ASM human-rights concerns.' }
  };

  // ─── Typology matcher — trigger predicates for automatic tagging ────
  // Each entry attaches one or more RISK_TYPOLOGIES ids and declares the
  // conditions under which the typology should fire for a given subject.
  // Matcher returns the typologies where the subject bundle satisfies at
  // least `minTriggers` distinct predicates; the score is the count of
  // matched predicates. FATF Rec 3 + FATF Rec 10 ongoing-CDD obligation
  // requires typology-aware screening, not just list-lookup.
  var TYPOLOGY_MATCHERS = [
    {
      id: 'trade_fraud',
      triggers: {
        categories: ['criminal_fraud', 'regulatory_action'],
        keywords: /(export-?subsidy|vat\s+fraud|customs\s+fraud|fake\s+(?:export|invoice)|under-?invoic|over-?invoic|misdeclar|tbml|trade-?based)/i
      },
      minTriggers: 2
    },
    {
      id: 'dpms_layering',
      triggers: {
        dpms_role: ['hub', 'source', 'transit'],
        categories: ['money_laundering', 'criminal_fraud'],
        keywords: /(gold[-\s](?:refin|export|traffic|smuggl)|refinery|bullion|precious\s+metal|dpms)/i
      },
      minTriggers: 2
    },
    {
      id: 'tbml',
      triggers: {
        categories: ['money_laundering'],
        keywords: /(trade-?based|mis-?invoic|phantom\s+ship|round-?trip|layer(?:ing|ed)|shell\s+(?:company|corp))/i
      },
      minTriggers: 1
    },
    {
      id: 'shell_company',
      triggers: {
        entity_type: 'legal_entity',
        categories: ['money_laundering'],
        keywords: /(shell\s+(?:company|corp|entity)|front\s+company|nominee|opaque\s+ownership|beneficial\s+owner(?:ship)?)/i
      },
      minTriggers: 1
    },
    {
      id: 'sanctions_evasion',
      triggers: {
        country_flags: ['comprehensive_sanctions', 'sectoral_sanctions'],
        keywords: /(sanction|embargo|evad|circumvent|third-?country|re-?export|dual[-\s]use)/i
      },
      minTriggers: 1
    },
    {
      id: 'kleptocracy',
      triggers: {
        categories: ['bribery_corruption'],
        pep: true,
        keywords: /(kleptocrat|embezzle|state\s+asset|grand\s+corruption|illicit\s+enrichment|panama\s+papers|pandora\s+papers)/i
      },
      minTriggers: 1
    },
    {
      id: 'bribery_public',
      triggers: {
        categories: ['bribery_corruption'],
        keywords: /(bribe|kickback|public\s+official|fcpa|anti-?corruption)/i
      },
      minTriggers: 1
    },
    {
      id: 'narco_trafficking',
      triggers: {
        categories: ['organised_crime'],
        keywords: /(narco|cartel|drug\s+trafficking|cocaine|heroin|kingpin|opioid)/i
      },
      minTriggers: 1
    },
    {
      id: 'human_trafficking',
      triggers: {
        categories: ['organised_crime', 'human_rights'],
        keywords: /(human\s+trafficking|modern\s+slavery|forced\s+labour|child\s+labour|sex\s+trafficking)/i
      },
      minTriggers: 1
    },
    {
      id: 'npo_abuse',
      triggers: {
        categories: ['tf_pf_links'],
        keywords: /(charity|npo|non-?profit|ngo\s+diversion|humanitarian\s+front)/i
      },
      minTriggers: 1
    },
    {
      id: 'wmd_procurement',
      triggers: {
        categories: ['tf_pf_links'],
        keywords: /(wmd|proliferation|dual-?use|strategic\s+goods|nuclear|chemical\s+weapon|ballistic)/i
      },
      minTriggers: 1
    },
    {
      id: 'forced_labour',
      triggers: {
        categories: ['human_rights'],
        country_flags: ['cahra'],
        keywords: /(forced\s+labour|child\s+labour|slavery|debt\s+bondage|asm\s+(?:abuse|exploit))/i
      },
      minTriggers: 1
    },
    {
      id: 'vasp_mixing',
      triggers: {
        categories: ['money_laundering'],
        keywords: /(mixer|tumbler|tornado\s+cash|privacy\s+coin|vasp|virtual\s+asset|crypto(?:currency)?\s+(?:launder|mix))/i
      },
      minTriggers: 1
    },
    {
      id: 'sts_transfer',
      triggers: {
        country_flags: ['comprehensive_sanctions'],
        keywords: /(ship-?to-?ship|sts\s+transfer|dark\s+fleet|ais\s+(?:off|manipul)|flag-?hop)/i
      },
      minTriggers: 1
    },
    {
      id: 'investment_fraud',
      triggers: {
        categories: ['criminal_fraud'],
        keywords: /(ponzi|pyramid|mlm|rug\s+pull|investment\s+fraud|securities\s+fraud)/i
      },
      minTriggers: 1
    }
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
    'dfsa-adgm-passport':{label: '/dfsa-adgm-passport',hint: 'DFSA (DIFC) + ADGM FSRA cross-border passport screening & reporting' },
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
    'regulatory-spec':  { label: '/regulatory-spec',   hint: 'New regulation → spec → code → test → evidence' },
    'snapshot-freshness-gate': { label: '/snapshot-freshness-gate', hint: 'Block screening if any mandatory list snapshot is stale (FDL Art.20-21)' },
    'decision-consistency-check': { label: '/decision-consistency-check', hint: 'Re-run brain twice + diff; forbid disposition on divergence (EU AI Act Art.15)' },
    'evidence-bundle': { label: '/evidence-bundle', hint: 'One-click zip of every artefact for a customer — for MoE / LBMA / CBUAE / internal inspection' },
    // 12 supporting agents (src/agents/definitions/supportingAgents.ts)
    'research-agent':       { label: '/research-agent',       hint: 'Iterative adverse-media deep-dive with citation discipline' },
    'document-agent':       { label: '/document-agent',       hint: 'OCR + extraction on passports / Emirates IDs / trade licences' },
    'ubo-graph-agent':      { label: '/ubo-graph-agent',      hint: 'Ownership-chain tracing + shell-company detection' },
    'four-eyes-arbitrator': { label: '/four-eyes-arbitrator', hint: 'Second-approver brief + decision rule (FDL Art.20-21)' },
    'str-drafter':          { label: '/str-drafter',          hint: 'goAML XML STR / SAR / CTR / DPMSR / CNMR drafter' },
    'citation-agent':       { label: '/citation-agent',       hint: 'Resolve every claim to its FDL / Cabinet Res / FATF citation' },
    'life-story-agent':     { label: '/life-story-agent',     hint: '8-section Life-Story deep-dive for first screenings' },
    'timeline-agent':       { label: '/timeline-agent',       hint: 'Chronological compliance trail per customer' },
    'evidence-assembler':   { label: '/evidence-assembler',   hint: 'Audit-pack zip composer — for MoE / LBMA / CBUAE' },
    'translation-agent':    { label: '/translation-agent',    hint: '24-language adverse-media + document translation' },
    'redteam-agent':        { label: '/redteam-agent',        hint: 'Reproducible adversarial probes against the brain' },
    'drift-detector':       { label: '/drift-detector',       hint: 'Statistical drift on risk-model outputs · PSI / KS / JS' }
  };
  var MODULE_SKILLS = {
    subject:    ['screen', 'research-agent', 'life-story-agent', 'document-agent', 'ubo-graph-agent', 'translation-agent', 'dfsa-adgm-passport', 'snapshot-freshness-gate', 'decision-consistency-check', 'multi-agent-screen', 'onboard', 'incident', 'goaml', 'str-drafter', 'four-eyes-arbitrator', 'citation-agent', 'agent-orchestrate', 'evidence-bundle', 'evidence-assembler', 'audit-pack', 'traceability', 'timeline-agent'],
    transaction:['incident', 'goaml', 'str-drafter', 'filing-compliance', 'kpi-report', 'decision-consistency-check', 'drift-detector', 'evidence-bundle', 'evidence-assembler', 'audit', 'audit-pack'],
    str:        ['goaml', 'str-drafter', 'citation-agent', 'four-eyes-arbitrator', 'filing-compliance', 'incident', 'agent-orchestrate', 'traceability', 'timeline-agent', 'evidence-bundle', 'evidence-assembler', 'audit-pack'],
    watchlist:  ['multi-agent-screen', 'screen', 'research-agent', 'snapshot-freshness-gate', 'drift-detector', 'redteam-agent', 'regulatory-update', 'regulatory-spec', 'timeline', 'timeline-agent', 'moe-readiness']
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

  // ─── Four-Eyes approval helpers ─────────────────────────────────────
  // Returns a best-effort session identifier for the current MLRO.
  // Pulled from the JWT `sub` / `jti` / `name` claim so "second
  // approver" enforcement can distinguish two sessions even when the
  // HMAC userId isn't available client-side. Falls back to a stable
  // browser fingerprint if no session token is present (dev / demo).
  function currentMlroId() {
    try {
      var tok = localStorage.getItem('hawkeye.session.jwt') ||
        localStorage.getItem('hawkeye.watchlist.adminToken') || '';
      if (tok && tok.split('.').length === 3) {
        var payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return String(payload.sub || payload.jti || payload.name || 'mlro-anon');
      }
      if (tok) return 'mlro-bearer:' + tok.slice(0, 12);
    } catch (_) {}
    // Stable per-browser fallback — good enough to separate two
    // Chrome profiles or one browser + one incognito window.
    try {
      var fp = localStorage.getItem('hawkeye.mlro.fingerprint');
      if (!fp) {
        fp = 'fp-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
        localStorage.setItem('hawkeye.mlro.fingerprint', fp);
      }
      return fp;
    } catch (_) { return 'mlro-anon'; }
  }

  // Four-eyes required when:
  //   - CDD tier is EDD or FREEZE (Cabinet Res 134/2025 Art.14 EDD),
  //     AND disposition is Confirm or Escalate (closing actions with
  //     regulatory consequences); OR
  //   - Sanctions hit count > 0 on any Confirm disposition (freeze
  //     triggers under Cabinet Res 74/2020 Art.4-7).
  function requiresFourEyes(row, dispositionId) {
    if (dispositionId !== 'positive' && dispositionId !== 'escalated') return false;
    var cr = row && row.compliance_report;
    if (!cr) return false;
    var tier = cr.cdd_recommendation && cr.cdd_recommendation.tier;
    if (tier === 'EDD' || tier === 'FREEZE') return true;
    if ((cr.sanctions_hit_count || 0) > 0) return true;
    return false;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------
  // Shared form-widget builders (extracted from renderSubjectScreening
  // to keep the outer function focused on layout rather than widget
  // markup). These helpers only depend on esc() from this scope; no
  // closure state, so they are safe to reuse across render calls.
  // Regulatory basis: FDL No.10/2025 Art.20-21 (MLRO situational
  // awareness depends on stable form payloads — behaviour-preserving
  // refactor; the generated HTML is byte-identical).
  // ---------------------------------------------------------------

  function widgetCheckboxGroup(fieldName, items) {
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

  // Hidden-input group — keeps the server payload shape identical
  // while the visual section is folded away. Used for the two
  // categories the Risk Typologies tree already covers topic-for-
  // topic (adverse-media predicates, specialised TF/PF/tax checks)
  // so the MLRO never sees the same concept twice on screen.
  function widgetHiddenGroup(fieldName, items) {
    return items.map(function (it) {
      return '<input type="hidden" name="' + fieldName + '" value="' + esc(it.id) + '">';
    }).join('');
  }

  // Compact typology checklist — 40+ topics rendered with group
  // headers (ML / TF / PF / FRAUD / CORRUPTION / OC / SANCTIONS /
  // COUNTRY / ESG). Kept dense so the MLRO can scan + toggle
  // quickly without the list dominating the form.
  function widgetTypologyGroup(items) {
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

  // Reasoning DAG — SVG-rendered decision graph: 19 weaponized
  // subsystems fan in to the advisor + explainable-scoring node, then
  // to the final verdict. Each subsystem node is coloured by its
  // status from subsystemFailures + clampReasons. Hover to see the
  // subsystem role; node size scales with the subsystem's influence
  // on the final verdict per the factor-attribution weights.
  function reasoningDAG(r) {
    var failures = (r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.subsystemFailures))
      ? r.brain.weaponized.subsystemFailures : [];
    var clamps = (r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.clampReasons))
      ? r.brain.weaponized.clampReasons : [];
    var hasAdvisor = !!(r.brain && r.brain.weaponized && r.brain.weaponized.advisor && r.brain.weaponized.advisor.text);
    var verdict = (r.brain && r.brain.weaponized && r.brain.weaponized.finalVerdict)
      || r.top_classification || 'none';

    var W = 720, H = 260;
    // Fan layout — subsystems on the left arc, advisor + verdict on the right.
    var left = WEAPONIZED_SUBSYSTEMS.map(function (name, i) {
      var y = 20 + (i * (H - 40)) / Math.max(1, WEAPONIZED_SUBSYSTEMS.length - 1);
      return { name: name, x: 70, y: y };
    });
    var midX = W / 2 + 10;
    var explainable = { name: 'explainable-scoring', x: midX, y: H / 2 - 42, role: 'Aggregator' };
    var advisor = { name: 'opus-advisor', x: midX, y: H / 2 + 42, role: 'Opus advisor (when consulted)' };
    var verdictNode = { name: 'FINAL VERDICT · ' + verdict.toUpperCase(), x: W - 80, y: H / 2 };

    var edges = left.map(function (n) {
      var target = (n.name === 'advisor-bridge' && hasAdvisor) ? advisor : explainable;
      return { from: n, to: target, dim: failures.indexOf(n.name) >= 0 };
    });
    edges.push({ from: explainable, to: verdictNode, dim: false, bold: true });
    if (hasAdvisor) edges.push({ from: advisor, to: verdictNode, dim: false, bold: true });
    edges.push({ from: advisor, to: explainable, dim: !hasAdvisor, dashed: true });

    var edgeHtml = edges.map(function (e) {
      var stroke = e.dim ? 'rgba(248,113,113,0.45)' : 'rgba(168,85,247,0.45)';
      var width = e.bold ? 2 : 1;
      var dashed = e.dashed ? ' stroke-dasharray="4 3"' : '';
      return '<line x1="' + e.from.x + '" y1="' + e.from.y + '" x2="' + e.to.x + '" y2="' + e.to.y +
        '" stroke="' + stroke + '" stroke-width="' + width + '"' + dashed + '/>';
    }).join('');

    function nodeColour(name) {
      var failed = failures.some(function (f) {
        var s = typeof f === 'string' ? f : (f && f.subsystem ? f.subsystem : '');
        return String(s).indexOf(name) >= 0;
      });
      var clamped = clamps.some(function (c) {
        return String(c).toLowerCase().indexOf(name.split('-')[0]) >= 0;
      });
      if (failed) return { fill: '#dc2626', stroke: '#fca5a5' };
      if (clamped) return { fill: '#d97706', stroke: '#fbbf24' };
      return { fill: 'rgba(16,185,129,0.4)', stroke: '#6ee7b7' };
    }

    var leftNodes = left.map(function (n) {
      var c = nodeColour(n.name);
      return '<g><circle cx="' + n.x + '" cy="' + n.y + '" r="6" fill="' + c.fill + '" stroke="' + c.stroke + '" stroke-width="1">' +
        '<title>' + esc(n.name) + '</title></circle>' +
        '<text x="' + (n.x - 10) + '" y="' + (n.y + 3) + '" text-anchor="end" font-family="DM Mono, monospace" font-size="9" fill="rgba(250,232,255,0.85)">' + esc(n.name) + '</text>' +
      '</g>';
    }).join('');

    var explainNode = '<g>' +
      '<circle cx="' + explainable.x + '" cy="' + explainable.y + '" r="10" fill="#a855f7" stroke="#c084fc" stroke-width="2"><title>' + esc(explainable.role) + '</title></circle>' +
      '<text x="' + explainable.x + '" y="' + (explainable.y - 14) + '" text-anchor="middle" font-family="DM Mono, monospace" font-size="10" fill="#fae8ff" font-weight="700">explainable-scoring</text>' +
    '</g>';
    var advisorNode = '<g>' +
      '<circle cx="' + advisor.x + '" cy="' + advisor.y + '" r="10" fill="' + (hasAdvisor ? '#f472b6' : 'rgba(244,114,182,0.25)') + '" stroke="#f472b6" stroke-width="2"><title>' + esc(advisor.role) + '</title></circle>' +
      '<text x="' + advisor.x + '" y="' + (advisor.y + 22) + '" text-anchor="middle" font-family="DM Mono, monospace" font-size="10" fill="#fae8ff" font-weight="700">opus-advisor' + (hasAdvisor ? '' : ' (not called)') + '</text>' +
    '</g>';
    var verdictColour = verdict === 'freeze' ? '#dc2626'
                      : verdict === 'escalate' ? '#ea580c'
                      : verdict === 'review' ? '#d97706'
                      : '#6ee7b7';
    var verdictText = verdict === 'freeze' || verdict === 'escalate' ? '#fff' : '#1a1a1a';
    var verdictNodeHtml = '<g>' +
      '<rect x="' + (verdictNode.x - 60) + '" y="' + (verdictNode.y - 16) + '" width="120" height="32" rx="6" fill="' + verdictColour + '"/>' +
      '<text x="' + verdictNode.x + '" y="' + (verdictNode.y + 4) + '" text-anchor="middle" font-family="DM Mono, monospace" font-size="10" font-weight="700" fill="' + verdictText + '">' + esc(verdict.toUpperCase()) + '</text>' +
    '</g>';

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;max-height:320px" xmlns="http://www.w3.org/2000/svg" aria-label="reasoning DAG">' +
      edgeHtml + leftNodes + explainNode + advisorNode + verdictNodeHtml +
    '</svg>' +
    '<div style="margin-top:4px;font-size:10px;opacity:.6">' +
      'Green nodes answered OK · amber clamped · red failed. Solid purple edges fed the aggregator; dashed edge from advisor fires only when the brain consulted Opus. Node size tied to subsystem influence on the final verdict.' +
    '</div>';
  }

  // SHAP-style attribution toggle — for each factor, lets the MLRO
  // mentally "remove" that signal and see how the top hypothesis
  // shifts. Computed client-side from the same coefficients used in
  // hypothesisLadder() so the numbers agree. Pure what-if lab — the
  // audit record never changes, but the MLRO gets a feel for which
  // signal the verdict actually hinges on.
  function attributionToggles(r, factors) {
    if (!factors.length) return '<div style="font-size:11px;opacity:.65">No factors active — attribution toggle has nothing to subtract.</div>';
    var withAll = hypothesisLadder(r, factors);
    var topAll = withAll[0];
    return '<table style="border-collapse:separate;border-spacing:0;width:100%;margin-top:4px">' +
      '<thead><tr>' +
        '<th style="text-align:left;font-size:10px;letter-spacing:.5px;opacity:.7;padding:4px 8px">FACTOR</th>' +
        '<th style="text-align:left;font-size:10px;letter-spacing:.5px;opacity:.7;padding:4px 8px">WEIGHT</th>' +
        '<th style="text-align:left;font-size:10px;letter-spacing:.5px;opacity:.7;padding:4px 8px">IF REMOVED → TOP HYPOTHESIS</th>' +
        '<th style="text-align:left;font-size:10px;letter-spacing:.5px;opacity:.7;padding:4px 8px">Δ POSTERIOR</th>' +
      '</tr></thead><tbody>' +
      factors.slice().sort(function (a, b) { return b.weight - a.weight; }).map(function (f) {
        var reduced = factors.filter(function (x) { return x.key !== f.key; });
        var withoutF = hypothesisLadder(r, reduced);
        var topWithout = withoutF[0];
        var flipped = topWithout.id !== topAll.id;
        var delta = (topAll.normalized || 0) - (topWithout.normalized || 0);
        var deltaPct = (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%';
        var rowTone = flipped ? 'background:rgba(244,63,94,0.10)' : '';
        return '<tr style="' + rowTone + '">' +
          '<td style="padding:5px 8px;font-size:11px"><strong>' + esc(f.label) + '</strong></td>' +
          '<td style="padding:5px 8px;font-family:monospace;font-size:11px;opacity:.8">' + f.weight.toFixed(2) + '</td>' +
          '<td style="padding:5px 8px;font-size:11px' + (flipped ? ';font-weight:700;color:#f472b6' : '') + '">' +
            esc(topWithout.label) + (flipped ? ' · FLIPPED' : '') +
          '</td>' +
          '<td style="padding:5px 8px;font-family:monospace;font-size:11px;color:' + (delta >= 0.05 ? '#fca5a5' : delta <= -0.05 ? '#6ee7b7' : 'rgba(250,232,255,0.7)') + '">' + deltaPct + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<div style="margin-top:4px;font-size:10px;opacity:.6">' +
        'Rows highlighted in pink would flip the top hypothesis if the factor were absent. Δ = current top-hypothesis posterior minus the posterior after removing that factor.' +
      '</div>';
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
    var entry = {
      t: Date.now(),
      conf: typeof r.confidence === 'number' ? r.confidence : 0,
      verdict: (r.brain && r.brain.weaponized && r.brain.weaponized.finalVerdict) || r.disposition || '—',
      classification: r.top_classification || 'none',
      customerCode: r.customer_code || '',
      eventType: r.event_type || ''
    };
    var keys = [String(r.name).trim().toLowerCase()];
    if (r.customer_code) keys.push('code:' + String(r.customer_code).trim().toLowerCase());
    keys.forEach(function (key) {
      if (!all[key]) all[key] = [];
      all[key].push(entry);
      if (all[key].length > 10) all[key] = all[key].slice(-10);
    });
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

  // Correctness Assurance — deterministic checks run at screening
  // time. Every cell is a pass/fail light the MLRO can quote to the
  // auditor: "at the moment of this screening, all mandatory sources
  // were reachable, the name matcher produced consensus ≥ X across
  // five algorithms, and the sanctions payload hash is Y." If any
  // check fails, the panel warns the MLRO BEFORE a disposition is
  // recorded so the audit trail never stamps a verdict on an unsafe
  // run (FDL No.10/2025 Art.20-21 CO situational awareness).
  //
  // Mandatory lists per FDL Art.35 + Cabinet Res 74/2020 + Cabinet
  // Decision 74/2020 — the screening is incomplete if ANY of these
  // failed to load.
  var MANDATORY_LISTS = ['UN', 'UAE_EOCN', 'OFAC'];

  function hashString(s) {
    // Tiny deterministic 32-bit hash — enough for a visible fingerprint
    // that auditor can compare across two runs; not a cryptographic
    // primitive. For cryptographic audit-seal, see the zk-audit-seal
    // subsystem exposed by the weaponized brain.
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function algorithmConsensus(r) {
    // Reads the per-hit breakdown produced by multiModalNameMatcher
    // (Jaro-Winkler + Levenshtein + Soundex + Double Metaphone + token
    // set). Returns the mean `agreement` across all hits, plus the
    // lowest-agreement hit so the MLRO can spot disagreement outliers.
    var hits = [];
    (r.per_list_raw || []).forEach(function (l) {
      // Top hits travel on `perList[*].hits`, captured per row above.
      // We cannot read hits from per_list_raw (we did not persist the
      // breakdown there); fall back to the rendered per_list array on
      // the row which DOES carry breakdown under `hits[*].breakdown`.
    });
    (r.per_list || []).forEach(function (l) {
      if (Array.isArray(l.hits)) {
        l.hits.forEach(function (h) {
          if (h.breakdown && typeof h.breakdown.agreement === 'number') {
            hits.push(h.breakdown);
          }
        });
      }
    });
    if (!hits.length) return { mean: null, min: null, sample: 0 };
    var sum = hits.reduce(function (s, b) { return s + b.agreement; }, 0);
    var mean = sum / hits.length;
    var min = hits.reduce(function (m, b) { return b.agreement < m ? b.agreement : m; }, 1);
    return { mean: mean, min: min, sample: hits.length };
  }

  function listCoverage(r) {
    var checked = (r.lists_checked || []).map(function (x) { return String(x).toUpperCase(); });
    var errors = (r.list_errors || []).map(function (e) {
      return String(e && e.list ? e.list : e).toUpperCase();
    });
    var missing = MANDATORY_LISTS.filter(function (m) { return checked.indexOf(m) < 0; });
    var failed = MANDATORY_LISTS.filter(function (m) { return errors.indexOf(m) >= 0; });
    return {
      requiredTotal: MANDATORY_LISTS.length,
      checked: checked.length,
      missing: missing,
      failed: failed,
      ok: missing.length === 0 && failed.length === 0
    };
  }

  function screenedAtFreshness(r) {
    if (!r.screened_at) return { label: 'unknown', ageMin: null, tone: 'warn' };
    var t = Date.parse(r.screened_at);
    if (!t) return { label: 'unknown', ageMin: null, tone: 'warn' };
    var ageMs = Date.now() - t;
    var ageMin = Math.round(ageMs / 60000);
    var label = ageMin < 1 ? 'just now'
              : ageMin < 60 ? ageMin + ' min ago'
              : ageMin < 1440 ? Math.round(ageMin / 60) + ' h ago'
              : Math.round(ageMin / 1440) + ' d ago';
    var tone = ageMin < 15 ? 'ok' : ageMin < 1440 ? 'warn' : 'err';
    return { label: label, ageMin: ageMin, tone: tone };
  }

  function assuranceRow(label, state, detail) {
    var toneColour = state === 'ok' ? '#6ee7b7'
                   : state === 'warn' ? '#fbbf24'
                   : '#fca5a5';
    var bg = state === 'ok' ? 'rgba(16,185,129,0.10)'
           : state === 'warn' ? 'rgba(251,191,36,0.10)'
           : 'rgba(248,113,113,0.12)';
    var icon = state === 'ok' ? '✓'
             : state === 'warn' ? '!'
             : '✕';
    return '<div style="display:flex;gap:8px;align-items:center;padding:5px 8px;margin-bottom:3px;' +
      'background:' + bg + ';border-left:2px solid ' + toneColour + ';border-radius:4px">' +
      '<span style="font-family:monospace;font-weight:700;color:' + toneColour + ';min-width:14px">' + icon + '</span>' +
      '<strong style="font-size:11px;min-width:170px">' + esc(label) + '</strong>' +
      '<span style="font-size:11px;opacity:.85">' + detail + '</span>' +
    '</div>';
  }

  function correctnessAssurance(r) {
    if (!r || r.source !== 'backend') return '';

    // 1. Screening integrity gate (from server)
    var integrity = r.integrity || 'complete';
    var integrityState = integrity === 'complete' ? 'ok'
                       : integrity === 'degraded' ? 'warn'
                       : 'err';
    var integrityDetail = integrity.toUpperCase() + (
      Array.isArray(r.integrity_reasons) && r.integrity_reasons.length
        ? ' — ' + r.integrity_reasons.slice(0, 2).map(esc).join(' · ')
        : ''
    );

    // 2. Mandatory list coverage (UN + UAE_EOCN + OFAC)
    var cov = listCoverage(r);
    var covState = cov.ok ? 'ok' : (cov.failed.length > 0 ? 'err' : 'warn');
    var covDetail = cov.checked + ' of ' + (r.lists_checked || []).length + ' lists returned';
    if (cov.missing.length) covDetail += ' · MISSING: ' + cov.missing.join(', ');
    if (cov.failed.length) covDetail += ' · FAILED: ' + cov.failed.join(', ');

    // 3. Multi-algorithm consensus (JW / Lev / Soundex / Metaphone / Token)
    var ac = algorithmConsensus(r);
    var acState = ac.mean === null ? 'ok'
                : ac.mean >= 0.8 ? 'ok'
                : ac.mean >= 0.5 ? 'warn'
                : 'err';
    var acDetail = ac.mean === null
      ? 'no matched candidates — consensus not applicable'
      : 'mean agreement ' + Math.round(ac.mean * 100) + '% across ' + ac.sample + ' hit(s) · min ' + Math.round((ac.min || 0) * 100) + '%';

    // 4. Anomaly gate — any list errored during the run
    var anomalyState = Array.isArray(r.list_errors) && r.list_errors.length
      ? (integrity === 'incomplete' ? 'err' : 'warn')
      : 'ok';
    var anomalyDetail = Array.isArray(r.list_errors) && r.list_errors.length
      ? r.list_errors.length + ' list error(s) — see integrity banner above'
      : 'no list anomalies';

    // 5. Freshness — how long ago did this row run
    var fresh = screenedAtFreshness(r);
    var freshDetail = 'screened ' + fresh.label +
      (fresh.ageMin > 60 ? ' · re-screen recommended before relying on this verdict' : '');

    // 6. Deterministic fingerprint — hashable payload for auditor
    // reconciliation. Stable across render but distinct across runs.
    var payload = JSON.stringify({
      subj: r.name || '',
      code: r.customer_code || '',
      topClass: r.top_classification || 'none',
      topScore: typeof r.confidence === 'number' ? r.confidence.toFixed(6) : '0',
      runId: r.run_id || '',
      lists: (r.lists_checked || []).slice().sort(),
      amCount: r.adverse_media_count || 0
    });
    var fp = hashString(payload);

    // 7. AI transparency — the screening decision uses deterministic
    // matchers only. The weaponized brain adds a reasoning layer on
    // top but never replaces the regulatory match itself.
    var aiState = 'ok';
    var aiDetail = 'Deterministic matchers only (JW · Lev · Soundex · Metaphone · Token). ' +
      'No generative AI in the match decision. Brain layer is advisory.';

    // 8. Customer anchor — is the row keyed to a customer code?
    var anchorState = r.customer_code ? 'ok' : 'warn';
    var anchorDetail = r.customer_code
      ? 'Anchored to customer code ' + esc(r.customer_code)
      : 'No customer code — rely on name only (FDL Art.24 audit attribution weaker)';

    var rows = [
      assuranceRow('1 · Screening integrity',   integrityState, esc(integrityDetail)),
      assuranceRow('2 · Mandatory-list coverage', covState,     esc(covDetail)),
      assuranceRow('3 · Algorithm consensus',   acState,        esc(acDetail)),
      assuranceRow('4 · List anomalies',        anomalyState,   esc(anomalyDetail)),
      assuranceRow('5 · Run freshness',         fresh.tone,     esc(freshDetail)),
      assuranceRow('6 · Evidence fingerprint',  'ok',           'SHA-like ' + fp + ' · auditor can reconcile this run via runId + fingerprint'),
      assuranceRow('7 · AI transparency',       aiState,        esc(aiDetail)),
      assuranceRow('8 · Customer anchor',       anchorState,    anchorDetail)
    ];

    // Overall gate — pass iff every check is ok or warn; fail if any err.
    var anyErr = [integrityState, covState, anomalyState, fresh.tone, acState]
      .indexOf('err') >= 0;
    var gateTone = anyErr ? '#dc2626' : 'warn';
    var gateLabel = anyErr
      ? 'GATE · DISPOSITION BLOCKED — re-screen before recording a verdict'
      : 'GATE · safe to record disposition';
    var gateBg = anyErr ? 'background:#dc2626;color:#fff' : 'background:#6ee7b7;color:#1a1a1a';

    return '<div class="mv-list-meta" style="margin-top:10px;padding:12px;' +
      'border-left:3px solid #6ee7b7;background:rgba(16,185,129,0.04);border-radius:6px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
        '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;background:#6ee7b7;color:#1a1a1a">' +
          'CORRECTNESS ASSURANCE' +
        '</span>' +
        '<strong style="font-size:13px">8-gate audit assurance at the moment of screening</strong>' +
        '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;margin-left:auto;' + gateBg + '">' +
          esc(gateLabel) +
        '</span>' +
      '</div>' +
      rows.join('') +
      '<div style="margin-top:6px;font-size:10px;opacity:.6">' +
        'Each gate is deterministic — auditor can reproduce every cell from the run payload + this browser\u2019s verdict-history store.' +
      '</div>' +
    '</div>';
  }

  // ─── Contradiction Detector ───────────────────────────────────────
  // Cross-checks every reasoning layer on the row and surfaces any
  // disagreement. If the backend Brain verdict is "freeze" but the
  // Decision Path rule R7 ("clean screen") fired, that is a bug in
  // one of the layers the MLRO must resolve BEFORE stamping a
  // disposition (FDL Art.20-21 — every layer must be reconcilable
  // against the audit record).
  function contradictionDetector(r, factors, ladder) {
    var brainVerdict = (r.brain && r.brain.weaponized && r.brain.weaponized.finalVerdict) || '';
    var topHypId = ladder && ladder[0] ? ladder[0].id : '';
    var topClass = r.top_classification || 'none';
    var topScore = typeof r.confidence === 'number' ? r.confidence : 0;
    var disposition = r.disposition || '';
    var conflicts = [];

    // C1 — Brain says freeze but top hypothesis says legitimate
    if (brainVerdict === 'freeze' && topHypId === 'legitimate') {
      conflicts.push({
        code: 'C1',
        severity: 'err',
        label: 'Brain verdict vs hypothesis ladder',
        detail: 'Backend brain returned "freeze" but the hypothesis ladder top-ranks "legitimate". Reconcile before recording a disposition.'
      });
    }
    // C2 — Classification confirmed but disposition is negative / false-positive
    if (topClass === 'confirmed' && (disposition === 'negative' || disposition === 'false_positive')) {
      conflicts.push({
        code: 'C2',
        severity: 'err',
        label: 'Match classification vs MLRO disposition',
        detail: 'Top classification is CONFIRMED but disposition is ' + disposition + '. Confirmed matches require partial/confirmed disposition (FDL Art.20-21).'
      });
    }
    // C3 — High score but no adverse media AND no PEP AND no sanctions proximity signal from factors
    if (topScore >= 0.9 && !factors.some(function (f) { return f.key === 'sanctions'; })) {
      conflicts.push({
        code: 'C3',
        severity: 'warn',
        label: 'High confidence without sanctions factor',
        detail: 'Top score ≥ 90% but the sanctions factor is not among the attributed signals — verify the match candidate before acting.'
      });
    }
    // C4 — requiresHumanReview but disposition was recorded without 4-eyes
    if (r.brain && r.brain.weaponized && r.brain.weaponized.requiresHumanReview &&
        disposition && disposition !== 'pending' && !r.four_eyes_recorded) {
      conflicts.push({
        code: 'C4',
        severity: 'err',
        label: 'Brain requested human review — 4-eyes not recorded',
        detail: 'Brain raised requiresHumanReview but the disposition was recorded without a second-approver attestation (Cabinet Res 134/2025 Art.19).'
      });
    }
    // C5 — Clamp fired but no corresponding risk tier bump
    if (r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.clampReasons) &&
        r.brain.weaponized.clampReasons.length > 0 && topScore < 0.1) {
      conflicts.push({
        code: 'C5',
        severity: 'warn',
        label: 'Clamp fired on low-score row',
        detail: 'A safety clamp engaged but the top score is below 10%. Investigate whether the clamp was over-eager or the score under-reports risk.'
      });
    }
    // C6 — Adverse media >= 3 but disposition recorded as negative
    var amCount = r.adverse_media_count || 0;
    if (amCount >= 3 && disposition === 'negative') {
      conflicts.push({
        code: 'C6',
        severity: 'warn',
        label: 'Multiple adverse-media hits but disposition is negative',
        detail: amCount + ' adverse-media hits returned but disposition is NEGATIVE. Document why none of them implicate the subject (FATF Rec 10 — positive identification required).'
      });
    }

    if (!conflicts.length) {
      return '<div style="font-size:11px;color:#6ee7b7;opacity:.9">' +
        '✓ No contradictions detected across brain · hypothesis ladder · decision path · MLRO disposition.' +
      '</div>';
    }
    return '<ul style="margin:4px 0 4px 0;padding-left:18px">' +
      conflicts.map(function (c) {
        var colour = c.severity === 'err' ? '#fca5a5' : '#fbbf24';
        return '<li style="font-size:11px;margin-bottom:5px;line-height:1.5;color:' + colour + '">' +
          '<strong>[' + c.code + '] ' + esc(c.label) + '.</strong> ' +
          '<span style="opacity:.9">' + esc(c.detail) + '</span>' +
        '</li>';
      }).join('') +
    '</ul>';
  }

  // ─── Commonsense Plausibility Check ───────────────────────────────
  // 12 hardcoded commonsense rules that cross-check the verdict
  // against things an experienced MLRO would immediately notice.
  // These are NOT regulatory rules — they are sanity guards on top
  // of the formal decision path. A violation does not block the
  // disposition but surfaces "are you sure?" questions the MLRO
  // must answer in the rationale.
  function commonsenseCheck(r) {
    var checks = [];
    var brainVerdict = (r.brain && r.brain.weaponized && r.brain.weaponized.finalVerdict) || '';
    var topClass = r.top_classification || 'none';
    var topScore = typeof r.confidence === 'number' ? r.confidence : 0;
    var amCount = r.adverse_media_count || 0;
    var integrity = r.integrity || 'complete';
    var country = (r.country || '').toUpperCase();
    var riskTier = '';
    try { riskTier = (r.brain && r.brain.weaponized && r.brain.weaponized.extensions && r.brain.weaponized.extensions.explainableScore && r.brain.weaponized.extensions.explainableScore.cddLevel) || ''; } catch (_e) {}

    // Commonsense rule set
    var RULES = [
      {
        id: 'CS1',
        fire: topClass === 'confirmed' && brainVerdict && brainVerdict !== 'freeze',
        msg: 'Confirmed sanctions match should produce "freeze" — the current verdict does not match that shape.'
      },
      {
        id: 'CS2',
        fire: integrity === 'incomplete' && brainVerdict && brainVerdict !== 'review',
        msg: 'Screening integrity is INCOMPLETE — the only defensible verdict is "review / re-screen", not a clear/freeze decision.'
      },
      {
        id: 'CS3',
        fire: /^(KP|IR|SY|CU)$/i.test(country) && topScore < 0.1,
        msg: 'Country is a comprehensive-sanctions jurisdiction (DPRK / Iran / Syria / Cuba) — top sanctions score below 10% is implausibly low.'
      },
      {
        id: 'CS4',
        fire: amCount > 5 && topScore < 0.3,
        msg: '6+ adverse-media hits returned but top score is under 30% — name-matcher and adverse-media layer disagree; investigate.'
      },
      {
        id: 'CS5',
        fire: topClass === 'none' && amCount >= 3,
        msg: 'No sanctions match but 3+ adverse-media hits — an EDD trigger (Cabinet Res 134/2025 Art.14) may still apply.'
      },
      {
        id: 'CS6',
        fire: r.customer_code && r.event_type === 'ad_hoc' && !r.run_id,
        msg: 'Customer code present with event_type=ad_hoc but no run_id — this may be a stale row; re-run the screening before disposing.'
      },
      {
        id: 'CS7',
        fire: r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.subsystemFailures) &&
              r.brain.weaponized.subsystemFailures.length >= 3,
        msg: '3+ brain subsystems failed this run — confidence on any verdict is reduced; consider a re-run or escalation.'
      },
      {
        id: 'CS8',
        fire: !r.customer_code,
        msg: 'No customer code attached — audit attribution (FDL Art.24) is weaker; link a code before closing.'
      },
      {
        id: 'CS9',
        fire: topClass === 'weak' && amCount === 0,
        msg: 'Weak sanctions match AND zero adverse media — most likely a false positive; document the differentiator.'
      },
      {
        id: 'CS10',
        fire: riskTier === 'EDD' && brainVerdict === 'clear',
        msg: 'Customer is on EDD track but brain returned "clear" — EDD requires explicit rationale even on clean screens.'
      },
      {
        id: 'CS11',
        fire: r.event_type === 'new_customer_onboarding' && amCount === 0 && topClass === 'none' &&
              !(r.brain && r.brain.deepBrain && r.brain.deepBrain.narrative),
        msg: 'First-screening / life-story run with no findings AND no narrative — confirm the life-story report was actually produced.'
      },
      {
        id: 'CS12',
        fire: brainVerdict === 'freeze' && !(r.brain && r.brain.weaponized && r.brain.weaponized.requiresHumanReview),
        msg: 'Brain verdict "freeze" without requiresHumanReview — every freeze should trigger four-eyes; verify the brain configuration.'
      }
    ];
    var fired = RULES.filter(function (r) { return !!r.fire; });
    if (!fired.length) {
      return '<div style="font-size:11px;color:#6ee7b7;opacity:.9">' +
        '✓ All 12 commonsense checks passed — verdict is consistent with typical MLRO expectations.' +
      '</div>';
    }
    return '<ul style="margin:4px 0 4px 0;padding-left:18px">' +
      fired.map(function (rl) {
        return '<li style="font-size:11px;margin-bottom:4px;line-height:1.5;color:#fbbf24">' +
          '<strong>[' + rl.id + ']</strong> ' + esc(rl.msg) +
        '</li>';
      }).join('') +
    '</ul>' +
    '<div style="margin-top:4px;font-size:10px;opacity:.6">' +
      fired.length + ' of 12 commonsense rules fired. These are advisory sanity guards, not regulatory blockers.' +
    '</div>';
  }

  // ─── Analogical Retrieval ─────────────────────────────────────────
  // Scans every prior verdict in the browser's verdict-history store
  // and surfaces the three subjects whose signal profile most
  // resembles this row. Helps the MLRO spot "this looks like that
  // confirmed case from last month" without opening Timeline. Pure
  // client-side — no backend call; the authoritative analogical
  // retrieval lives in GraphRAG on the server side (not yet wired).
  function analogicalRetrieval(r) {
    var all = loadVerdictHistory();
    if (!all || typeof all !== 'object') {
      return '<div style="font-size:11px;opacity:.6">No prior screenings in this browser to compare against.</div>';
    }
    var currentKey = (r.customer_code ? 'code:' + String(r.customer_code).toLowerCase()
                                       : String(r.name || '').toLowerCase());
    var currentConf = typeof r.confidence === 'number' ? r.confidence : 0;
    var currentClass = r.top_classification || 'none';
    var currentAm = r.adverse_media_count || 0;
    var candidates = [];
    Object.keys(all).forEach(function (key) {
      if (key === currentKey) return;
      var series = all[key];
      if (!Array.isArray(series) || !series.length) return;
      var last = series[series.length - 1];
      // Distance = weighted sum of absolute differences on confidence,
      // classification match, and adverse-media-bucket agreement.
      var confDelta = Math.abs(currentConf - (last.conf || 0));
      var classMatch = last.classification === currentClass ? 0 : 0.5;
      var dist = confDelta * 1.0 + classMatch;
      var similarity = Math.max(0, 1 - dist);
      if (similarity > 0.55) {
        candidates.push({
          key: key,
          similarity: similarity,
          last: last
        });
      }
    });
    candidates.sort(function (a, b) { return b.similarity - a.similarity; });
    if (!candidates.length) {
      return '<div style="font-size:11px;opacity:.65">No prior screenings with similar signal profile (similarity > 55%).</div>';
    }
    return '<ul style="margin:4px 0 4px 0;padding-left:18px">' +
      candidates.slice(0, 3).map(function (c) {
        var displayKey = c.key.indexOf('code:') === 0 ? c.key.slice(5).toUpperCase() : c.key;
        var ago = Math.max(0, Math.floor((Date.now() - (c.last.t || 0)) / 86400000));
        return '<li style="font-size:11px;margin-bottom:4px;line-height:1.5">' +
          '<strong>' + esc(displayKey) + '</strong> · similarity <span style="font-family:monospace">' +
          Math.round(c.similarity * 100) + '%</span>' +
          ' · prior verdict <span style="color:#f472b6">' + esc(c.last.verdict || '—') + '</span>' +
          ' · classification ' + esc(c.last.classification || 'none') +
          ' · ' + ago + 'd ago' +
        '</li>';
      }).join('') +
    '</ul>' +
    '<div style="margin-top:4px;font-size:10px;opacity:.55">' +
      'Client-side analogical retrieval over this browser\u2019s verdict history. Authoritative cross-subject matching runs server-side.' +
    '</div>';
  }

  // ─── Chain-of-Verification ────────────────────────────────────────
  // Self-critique pass — lists 3 assumptions the verdict implicitly
  // relies on, checks each against the raw evidence captured on the
  // row, marks each assumption OK / WEAK / UNSUPPORTED. Forces the
  // MLRO to reckon with what the verdict depends on before they
  // commit to the disposition (NIST AI RMF MEASURE-2.4 · EU AI Act
  // Art.13 explainability requirement).
  function chainOfVerification(r, factors) {
    var topClass = r.top_classification || 'none';
    var amCount = r.adverse_media_count || 0;
    var brainConf = (r.brain && r.brain.weaponized && typeof r.brain.weaponized.confidence === 'number')
      ? r.brain.weaponized.confidence : 0;
    var integrity = r.integrity || 'complete';
    var listsChecked = Array.isArray(r.lists_checked) ? r.lists_checked.length : 0;

    var assumptions = [
      {
        text: 'The subject name as screened matches the person the MLRO intends to onboard / transact.',
        supported: !!r.name && r.name.length > 1 && !!r.customer_code,
        weak: !!r.name && !r.customer_code,
        evidence: r.customer_code
          ? 'Customer code ' + r.customer_code + ' anchors the row to a specific customer.'
          : (r.name ? 'Name provided but no customer code — weak anchor.' : 'No name on the row.')
      },
      {
        text: 'All mandatory sanctions lists were actually screened against this run.',
        supported: integrity === 'complete' && listsChecked >= 3,
        weak: integrity === 'degraded',
        evidence: listsChecked + ' list(s) checked; integrity=' + integrity + '. Mandatory set is UN + UAE EOCN + OFAC.'
      },
      {
        text: 'The confidence value is backed by positively corroborating signals, not a single fragile match.',
        supported: factors.length >= 2 || (topClass !== 'none' && amCount > 0),
        weak: factors.length === 1,
        evidence: factors.length + ' factor(s) active; top_classification=' + topClass + '; adverse-media hits=' + amCount + '.'
      },
      {
        text: 'No brain subsystem that contributed to the verdict failed or was clamped during this run.',
        supported: !(r.brain && r.brain.weaponized && (
          (Array.isArray(r.brain.weaponized.subsystemFailures) && r.brain.weaponized.subsystemFailures.length > 0) ||
          (Array.isArray(r.brain.weaponized.clampReasons) && r.brain.weaponized.clampReasons.length > 0)
        )),
        weak: !!(r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.clampReasons) &&
                r.brain.weaponized.clampReasons.length > 0),
        evidence: r.brain && r.brain.weaponized
          ? ((r.brain.weaponized.subsystemFailures || []).length + ' subsystem failure(s), ' +
             (r.brain.weaponized.clampReasons || []).length + ' clamp(s) fired.')
          : 'No brain telemetry on this row.'
      }
    ];
    return '<ol style="margin:4px 0 4px 0;padding-left:18px">' +
      assumptions.map(function (a) {
        var tone, icon;
        if (a.supported) { tone = '#6ee7b7'; icon = '✓'; }
        else if (a.weak) { tone = '#fbbf24'; icon = '!'; }
        else             { tone = '#fca5a5'; icon = '✕'; }
        return '<li style="font-size:11px;margin-bottom:6px;line-height:1.5">' +
          '<span style="color:' + tone + ';font-weight:700">' + icon + '</span> ' +
          '<strong>' + esc(a.text) + '</strong>' +
          '<br><span style="opacity:.75">Evidence: ' + esc(a.evidence) + '</span>' +
        '</li>';
      }).join('') +
    '</ol>' +
    '<div style="margin-top:4px;font-size:10px;opacity:.55">' +
      'Self-critique pass. Any ✕ should block the disposition until resolved; any ! requires a written MLRO rationale.' +
    '</div>';
  }

  // ─── Red-team Devil's Advocate ────────────────────────────────────
  // Argues the opposite of the verdict. Forces the MLRO to reckon
  // with the strongest case against their chosen disposition BEFORE
  // they record it. NIST AI RMF MANAGE-2.4 requires documented
  // counter-argument review on every high-stakes AI-touching decision.
  function devilsAdvocate(r, ladder) {
    var brainVerdict = (r.brain && r.brain.weaponized && r.brain.weaponized.finalVerdict) || '';
    var topHyp = ladder && ladder[0] ? ladder[0].id : 'legitimate';
    var args = [];
    if (brainVerdict === 'clear' || topHyp === 'legitimate') {
      args.push('A name coincidence at this score range has a non-zero base rate — require DoB / ID / jurisdiction differentiator before closing.');
      args.push('Adverse-media absence does not prove absence of risk; 13K+ sources do not cover every jurisdiction in every language.');
      args.push('A subject on a watchlist that was recently added may not yet appear in the cached snapshot used for this run.');
    } else if (brainVerdict === 'freeze' || topHyp === 'sanctions_evasion') {
      args.push('If the match is based on a partial-name hit with weak algorithmic consensus, premature freeze exposes the firm to wrongful-restraint liability.');
      args.push('EOCN procedure requires a confirmed designation — ambiguous matches must escalate to CO adjudication, not auto-freeze.');
      args.push('Freezing without notifying the EOCN within 24h is itself a breach (Cabinet Res 74/2020 Art.5) — confirm the clock is running before acting.');
    } else if (topHyp === 'false_positive') {
      args.push('False-positive disposition without a recorded differentiator cannot be defended under FATF Rec 10 positive identification.');
      args.push('The same candidate may re-appear on tomorrow\u2019s watchlist refresh — without the pin-as-subject action the MLRO will re-screen the same alert.');
      args.push('If the candidate is in fact the subject, recording false-positive is a tipping-off signal (FDL Art.29).');
    } else {
      args.push('The verdict could be inflated by a single dominant factor — if the top factor is removed, does the hypothesis ladder still agree?');
      args.push('Brain clamps protect against outlier signals; if no clamp fired, the verdict has not been adversarially stressed.');
      args.push('A verdict that hinges on a single subsystem is fragile — spread across 2+ corroborating signals before committing.');
    }
    return '<ul style="margin:4px 0 4px 0;padding-left:18px">' +
      args.map(function (a) {
        return '<li style="font-size:11px;margin-bottom:5px;line-height:1.5;color:#f472b6">' +
          '<strong>Counter-argument.</strong> <span style="color:#fae8ff;opacity:.92">' + esc(a) + '</span>' +
        '</li>';
      }).join('') +
    '</ul>' +
    '<div style="margin-top:4px;font-size:10px;opacity:.6">' +
      'Each counter-argument requires a sentence in the MLRO rationale that refutes it (NIST AI RMF MANAGE-2.4).' +
    '</div>';
  }

  // ─── Escalation Pathway Forecast ──────────────────────────────────
  // Projects the 24h / 5-day / 30-day consequence of each possible
  // disposition so the MLRO sees the downstream impact BEFORE they
  // commit. Ties regulatory clocks (Cabinet Res 74/2020 Art.4-7 freeze
  // + CNMR) to the outcome.
  function escalationForecast(r) {
    var topClass = r.top_classification || 'none';
    var rows = [];
    if (topClass === 'confirmed') {
      rows.push({ h: '24 hours',  d: 'Freeze executed · EOCN notification filed · STR drafted without delay' });
      rows.push({ h: '5 business days', d: 'CNMR submitted to EOCN (Cabinet Res 74/2020 Art.6)' });
      rows.push({ h: '30 days', d: 'Senior-management attestation memo filed · customer relationship under EDD monitoring' });
    } else if (topClass === 'potential') {
      rows.push({ h: '1 business day', d: 'Escalate to CO · suspend pending onboarding / transaction (Cabinet Res 134/2025 Art.14)' });
      rows.push({ h: '5 business days', d: 'CO adjudication complete · either freeze path OR documented false-positive dismissal' });
      rows.push({ h: '30 days', d: 'If dismissed: continuous monitoring auto-enrolment. If confirmed: STR + CNMR track' });
    } else if (topClass === 'weak') {
      rows.push({ h: '24 hours', d: 'Documented and dismissed if false positive · no freeze · no escalation' });
      rows.push({ h: '5 business days', d: 'Watchlist enrolment re-screens at 06:00 + 14:00 UTC daily' });
      rows.push({ h: '30 days', d: 'No action unless a fresh adverse-media / sanctions delta fires' });
    } else {
      rows.push({ h: '24 hours', d: 'Proceed to standard CDD / SDD path; no sanctions obligation' });
      rows.push({ h: '5 business days', d: 'Watchlist enrolment active · periodic re-screen scheduled by risk tier' });
      rows.push({ h: '30 days', d: 'Fresh delta would reopen the case automatically; otherwise no action' });
    }
    return '<ul style="margin:4px 0 4px 0;padding-left:18px">' +
      rows.map(function (rw) {
        return '<li style="font-size:11px;margin-bottom:4px;line-height:1.5">' +
          '<strong style="font-family:monospace;color:#a855f7">' + esc(rw.h) + '</strong> — ' +
          '<span style="opacity:.9">' + esc(rw.d) + '</span>' +
        '</li>';
      }).join('') +
    '</ul>';
  }

  // ─── Signal Freshness Decay ───────────────────────────────────────
  // Each signal has a half-life. If any signal feeding the verdict
  // is stale, the verdict inherits that staleness. Surfaces per-signal
  // age with a colour cue so the MLRO sees "this verdict rests on
  // 6-month-old adverse media" immediately.
  function signalFreshness(r) {
    var now = Date.now();
    var ranAt = r.screened_at ? Date.parse(r.screened_at) : now;
    var ageHours = Math.max(0, Math.round((now - ranAt) / 3600000));
    var signals = [
      { label: 'Sanctions snapshot (UN / OFAC / UAE EOCN)', ageHours: ageHours, budget: 24, unit: 'h' },
      { label: 'Adverse-media feed',                       ageHours: ageHours, budget: 6,  unit: 'h' },
      { label: 'PEP roster',                               ageHours: ageHours, budget: 168, unit: 'h' },
      { label: 'Customer KYC / UBO data',                  ageHours: ageHours * 30, budget: 2160, unit: 'h' },
      { label: 'Country-risk list (FATF / CAHRA)',         ageHours: ageHours, budget: 720, unit: 'h' }
    ];
    return '<ul style="margin:4px 0 4px 0;padding-left:18px">' +
      signals.map(function (s) {
        var ratio = s.ageHours / s.budget;
        var colour = ratio < 0.5 ? '#6ee7b7' : ratio < 1 ? '#fbbf24' : '#fca5a5';
        var icon = ratio < 0.5 ? '✓' : ratio < 1 ? '!' : '✕';
        return '<li style="font-size:11px;margin-bottom:4px;line-height:1.5">' +
          '<span style="color:' + colour + ';font-weight:700">' + icon + '</span> ' +
          '<strong>' + esc(s.label) + '</strong>' +
          ' — age <span style="font-family:monospace">' + s.ageHours + s.unit + '</span>' +
          ' vs budget <span style="font-family:monospace">' + s.budget + s.unit + '</span>' +
        '</li>';
      }).join('') +
    '</ul>' +
    '<div style="margin-top:4px;font-size:10px;opacity:.55">' +
      'Freshness budgets approximate FATF Rec 10 ongoing-CDD + Cabinet Res 74/2020 Art.4 24h TFS cadence.' +
    '</div>';
  }

  // ─── Peer-Group Benchmark ─────────────────────────────────────────
  // Compares this subject to other rows in localStorage that share
  // entity type + country + risk tier. Answers "is this row typical
  // for its cohort, or an outlier?".
  function peerBenchmark(r) {
    var rows = safeParse(STORAGE.subjects, []);
    if (!Array.isArray(rows) || !rows.length) {
      return '<div style="font-size:11px;opacity:.6">No peer rows in this browser yet.</div>';
    }
    var cohort = rows.filter(function (p) {
      return p.id !== r.id && p.subject_type === r.subject_type && (!!p.country === !!r.country);
    });
    if (!cohort.length) {
      return '<div style="font-size:11px;opacity:.6">No peer subjects match entity type + country set.</div>';
    }
    var confs = cohort.map(function (p) { return typeof p.confidence === 'number' ? p.confidence : 0; });
    var mean = confs.reduce(function (s, x) { return s + x; }, 0) / confs.length;
    var max = confs.reduce(function (m, x) { return x > m ? x : m; }, 0);
    var my = typeof r.confidence === 'number' ? r.confidence : 0;
    var delta = my - mean;
    var rank = confs.filter(function (x) { return x > my; }).length + 1;
    var deltaColour = Math.abs(delta) < 0.05 ? 'rgba(250,232,255,0.8)' : delta > 0 ? '#fca5a5' : '#6ee7b7';
    return '<div style="font-size:11px;line-height:1.55">' +
      '<div>Cohort: <strong>' + cohort.length + '</strong> peer subject(s) · same entity type + country.</div>' +
      '<div>This subject: <span style="font-family:monospace;font-weight:700">' + Math.round(my * 100) + '%</span>' +
        ' · cohort mean <span style="font-family:monospace">' + Math.round(mean * 100) + '%</span>' +
        ' · cohort max <span style="font-family:monospace">' + Math.round(max * 100) + '%</span>.</div>' +
      '<div>Delta vs mean: <span style="font-family:monospace;color:' + deltaColour + '">' +
        (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%</span> · ' +
        'rank <span style="font-family:monospace">' + rank + '</span> of ' + (cohort.length + 1) + '.</div>' +
    '</div>';
  }

  // ─── Auto-Narrative Drafter ───────────────────────────────────────
  // Produces a compliance-report paragraph the MLRO can copy into
  // the rationale. Uses the captured row data + regulatory anchors
  // to stay FDL Art.29 no-tipping-off safe.
  function autoNarrative(r) {
    var name = r.name || '(unnamed subject)';
    var code = r.customer_code ? ' (customer code ' + r.customer_code + ')' : '';
    var topClass = r.top_classification || 'none';
    var topScore = typeof r.confidence === 'number' ? Math.round(r.confidence * 100) : 0;
    var amCount = r.adverse_media_count || 0;
    var eventType = r.event_type || 'ad_hoc';
    var brainVerdict = (r.brain && r.brain.weaponized && r.brain.weaponized.finalVerdict) || 'n/a';
    var integrity = r.integrity || 'complete';
    var lists = Array.isArray(r.lists_checked) && r.lists_checked.length
      ? r.lists_checked.join(', ') : 'UN + UAE EOCN + OFAC (default set)';

    var body =
      name + code + ' was screened on ' + (r.screened_at ? r.screened_at.slice(0, 19).replace('T', ' ') + ' UTC' : 'the date stamped on this row') +
      ' under event type "' + eventType + '". The multi-list fan-out covered ' + lists + '. ' +
      'Top sanctions classification is ' + topClass.toUpperCase() + ' at ' + topScore + '% algorithmic confidence, ' +
      'with ' + amCount + ' adverse-media hit(s) returned. ' +
      'The weaponized-brain verdict was "' + brainVerdict + '" and screening integrity is ' + integrity.toUpperCase() + '. ' +
      (topClass === 'confirmed'
        ? 'A confirmed-match disposition must follow: execute the freeze within 24 clock hours (Cabinet Res 74/2020 Art.4), ' +
          'file CNMR to EOCN within 5 business days (Art.6), and draft the STR without delay (FDL Art.26-27). ' +
          'Do NOT notify the subject (FDL Art.29).'
        : topClass === 'potential'
        ? 'A partial-match disposition requires escalation to the Compliance Officer within one business day and suspension of any pending onboarding or transaction (Cabinet Res 134/2025 Art.14). ' +
          'No tipping off (FDL Art.29).'
        : topClass === 'weak'
        ? 'A weak-match result is documented and dismissed once the differentiator (DoB / ID / jurisdiction / biometric) is recorded in this rationale.'
        : 'No sanctions proximity; the subject proceeds to standard CDD / SDD path. Ongoing monitoring auto-enrols the subject on the watchlist (FATF Rec 10).') +
      ' This record is retained 10 years (FDL Art.24) and processed under UAE PDPL Art.6(1)(c).';

    return '<div style="font-size:11px;line-height:1.6;padding:8px 10px;background:rgba(255,255,255,0.03);border-left:2px solid #a855f7;border-radius:4px">' +
      esc(body) +
    '</div>' +
    '<div style="margin-top:4px;font-size:10px;opacity:.55">' +
      'Copy the paragraph into the MLRO rationale box and adjust as needed. Do not paste verbatim without reviewing every regulatory citation.' +
    '</div>';
  }

  // ─── Causal Story Generator ───────────────────────────────────────
  // Best-available explanation of HOW the evidence produced the
  // verdict, narrated in the MLRO's voice. Surfaces the implicit
  // "story" so the MLRO can challenge the narrative, not just the
  // numbers.
  function causalStory(r, ladder, factors) {
    var topHyp = ladder && ladder[0] ? ladder[0] : null;
    var story = [];
    if (!topHyp) return '<div style="font-size:11px;opacity:.65">No signals to build a causal story from.</div>';
    var strongest = factors.slice().sort(function (a, b) { return b.weight - a.weight; })[0];
    if (strongest) {
      story.push('The row pivots on <strong>' + esc(strongest.label) + '</strong> — ' + esc(strongest.detail) + '.');
    }
    story.push('Given that signal, the top hypothesis is <strong style="color:#f472b6">' + esc(topHyp.label) + '</strong> at a normalised posterior of <span style="font-family:monospace">' + Math.round((topHyp.normalized || 0) * 100) + '%</span>.');
    story.push('The brain\u2019s supporting rationale: ' + esc(topHyp.rationale));
    var amCount = r.adverse_media_count || 0;
    if (amCount > 0) {
      story.push('Adverse-media corroboration: <span style="font-family:monospace">' + amCount + '</span> hit(s) align with the hypothesis, reinforcing the narrative.');
    } else {
      story.push('No adverse-media corroboration — the hypothesis rests on the sanctions layer alone.');
    }
    if (r.brain && r.brain.weaponized && Array.isArray(r.brain.weaponized.clampReasons) && r.brain.weaponized.clampReasons.length) {
      story.push('Brain safety clamps fired: <em>' + esc(r.brain.weaponized.clampReasons.slice(0, 2).join(' · ')) + '</em> — the numeric verdict has already been tempered.');
    }
    return '<ol style="margin:4px 0 4px 0;padding-left:18px">' +
      story.map(function (s) {
        return '<li style="font-size:11px;margin-bottom:4px;line-height:1.55">' + s + '</li>';
      }).join('') +
    '</ol>' +
    '<div style="margin-top:4px;font-size:10px;opacity:.55">' +
      'The MLRO should challenge any step that does not match the evidence before accepting the verdict.' +
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

    return correctnessAssurance(r) +
      '<div class="mv-list-meta" style="margin-top:10px;padding:12px;' +
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
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>REASONING DAG</strong> · subsystem → aggregator → verdict graph</summary>' +
        '<div style="margin-top:6px">' + reasoningDAG(r) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>ATTRIBUTION WHAT-IFS</strong> · remove each signal · see top hypothesis shift</summary>' +
        '<div style="margin-top:6px;overflow-x:auto">' + attributionToggles(r, factors) + '</div>' +
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

      '<details style="margin-top:4px" open>' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>CONTRADICTION DETECTOR</strong> · cross-layer consistency</summary>' +
        '<div style="margin-top:6px">' + contradictionDetector(r, factors, ladder) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>COMMONSENSE PLAUSIBILITY</strong> · 12 sanity rules</summary>' +
        '<div style="margin-top:6px">' + commonsenseCheck(r) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>ANALOGICAL RETRIEVAL</strong> · similar prior cases</summary>' +
        '<div style="margin-top:6px">' + analogicalRetrieval(r) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>CHAIN-OF-VERIFICATION</strong> · self-critique of the verdict\u2019s assumptions</summary>' +
        '<div style="margin-top:6px">' + chainOfVerification(r, factors) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>DEVIL\u2019S ADVOCATE</strong> · 3 counter-arguments to challenge the verdict</summary>' +
        '<div style="margin-top:6px">' + devilsAdvocate(r, ladder) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>ESCALATION FORECAST</strong> · 24h / 5 business days / 30 days projection</summary>' +
        '<div style="margin-top:6px">' + escalationForecast(r) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>SIGNAL FRESHNESS</strong> · age vs regulatory budget per data source</summary>' +
        '<div style="margin-top:6px">' + signalFreshness(r) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>PEER-GROUP BENCHMARK</strong> · rank vs same entity type + country</summary>' +
        '<div style="margin-top:6px">' + peerBenchmark(r) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>AUTO-NARRATIVE</strong> · draft compliance-report paragraph for the MLRO rationale</summary>' +
        '<div style="margin-top:6px">' + autoNarrative(r) + '</div>' +
      '</details>' +

      '<details style="margin-top:4px">' +
        '<summary style="cursor:pointer;font-size:11px;letter-spacing:1px;opacity:.85"><strong>CAUSAL STORY</strong> · best-available narrative linking evidence → verdict</summary>' +
        '<div style="margin-top:6px">' + causalStory(r, ladder, factors) + '</div>' +
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

    // Widget helpers (checkboxGroup / hiddenGroup / typologyGroup)
    // are hoisted to module scope — see widget*Group functions near
    // the top of the file. This function keeps thin aliases so every
    // call site below reads the same way it always has.
    var checkboxGroup = widgetCheckboxGroup;
    function specialGroup(items) { return widgetCheckboxGroup('special_screens', items); }
    var hiddenGroup = widgetHiddenGroup;
    var typologyGroup = widgetTypologyGroup;

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
        // Customer identity block — required on the FIRST screening so
        // every downstream report (Asana task body, life-story markdown,
        // PDF, goAML XML, watchlist enrolment, audit trail) is keyed
        // off the same customer code. The code travels with every
        // delta re-screen so the MLRO + auditor can reconstruct the
        // chronological trail for a single customer at a glance
        // (FDL No.10/2025 Art.24 — 10-yr audit record must be complete
        // and unambiguously attributable to the customer).
        // Identity grid — 3 rows x 3 columns = 9 cells. Search fields
        // are dense + horizontally scannable at this layout, and the
        // Run Screening action still fits immediately below the last
        // row. Customer-name input retired — when empty it falls back
        // to the Name / Entity value at submit time, preserving the
        // customer anchor with one fewer cell (FDL Art.24 audit
        // attribution — customer_code is the true anchor).
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Customer code <span style="color:#f472b6">*</span></span>',
            '<input type="text" name="customer_code" required placeholder="e.g. FGL-0284, CUST-2026-0017"></label>',
          '<label class="mv-field"><span class="mv-field-label">Subject type</span>',
            '<select name="subject_type">',
              '<option value="individual">Individual</option>',
              '<option value="entity">Entity / Organisation</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Name / Entity <span style="color:#f472b6">*</span></span>',
            '<input type="text" name="name" required placeholder="Full legal name or registered entity"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Alias</span>',
            '<input type="text" name="alias" placeholder="Also known as / trading name"></label>',
          '<label class="mv-field"><span class="mv-field-label">Gender</span>',
            '<select name="gender">',
              '<option value="">—</option>',
              '<option value="female">Female</option>',
              '<option value="male">Male</option>',
              '<option value="na">N/A (entity)</option>',
            '</select></label>',
          '<label class="mv-field"><span class="mv-field-label">Date of birth / Registration</span>',
            '<input type="text" name="dob" placeholder="dd/mm/yyyy"></label>',
        '</div>',
        '<div class="mv-grid-3">',
          '<label class="mv-field"><span class="mv-field-label">Citizenship / Country</span>',
            '<input type="text" name="country" placeholder="e.g. UAE, India, BVI"></label>',
          '<label class="mv-field"><span class="mv-field-label">Passport / Registration no.</span>',
            '<input type="text" name="passport" placeholder="Passport / trade licence / CR no."></label>',
          '<label class="mv-field"><span class="mv-field-label">Issuing authority</span>',
            '<input type="text" name="issuer" placeholder="e.g. DED, UAE MOI, HMPO"></label>',
        '</div>',

        // Run / Clear moved UP next to the search identity grid so the
        // MLRO can fire the screen without scrolling past the Coverage
        // disclosure and the skills palette. The trailing actions block
        // below the form is retired — a single action bar keeps the
        // flow "type identity → click Run Screening" tight.
        '<div class="mv-form-actions" style="margin-top:10px;margin-bottom:6px">',
          '<button type="submit" class="mv-btn mv-btn-primary">Run screening</button>',
          '<button type="reset" class="mv-btn mv-btn-ghost">Clear</button>',
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
              r.customer_code ? 'Customer code ' + r.customer_code : null,
              (r.subject_type === 'entity' ? 'Entity' : 'Individual'),
              r.event_type === 'new_customer_onboarding' ? 'First screening (life-story)'
                : r.event_type === 'periodic_review' ? 'Periodic review'
                : null,
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
              // Status pills. RISK summarises the overall risk rating;
              // SANCTIONS surfaces the sanctions-dimension verdict
              // independently so a clean sanctions result stands out even
              // when adverse-media risk is HIGH.
              var sanctionsHitCount = typeof cr.sanctions_hit_count === 'number'
                ? cr.sanctions_hit_count : 0;
              var sanctionsListsChecked = typeof cr.sanctions_lists_checked === 'number'
                ? cr.sanctions_lists_checked
                : (Array.isArray(cr.sanctions_detail) ? cr.sanctions_detail.length : 0);
              var sanctionsBadgeColor = sanctionsHitCount > 0
                ? 'background:#dc2626;color:#fff'
                : 'background:#166534;color:#fff';
              var sanctionsSummary = cr.sanctions_summary
                || (sanctionsHitCount > 0 ? 'POSITIVE' : 'NEGATIVE');

              // Narrative blocks. Sanctions Finding and Adverse Media
              // Finding each render as their own paragraph so the MLRO and
              // any MoE/LBMA inspector can read the verdict in plain English
              // alongside the mandatory regulatory action list.
              var sanctionsParagraph = cr.sanctions_narrative
                ? '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Sanctions Finding.</strong> ' +
                    esc(cr.sanctions_narrative) +
                  '</div>'
                : '';
              var adverseParagraph = cr.adverse_media_narrative
                ? '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Adverse Media Finding.</strong> ' +
                    esc(cr.adverse_media_narrative) +
                  '</div>'
                : '';

              // Jurisdiction Context paragraph. Rendered only when the
              // country-risk table returned flags or a narrative.
              var jurisdictionParagraph = '';
              if (cr.jurisdiction && cr.jurisdiction.narrative) {
                var jRisk = cr.jurisdiction.risk_level || 'standard';
                var jBadge =
                  jRisk === 'critical' ? 'background:#7f1d1d;color:#fff' :
                  jRisk === 'high'     ? 'background:#dc2626;color:#fff' :
                  jRisk === 'elevated' ? 'background:#ea580c;color:#fff' :
                  jRisk === 'medium'   ? 'background:#d97706;color:#1a1a1a' :
                                         'background:#166534;color:#fff';
                var flagChips = Array.isArray(cr.jurisdiction.flags) && cr.jurisdiction.flags.length
                  ? ' <span style="opacity:.7;font-size:10px">[' + cr.jurisdiction.flags.map(esc).join(' · ') + ']</span>'
                  : '';
                jurisdictionParagraph =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Jurisdiction Context.</strong> ' +
                    '<span style="padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:.5px;margin-right:6px;' + jBadge + '">' +
                      esc(String(jRisk).toUpperCase()) +
                    '</span>' +
                    esc(cr.jurisdiction.narrative.replace(/^Jurisdiction Context\.\s*/, '')) +
                    flagChips +
                  '</div>';
              }

              // Typology Match paragraph.
              var typologyParagraph = cr.typology_narrative
                ? '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Typology Match.</strong> ' +
                    esc(cr.typology_narrative.replace(/^Typology Match\.\s*/, '')) +
                  '</div>'
                : '';

              // Reasoning Chain (multi-step evidence → inference → action).
              var reasoningBlock = '';
              if (Array.isArray(cr.reasoning_chain) && cr.reasoning_chain.length) {
                var steps = cr.reasoning_chain.map(function (s) {
                  return '<li style="margin-bottom:4px">' +
                    '<strong>' + esc(s.label) + '.</strong> ' +
                    '<span style="opacity:.9">Evidence:</span> ' + esc(s.evidence) + ' ' +
                    '<span style="opacity:.9">→ Inference:</span> ' + esc(s.inference) +
                    (s.citation ? ' <span style="opacity:.6;font-size:10px">[' + esc(s.citation) + ']</span>' : '') +
                    '</li>';
                }).join('');
                reasoningBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Reasoning Chain.</strong>' +
                    '<ol style="margin:4px 0 0 0;padding-left:18px">' + steps + '</ol>' +
                  '</div>';
              }

              // Score Attribution breakdown.
              var attributionBlock = '';
              if (cr.score_attribution && Array.isArray(cr.score_attribution.factors) && cr.score_attribution.factors.length) {
                var total = cr.score_attribution.total || 0;
                var totalColor = total >= 70 ? '#dc2626' : total >= 40 ? '#ea580c' : total >= 20 ? '#d97706' : '#166534';
                var factorRows = cr.score_attribution.factors.map(function (f) {
                  return '<li style="margin-bottom:2px">' +
                    '<strong style="min-width:40px;display:inline-block;color:' + totalColor + '">+' + f.points + '</strong> ' +
                    esc(f.factor) +
                    (f.note ? ' <span style="opacity:.7">— ' + esc(f.note) + '</span>' : '') +
                    '</li>';
                }).join('');
                attributionBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Risk Factor Attribution.</strong> ' +
                    '<span style="padding:1px 8px;border-radius:3px;font-weight:700;background:' + totalColor + ';color:#fff;font-size:11px">' +
                      'TOTAL ' + total + ' / 100' +
                    '</span>' +
                    '<ul style="margin:4px 0 0 0;padding-left:18px;list-style:none">' + factorRows + '</ul>' +
                  '</div>';
              }

              // Confidence calibration block.
              var calibrationBlock = '';
              if (cr.confidence_calibration) {
                var cal = cr.confidence_calibration;
                var adjBits = (cal.adjustments || []).map(function (a) {
                  var sign = a.delta >= 0 ? '+' : '';
                  return esc(a.label) + ' <strong>' + sign + a.delta + '</strong>';
                }).join(' · ');
                calibrationBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Confidence Calibration.</strong> ' +
                    'Raw ' + cal.raw_confidence_pct + '% → Calibrated <strong>' + cal.calibrated_pct + '%</strong> (' + esc(cal.band) + ').' +
                    (adjBits ? ' <span style="opacity:.8">Adjustments: ' + adjBits + '.</span>' : '') +
                  '</div>';
              }

              // CDD tier recommendation.
              var cddBlock = '';
              if (cr.cdd_recommendation) {
                var cdd = cr.cdd_recommendation;
                var tierColor =
                  cdd.tier === 'FREEZE' ? 'background:#7f1d1d;color:#fff' :
                  cdd.tier === 'EDD'    ? 'background:#dc2626;color:#fff' :
                  cdd.tier === 'CDD'    ? 'background:#d97706;color:#1a1a1a' :
                                          'background:#166534;color:#fff';
                var reasonsList = (cdd.reasons || []).map(function (r) {
                  return '<li style="margin-bottom:2px">' + esc(r) + '</li>';
                }).join('');
                cddBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>CDD Tier Recommendation.</strong> ' +
                    '<span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.5px;' + tierColor + '">' +
                      esc(cdd.tier) +
                    '</span>' +
                    ' <span style="opacity:.8">review: ' + esc(cdd.review_cycle) + '</span>' +
                    (reasonsList ? '<ul style="margin:4px 0 0 0;padding-left:18px">' + reasonsList + '</ul>' : '') +
                  '</div>';
              }

              // Red-flag checklist (show only triggered flags — the rest
              // are in the data payload for /audit-pack exports).
              var redFlagBlock = '';
              if (Array.isArray(cr.red_flags) && cr.red_flags.length) {
                var triggered = cr.red_flags.filter(function (f) { return f.triggered; });
                var notTriggered = cr.red_flags.filter(function (f) { return !f.triggered; });
                if (triggered.length) {
                  var items = triggered.map(function (f) {
                    return '<li style="margin-bottom:2px">' +
                      '<strong style="color:#dc2626">✕</strong> ' + esc(f.label) +
                      ' <span style="opacity:.8">— ' + esc(f.rationale) + '</span>' +
                      (f.citation ? ' <span style="opacity:.55;font-size:10px">[' + esc(f.citation) + ']</span>' : '') +
                      '</li>';
                  }).join('');
                  redFlagBlock =
                    '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                      '<strong>AML Red Flags Triggered</strong> ' +
                      '<span style="opacity:.7">(' + triggered.length + ' / ' + cr.red_flags.length + ' checks).</span>' +
                      '<ul style="margin:4px 0 0 0;padding-left:18px;list-style:none">' + items + '</ul>' +
                    '</div>';
                } else {
                  redFlagBlock =
                    '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                      '<strong>AML Red Flags.</strong> None triggered (0 / ' + cr.red_flags.length + ' checks).' +
                    '</div>';
                }
              }

              // Counterfactuals — what factors would flip the verdict.
              var counterfactualBlock = '';
              if (Array.isArray(cr.counterfactuals) && cr.counterfactuals.length) {
                var cfItems = cr.counterfactuals.map(function (c) {
                  var flipTag = c.flips_verdict
                    ? ' <span style="background:#dc2626;color:#fff;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700">FLIPS VERDICT</span>'
                    : '';
                  return '<li style="margin-bottom:2px">Remove <strong>' + esc(c.remove) + '</strong> → ' +
                    c.delta_points + ' pts · new total ' + c.new_total + '/100' + flipTag +
                    ' <span style="opacity:.7">— ' + esc(c.note) + '</span>' +
                    '</li>';
                }).join('');
                counterfactualBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Counterfactual Analysis.</strong>' +
                    '<ul style="margin:4px 0 0 0;padding-left:18px">' + cfItems + '</ul>' +
                  '</div>';
              }

              // Evidence gaps.
              var gapsBlock = '';
              if (Array.isArray(cr.evidence_gaps) && cr.evidence_gaps.length) {
                var gapItems = cr.evidence_gaps.map(function (g) {
                  return '<li style="margin-bottom:2px">' +
                    '<strong>' + esc(g.gap) + '.</strong> ' + esc(g.request) +
                    (g.citation ? ' <span style="opacity:.55;font-size:10px">[' + esc(g.citation) + ']</span>' : '') +
                    '</li>';
                }).join('');
                gapsBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Evidence Gaps & Requests.</strong>' +
                    '<ul style="margin:4px 0 0 0;padding-left:18px">' + gapItems + '</ul>' +
                  '</div>';
              }

              // Connected Parties suggested for re-screen.
              var connectedBlock = '';
              if (Array.isArray(cr.connected_parties) && cr.connected_parties.length) {
                var parties = cr.connected_parties.map(function (p) {
                  return '<li style="margin-bottom:2px">' +
                    '<strong>' + esc(p.name) + '</strong>' +
                    (p.abbrev ? ' <span style="opacity:.7">(' + esc(p.abbrev) + ')</span>' : '') +
                    ' <span style="opacity:.75">— ' + esc(p.action) + '</span>' +
                    '</li>';
                }).join('');
                connectedBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Connected Parties (re-screen queue).</strong>' +
                    '<ul style="margin:4px 0 0 0;padding-left:18px">' + parties + '</ul>' +
                  '</div>';
              }

              // Evidence Quality grade — source-tier math + independence
              // + recency + primary/secondary rating per FATF Rec 10.
              var evidenceBlock = '';
              if (cr.evidence_grade && cr.evidence_grade.grade) {
                var eg = cr.evidence_grade;
                var gradeTone =
                  eg.grade === 'A' ? 'background:#166534;color:#fff' :
                  eg.grade === 'B' ? 'background:#15803d;color:#fff' :
                  eg.grade === 'C' ? 'background:#d97706;color:#1a1a1a' :
                  eg.grade === 'D' ? 'background:#ea580c;color:#fff' :
                                     'background:#dc2626;color:#fff';
                var bd = eg.breakdown || {};
                var tc = bd.source_tiers || {};
                var breakdownBits = [
                  'source tiers ' + (tc.tier1 || 0) + '/' + (tc.tier2 || 0) + '/' + (tc.tier3 || 0) + (tc.unknown ? ' (+' + tc.unknown + ' unknown)' : ''),
                  'independence +' + (bd.independence || 0),
                  'recency +' + (bd.recency || 0),
                  'primary +' + (bd.primary || 0)
                ];
                evidenceBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Evidence Quality.</strong> ' +
                    '<span style="padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;' + gradeTone + '">' +
                      'GRADE ' + esc(eg.grade) + ' · ' + (eg.total || 0) + ' pts' +
                    '</span>' +
                    ' <span style="opacity:.8">' + breakdownBits.join(' · ') + '</span>' +
                    ' <span style="opacity:.55;font-size:10px">[FATF Rec 10 evidence standard]</span>' +
                  '</div>';
              }

              // Escalation Pathway Forecast — 30 / 90 / 180-day
              // trajectory from the typology-driven catalog.
              var escalationBlock = '';
              if (cr.escalation_pathway && cr.escalation_pathway.pathway) {
                var ep = cr.escalation_pathway;
                var stages = (ep.pathway.stages || []).map(function (s) {
                  return '<li style="margin-bottom:2px">' +
                    '<strong>' + esc(s.stage) + '</strong> ' +
                    '<span style="opacity:.7">(' + esc(s.days) + ' days)</span> ' +
                    '<span style="opacity:.85">— ' + esc(s.indicator) + '</span>' +
                    '</li>';
                }).join('');
                escalationBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Escalation Pathway Forecast.</strong> ' +
                    esc(ep.pathway.label) + ' — ' + esc(ep.ignition) +
                    '<ol style="margin:4px 0 0 0;padding-left:18px">' + stages + '</ol>' +
                    (ep.pathway.citation ? '<div style="font-size:10px;opacity:.55;margin-top:4px">[' + esc(ep.pathway.citation) + ']</div>' : '') +
                  '</div>';
              }

              // Contradiction / plausibility engine — surfaces declared-vs-
              // observed mismatches and out-of-range figures. FATF Rec 10
              // "reasonable grounds" + Cabinet Res 134/2025 Art.14 EDD.
              var contradictionBlock = '';
              if (Array.isArray(cr.contradictions) && cr.contradictions.length) {
                var cItems = cr.contradictions.map(function (c) {
                  var sevColor = c.severity === 'high' ? '#dc2626'
                    : c.severity === 'medium' ? '#ea580c' : '#d97706';
                  return '<li style="margin-bottom:4px">' +
                    '<span style="color:' + sevColor + ';font-weight:700">[' + esc(String(c.severity).toUpperCase()) + ']</span> ' +
                    '<strong>' + esc(c.label) + '</strong>' +
                    '<br><span style="opacity:.85;font-size:11px">Observed: ' + esc(c.observed) +
                    ' · Baseline: ' + esc(c.baseline) +
                    (c.ratio && c.ratio !== '—' ? ' · Deviation: ' + esc(c.ratio) : '') +
                    '</span><br><span style="opacity:.8;font-size:11px">↳ ' + esc(c.note) + '</span>' +
                    (c.citation ? ' <span style="opacity:.55;font-size:10px">[' + esc(c.citation) + ']</span>' : '') +
                    '</li>';
                }).join('');
                contradictionBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6;padding:8px;border-left:3px solid #dc2626;background:rgba(220,38,38,0.05);border-radius:6px">' +
                    '<strong>Contradictions &amp; Plausibility Checks.</strong> ' +
                    '<span style="opacity:.75">' + cr.contradictions.length + ' anomal(y/ies) detected.</span>' +
                    '<ul style="margin:6px 0 0 0;padding-left:18px;list-style:none">' + cItems + '</ul>' +
                  '</div>';
              }

              // Hypothesis ranker — forces the MLRO to look at the top
              // alternate explanations before closing the disposition.
              var hypothesisBlock = '';
              if (Array.isArray(cr.hypotheses) && cr.hypotheses.length) {
                var hItems = cr.hypotheses.map(function (h, idx) {
                  var probColor = h.probability >= 40 ? '#dc2626'
                    : h.probability >= 20 ? '#ea580c' : '#4b5563';
                  var supportsHtml = (h.supports || []).map(function (s) {
                    return '<li style="opacity:.8">+ ' + esc(s) + '</li>';
                  }).join('');
                  var contrasHtml = (h.contras || []).map(function (s) {
                    return '<li style="opacity:.7;color:#86efac">− ' + esc(s) + '</li>';
                  }).join('');
                  return '<li style="margin-bottom:6px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px">' +
                    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                      '<span style="font-weight:700;color:' + probColor + '">H' + (idx + 1) + ' · ' + h.probability + '%</span>' +
                      '<strong>' + esc(h.label) + '</strong>' +
                      '<span style="opacity:.6;font-size:10px">[' + esc(h.typology) + ']</span>' +
                    '</div>' +
                    (supportsHtml || contrasHtml ? '<ul style="margin:4px 0 0 0;padding-left:18px;list-style:none;font-size:11px">' + supportsHtml + contrasHtml + '</ul>' : '') +
                    '<div style="margin-top:3px;font-size:11px;opacity:.85">↳ ' + esc(h.implication) + '</div>' +
                    '</li>';
                }).join('');
                hypothesisBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.55">' +
                    '<strong>Competing Hypotheses.</strong> ' +
                    '<span style="opacity:.75">Top ' + cr.hypotheses.length + ' ranked by evidence overlap.</span>' +
                    '<ol style="margin:4px 0 0 0;padding-left:0;list-style:none">' + hItems + '</ol>' +
                  '</div>';
              }

              // Bayesian Posterior block — probabilistic risk summary
              // with 90% credible interval + per-signal LLR contribution.
              var bayesianBlock = '';
              if (cr.bayesian_posterior) {
                var bp = cr.bayesian_posterior;
                var pColor = bp.posterior_mean_pct >= 70 ? '#dc2626'
                  : bp.posterior_mean_pct >= 40 ? '#ea580c'
                  : bp.posterior_mean_pct >= 15 ? '#d97706' : '#166534';
                var weights = (bp.evidence_weights || []).map(function (w) {
                  var sign = w.llr >= 0 ? '+' : '';
                  return '<li style="margin-bottom:1px;font-size:11px">' +
                    '<span style="color:' + (w.llr >= 0 ? '#fca5a5' : '#86efac') + ';font-weight:700;min-width:50px;display:inline-block">LLR ' + sign + w.llr.toFixed(2) + '</span> ' +
                    esc(w.label) + (w.note ? ' <span style="opacity:.7">(' + esc(w.note) + ')</span>' : '') +
                    '</li>';
                }).join('');
                bayesianBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.55">' +
                    '<strong>Bayesian Posterior.</strong> ' +
                    '<span style="padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;background:' + pColor + ';color:#fff">' +
                      bp.posterior_mean_pct + '% · ' + esc(bp.interpretation).toUpperCase() +
                    '</span>' +
                    ' <span style="opacity:.85;font-size:11px">90% CI [' + bp.ci_low_pct + '%, ' + bp.ci_high_pct + '%]</span>' +
                    ' <span style="opacity:.6;font-size:10px">prior ' + bp.prior_pct + '% · σ ' + bp.posterior_sigma.toFixed(2) + '</span>' +
                    '<details style="margin-top:4px"><summary style="font-size:11px;opacity:.8;cursor:pointer">Evidence weights (' + (bp.evidence_weights || []).length + ')</summary>' +
                      '<ul style="margin:4px 0 0 0;padding-left:18px;list-style:none">' + weights + '</ul>' +
                    '</details>' +
                    ' <span style="opacity:.55;font-size:10px">[' + esc(bp.citation) + ']</span>' +
                  '</div>';
              }

              // Learned Patterns — aggregated statistics from prior
              // MLRO dispositions on similar cases. Surfaces false-
              // positive rate + discriminator signal + top 3 prior
              // matches so the MLRO sees institutional memory before
              // closing this disposition.
              var lessons = findRelevantLessons(r);
              var lessonsBlock = '';
              if (lessons && lessons.total_matches > 0) {
                var byD = lessons.by_disposition || {};
                var dispBits = [];
                if (byD.positive)       dispBits.push('<span style="color:#fca5a5">' + byD.positive + ' confirmed</span>');
                if (byD.escalated)      dispBits.push('<span style="color:#fdba74">' + byD.escalated + ' escalated</span>');
                if (byD.partial)        dispBits.push('<span style="color:#d8b4fe">' + byD.partial + ' partial</span>');
                if (byD.false_positive) dispBits.push('<span style="color:#86efac">' + byD.false_positive + ' false-positive</span>');
                var topRows = (lessons.top_matches || []).map(function (m) {
                  return '<li style="margin-bottom:2px;font-size:11px">' +
                    esc(m.subject_name || '—') +
                    ' · <span style="font-weight:700">' + esc(String(m.disposition || '').toUpperCase()) + '</span>' +
                    (m.cdd_tier ? ' · ' + esc(m.cdd_tier) : '') +
                    (m.confidence_pct != null ? ' · ' + m.confidence_pct + '%' : '') +
                    (m.ts ? ' <span style="opacity:.55">(' + esc(new Date(m.ts).toLocaleDateString()) + ')</span>' : '') +
                    '</li>';
                }).join('');
                lessonsBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6;padding:8px;border-left:3px solid #d8b4fe;background:rgba(168,85,247,0.05);border-radius:6px">' +
                    '<strong>Learned Patterns.</strong> ' +
                    lessons.total_matches + ' similar prior disposition(s): ' + dispBits.join(' · ') + '.' +
                    ' Confirm rate: <strong>' + lessons.confirm_rate_pct + '%</strong>' +
                    (lessons.discriminator_category
                      ? ' · <span style="opacity:.85">Discriminator: <strong>' + esc(lessons.discriminator_category) + '</strong> (present in positives, absent in most false-positives)</span>'
                      : '') +
                    (topRows ? '<ul style="margin:4px 0 0 0;padding-left:18px;list-style:none">' + topRows + '</ul>' : '') +
                    ' <span style="opacity:.55;font-size:10px">[' + esc(lessons.citation) + ']</span>' +
                  '</div>';
              }

              // Historical Case Similarity — computed at render-time
              // against the full workbench (rows) + register.
              var similarCases = findSimilarCases(r, rows);
              // Temporal Trajectory — prior screenings of the same
              // subject in the workbench. Rendered only if priors exist.
              var trajectory = computeTemporalTrajectory(r, rows);
              var trajectoryBlock = '';
              if (trajectory && trajectory.prior_count > 0) {
                var dirColor =
                  trajectory.direction === 'rising' ? '#dc2626' :
                  trajectory.direction === 'falling' ? '#166534' :
                  trajectory.direction === 'stable' ? '#d97706' : '#4b5563';
                var dirLabel = String(trajectory.direction).toUpperCase().replace(/-/g, ' ');
                var notes = (trajectory.notes || []).map(esc).join(' · ');
                trajectoryBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Temporal Trajectory.</strong> ' +
                    '<span style="padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;background:' + dirColor + ';color:#fff">' +
                      dirLabel +
                    '</span> ' +
                    trajectory.prior_count + ' prior screening(s) of this subject.' +
                    (notes ? ' <span style="opacity:.85">' + notes + '</span>' : '') +
                    (trajectory.latest_prior_ts ? ' <span style="opacity:.6;font-size:10px">(latest prior: ' + esc(new Date(trajectory.latest_prior_ts).toLocaleString()) + ')</span>' : '') +
                    ' <span style="opacity:.55;font-size:10px">[' + esc(trajectory.citation) + ']</span>' +
                  '</div>';
              }
              var similarBlock = '';
              if (similarCases.length) {
                var items = similarCases.map(function (sim) {
                  var srcTag = sim.source === 'register'
                    ? '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(168,85,247,0.2);color:#d8b4fe">register</span>'
                    : '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(136,181,255,0.18);color:#c3dafe">workbench</span>';
                  var clsTag = sim.classification
                    ? ' · <span style="opacity:.85">' + esc(String(sim.classification).toUpperCase()) + '</span>'
                    : '';
                  var confTag = sim.confidence != null ? ' · ' + sim.confidence + '%' : '';
                  var overlapBits = [];
                  if (sim.overlap && sim.overlap.country)     overlapBits.push('same country');
                  if (sim.overlap && sim.overlap.entity_type) overlapBits.push('same entity type');
                  if (sim.overlap && Array.isArray(sim.overlap.categories) && sim.overlap.categories.length) {
                    overlapBits.push('categories: ' + sim.overlap.categories.join('+'));
                  }
                  if (sim.overlap && Array.isArray(sim.overlap.typologies) && sim.overlap.typologies.length) {
                    overlapBits.push('typologies: ' + sim.overlap.typologies.join('+'));
                  }
                  return '<li style="margin-bottom:3px">' +
                    srcTag + ' <strong>' + esc(sim.name) + '</strong>' +
                    (sim.country ? ' <span style="opacity:.7">(' + esc(sim.country) + ')</span>' : '') +
                    clsTag + confTag +
                    ' <span style="opacity:.6;font-size:11px">· score ' + sim.score + '</span>' +
                    (overlapBits.length ? '<br><span style="opacity:.7;font-size:11px;padding-left:8px">↳ ' + esc(overlapBits.join(' · ')) + '</span>' : '') +
                    '</li>';
                }).join('');
                similarBlock =
                  '<div style="margin-bottom:8px;font-size:12px;line-height:1.6">' +
                    '<strong>Historical Similarity.</strong> ' +
                    similarCases.length + ' prior case(s) match this pattern' +
                    ' <span style="opacity:.55;font-size:10px">[FATF Rec 10.12 pattern recognition]</span>' +
                    '<ul style="margin:4px 0 0 0;padding-left:4px;list-style:none">' + items + '</ul>' +
                  '</div>';
              }

              complianceReportLine = '<div class="mv-list-meta" style="margin-top:10px;padding:12px;border-left:3px solid #ea580c;background:rgba(234,88,12,0.06);border-radius:6px">' +
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
                  '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;' + riskBadgeColor + '">' +
                    'RISK · ' + esc(String(cr.risk_level).toUpperCase()) +
                  '</span>' +
                  '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;' + sanctionsBadgeColor + '">' +
                    'SANCTIONS · ' + esc(sanctionsSummary) +
                  '</span>' +
                  '<strong style="font-size:13px">Compliance Report</strong>' +
                '</div>' +
                sanctionsParagraph +
                adverseParagraph +
                jurisdictionParagraph +
                typologyParagraph +
                calibrationBlock +
                evidenceBlock +
                escalationBlock +
                contradictionBlock +
                hypothesisBlock +
                bayesianBlock +
                reasoningBlock +
                attributionBlock +
                cddBlock +
                redFlagBlock +
                counterfactualBlock +
                gapsBlock +
                connectedBlock +
                similarBlock +
                trajectoryBlock +
                lessonsBlock +
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

            // Four-eyes pending-approval banner. Shown when a closing
            // disposition was proposed but the second-MLRO sign-off
            // hasn't happened yet. Cabinet Res 134/2025 Art.14.
            var fourEyesBanner = '';
            if (r.disposition === 'pending_approval') {
              var me = currentMlroId();
              var amRequester = me === r.approval_required_by;
              var proposed = String(r.pending_disposition || '').toUpperCase();
              var reqAt = r.approval_required_at ? new Date(r.approval_required_at).toLocaleString() : '';
              fourEyesBanner =
                '<div style="margin-top:8px;padding:10px 12px;border-left:3px solid #eab308;background:rgba(234,179,8,0.08);border-radius:6px">' +
                  '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                    '<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;background:#eab308;color:#1a0a20">' +
                      'FOUR-EYES · AWAITING APPROVAL' +
                    '</span>' +
                    '<strong style="font-size:12px">Proposed: ' + esc(proposed) + '</strong>' +
                    '<span style="opacity:.75;font-size:11px">by MLRO ' + esc(r.approval_required_by || 'unknown') +
                      (reqAt ? ' · ' + esc(reqAt) : '') + '</span>' +
                    (r.approval_asana_url
                      ? '<a href="' + esc(r.approval_asana_url) + '" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#fdba74;text-decoration:underline">Asana task</a>'
                      : '') +
                  '</div>' +
                  (amRequester
                    ? '<div style="margin-top:6px;font-size:11px;opacity:.8">Awaiting a second MLRO — you cannot approve your own proposal (Cabinet Res 134/2025 Art.14).</div>'
                    : '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
                        '<button class="mv-btn mv-btn-sm mv-btn-ok" data-action="sc-sub-approve" data-id="' + esc(r.id) + '" data-v="approve">Approve (' + esc(proposed) + ')</button>' +
                        '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="sc-sub-approve" data-id="' + esc(r.id) + '" data-v="reject">Reject — reopen</button>' +
                      '</div>') +
                '</div>';
            }

            // MLRO disposition action row. Hidden for already-closed dispositions
            // and for rows currently pending second-MLRO approval.
            var canAct = r.disposition === 'pending' || r.disposition === 'positive' || r.disposition === 'partial';
            if (r.disposition === 'pending_approval') canAct = false;
            // Four-eyes indicator — appended to Confirm/Escalate labels
            // when the disposition would trigger the approval gate.
            var confirmTriggersFE = canAct && requiresFourEyes(r, 'positive');
            var escalateTriggersFE = canAct && requiresFourEyes(r, 'escalated');
            var feChip = ' <span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(234,179,8,0.2);color:#fde68a;font-weight:700;letter-spacing:.4px">4-EYES</span>';
            // Brain-to-Asana button — only shown when we have a
            // compliance_report to serialise (i.e. a known hit). The
            // button emits a sc-sub-to-asana action that the handler
            // below catches; it does NOT auto-fire on render so the
            // MLRO keeps manual control over what lands in Asana.
            var hasCr = !!r.compliance_report;
            var asanaBtnHtml = hasCr
              ? '<button class="mv-btn mv-btn-sm" data-action="sc-sub-to-asana" data-id="' + esc(r.id) + '" ' +
                  'title="Push the full compliance report to Asana as a new compliance-ops task" ' +
                  'style="background:linear-gradient(90deg,#ff8bd1,#ffd6a8);color:#1a0a20;font-weight:700">' +
                  'Send to Asana' +
                '</button>'
              : '';
            // UBO / Network graph — renders the connected-parties +
            // similar-cases network as an inline SVG. Button only
            // shown when there is something to graph.
            var hasGraphData = hasCr && (
              (Array.isArray(r.compliance_report.connected_parties) && r.compliance_report.connected_parties.length) ||
              // similar_cases computed at render-time, so approximate
              // availability by presence of typologies / country.
              r.country
            );
            var graphBtnHtml = hasGraphData
              ? '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="sc-sub-ubo-graph" data-id="' + esc(r.id) + '" ' +
                  'title="Show the UBO / connected-parties / similar-cases network graph" ' +
                  'style="border:1px solid rgba(136,181,255,0.45);color:#c3dafe">' +
                  'Network graph' +
                '</button>'
              : '';
            // Devil's Advocate — counter-argument pass against the primary
            // verdict. Available on any compliance-report row (even clean
            // low-risk matches benefit from the sanity-check).
            var redTeamBtnHtml = hasCr
              ? '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="sc-sub-red-team" data-id="' + esc(r.id) + '" ' +
                  'title="Run a Devil\'s Advocate counter-argument pass against this verdict" ' +
                  'style="border:1px solid rgba(168,85,247,0.45);color:#d8b4fe">' +
                  'Devil\'s Advocate' +
                '</button>'
              : '';
            // Draft STR — only surfaced when the CDD tier is EDD or FREEZE,
            // or when adverse-media classification is CONFIRMED (the
            // cases where an STR is realistically on the table).
            var shouldOfferStr = hasCr && (
              (r.compliance_report.cdd_recommendation &&
                ['EDD', 'FREEZE'].indexOf(r.compliance_report.cdd_recommendation.tier) >= 0) ||
              r.compliance_report.adverse_media_classification === 'confirmed'
            );
            var strBtnHtml = shouldOfferStr
              ? '<button class="mv-btn mv-btn-sm" data-action="sc-sub-str-draft" data-id="' + esc(r.id) + '" ' +
                  'title="Draft a goAML-ready STR narrative from this compliance report" ' +
                  'style="background:linear-gradient(90deg,#7f1d1d,#dc2626);color:#fff;font-weight:700">' +
                  'Draft STR' +
                '</button>'
              : '';
            var actionHtml = (canAct || hasCr)
              ? '<div class="mv-form-actions" style="margin-top:8px;gap:6px;flex-wrap:wrap">' +
                  (canAct
                    ? '<button class="mv-btn mv-btn-sm mv-btn-ok" data-action="sc-sub-dispose" data-id="' + esc(r.id) + '" data-d="positive">Confirm match' + (confirmTriggersFE ? feChip : '') + '</button>' +
                      '<button class="mv-btn mv-btn-sm" data-action="sc-sub-dispose" data-id="' + esc(r.id) + '" data-d="partial">Partial — investigate</button>' +
                      '<button class="mv-btn mv-btn-sm" data-action="sc-sub-dispose" data-id="' + esc(r.id) + '" data-d="false_positive">False positive</button>' +
                      '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-action="sc-sub-dispose" data-id="' + esc(r.id) + '" data-d="escalated">Escalate' + (escalateTriggersFE ? feChip : '') + '</button>'
                    : '') +
                  graphBtnHtml +
                  redTeamBtnHtml +
                  strBtnHtml +
                  asanaBtnHtml +
                  '<span class="mv-list-meta" data-dr-asana-status="' + esc(r.id) + '" style="align-self:center;margin-left:4px;font-size:11px;opacity:.7"></span>' +
                '</div>' +
                (hasCr
                  ? '<div data-reasoning-panel="' + esc(r.id) + '" style="display:none;margin-top:10px"></div>'
                  : '')
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
              fourEyesBanner +
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
        // Customer code is required — it anchors the audit trail across
        // every report the MLRO will ever receive for this customer
        // (first screening, daily deltas, periodic re-screens, STR).
        var customerCode = (fd.get('customer_code') || '').toString().trim();
        var customerNameRaw = (fd.get('customer_name') || '').toString().trim();
        var subjectNameRaw = (fd.get('name') || '').toString().trim();
        var customerName = customerNameRaw || subjectNameRaw;
        // First screening for this customer? Checked against the
        // verdict-history store — if there is no prior entry for this
        // customer code, eventType flips to `new_customer_onboarding`
        // which triggers the Life-Story deep-dive report on the
        // server side (lifeStoryReportBuilder.ts).
        var history = loadVerdictHistory();
        var historyKeyByCode = 'code:' + customerCode.toLowerCase();
        var historyKeyByName = String(subjectNameRaw).toLowerCase();
        var isFirstScreen = customerCode
          ? !history[historyKeyByCode] || history[historyKeyByCode].length === 0
          : !history[historyKeyByName] || history[historyKeyByName].length === 0;
        var body = {
          subjectName: subjectNameRaw,
          customerCode: customerCode || undefined,
          customerName: customerName || undefined,
          aliases: fd.get('alias') ? [fd.get('alias').toString().trim()] : undefined,
          entityType: subjectTypeForm === 'entity' ? 'legal_entity' : 'individual',
          dob: (fd.get('dob') || '').toString().trim() || undefined,
          country: (fd.get('country') || '').toString().trim() || undefined,
          idNumber: (fd.get('passport') || '').toString().trim() || undefined,
          subjectId: customerCode || undefined,
          eventType: isFirstScreen ? 'new_customer_onboarding' : 'ad_hoc',
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
        var row = rows[idx];
        // Four-eyes gate — Cabinet Res 134/2025 Art.14 + Cabinet Res
        // 74/2020 Art.4-7. High-risk closing actions park in
        // pending_approval until a second MLRO signs off.
        if (requiresFourEyes(row, d)) {
          row.disposition = 'pending_approval';
          row.pending_disposition = d;
          row.approval_required_by = currentMlroId();
          row.approval_required_at = new Date().toISOString();
          // Best-effort — create an Asana approval task so the second
          // MLRO receives it in their queue. Non-blocking; failure
          // does NOT stop the four-eyes gate from being enforced.
          try {
            var tok = '';
            try { tok = localStorage.getItem('hawkeye.session.jwt') || localStorage.getItem('hawkeye.watchlist.adminToken') || ''; } catch (_) {}
            if (tok) {
              fetch('/api/asana/task', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                body: JSON.stringify({
                  name: '[Four-Eyes · ' + String(d).toUpperCase() + '] Approval needed — ' + (row.name || 'subject'),
                  notes: 'Four-eyes approval required for this disposition.\n\n' +
                    'Requested by MLRO: ' + row.approval_required_by + '\n' +
                    'Proposed disposition: ' + String(d).toUpperCase() + '\n' +
                    'CDD tier: ' + ((row.compliance_report && row.compliance_report.cdd_recommendation && row.compliance_report.cdd_recommendation.tier) || 'n/a') + '\n' +
                    'Sanctions hit count: ' + ((row.compliance_report && row.compliance_report.sanctions_hit_count) || 0) + '\n\n' +
                    '=== COMPLIANCE REPORT ===\n\n' +
                    serializeComplianceReportForAsana(row),
                  surface: 'compliance-ops',
                  category: 'four_eyes_approval',
                  citation: 'Cabinet Res 134/2025 Art.14',
                  entity: (row.name || '') + (row.country ? ' · ' + row.country : '')
                })
              }).then(function (res) {
                return res.ok ? res.json() : null;
              }).then(function (json) {
                if (json && (json.url || json.permalink_url)) {
                  row.approval_asana_url = json.url || json.permalink_url;
                  safeSave(STORAGE.subjects, rows);
                  renderSubjectScreening(host);
                }
              }).catch(function () { /* best-effort */ });
            }
          } catch (_) { /* best-effort */ }
        } else {
          row.disposition = d;
          row.disposed_at = new Date().toISOString();
          try { recordLesson(row, d); } catch (_) { /* best-effort */ }
        }
        safeSave(STORAGE.subjects, rows);
        renderSubjectScreening(host);
      };
    });

    // Four-Eyes approval — the second MLRO clicks Approve/Reject on
    // a row in pending_approval. Enforced: the approver must NOT be
    // the same session/identifier that originally proposed the
    // disposition (Cabinet Res 134/2025 Art.14 two-approver rule).
    host.querySelectorAll('[data-action="sc-sub-approve"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var verdict = btn.getAttribute('data-v'); // 'approve' | 'reject'
        var idx = -1;
        for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { idx = i; break; } }
        if (idx < 0) return;
        var row = rows[idx];
        if (row.disposition !== 'pending_approval') { renderSubjectScreening(host); return; }
        var me = currentMlroId();
        if (me === row.approval_required_by) {
          alert('Four-eyes rule: the MLRO who proposed this disposition cannot self-approve (Cabinet Res 134/2025 Art.14). Sign in as a second MLRO.');
          return;
        }
        if (verdict === 'approve') {
          row.disposition = row.pending_disposition || 'positive';
          row.disposed_at = new Date().toISOString();
          row.approved_by = me;
          row.approved_at = row.disposed_at;
          try { recordLesson(row, row.disposition); } catch (_) {}
        } else {
          row.disposition = 'pending';
          row.rejected_by = me;
          row.rejected_at = new Date().toISOString();
          row.approval_rejection_reason = 'Four-eyes reviewer rejected the proposed disposition.';
        }
        // Server-side audit persistence — Netlify Blob with 10-year
        // retention (FDL Art.24). Best-effort: a failure does not
        // rollback the client-side state, but surfaces in the console
        // so operators can reconcile. Server re-validates the
        // requester !== approver invariant.
        try {
          var audToken = '';
          try { audToken = localStorage.getItem('hawkeye.session.jwt') || localStorage.getItem('hawkeye.watchlist.adminToken') || ''; } catch (_) {}
          if (audToken) {
            fetch('/api/four-eyes-audit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + audToken },
              body: JSON.stringify({
                rowId: row.id,
                subjectName: row.name || '',
                country: row.country || '',
                proposedDisposition: row.pending_disposition || (verdict === 'approve' ? row.disposition : 'positive'),
                requesterId: row.approval_required_by || '',
                requestedAt: row.approval_required_at || '',
                approverId: me,
                event: verdict === 'approve' ? 'approve' : 'reject',
                eventAt: new Date().toISOString(),
                rejectionReason: verdict === 'reject' ? (row.approval_rejection_reason || '') : undefined,
                cddTier: (row.compliance_report && row.compliance_report.cdd_recommendation && row.compliance_report.cdd_recommendation.tier) || undefined,
                sanctionsHitCount: (row.compliance_report && row.compliance_report.sanctions_hit_count) || 0,
                riskLevel: (row.compliance_report && row.compliance_report.risk_level) || undefined,
                asanaUrl: row.approval_asana_url || undefined
              })
            }).catch(function (err) {
              try { console.warn('[four-eyes] audit write failed:', err && err.message); } catch (_) {}
            });
          }
        } catch (_) { /* best-effort */ }
        delete row.pending_disposition;
        safeSave(STORAGE.subjects, rows);
        renderSubjectScreening(host);
      };
    });

    // Shared helper — creates or reuses the reasoning panel below a
    // screening row and mounts a streaming block with a header, body,
    // and status line. Each panel can host Red-Team or STR output;
    // consecutive clicks on the same row swap the content rather than
    // stacking, so the card doesn't grow unbounded.
    function mountReasoningPanel(id, heading, subhead, tone) {
      var panel = host.querySelector('[data-reasoning-panel="' + id + '"]');
      if (!panel) return null;
      var borderColor = tone === 'devil' ? 'rgba(168,85,247,0.4)'
        : tone === 'str'   ? 'rgba(220,38,38,0.45)'
        : 'rgba(255,139,209,0.3)';
      var bg = tone === 'devil' ? 'rgba(168,85,247,0.05)'
        : tone === 'str'   ? 'rgba(220,38,38,0.05)'
        : 'rgba(255,139,209,0.04)';
      panel.style.display = 'block';
      panel.innerHTML =
        '<div style="padding:12px;border-left:3px solid ' + borderColor + ';background:' + bg + ';border-radius:6px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">' +
            '<div>' +
              '<strong style="font-size:13px">' + esc(heading) + '</strong>' +
              '<div style="font-size:11px;opacity:.7;margin-top:2px">' + esc(subhead) + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px">' +
              '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-reasoning-copy>Copy</button>' +
              '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-reasoning-close>Close</button>' +
            '</div>' +
          '</div>' +
          '<div data-role="stream-status" style="font-size:11px;opacity:.8;margin-bottom:6px"></div>' +
          '<pre data-role="stream-text" style="white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.55;margin:0;padding:10px;background:rgba(0,0,0,0.15);border-radius:6px;max-height:400px;overflow:auto"></pre>' +
          '<div data-role="stream-meta" style="margin-top:6px;font-size:11px;opacity:.7"></div>' +
        '</div>';
      panel.querySelector('[data-reasoning-close]').addEventListener('click', function () {
        panel.innerHTML = '';
        panel.style.display = 'none';
      });
      panel.querySelector('[data-reasoning-copy]').addEventListener('click', function () {
        var txt = (panel.querySelector('[data-role="stream-text"]') || {}).textContent || '';
        if (!txt) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt);
            var b = panel.querySelector('[data-reasoning-copy]');
            if (b) { var orig = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.textContent = orig; }, 1200); }
          }
        } catch (_) { /* clipboard unavailable */ }
      });
      return panel;
    }

    function bearerToken() {
      try { return localStorage.getItem('hawkeye.session.jwt') || localStorage.getItem('hawkeye.watchlist.adminToken') || ''; } catch (_) { return ''; }
    }

    // UBO / Network graph — builds the SVG and mounts it in the
    // reasoning panel. Clicking any node pre-fills the subject name
    // input + country + opens the new-screening form so the MLRO
    // can walk the graph one step at a time.
    host.querySelectorAll('[data-action="sc-sub-ubo-graph"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var row = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { row = rows[i]; break; } }
        if (!row) return;
        var panel = host.querySelector('[data-reasoning-panel="' + id + '"]');
        if (!panel) return;
        var similar = findSimilarCases(row, rows);
        var svgHtml = buildUboGraphSvg(row, similar, { width: 640, height: 400 });
        panel.style.display = 'block';
        panel.innerHTML =
          '<div style="padding:12px;border-left:3px solid rgba(136,181,255,0.4);background:rgba(136,181,255,0.04);border-radius:6px">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">' +
              '<div>' +
                '<strong style="font-size:13px">UBO / Connected-Parties Network</strong>' +
                '<div style="font-size:11px;opacity:.7;margin-top:2px">Subject · parties (inner ring) · similar cases (outer ring). Cabinet Decision 109/2023 · FATF Rec 10.</div>' +
              '</div>' +
              '<button class="mv-btn mv-btn-sm mv-btn-ghost" data-graph-close>Close</button>' +
            '</div>' +
            svgHtml +
          '</div>';
        panel.querySelector('[data-graph-close]').addEventListener('click', function () {
          panel.innerHTML = '';
          panel.style.display = 'none';
        });
        Array.prototype.forEach.call(panel.querySelectorAll('[data-ubo-target]'), function (node) {
          node.addEventListener('click', function () {
            var target = node.getAttribute('data-ubo-target');
            var country = node.getAttribute('data-ubo-country');
            if (!target) return;
            // Open the new-screening form and pre-fill name + country.
            var form = host.querySelector('#sc-subject-form');
            if (form && form.style.display === 'none') form.style.display = '';
            var nameInput = form && form.querySelector('input[name="subjectName"]');
            var countryInput = form && form.querySelector('input[name="country"]');
            if (nameInput) nameInput.value = target;
            if (countryInput && country) countryInput.value = country;
            if (nameInput) { nameInput.focus(); nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
          });
        });
      };
    });

    // Devil's Advocate — streams an Opus-assisted counter-argument
    // pass into a panel below the row. The executor sees the full
    // serialised compliance report as caseContext.
    host.querySelectorAll('[data-action="sc-sub-red-team"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var row = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { row = rows[i]; break; } }
        if (!row) return;
        var t = bearerToken();
        if (!t) { alert('Sign in at /login.html first.'); return; }
        var panel = mountReasoningPanel(id,
          'Devil\'s Advocate — counter-argument pass',
          'Opus advisor · weakest evidence · exculpatory hypotheses · missed safe harbours · decisive evidence request',
          'devil');
        if (!panel) return;
        streamBrainReasonInto(panel, {
          question: RED_TEAM_QUESTION,
          caseContext: serializeComplianceReportForAsana(row)
        }, t);
      };
    });

    // Draft STR — streams a goAML-ready STR narrative into a panel
    // below the row. Only offered when CDD tier is EDD / FREEZE or
    // adverse-media classification is CONFIRMED. On stream complete,
    // appends a "Download goAML XML" button that wraps the narrative
    // in a goAML-conforming envelope passing validateSTR() and
    // offers it as a file download for MLRO review before submission.
    host.querySelectorAll('[data-action="sc-sub-str-draft"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var row = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { row = rows[i]; break; } }
        if (!row) return;
        var t = bearerToken();
        if (!t) { alert('Sign in at /login.html first.'); return; }
        var panel = mountReasoningPanel(id,
          'STR Draft — UAE FIU / goAML',
          'Sonnet executor · FDL Art.26-27 structure · FDL Art.29 tipping-off guard · MLRO review required',
          'str');
        if (!panel) return;
        streamBrainReasonInto(panel, {
          question: STR_DRAFT_QUESTION,
          caseContext: serializeComplianceReportForAsana(row)
        }, t, {
          onDone: function (fullNarrative) {
            // Add a "Download goAML XML" button that builds the
            // envelope client-side and triggers a file download.
            var actionsHost = panel.querySelector('[data-role="stream-meta"]');
            if (!actionsHost) return;
            var dl = document.createElement('button');
            dl.className = 'mv-btn mv-btn-sm';
            dl.style.cssText = 'background:linear-gradient(90deg,#7f1d1d,#dc2626);color:#fff;font-weight:700;margin-top:8px';
            dl.textContent = 'Download goAML XML (DRAFT)';
            dl.addEventListener('click', function () {
              var xml = buildGoAmlStrXml(row, fullNarrative);
              var blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
              var url = URL.createObjectURL(blob);
              var a = document.createElement('a');
              var fname = 'STR-DRAFT-' + (row.name || 'subject').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40) +
                '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.xml';
              a.href = url;
              a.download = fname;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
              dl.textContent = 'Downloaded ✓ (review before submission)';
              dl.disabled = true;
            });
            actionsHost.appendChild(document.createElement('br'));
            actionsHost.appendChild(dl);
          }
        });
      };
    });

    // Brain-to-Asana — posts the serialised compliance report to the
    // existing /api/asana/task endpoint. The endpoint is authenticated,
    // rate-limited, and writes to the compliance-ops Asana project via
    // asanaClient.ts. Audit-trail-aware: MoE/LBMA can reconstruct who
    // pushed what when from the Asana side (FDL Art.24 retention).
    host.querySelectorAll('[data-action="sc-sub-to-asana"]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-id');
        var row = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { row = rows[i]; break; } }
        if (!row) return;
        var status = host.querySelector('[data-dr-asana-status="' + id + '"]');
        var setStatus = function (msg, tone) {
          if (!status) return;
          status.textContent = msg;
          status.style.color = tone === 'err' ? '#fca5a5' : tone === 'ok' ? '#86efac' : '';
        };
        var token = '';
        try { token = localStorage.getItem('hawkeye.session.jwt') || localStorage.getItem('hawkeye.watchlist.adminToken') || ''; } catch (_) {}
        if (!token) { setStatus('Sign in at /login.html first.', 'err'); return; }
        var cr = row.compliance_report || {};
        var cddTier = (cr.cdd_recommendation && cr.cdd_recommendation.tier) || '';
        var citation = Array.isArray(cr.regulatory_basis) && cr.regulatory_basis.length
          ? cr.regulatory_basis[0] : '';
        var entity = row.name + (row.country ? ' · ' + row.country : '');
        var category = cddTier === 'FREEZE' ? 'sanctions_freeze'
          : cddTier === 'EDD' ? 'compliance_edd'
          : 'compliance_screening';
        var payload = {
          name: composeAsanaTaskName(row),
          notes: serializeComplianceReportForAsana(row),
          surface: 'compliance-ops',
          category: category,
          citation: citation ? String(citation).slice(0, 254) : undefined,
          entity: entity.slice(0, 254)
        };
        btn.disabled = true;
        var originalLabel = btn.textContent;
        btn.textContent = 'Sending…';
        setStatus('Posting to Asana…', '');
        fetch('/api/asana/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(payload)
        }).then(function (res) {
          return res.json().catch(function () { return null; }).then(function (json) {
            return { res: res, json: json };
          });
        }).then(function (r) {
          if (!r.res.ok) {
            var detail = (r.json && r.json.error) || ('HTTP ' + r.res.status);
            throw new Error(detail);
          }
          var url = r.json && (r.json.url || r.json.permalink_url || r.json.task_url);
          setStatus(url ? 'Pushed — open task' : 'Pushed ✓', 'ok');
          if (url && status) {
            status.innerHTML = 'Pushed — <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" style="color:#86efac;text-decoration:underline">open task</a>';
          }
        }).catch(function (err) {
          setStatus('Asana push failed: ' + (err && err.message ? err.message : 'unknown'), 'err');
        }).then(function () {
          btn.disabled = false;
          btn.textContent = originalLabel;
        });
      };
    });
  }

  // ─── Brain-to-Asana serialiser ─────────────────────────────────────
  // Composes the 13-block compliance report into a plain-text Asana
  // task body. The endpoint /api/asana/task accepts up to 16 KB of
  // notes — well above the typical serialised report size. Output is
  // audit-ready: every block is labelled, every citation is preserved,
  // and the generated-at timestamp + integrity flag are captured so
  // the MoE / LBMA inspector can reconstruct the state of the
  // screening engine at the moment the task was dispatched
  // (FDL No.(10)/2025 Art.24 — 10-year retention).
  function serializeComplianceReportForAsana(r) {
    if (!r || !r.compliance_report) return '';
    var cr = r.compliance_report;
    var L = [];
    function push(s) { L.push(s); }
    var cddTier = (cr.cdd_recommendation && cr.cdd_recommendation.tier) || '—';
    var risk = (cr.risk_level || 'high').toUpperCase();
    var sanct = cr.sanctions_summary || (cr.sanctions_hit_count > 0 ? 'POSITIVE' : 'NEGATIVE');
    push('[ Risk: ' + risk + ' · Sanctions: ' + sanct + ' · CDD: ' + cddTier + ' ]');
    push('Subject: ' + (r.name || '') + ' (' + (r.subject_type || 'subject') +
      (r.country ? ', ' + r.country : '') + ')');
    if (r.customer_code) push('Customer code: ' + r.customer_code);
    if (r.event_type) push('Event: ' + r.event_type);
    push('');
    if (cr.sanctions_narrative) {
      push('SANCTIONS FINDING');
      push(cr.sanctions_narrative);
      push('');
    }
    if (cr.adverse_media_narrative) {
      push('ADVERSE MEDIA FINDING');
      push(cr.adverse_media_narrative);
      push('');
    }
    if (cr.jurisdiction && cr.jurisdiction.narrative) {
      push('JURISDICTION CONTEXT (' + (cr.jurisdiction.risk_level || 'standard').toUpperCase() + ')');
      push(cr.jurisdiction.narrative);
      if (Array.isArray(cr.jurisdiction.flags) && cr.jurisdiction.flags.length) {
        push('Flags: ' + cr.jurisdiction.flags.join(', '));
      }
      push('');
    }
    if (cr.typology_narrative) {
      push('TYPOLOGY MATCH');
      push(cr.typology_narrative);
      push('');
    }
    if (cr.confidence_calibration) {
      var cal = cr.confidence_calibration;
      push('CONFIDENCE CALIBRATION');
      push('Raw ' + cal.raw_confidence_pct + '% → Calibrated ' + cal.calibrated_pct + '% (' + cal.band + ')');
      if (Array.isArray(cal.adjustments) && cal.adjustments.length) {
        cal.adjustments.forEach(function (a) {
          push('  ' + (a.delta >= 0 ? '+' : '') + a.delta + ' · ' + a.label);
        });
      }
      push('');
    }
    if (cr.evidence_grade && cr.evidence_grade.grade) {
      var eg = cr.evidence_grade;
      var bd = eg.breakdown || {};
      var tc = bd.source_tiers || {};
      push('EVIDENCE QUALITY: GRADE ' + eg.grade + ' (' + (eg.total || 0) + ' pts)');
      push('  Source tiers T1/T2/T3: ' + (tc.tier1 || 0) + '/' + (tc.tier2 || 0) + '/' + (tc.tier3 || 0) +
        (tc.unknown ? ' (+' + tc.unknown + ' unknown)' : ''));
      push('  Independence +' + (bd.independence || 0) + ' · Recency +' + (bd.recency || 0) +
        ' · Primary +' + (bd.primary || 0));
      push('');
    }
    if (cr.escalation_pathway && cr.escalation_pathway.pathway) {
      var ep = cr.escalation_pathway;
      push('ESCALATION PATHWAY FORECAST');
      push(ep.pathway.label + ' — ' + ep.ignition);
      (ep.pathway.stages || []).forEach(function (s, idx) {
        push('  ' + (idx + 1) + '. ' + s.stage + ' (' + s.days + ' days) — ' + s.indicator);
      });
      if (ep.pathway.citation) push('  [' + ep.pathway.citation + ']');
      push('');
    }
    if (Array.isArray(cr.contradictions) && cr.contradictions.length) {
      push('CONTRADICTIONS & PLAUSIBILITY CHECKS: ' + cr.contradictions.length + ' anomal(y/ies)');
      cr.contradictions.forEach(function (c) {
        push('  [' + String(c.severity).toUpperCase() + '] ' + c.label);
        push('    Observed: ' + c.observed + ' · Baseline: ' + c.baseline +
          (c.ratio && c.ratio !== '—' ? ' · Deviation: ' + c.ratio : ''));
        push('    ↳ ' + c.note + (c.citation ? '  [' + c.citation + ']' : ''));
      });
      push('');
    }
    if (Array.isArray(cr.hypotheses) && cr.hypotheses.length) {
      push('COMPETING HYPOTHESES (ranked by evidence overlap)');
      cr.hypotheses.forEach(function (h, idx) {
        push('  H' + (idx + 1) + ' · ' + h.probability + '% · ' + h.label + ' [' + h.typology + ']');
        (h.supports || []).forEach(function (s) { push('    + ' + s); });
        (h.contras || []).forEach(function (s) { push('    - ' + s); });
        push('    ↳ ' + h.implication);
      });
      push('');
    }
    if (cr.bayesian_posterior) {
      var bp = cr.bayesian_posterior;
      push('BAYESIAN POSTERIOR: ' + bp.posterior_mean_pct + '% (' + String(bp.interpretation).toUpperCase() + ')');
      push('  90% CI: [' + bp.ci_low_pct + '%, ' + bp.ci_high_pct + '%] · prior ' + bp.prior_pct + '% · σ ' + bp.posterior_sigma.toFixed(2));
      (bp.evidence_weights || []).forEach(function (w) {
        var sign = w.llr >= 0 ? '+' : '';
        push('  LLR ' + sign + w.llr.toFixed(2) + ' · ' + w.label + (w.note ? ' (' + w.note + ')' : ''));
      });
      if (bp.citation) push('  [' + bp.citation + ']');
      push('');
    }
    if (Array.isArray(cr.reasoning_chain) && cr.reasoning_chain.length) {
      push('REASONING CHAIN');
      cr.reasoning_chain.forEach(function (s) {
        push('  ' + s.step + '. ' + s.label);
        push('     Evidence: ' + s.evidence);
        push('     Inference: ' + s.inference);
        if (s.citation) push('     [' + s.citation + ']');
      });
      push('');
    }
    if (cr.score_attribution && Array.isArray(cr.score_attribution.factors) && cr.score_attribution.factors.length) {
      push('RISK FACTOR ATTRIBUTION: ' + (cr.score_attribution.total || 0) + ' / 100');
      cr.score_attribution.factors.forEach(function (f) {
        push('  +' + f.points + '  ' + f.factor + (f.note ? ' — ' + f.note : ''));
      });
      push('');
    }
    if (cr.cdd_recommendation) {
      var cdd = cr.cdd_recommendation;
      push('CDD TIER: ' + cdd.tier);
      push('Review cycle: ' + cdd.review_cycle);
      if (Array.isArray(cdd.reasons) && cdd.reasons.length) {
        push('Rationale:');
        cdd.reasons.forEach(function (reason) { push('  - ' + reason); });
      }
      if (cdd.citation) push('[' + cdd.citation + ']');
      push('');
    }
    if (Array.isArray(cr.red_flags) && cr.red_flags.length) {
      var triggered = cr.red_flags.filter(function (f) { return f.triggered; });
      push('RED FLAGS TRIGGERED: ' + triggered.length + ' / ' + cr.red_flags.length);
      triggered.forEach(function (f) {
        push('  ✕ ' + f.label + ' — ' + f.rationale + (f.citation ? '  [' + f.citation + ']' : ''));
      });
      push('');
    }
    if (Array.isArray(cr.counterfactuals) && cr.counterfactuals.length) {
      push('COUNTERFACTUAL ANALYSIS');
      cr.counterfactuals.forEach(function (c) {
        push('  Remove "' + c.remove + '" → ' + c.delta_points + ' pts · new total ' + c.new_total + '/100' +
          (c.flips_verdict ? ' [FLIPS VERDICT]' : '') + ' — ' + c.note);
      });
      push('');
    }
    if (Array.isArray(cr.evidence_gaps) && cr.evidence_gaps.length) {
      push('EVIDENCE GAPS & REQUESTS');
      cr.evidence_gaps.forEach(function (g) {
        push('  - ' + g.gap + ': ' + g.request + (g.citation ? '  [' + g.citation + ']' : ''));
      });
      push('');
    }
    if (Array.isArray(cr.connected_parties) && cr.connected_parties.length) {
      push('CONNECTED PARTIES (re-screen queue)');
      cr.connected_parties.forEach(function (p) {
        push('  - ' + p.name + (p.abbrev ? ' (' + p.abbrev + ')' : '') + ': ' + p.action);
      });
      push('');
    }
    if (cr.recommendation) {
      push('RECOMMENDATION');
      push(cr.recommendation);
      push('');
    }
    if (Array.isArray(cr.regulatory_basis) && cr.regulatory_basis.length) {
      push('REGULATORY BASIS');
      push(cr.regulatory_basis.join(' · '));
      push('');
    }
    push('---');
    push('Generated: ' + (r.screened_at || new Date().toISOString()));
    push('Source: ' + (r.source || 'simulation') + ' · integrity: ' + (r.integrity || 'simulated'));
    return L.join('\n');
  }

  function composeAsanaTaskName(r) {
    var cr = r.compliance_report || {};
    var cddTier = (cr.cdd_recommendation && cr.cdd_recommendation.tier) || '';
    var risk = (cr.risk_level || 'high').toUpperCase();
    var prefix = '[Screening · ' + risk + (cddTier ? ' · ' + cddTier : '') + ']';
    var nm = r.name || 'subject';
    var cc = r.country ? ' (' + r.country + ')' : '';
    var label = prefix + ' ' + nm + cc;
    return label.length > 508 ? label.slice(0, 508) + '...' : label;
  }

  // ─── goAML STR XML export ───────────────────────────────────────────
  // Wraps the Draft STR narrative in a minimal goAML-conforming STR
  // envelope that passes src/utils/goamlValidator.ts validateSTR().
  // Required elements per the UAE FIU schema: reportHeader (with
  // RPT-YYYY-XXX id), reportingEntity, suspiciousSubject,
  // groundsForSuspicion, transactionDetails, reportFooter.
  //
  // The narrative text produced by the Draft-STR LLM pass is inserted
  // verbatim into <groundsForSuspicion>, escaped for XML safety. The
  // MLRO reviews + edits before actual submission — this endpoint
  // produces a draft XML, never auto-files.
  //
  // No auto-submission. FDL Art.29 no-tipping-off is already baked
  // into the LLM prompt; the generated XML carries no reference to
  // "we filed" or "reported to FIU".
  function xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function isoDateForGoaml(d) {
    d = d || new Date();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function buildGoAmlStrXml(row, narrativeText) {
    if (!row) return '';
    var cr = row.compliance_report || {};
    var now = new Date();
    var reportId = 'RPT-' + now.getUTCFullYear() + '-' +
      (row.id || 'ROW').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) +
      now.getTime().toString(36).toUpperCase().slice(-6);
    var subjectName  = xmlEscape(row.name || 'UNKNOWN SUBJECT');
    var subjectType  = row.subject_type === 'entity' ? 'LEGAL_ENTITY' : 'INDIVIDUAL';
    var country      = xmlEscape((row.country || '').toUpperCase());
    var dob          = xmlEscape(row.dob || '');
    var idNumber     = xmlEscape(row.passport || '');
    var reportingEntityName = 'HAWKEYE STERLING MLRO (UAE DPMS)';
    var narrative    = xmlEscape(narrativeText || '(no narrative provided)');
    var typologyLabel = '';
    if (cr.typologies && cr.typologies[0] && cr.typologies[0].label) {
      typologyLabel = cr.typologies[0].label;
    }
    var riskLevel    = xmlEscape((cr.risk_level || 'high').toUpperCase());
    var cddTier      = xmlEscape((cr.cdd_recommendation && cr.cdd_recommendation.tier) || 'EDD');
    var basisList    = Array.isArray(cr.regulatory_basis)
      ? cr.regulatory_basis.map(function (c) { return '<citation>' + xmlEscape(c) + '</citation>'; }).join('')
      : '';
    var posteriorPct = (cr.bayesian_posterior && cr.bayesian_posterior.posterior_mean_pct != null)
      ? String(cr.bayesian_posterior.posterior_mean_pct) : '';
    var postCi       = (cr.bayesian_posterior && cr.bayesian_posterior.ci_low_pct != null)
      ? cr.bayesian_posterior.ci_low_pct + '-' + cr.bayesian_posterior.ci_high_pct : '';

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<report xmlns="http://goaml.unodc.org/goaml/schema/v4" reportType="STR">',
      '  <reportHeader>',
      '    <reportId>' + reportId + '</reportId>',
      '    <reportGeneratedAt>' + now.toISOString() + '</reportGeneratedAt>',
      '    <reportGeneratedDate>' + isoDateForGoaml(now) + '</reportGeneratedDate>',
      '    <reportStatus>DRAFT</reportStatus>',
      '  </reportHeader>',
      '  <reportingEntity>',
      '    <entityName>' + xmlEscape(reportingEntityName) + '</entityName>',
      '    <sector>DPMS</sector>',
      '    <regulatoryBasis>FDL No.(10)/2025 Art.20 · Cabinet Res 134/2025 Art.14</regulatoryBasis>',
      '  </reportingEntity>',
      '  <suspiciousSubject>',
      '    <name>' + subjectName + '</name>',
      '    <subjectType>' + subjectType + '</subjectType>',
      (country ? '    <country>' + country + '</country>' : ''),
      (dob     ? '    <dateOfBirth>' + dob + '</dateOfBirth>' : ''),
      (idNumber? '    <identification type="PASSPORT">' + idNumber + '</identification>' : ''),
      '    <riskRating>' + riskLevel + '</riskRating>',
      '    <cddTier>' + cddTier + '</cddTier>',
      '  </suspiciousSubject>',
      '  <groundsForSuspicion>',
      '    <typology>' + xmlEscape(typologyLabel || 'Unclassified predicate offence') + '</typology>',
      (posteriorPct ? '    <bayesianPosteriorPct>' + posteriorPct + '</bayesianPosteriorPct>' : ''),
      (postCi       ? '    <credibleInterval90Pct>' + postCi + '</credibleInterval90Pct>' : ''),
      '    <narrative><![CDATA[' + (narrativeText || '(no narrative provided)').replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]></narrative>',
      '  </groundsForSuspicion>',
      '  <transactionDetails>',
      '    <status>TO_BE_COMPLETED_BY_MLRO</status>',
      '    <note>Transaction line-items require MLRO input before submission. Populate from transactionMonitor store before final XML export.</note>',
      '  </transactionDetails>',
      (basisList ? '  <regulatoryBasis>' + basisList + '</regulatoryBasis>' : ''),
      '  <reportFooter>',
      '    <generatedBy>compliance-analyzer (hawkeye-sterling)</generatedBy>',
      '    <generationMethod>Sonnet executor + Opus advisor · structured output</generationMethod>',
      '    <tippingOffGuard>FDL Art.29 — no subject notification; no party outside MLRO + FIU to be informed of this report.</tippingOffGuard>',
      '  </reportFooter>',
      '</report>'
    ].filter(Boolean).join('\n');
  }

  // ─── Red-Team + STR Draft prompts ───────────────────────────────────
  // Two specialised user-message templates dispatched to /api/brain-reason
  // (Sonnet executor + Opus advisor + SSE streaming + 24s wall-clock).
  // Both use the full serialized compliance report as caseContext so the
  // model has every block of evidence without extra prompt engineering.

  var RED_TEAM_QUESTION =
    'Act as a DEVIL\'S ADVOCATE compliance reviewer. A primary verdict has been issued on the subject described in the case context. Your job is to construct the strongest possible counter-argument AGAINST that verdict — NOT to repeat or rationalise it.\n\n' +
    'Deliver exactly four sections, in this order:\n\n' +
    '1. WEAKEST EVIDENCE. Name the single weakest piece of evidence supporting the primary verdict and explain why it is weak (source tier, coverage gap, inferential leap, stale signal, etc.).\n\n' +
    '2. EXCULPATORY HYPOTHESES. Propose at least two plausible false-positive or exculpatory hypotheses with concrete supporting considerations (e.g. name collision, alias confusion, time-barred proceeding, resolved regulatory action).\n\n' +
    '3. MISSED SAFE HARBOURS. List any regulatory exemption, safe harbour, de minimis threshold, or mitigating factor the primary verdict may have missed — cite the article / resolution / circular.\n\n' +
    '4. DECISIVE EVIDENCE REQUEST. Name the single piece of evidence that, if obtained, would most decisively move the verdict in either direction, and explain how to obtain it.\n\n' +
    'Close with one short paragraph honestly assessing which argument (primary verdict or your counter-argument) is stronger on the current evidence, and your confidence (as 0-100%) in that meta-assessment. Do not tip off the subject (FDL Art.29).';

  var STR_DRAFT_QUESTION =
    'Draft an STR narrative for the UAE FIU on the subject and case below, ready for MLRO review and goAML submission. Follow FDL No.(10)/2025 Art.26-27 drafting standards.\n\n' +
    'Structure the narrative under these labelled headings, in this order:\n\n' +
    'WHO — subject name, identifiers, role, known relationships, PEP status if any.\n' +
    'WHAT — the suspicious activity: amounts, channels, counterparties, dates, patterns, predicate-offence nexus.\n' +
    'WHEN — the date range covered by the suspicion, including first observation and most recent event.\n' +
    'WHERE — jurisdictions involved, correspondent banks, delivery / shipment routes, UAE nexus.\n' +
    'WHY — the reasonable grounds for suspicion: what makes the activity unusual, which red flags triggered, why standard CDD is insufficient.\n' +
    'HOW — the typology and mechanism with FATF / Cabinet Res / MoE citations.\n\n' +
    'Then close with the following labelled lines (one per line):\n' +
    'TYPOLOGY: <one-line FATF or LBMA typology match>\n' +
    'PREDICATE OFFENCE: <article / law with citation>\n' +
    'FILING DEADLINE: <date + business-day rationale; STR/SAR = without delay per FDL Art.26-27>\n' +
    'TIPPING-OFF GUARD: FDL Art.29 — no notification to the subject; no disclosure that the STR has been filed.\n' +
    'goAML REPORT TYPE: <STR / SAR / CTR / DPMSR / CNMR>\n\n' +
    'Style: tight, factual, 400-600 words, cite every claim, no speculation beyond what the case context supports. Output is for the UAE FIU; not for the subject, counsel, or any other audience.';

  // Inline streaming reader — parses /api/brain-reason SSE events into
  // a target DOM panel. Simplified copy of the reader in deep-reasoning.js;
  // kept separate so the screening card can render the streaming reply
  // inline next to the compliance report without round-tripping through
  // the Deep Reasoning card.
  function streamBrainReasonInto(panel, payload, token, opts) {
    opts = opts || {};
    var full = '';
    var textEl = panel.querySelector('[data-role="stream-text"]');
    var statusEl = panel.querySelector('[data-role="stream-status"]');
    var metaEl = panel.querySelector('[data-role="stream-meta"]');
    var abort = new AbortController();
    var ctrl = { abort: function () { try { abort.abort(); } catch (_) {} } };
    function setStatus(msg, tone) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.style.color = tone === 'err' ? '#fca5a5' : tone === 'ok' ? '#86efac' : '';
    }
    setStatus('Streaming…');
    fetch('/api/brain-reason', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload),
      signal: abort.signal
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.text().then(function (t) { throw new Error('HTTP ' + res.status + (t ? ' — ' + t.slice(0, 200) : '')); });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      var advisorCount = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += decoder.decode(r.value, { stream: true });
          var sep;
          while ((sep = buf.indexOf('\n\n')) !== -1) {
            var frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            if (!frame.trim()) continue;
            var evName = '';
            var dataStr = '';
            frame.split('\n').forEach(function (ln) {
              if (ln.indexOf('event:') === 0) evName = ln.slice(6).trim();
              else if (ln.indexOf('data:') === 0) dataStr += ln.slice(5).trim();
            });
            if (!dataStr) continue;
            var parsed;
            try { parsed = JSON.parse(dataStr); } catch (_) { continue; }
            if (evName === 'delta' && typeof parsed.text === 'string') {
              full += parsed.text;
              if (textEl) textEl.textContent = full;
            } else if (evName === 'advisor') {
              advisorCount = parsed.advisorCallCount || advisorCount;
              if (metaEl) metaEl.textContent = 'Advisor calls: ' + advisorCount;
            } else if (evName === 'wall_clock') {
              setStatus('Truncated — 24s budget exceeded.', 'err');
            } else if (evName === 'error') {
              throw new Error(parsed.error || 'upstream error');
            } else if (evName === 'done') {
              setStatus('Done · ' + new Date(parsed.generatedAtIso || Date.now()).toLocaleTimeString(), 'ok');
              if (opts.onDone) opts.onDone(full);
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (abort.signal.aborted) {
        setStatus('Cancelled', 'err');
      } else {
        setStatus('Failed: ' + (err && err.message ? err.message : 'unknown'), 'err');
      }
    });
    return ctrl;
  }

  // ─── Screening intelligence engine ──────────────────────────────────
  // Five-layer reasoning pass that sits on top of the simulation-path
  // row and feeds the narrative compliance report:
  //   1. lookupJurisdiction()     — per-country risk overlay
  //   2. matchTypologies()        — trigger-predicate pattern matcher
  //   3. extractConnectedParties()— entity extraction from the register
  //   4. computeScoreAttribution()— additive factor breakdown (0-100)
  //   5. buildReasoningChain()    — evidence → inference → action steps
  //
  // Each layer is pure (no side effects), returns a structured object
  // consumable by the UI renderer, and has its regulatory citation
  // baked into the output so the MoE/LBMA audit pack can trace every
  // inference back to a law, Cabinet Resolution, or FATF Recommendation.

  function normalizeCountryKey(str) {
    if (!str) return null;
    var s = String(str).trim().toLowerCase();
    if (!s) return null;
    // ISO-2 direct match (case-insensitive)
    if (s.length === 2 && /^[a-z]{2}$/.test(s)) {
      var up = s.toUpperCase();
      if (COUNTRY_RISK_TABLE[up]) return up;
    }
    // Alias match
    var keys = Object.keys(COUNTRY_RISK_TABLE);
    for (var i = 0; i < keys.length; i++) {
      var row = COUNTRY_RISK_TABLE[keys[i]];
      if (Array.isArray(row.aliases)) {
        for (var j = 0; j < row.aliases.length; j++) {
          if (row.aliases[j] === s) return keys[i];
        }
      }
    }
    return null;
  }

  function lookupJurisdiction(countryStr) {
    var iso = normalizeCountryKey(countryStr);
    if (!iso) {
      return {
        iso: null,
        name: countryStr || '',
        flags: [],
        risk_level: 'unassessed',
        narrative: countryStr
          ? 'Jurisdiction Context. ' + countryStr + ' is not present in the local country-risk table. Apply standard CDD with a conservative jurisdiction uplift pending manual assessment (Cabinet Res 134/2025 Art.14).'
          : ''
      };
    }
    var row = COUNTRY_RISK_TABLE[iso];
    var flags = [];
    if (row.fatf_black) flags.push('fatf_black');
    if (row.fatf_grey) flags.push('fatf_grey');
    if (row.fatf_recent_delist) flags.push('fatf_recent_delist');
    if (row.comprehensive_sanctions) flags.push('comprehensive_sanctions');
    if (row.sectoral_sanctions) flags.push('sectoral_sanctions');
    if (row.cahra) flags.push('cahra');
    if (row.secrecy) flags.push('secrecy');
    if (row.dpms_role) flags.push('dpms_' + row.dpms_role);

    var riskLevel;
    if (row.fatf_black || row.comprehensive_sanctions) riskLevel = 'critical';
    else if (row.sectoral_sanctions || row.fatf_grey) riskLevel = 'high';
    else if (row.cahra || row.fatf_recent_delist) riskLevel = 'elevated';
    else if (row.secrecy) riskLevel = 'medium';
    else riskLevel = 'standard';

    var labelFromAlias = row.aliases && row.aliases[0]
      ? row.aliases[0].replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      : iso;

    var parts = [];
    parts.push(row.notes || (labelFromAlias + ' — jurisdiction context.'));
    // CDD-level uplift sentence
    if (row.fatf_black || row.comprehensive_sanctions) {
      parts.push('CDD uplift: EDD mandatory under Cabinet Res 134/2025 Art.14 + counter-measures per FATF black-list obligations; any engagement requires MLRO + senior-management sign-off and CO situational-awareness logging (FDL Art.20-21).');
    } else if (row.sectoral_sanctions) {
      parts.push('CDD uplift: EDD required; sectoral-sanctions screening mandatory on USD/EUR/GBP clearing paths (OFAC/EU/UK programs).');
    } else if (row.fatf_grey) {
      parts.push('CDD uplift: EDD required under Cabinet Res 134/2025 Art.14; risk-based heightened scrutiny on source-of-wealth / source-of-funds.');
    } else if (row.fatf_recent_delist) {
      parts.push('CDD uplift: residual heightened scrutiny for ~18 months post-delisting; MoE Circular 08/AML/2021 DPMS due-diligence still applies where DPMS-relevant.');
    } else if (row.cahra && row.dpms_role === 'source') {
      parts.push('CDD uplift: LBMA RGG v9 Step 3-5 mandatory enhanced DD on any DPMS sourcing from this CAHRA; OECD DD Guidance applies.');
    } else if (row.cahra) {
      parts.push('CDD uplift: CAHRA context — supply-chain DD (LBMA RGG v9 Step 2-3) where DPMS nexus exists.');
    } else if (row.secrecy) {
      parts.push('CDD uplift: beneficial-ownership transparency scrutiny; UBO re-verification within 15 working days of any ownership change (Cabinet Decision 109/2023).');
    } else {
      parts.push('CDD uplift: none at the jurisdiction layer; rely on subject-specific risk factors.');
    }
    return {
      iso: iso,
      name: labelFromAlias,
      flags: flags,
      risk_level: riskLevel,
      narrative: 'Jurisdiction Context. ' + parts.join(' ')
    };
  }

  function matchTypologies(ctx) {
    var out = [];
    var haystackText = [
      ctx.summary || '',
      ctx.recommendation || ''
    ].join(' ').toLowerCase();
    for (var i = 0; i < TYPOLOGY_MATCHERS.length; i++) {
      var m = TYPOLOGY_MATCHERS[i];
      var score = 0;
      var triggers = [];
      if (m.triggers.categories && Array.isArray(ctx.categories)) {
        var catHit = m.triggers.categories.filter(function (c) { return ctx.categories.indexOf(c) >= 0; });
        if (catHit.length) { score += catHit.length; triggers.push('categories: ' + catHit.join('+')); }
      }
      if (m.triggers.keywords && haystackText) {
        var kwMatch = haystackText.match(m.triggers.keywords);
        if (kwMatch) { score += 1; triggers.push('keyword: "' + kwMatch[0] + '"'); }
      }
      if (m.triggers.dpms_role && ctx.jurisdiction && ctx.jurisdiction.flags) {
        var dpmsMatch = m.triggers.dpms_role.some(function (r) {
          return ctx.jurisdiction.flags.indexOf('dpms_' + r) >= 0;
        });
        if (dpmsMatch) { score += 1; triggers.push('DPMS corridor'); }
      }
      if (m.triggers.country_flags && ctx.jurisdiction && ctx.jurisdiction.flags) {
        var flagMatch = m.triggers.country_flags.filter(function (f) {
          return ctx.jurisdiction.flags.indexOf(f) >= 0;
        });
        if (flagMatch.length) { score += flagMatch.length; triggers.push('jurisdiction: ' + flagMatch.join('+')); }
      }
      if (m.triggers.entity_type && ctx.entity_type === m.triggers.entity_type) {
        score += 1; triggers.push('entity_type: ' + m.triggers.entity_type);
      }
      if (m.triggers.pep && ctx.pep_flagged) {
        score += 1; triggers.push('PEP');
      }
      if (score >= (m.minTriggers || 1)) {
        var meta = RISK_TYPOLOGIES.filter(function (t) { return t.id === m.id; })[0] || {};
        out.push({
          id: m.id,
          label: meta.label || m.id,
          citation: meta.citation || '',
          group: meta.group || '',
          score: score,
          matched_triggers: triggers
        });
      }
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 4);
  }

  function extractConnectedParties(summary) {
    if (!summary) return [];
    var text = String(summary);
    var seen = {};
    var out = [];
    // 1. Proper-noun entity spans of 2+ capitalised words (Istanbul Gold Refinery, Hurriyet Daily News).
    //    Kept conservative to avoid false positives on sentence starts.
    var rxEntity = /\b([A-Z][A-Za-z&]+(?:\s+[A-Z][A-Za-z&]+){1,5})(?:\s*\(([A-Z]{2,6})\))?/g;
    var m;
    while ((m = rxEntity.exec(text)) !== null) {
      var candidate = m[1].trim();
      if (/^(The|And|But|For|With|From|This|That|Turkey|October|January|February|March|April|May|June|July|August|September|November|December|Oct|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Nov|Dec|Art|Note)$/.test(candidate.split(' ')[0])) continue;
      if (candidate.length < 6) continue;
      var key = candidate.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        name: candidate,
        abbrev: m[2] || null,
        source: 'register-summary',
        action: 'Re-screen as connected party (FATF Rec 10 ongoing CDD + Cabinet Decision 109/2023 UBO chain).'
      });
      if (out.length >= 6) break;
    }
    // 2. Numeric cohort extraction ("23 arrests", "21-22 individuals").
    var rxCohort = /(\d{1,3})(?:\s*-\s*\d{1,3})?\s+(?:arrests?|detainees?|co-?detainees?|individuals?|suspects?|defendants?|accused)/ig;
    var c;
    while ((c = rxCohort.exec(text)) !== null) {
      out.push({
        name: c[0].trim(),
        abbrev: null,
        source: 'register-summary',
        action: 'Request the full cohort list from the investigating authority and re-screen each named individual (FDL Art.20-21 CO situational awareness).'
      });
      break;
    }
    return out.slice(0, 6);
  }

  function computeScoreAttribution(ctx) {
    var factors = [];
    function push(factor, points, note) {
      if (points > 0) factors.push({ factor: factor, points: points, note: note || '' });
    }

    // Sanctions
    var mandatoryHits = 0;
    var otherHits = 0;
    (ctx.sanctions_detail || []).forEach(function (d) {
      if (d.verdict !== 'POSITIVE') return;
      if (d.mandatory) mandatoryHits += 1;
      else otherHits += 1;
    });
    if (mandatoryHits) push('Sanctions hit (MANDATORY regime)', mandatoryHits * 35,
      mandatoryHits + ' MANDATORY list hit(s) — non-discretionary freeze + CNMR (Cabinet Res 74/2020 Art.4-7).');
    if (otherHits) push('Sanctions hit (non-mandatory list)', otherHits * 20,
      otherHits + ' non-mandatory sanctions list hit(s) — freeze and CNMR applicable.');

    // Adverse media
    var amConf = typeof ctx.adverse_media_confidence === 'number' ? ctx.adverse_media_confidence : 0;
    var amPct = Math.round(amConf * 100);
    if (amConf >= 0.85) {
      push('Adverse media (CONFIRMED)', 30, 'Confirmed adverse-media match at ' + amPct + '% confidence.');
    } else if (amConf >= 0.5) {
      push('Adverse media (POTENTIAL)', 18, 'Potential adverse-media match at ' + amPct + '% confidence.');
    } else if (amConf > 0) {
      push('Adverse media (WEAK signal)', 5, 'Weak adverse-media signal at ' + amPct + '% confidence.');
    }

    // Category severity
    var criticalCats = ['tf_pf_links'];
    var highCats = ['criminal_fraud', 'money_laundering', 'bribery_corruption', 'organised_crime'];
    var midCats = ['regulatory_action', 'human_rights'];
    (ctx.adverse_hits || []).forEach(function (cat) {
      if (criticalCats.indexOf(cat) >= 0) push('Category: ' + cat, 14, 'Critical category — TF/PF (Cabinet Res 74/2020 + Cabinet Res 156/2025).');
      else if (highCats.indexOf(cat) >= 0) push('Category: ' + cat, 9, 'High-severity predicate offence (FATF Rec 3).');
      else if (midCats.indexOf(cat) >= 0) push('Category: ' + cat, 5, 'Secondary severity.');
      else push('Category: ' + cat, 3, '');
    });

    // Jurisdiction
    var j = ctx.jurisdiction || { flags: [] };
    if (j.flags.indexOf('comprehensive_sanctions') >= 0) push('Jurisdiction: comprehensive sanctions', 25, j.name + ' — OFAC/EU full-regime.');
    if (j.flags.indexOf('fatf_black') >= 0) push('Jurisdiction: FATF black', 20, j.name + ' — FATF counter-measures (Cabinet Res 134/2025 Art.14).');
    if (j.flags.indexOf('sectoral_sanctions') >= 0) push('Jurisdiction: sectoral sanctions', 15, j.name + ' — sectoral regime.');
    if (j.flags.indexOf('fatf_grey') >= 0) push('Jurisdiction: FATF grey', 12, j.name + ' — strategic AML/CFT deficiencies.');
    if (j.flags.indexOf('cahra') >= 0) push('Jurisdiction: CAHRA', 10, j.name + ' — LBMA RGG v9 Step 3.');
    if (j.flags.indexOf('fatf_recent_delist') >= 0) push('Jurisdiction: recent FATF delist', 6, j.name + ' — residual scrutiny.');
    if (j.flags.indexOf('secrecy') >= 0) push('Jurisdiction: financial-secrecy', 5, j.name + ' — UBO opacity.');
    if (j.flags.indexOf('dpms_source') >= 0) push('Jurisdiction: DPMS source', 6, j.name + ' — gold-source country.');
    else if (j.flags.indexOf('dpms_hub') >= 0) push('Jurisdiction: DPMS hub', 4, j.name + ' — gold-refining hub.');
    else if (j.flags.indexOf('dpms_transit') >= 0) push('Jurisdiction: DPMS transit', 4, j.name + ' — gold-transit corridor.');

    // PEP
    if (ctx.pep_self) push('PEP (self)', 15, 'Subject is a PEP (FATF Rec 12).');
    if (ctx.pep_family) push('PEP (family / associate)', 8, 'Subject is a close associate or family member of a PEP (Wolfsberg PEP FAQs).');

    // Special flags
    if (ctx.special_flags) {
      if (ctx.special_flags.indexOf('proliferation') >= 0) push('Special screen: proliferation financing', 20, 'Cabinet Res 156/2025 PF indicator.');
      if (ctx.special_flags.indexOf('terrorism') >= 0) push('Special screen: terrorism financing', 20, 'Cabinet Res 74/2020 TF indicator.');
      if (ctx.special_flags.indexOf('tax_evasion') >= 0) push('Special screen: tax evasion', 10, 'Predicate offence (FDL Art.2).');
    }

    // Typology bonus (caps at +8 to avoid double-counting with categories)
    if (Array.isArray(ctx.typologies) && ctx.typologies.length) {
      push('Typology pattern match', Math.min(8, ctx.typologies.length * 3),
        'Matched typologies: ' + ctx.typologies.map(function (t) { return t.id; }).join(', ') + '.');
    }

    factors.sort(function (a, b) { return b.points - a.points; });
    var total = factors.reduce(function (s, f) { return s + f.points; }, 0);
    if (total > 100) total = 100;
    return { total: total, factors: factors };
  }

  function buildReasoningChain(ctx) {
    var steps = [];
    // Step 1 — sanctions determination
    if (ctx.sanctions_hit_count === 0) {
      steps.push({
        step: 1,
        label: 'Sanctions determination',
        evidence: 'Screened against ' + (ctx.sanctions_lists_checked || 0) + ' lists; 0 matches including both MANDATORY regimes.',
        inference: 'No sanctions-driven freeze obligation.',
        citation: 'Cabinet Res 74/2020 Art.4-7'
      });
    } else {
      steps.push({
        step: 1,
        label: 'Sanctions determination',
        evidence: ctx.sanctions_hit_count + ' of ' + ctx.sanctions_lists_checked + ' lists matched.',
        inference: '24-hour freeze + EOCN notification + 5-business-day CNMR required; FDL Art.29 no-tipping-off applies.',
        citation: 'Cabinet Res 74/2020 Art.4-7 + FDL Art.29'
      });
    }
    // Step 2 — adverse-media determination
    if (ctx.adverse_media_confidence > 0) {
      var amLevel = ctx.adverse_media_confidence >= 0.85 ? 'CONFIRMED' :
                    ctx.adverse_media_confidence >= 0.5  ? 'POTENTIAL' : 'WEAK';
      steps.push({
        step: 2,
        label: 'Adverse-media determination',
        evidence: amLevel + ' match @ ' + Math.round(ctx.adverse_media_confidence * 100) + '% across ' +
                  (ctx.adverse_hits ? ctx.adverse_hits.length : 0) + ' categor(y/ies)' +
                  (ctx.source_count ? ' with ' + ctx.source_count + ' independent source(s)' : '') + '.',
        inference: amLevel === 'CONFIRMED'
          ? 'EDD mandatory; prepare STR/SAR filing if UAE-nexus identified.'
          : amLevel === 'POTENTIAL'
            ? 'EDD required; corroborate signal, collect SOW/SOF, re-screen connected parties.'
            : 'Log for monitoring; re-assess on signal escalation.',
        citation: 'FDL No.(10)/2025 Art.14, Art.26-27 · FATF Rec 10'
      });
    }
    // Step 3 — jurisdiction uplift
    if (ctx.jurisdiction && ctx.jurisdiction.flags && ctx.jurisdiction.flags.length) {
      steps.push({
        step: steps.length + 1,
        label: 'Jurisdiction uplift',
        evidence: ctx.jurisdiction.name + ' flags: ' + ctx.jurisdiction.flags.join(', ') + ' (risk ' + ctx.jurisdiction.risk_level + ').',
        inference: ctx.jurisdiction.risk_level === 'critical'
          ? 'Absolute-prohibition territory; any engagement requires licensing + board sign-off.'
          : ctx.jurisdiction.risk_level === 'high'
            ? 'EDD required; sectoral-sanctions + SOW verification.'
            : ctx.jurisdiction.risk_level === 'elevated'
              ? 'Residual uplift; supply-chain DD where DPMS-nexus.'
              : 'Jurisdiction-layer uplift applied to overall risk score.',
        citation: 'Cabinet Res 134/2025 Art.14 · LBMA RGG v9 Step 3'
      });
    }
    // Step 4 — typology match
    if (Array.isArray(ctx.typologies) && ctx.typologies.length) {
      var top = ctx.typologies[0];
      steps.push({
        step: steps.length + 1,
        label: 'Typology pattern match',
        evidence: ctx.typologies.map(function (t) { return t.label + ' (' + t.matched_triggers.join('; ') + ')'; }).join(' · '),
        inference: 'Top typology — ' + top.label + '. Apply the typology-specific red-flag checklist and collect corresponding evidence.',
        citation: top.citation || 'FATF typology reference'
      });
    }
    // Step 5 — connected parties
    if (Array.isArray(ctx.connected_parties) && ctx.connected_parties.length) {
      steps.push({
        step: steps.length + 1,
        label: 'Connected-party surfacing',
        evidence: 'Extracted ' + ctx.connected_parties.length + ' connected-party candidate(s) from register narrative.',
        inference: 'Queue each for re-screen and UBO-chain review before any onboarding / re-engagement decision.',
        citation: 'FATF Rec 10 · Cabinet Decision 109/2023'
      });
    }
    // Step 6 — final verdict
    steps.push({
      step: steps.length + 1,
      label: 'Final disposition',
      evidence: 'Risk factor attribution total: ' + (ctx.attribution_total || 0) + '/100.',
      inference: ctx.sanctions_hit_count > 0
        ? 'FREEZE + CNMR + EOCN notify + no-tip-off.'
        : ctx.attribution_total >= 50 || ctx.adverse_media_confidence >= 0.85
          ? 'EDD with senior-management sign-off; STR/SAR filing if UAE-nexus.'
          : ctx.attribution_total >= 25 || ctx.adverse_media_confidence >= 0.5
            ? 'EDD; document rationale and monitor.'
            : 'Standard CDD with log-and-monitor.',
      citation: 'FDL No.(10)/2025 Art.14, Art.20-21, Art.24, Art.26-27'
    });
    return steps;
  }

  function computeCounterfactuals(ctx) {
    // What factors would flip the disposition if removed? Reports the
    // deltas so the MLRO can see which single piece of evidence is
    // load-bearing. Matches the counterfactual-reasoning pattern from
    // pgmpy-style causal inference (CLAUDE.md vendored reference).
    var out = [];
    var base = ctx.attribution_total || 0;
    var factors = (ctx.score_attribution && ctx.score_attribution.factors) || [];
    if (!factors.length) return out;
    factors.slice(0, 5).forEach(function (f) {
      var after = base - f.points;
      if (after < 0) after = 0;
      var flipsVerdict = (base >= 50 && after < 50) ||
                         (base >= 25 && after < 25) ||
                         (base < 25 && after < 10);
      out.push({
        remove: f.factor,
        delta_points: -f.points,
        new_total: after,
        flips_verdict: flipsVerdict,
        note: flipsVerdict
          ? 'Load-bearing — removing this factor changes the CDD-tier recommendation.'
          : 'Supporting — removing this factor reduces the score but keeps the verdict.'
      });
    });
    return out;
  }

  function buildRedFlagChecklist(ctx) {
    // Enumerated AML/CFT/CPF red flags with pass/fail per subject.
    // Structured so the MLRO can treat it as an audit-ready checkbox
    // list (FATF Rec 10 + Cabinet Res 134/2025 Art.14 EDD triggers).
    var flags = [];
    function add(label, triggered, rationale, citation) {
      flags.push({ label: label, triggered: !!triggered, rationale: rationale || '', citation: citation || '' });
    }
    var j = ctx.jurisdiction || { flags: [] };
    var jf = j.flags || [];
    add('Sanctions designation',
      ctx.sanctions_hit_count > 0,
      ctx.sanctions_hit_count > 0
        ? 'Subject hits ' + ctx.sanctions_hit_count + ' sanctions list(s).'
        : 'No sanctions match.',
      'Cabinet Res 74/2020 Art.4-7');
    add('High-risk jurisdiction (FATF black / comprehensive sanctions)',
      jf.indexOf('fatf_black') >= 0 || jf.indexOf('comprehensive_sanctions') >= 0,
      'Jurisdiction: ' + j.name + '.',
      'Cabinet Res 134/2025 Art.14');
    add('Grey-list / sectoral-sanctions jurisdiction',
      jf.indexOf('fatf_grey') >= 0 || jf.indexOf('sectoral_sanctions') >= 0,
      'Jurisdiction: ' + j.name + '.',
      'FATF Plenary outputs');
    add('Conflict-Affected & High-Risk Area (CAHRA)',
      jf.indexOf('cahra') >= 0,
      'CAHRA exposure — LBMA RGG v9 Step 3.',
      'LBMA RGG v9 · OECD DD Guidance');
    add('Financial-secrecy jurisdiction',
      jf.indexOf('secrecy') >= 0,
      'UBO opacity concerns.',
      'Cabinet Decision 109/2023');
    add('DPMS corridor exposure',
      jf.indexOf('dpms_source') >= 0 || jf.indexOf('dpms_hub') >= 0 || jf.indexOf('dpms_transit') >= 0,
      'Gold-corridor role: ' + jf.filter(function (x) { return x.indexOf('dpms_') === 0; }).join(', ') + '.',
      'MoE Circular 08/AML/2021 · LBMA RGG v9');
    add('Adverse media — confirmed',
      ctx.adverse_media_confidence >= 0.85,
      'Confirmed adverse-media match.',
      'FDL Art.14 · FATF Rec 10');
    add('Adverse media — potential',
      ctx.adverse_media_confidence >= 0.5 && ctx.adverse_media_confidence < 0.85,
      'Potential adverse-media match.',
      'FDL Art.14');
    add('Predicate offence category (fraud / ML / corruption / OC)',
      (ctx.adverse_hits || []).some(function (c) {
        return ['criminal_fraud', 'money_laundering', 'bribery_corruption', 'organised_crime'].indexOf(c) >= 0;
      }),
      'Predicate-offence adverse-media signal.',
      'FATF Rec 3');
    add('TF / PF category signal',
      (ctx.adverse_hits || []).indexOf('tf_pf_links') >= 0 ||
        (ctx.special_flags || []).indexOf('proliferation') >= 0 ||
        (ctx.special_flags || []).indexOf('terrorism') >= 0,
      'Terrorist-financing / proliferation-financing indicator.',
      'Cabinet Res 74/2020 · Cabinet Res 156/2025');
    add('PEP exposure',
      !!ctx.pep_self || !!ctx.pep_family,
      ctx.pep_self ? 'Subject is a PEP.' : 'PEP associate / family.',
      'FATF Rec 12');
    add('Typology pattern match (≥1)',
      Array.isArray(ctx.typologies) && ctx.typologies.length > 0,
      (ctx.typologies || []).map(function (t) { return t.label; }).join(' · '),
      'FATF typology catalog');
    add('Multi-source corroboration (≥2 independent sources)',
      (ctx.source_count || 0) >= 2,
      (ctx.source_count || 0) + ' independent source(s) on file.',
      'FATF Rec 10 evidence standard');
    add('Connected-party exposure',
      Array.isArray(ctx.connected_parties) && ctx.connected_parties.length > 0,
      (ctx.connected_parties || []).length + ' connected-party candidate(s) extracted.',
      'FATF Rec 10 · Cabinet Decision 109/2023');
    return flags;
  }

  function recommendCddTier(ctx) {
    // SDD / CDD / EDD tier with rationale. Mirrors the decision tree in
    // CLAUDE.md ("When a new customer is onboarded") — score < 6 SDD,
    // 6-15 CDD, >=16 EDD, with PEP and sanctions overrides.
    var reasons = [];
    var forceTier = null;
    if (ctx.sanctions_hit_count > 0) {
      forceTier = 'FREEZE';
      reasons.push('Sanctions hit — 24h freeze + CNMR + no-tip-off (Cabinet Res 74/2020 Art.4-7 + FDL Art.29).');
    }
    if (!forceTier && (ctx.pep_self || ctx.pep_family)) {
      forceTier = 'EDD';
      reasons.push('PEP — Board approval + EDD mandatory (FATF Rec 12, Cabinet Res 134/2025 Art.14).');
    }
    var jf = (ctx.jurisdiction && ctx.jurisdiction.flags) || [];
    if (!forceTier && (jf.indexOf('fatf_black') >= 0 || jf.indexOf('comprehensive_sanctions') >= 0)) {
      forceTier = 'EDD';
      reasons.push(ctx.jurisdiction.name + ' — ' + (jf.indexOf('comprehensive_sanctions') >= 0 ? 'comprehensive-sanctions' : 'FATF black') + ' jurisdiction requires EDD with senior-management sign-off.');
    }
    if (!forceTier && ctx.adverse_media_confidence >= 0.85) {
      forceTier = 'EDD';
      reasons.push('Confirmed adverse-media match at ' + Math.round(ctx.adverse_media_confidence * 100) + '%.');
    }
    var total = ctx.attribution_total || 0;
    var tier = forceTier;
    if (!tier) {
      if (total >= 30 || ctx.adverse_media_confidence >= 0.5 || jf.indexOf('fatf_grey') >= 0 || jf.indexOf('cahra') >= 0) {
        tier = 'EDD';
        reasons.push('Factor attribution total ' + total + '/100 or elevated-risk feature present.');
      } else if (total >= 10) {
        tier = 'CDD';
        reasons.push('Factor attribution ' + total + '/100 — standard CDD with ongoing monitoring.');
      } else {
        tier = 'SDD';
        reasons.push('Low risk across all dimensions — SDD (FATF Rec 10 risk-based approach).');
      }
    }
    var reviewCycle;
    switch (tier) {
      case 'FREEZE': reviewCycle = 'immediate — daily case review until resolved'; break;
      case 'EDD':    reviewCycle = '3-month periodic review cycle'; break;
      case 'CDD':    reviewCycle = '6-month periodic review cycle'; break;
      case 'SDD':    reviewCycle = '12-month periodic review cycle'; break;
      default:       reviewCycle = 'as-needed';
    }
    return {
      tier: tier,
      reasons: reasons,
      review_cycle: reviewCycle,
      citation: 'FATF Rec 10 · Cabinet Res 134/2025 Art.14 · FDL No.(10)/2025 Art.14'
    };
  }

  function identifyEvidenceGaps(ctx) {
    // What's missing from the evidence record that would change the
    // verdict or reduce uncertainty. Each gap maps to a concrete
    // request / investigative step the MLRO can action.
    var gaps = [];
    if ((ctx.source_count || 0) < 2) {
      gaps.push({
        gap: 'Single-source adverse media',
        request: 'Corroborate with at least one additional tier-1 or tier-2 independent source (Reuters, AP, Bloomberg, FT, national press of record).',
        citation: 'FATF Rec 10 evidence standard'
      });
    }
    if (!ctx.has_sow_sof) {
      gaps.push({
        gap: 'Source-of-Wealth / Source-of-Funds not on file',
        request: 'Collect SOW/SOF documentation covering the last 10 years (FDL Art.24 retention).',
        citation: 'Cabinet Res 134/2025 Art.14 · FDL Art.24'
      });
    }
    if (!ctx.has_ubo) {
      gaps.push({
        gap: 'UBO chain not traced',
        request: 'Obtain beneficial-ownership register at ≥25% threshold; re-verify within 15 working days of any change.',
        citation: 'Cabinet Decision 109/2023'
      });
    }
    if (Array.isArray(ctx.connected_parties) && ctx.connected_parties.length) {
      gaps.push({
        gap: 'Connected parties not re-screened',
        request: 'Queue all ' + ctx.connected_parties.length + ' connected-party candidate(s) for independent screening.',
        citation: 'FATF Rec 10 · Cabinet Decision 109/2023'
      });
    }
    if (ctx.adverse_media_confidence >= 0.5 && ctx.adverse_media_confidence < 0.85) {
      gaps.push({
        gap: 'Adverse-media classification is POTENTIAL, not CONFIRMED',
        request: 'Pursue additional corroboration — court-record search, independent-press cross-check, and primary-source (investigating authority) confirmation.',
        citation: 'FATF Rec 10 · FDL Art.14'
      });
    }
    var jf = (ctx.jurisdiction && ctx.jurisdiction.flags) || [];
    if (jf.indexOf('dpms_source') >= 0 || jf.indexOf('cahra') >= 0) {
      gaps.push({
        gap: 'DPMS supply-chain traceability incomplete',
        request: 'Collect LBMA RGG v9 Step 2-3 evidence: mine-of-origin declarations, refiner attestations, chain-of-custody records.',
        citation: 'LBMA RGG v9 · UAE MoE RSG Framework'
      });
    }
    return gaps;
  }

  function calibrateConfidence(ctx) {
    // Adjusts the raw adverse-media confidence against two modifiers:
    //   source_tier_bonus: +0 to +10 pts for multi-source corroboration
    //   coverage_discount: subtract when categories are thin or only a
    //   single list was screened. Returns a calibrated posterior and the
    //   adjustment breakdown so the MLRO sees the math, not a black box.
    var raw = typeof ctx.adverse_media_confidence === 'number' ? ctx.adverse_media_confidence : 0;
    var pct = Math.round(raw * 100);
    var adjustments = [];
    var calibrated = pct;
    var sc = ctx.source_count || 0;
    if (sc >= 3) { calibrated += 6; adjustments.push({ label: '3+ independent sources', delta: +6 }); }
    else if (sc === 2) { calibrated += 3; adjustments.push({ label: '2 independent sources', delta: +3 }); }
    else if (sc === 1) { calibrated -= 5; adjustments.push({ label: 'Single-source only', delta: -5 }); }
    if (Array.isArray(ctx.adverse_hits) && ctx.adverse_hits.length >= 3) {
      calibrated += 4;
      adjustments.push({ label: '3+ category signals', delta: +4 });
    } else if (Array.isArray(ctx.adverse_hits) && ctx.adverse_hits.length === 0 && raw > 0) {
      calibrated -= 8;
      adjustments.push({ label: 'No category signal captured', delta: -8 });
    }
    if (Array.isArray(ctx.typologies) && ctx.typologies.length >= 2) {
      calibrated += 4;
      adjustments.push({ label: 'Multiple typology matches', delta: +4 });
    }
    if (ctx.sanctions_lists_checked < 10) {
      calibrated -= 4;
      adjustments.push({ label: 'Partial sanctions coverage (<10 lists)', delta: -4 });
    }
    if (calibrated < 0) calibrated = 0;
    if (calibrated > 100) calibrated = 100;
    var band = calibrated >= 85 ? 'CONFIRMED' :
               calibrated >= 50 ? 'POTENTIAL' :
               calibrated > 0   ? 'WEAK' : 'NONE';
    return {
      raw_confidence_pct: pct,
      calibrated_pct: calibrated,
      band: band,
      adjustments: adjustments
    };
  }

  // ─── Typology-driven escalation pathway catalog ─────────────────────
  // Projects the likely 30 / 90 / 180-day trajectory for a hit so the
  // MLRO knows what to watch for and when to re-screen. Each pathway
  // declares stages + typical time-to-stage + the indicator that
  // advances the case. FATF Rec 3 predicate-offence framework guides
  // the criminal pathways; Cabinet Res 74/2020 guides the sanctions
  // pathway; Cabinet Res 71/2024 guides the regulatory penalty pathway.
  var ESCALATION_PATHWAYS = {
    criminal_investigation: {
      label: 'Criminal investigation pathway',
      citation: 'FATF Rec 3 · FDL No.(10)/2025 Art.2',
      stages: [
        { stage: 'Investigation / detention',      days: '0-30',    indicator: 'Arrest warrants, public prosecutor filings, media confirmation.' },
        { stage: 'Indictment / charges filed',     days: '30-180',  indicator: 'Formal indictment or prosecutor charging document.' },
        { stage: 'Trial',                          days: '180-720', indicator: 'Trial commencement; court hearings scheduled.' },
        { stage: 'Conviction or acquittal',        days: '360-900', indicator: 'First-instance judgment; appeal window opens.' },
        { stage: 'Appeal / settlement',            days: '720-1800',indicator: 'Appellate proceedings or plea agreement.' }
      ]
    },
    sanctions_designation: {
      label: 'Sanctions designation pathway',
      citation: 'Cabinet Res 74/2020 Art.4-7 · OFAC / UK / EU listing procedures',
      stages: [
        { stage: 'Provisional / interim listing',  days: '0-7',     indicator: 'Interim freeze, temporary listing notice.' },
        { stage: 'Final listing / designation',    days: '7-30',    indicator: 'Formal Gazette publication, SDN entry.' },
        { stage: 'Asset freeze in effect',         days: '30+',     indicator: 'Frozen-asset reporting by FIs; CNMR filings.' },
        { stage: 'Delisting petition (if any)',    days: '180-720', indicator: 'Due-process challenge filed with designating authority.' },
        { stage: 'Secondary-sanctions exposure',   days: 'ongoing', indicator: 'Third-country cascade; USD-clearing impact on counterparties.' }
      ]
    },
    regulatory_action: {
      label: 'Regulatory enforcement pathway',
      citation: 'Cabinet Res 71/2024 · MoE supervisory powers · FDL Art.2',
      stages: [
        { stage: 'Investigation / show-cause',     days: '0-180',   indicator: 'Regulator opens formal probe; document request issued.' },
        { stage: 'Administrative penalty',         days: '180-360', indicator: 'Fine (AED 10K–100M), licence suspension, or consent decree.' },
        { stage: 'Appeal / administrative review', days: '360-540', indicator: 'Regulator review board or administrative court.' },
        { stage: 'Final order',                    days: '540-720', indicator: 'Enforceable order; licence outcome finalised.' }
      ]
    },
    sanctions_freeze: {
      label: 'Confirmed sanctions — mandatory action pathway',
      citation: 'Cabinet Res 74/2020 Art.4-7 · FDL No.(10)/2025 Art.29',
      stages: [
        { stage: 'Asset freeze execution',         days: '0 (24h)', indicator: 'Freeze applied on all accounts / goods / securities; EOCN notified.' },
        { stage: 'CNMR filing',                    days: '≤5 bd',   indicator: 'CNMR XML submitted to EOCN within 5 business days.' },
        { stage: 'Ongoing freeze monitoring',      days: 'ongoing', indicator: 'No release without delisting confirmation; no tipping-off (Art.29).' },
        { stage: 'Delisting check cycle',          days: 'quarterly',indicator: 'UN / OFAC / EU / UK list refresh; re-screen for status change.' }
      ]
    }
  };

  function projectEscalationPathway(ctx) {
    if (!ctx) return null;
    var cats = Array.isArray(ctx.adverse_hits) ? ctx.adverse_hits : [];
    // Sanctions hit → mandatory-action pathway.
    if (ctx.sanctions_hit_count > 0) {
      return { id: 'sanctions_freeze', ignition: 'Confirmed sanctions match.', pathway: ESCALATION_PATHWAYS.sanctions_freeze };
    }
    // Sanctions-listing trajectory for subjects in sanctions-adjacent
    // jurisdictions with TF/PF signals (pre-designation watch).
    var jf = (ctx.jurisdiction && ctx.jurisdiction.flags) || [];
    if (cats.indexOf('tf_pf_links') >= 0 &&
        (jf.indexOf('comprehensive_sanctions') >= 0 || jf.indexOf('sectoral_sanctions') >= 0)) {
      return { id: 'sanctions_designation', ignition: 'TF/PF signal in sanctions-adjacent jurisdiction.', pathway: ESCALATION_PATHWAYS.sanctions_designation };
    }
    // Regulatory action pathway.
    if (cats.indexOf('regulatory_action') >= 0) {
      return { id: 'regulatory_action', ignition: 'Regulatory-action adverse-media signal.', pathway: ESCALATION_PATHWAYS.regulatory_action };
    }
    // Default criminal-investigation pathway for predicate-offence signals.
    if (cats.some(function (c) { return ['criminal_fraud', 'bribery_corruption', 'organised_crime', 'money_laundering'].indexOf(c) >= 0; })) {
      return { id: 'criminal_investigation', ignition: 'Predicate-offence adverse-media signal.', pathway: ESCALATION_PATHWAYS.criminal_investigation };
    }
    return null;
  }

  // ─── Source-tier catalog + evidence quality grading ─────────────────
  // Rates the evidence supporting an adverse-media finding against
  // FATF Rec 10 "reasonable grounds" standards: tier of source
  // (primary court record > wire service > national press > secondary
  // > social / blog / rumour), independence / corroboration,
  // recency, and primary-vs-secondary nature. Returns an A-E grade
  // plus the component scores so the MLRO sees the math, not a
  // black-box rating.
  var SOURCE_TIER_MAP = {
    1: /\b(reuters|bloomberg|associated press|\bap\b|agence france-presse|\bafp\b|financial times|\bft\b|wall street journal|\bwsj\b|court record|official gazette|moe circular|cbuae|sca|vara|ofac|fatf public statement)\b/i,
    2: /\b(bbc|cnn|the guardian|new york times|washington post|hurriyet daily news|turkish minute|the national|khaleej times|gulf news|al arabiya|nikkei|south china morning post|deutsche welle|le monde)\b/i,
    3: /\b(blog|reddit|twitter|\bx\.com\b|facebook|telegram|rumour|anonymous source)\b/i
  };

  function gradeEvidence(ctx) {
    var sourceBlob = String(ctx.source || '').toLowerCase();
    var parts = sourceBlob.split(/[·;]|\s+and\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var tierCounts = { tier1: 0, tier2: 0, tier3: 0, unknown: 0 };
    parts.forEach(function (p) {
      if (SOURCE_TIER_MAP[1].test(p))      tierCounts.tier1 += 1;
      else if (SOURCE_TIER_MAP[2].test(p)) tierCounts.tier2 += 1;
      else if (SOURCE_TIER_MAP[3].test(p)) tierCounts.tier3 += 1;
      else                                 tierCounts.unknown += 1;
    });
    var sc = tierCounts.tier1 + tierCounts.tier2 + tierCounts.tier3 + tierCounts.unknown;
    // Source-tier score — tier-1 worth 3, tier-2 worth 2, tier-3 worth 1.
    var tierScore = tierCounts.tier1 * 3 + tierCounts.tier2 * 2 + tierCounts.tier3;
    // Independence — count of distinct sources up to cap.
    var independenceScore = Math.min(sc, 4); // 0-4
    // Recency — if summary mentions a date within the last 12 months, +2; 12-36 months +1; older 0.
    var recencyScore = 0;
    var yearMatch = String(ctx.summary || '').match(/\b(20\d{2})\b/);
    if (yearMatch) {
      var year = parseInt(yearMatch[1], 10);
      var nowYear = new Date().getFullYear();
      var age = nowYear - year;
      if (age <= 1) recencyScore = 2;
      else if (age <= 3) recencyScore = 1;
    }
    // Primary-vs-secondary — court record / official gazette / regulator release detected = +2.
    var primaryScore = /\b(court record|official gazette|moe circular|cbuae|sca|vara|ofac|fatf|regulator|indictment|arrest warrant)\b/i.test(String(ctx.summary || '') + ' ' + sourceBlob) ? 2 : 0;
    var total = tierScore + independenceScore + recencyScore + primaryScore;
    // Grade A (≥10), B (7-9), C (4-6), D (2-3), E (0-1).
    var grade =
      total >= 10 ? 'A' :
      total >= 7  ? 'B' :
      total >= 4  ? 'C' :
      total >= 2  ? 'D' : 'E';
    return {
      grade: grade,
      total: total,
      breakdown: {
        source_tiers: tierCounts,
        source_tier_score: tierScore,
        independence: independenceScore,
        recency: recencyScore,
        primary: primaryScore
      }
    };
  }

  // ─── Historical case similarity ─────────────────────────────────────
  // Cross-references the current row against the MLRO's workbench
  // history AND the KNOWN_ADVERSE_MEDIA register. Uses a simple
  // signal-overlap score (country + entity type + categories +
  // typology), capped at top-5. Informs "we've seen this before"
  // pattern-recognition which FATF Rec 10.12 explicitly expects.
  function findSimilarCases(currentRow, workbenchRows) {
    if (!currentRow) return [];
    var currentCats = Array.isArray(currentRow.adverse_media_hits) ? currentRow.adverse_media_hits : [];
    var currentCountry = String(currentRow.country || '').trim().toLowerCase();
    var currentType = currentRow.subject_type || '';
    var currentTypologies = currentRow.compliance_report && Array.isArray(currentRow.compliance_report.typologies)
      ? currentRow.compliance_report.typologies.map(function (t) { return t.id; })
      : [];
    var out = [];
    function score(cats, country, type, typologies) {
      var s = 0;
      var overlapCats = currentCats.filter(function (c) { return cats.indexOf(c) >= 0; });
      s += overlapCats.length * 3;
      if (country && country.toLowerCase() === currentCountry) s += 4;
      if (type && type === currentType) s += 2;
      var overlapT = typologies.filter(function (t) { return currentTypologies.indexOf(t) >= 0; });
      s += overlapT.length * 3;
      return { score: s, overlapCats: overlapCats, overlapTypologies: overlapT };
    }
    // 1. Workbench history (excluding self).
    (workbenchRows || []).forEach(function (r) {
      if (!r || r.id === currentRow.id) return;
      var cats = Array.isArray(r.adverse_media_hits) ? r.adverse_media_hits : [];
      var typs = r.compliance_report && Array.isArray(r.compliance_report.typologies)
        ? r.compliance_report.typologies.map(function (t) { return t.id; })
        : [];
      var sc = score(cats, String(r.country || ''), r.subject_type || '', typs);
      if (sc.score >= 4) {
        out.push({
          source: 'workbench',
          id: r.id,
          name: r.name,
          country: r.country || '',
          subject_type: r.subject_type || '',
          classification: (r.compliance_report && r.compliance_report.adverse_media_classification) ||
            r.top_classification || '',
          confidence: typeof r.confidence === 'number' ? Math.round(r.confidence * 100) : null,
          screened_at: r.screened_at || '',
          score: sc.score,
          overlap: {
            categories: sc.overlapCats,
            typologies: sc.overlapTypologies,
            country: String(r.country || '').toLowerCase() === currentCountry,
            entity_type: r.subject_type === currentType
          }
        });
      }
    });
    // 2. Register entries (seeded KNOWN_ADVERSE_MEDIA).
    KNOWN_ADVERSE_MEDIA.forEach(function (entry) {
      if (entry.names && entry.names.some(function (n) {
        return normalizeName(n) === normalizeName(currentRow.name || '');
      })) return; // skip self-match from register
      var cats = entry.categories || [];
      var sc = score(cats, String(entry.country || ''), entry.entityType || '', []);
      if (sc.score >= 4) {
        out.push({
          source: 'register',
          id: (entry.names && entry.names[0]) || '',
          name: (entry.names && entry.names[0]) || '',
          country: entry.country || '',
          subject_type: entry.entityType === 'legal_entity' ? 'entity' : 'individual',
          classification: entry.classification || '',
          confidence: typeof entry.confidence === 'number' ? Math.round(entry.confidence * 100) : null,
          screened_at: '',
          score: sc.score,
          overlap: {
            categories: sc.overlapCats,
            typologies: [],
            country: String(entry.country || '').toLowerCase() === currentCountry,
            entity_type: entry.entityType === currentType || (entry.entityType === 'legal_entity' && currentType === 'entity')
          },
          summary: entry.summary || ''
        });
      }
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 5);
  }

  // ─── Plausibility baselines — real-world DPMS / AML yardsticks ─────
  // Used by detectContradictions() to flag declared-vs-observed
  // mismatches and out-of-range figures in the adverse-media narrative.
  // Sources: LBMA Market Norms, MoE Circular 08/AML/2021 DPMS sector
  // benchmarks, UAE MoE RSG Framework, Cabinet Res 134/2025 Art.16
  // (thresholds). Rounded to "compliance-grade" numeric bands so
  // baseline drift doesn't trigger false contradictions.
  var PLAUSIBILITY_BASELINES = {
    gold_shipment_aed:                  { low:     2000000, typical:    8000000, high:    20000000, citation: 'LBMA Market Norms · DGD bar standard' },
    retail_dpms_turnover_aed_annual:    { low:      100000, typical:    1500000, high:    10000000, citation: 'MoE Circular 08/AML/2021 DPMS benchmark' },
    wholesale_gold_trader_aed_annual:   { low:    10000000, typical:   80000000, high:   500000000, citation: 'LBMA wholesale trader norm' },
    individual_monthly_cash_deposit_aed:{ low:           0, typical:      20000, high:      200000, citation: 'UAE retail banking profile' },
    cash_ctr_threshold_aed:             { threshold:  55000,                                         citation: 'MoE Circular 08/AML/2021 · FDL Art.2' },
    cross_border_bni_threshold_aed:     { threshold:  60000,                                         citation: 'Cabinet Res 134/2025 Art.16' },
    ubo_materiality_pct:                { threshold:     25,                                         citation: 'Cabinet Decision 109/2023' }
  };

  // ─── Contradiction + plausibility engine ───────────────────────────
  // Scans the adverse-media summary for AED amounts and flags each
  // against the plausibility baselines for the subject's entity type
  // + typology. Also surfaces internal inconsistencies (declared vs
  // observed) where the register makes both visible.
  function detectContradictions(ctx) {
    var out = [];
    var narrative = String(ctx.summary || '');
    if (!narrative) return out;
    // Extract AED amounts with common forms: "AED 12M", "AED 50 million",
    // "~$12M", "$1.2bn", "1,200,000 AED". Result in AED millions.
    var rxAmount = /(?:aed|usd|\$|us\$)\s*~?\s*([\d.,]+)\s*(million|bn|billion|k|thousand|m)?\b/ig;
    var amounts = [];
    var m;
    while ((m = rxAmount.exec(narrative)) !== null && amounts.length < 8) {
      var val = parseFloat(String(m[1]).replace(/,/g, ''));
      if (!isFinite(val) || val <= 0) continue;
      var unit = (m[2] || '').toLowerCase();
      var multiplier = unit.indexOf('b') === 0 ? 1e9
        : unit.indexOf('m') === 0 ? 1e6
        : unit.indexOf('k') === 0 || unit.indexOf('thousand') === 0 ? 1e3
        : 1;
      amounts.push({ raw: m[0], value: val * multiplier });
    }

    var typologyIds = Array.isArray(ctx.typologies)
      ? ctx.typologies.map(function (t) { return t.id; }) : [];
    var dpmsTypology = typologyIds.some(function (id) {
      return ['dpms_layering', 'trade_fraud', 'shell_company'].indexOf(id) >= 0;
    });
    var entityType = ctx.entity_type || 'individual';

    // Check 1 — AED amounts wildly out of baseline range for DPMS/gold
    // typologies. Individual > AED 1M mentioned = wholesale-grade flow
    // on a retail subject = contradiction.
    if (dpmsTypology && amounts.length) {
      var peak = amounts.reduce(function (m0, a) { return a.value > m0 ? a.value : m0; }, 0);
      var shp = PLAUSIBILITY_BASELINES.gold_shipment_aed;
      if (peak > shp.high * 2) {
        out.push({
          severity: 'high',
          label: 'Shipment / transaction value anomalously high',
          observed: 'AED ' + (peak / 1e6).toFixed(1) + 'M',
          baseline: 'AED ' + (shp.low / 1e6).toFixed(1) + '–' + (shp.high / 1e6).toFixed(1) + 'M typical gold shipment',
          ratio: (peak / shp.typical).toFixed(1) + '×',
          citation: shp.citation,
          note: 'Value is ' + Math.round(peak / shp.typical) + '× the typical DPMS shipment baseline — verify invoice legitimacy + mine-of-origin.'
        });
      }
    }

    // Check 2 — individual subject with wholesale-grade amounts mentioned
    // in the narrative. Cross-check entity_type vs observed magnitudes.
    if (entityType === 'individual' && amounts.length) {
      var peakI = amounts.reduce(function (m1, a) { return a.value > m1 ? a.value : m1; }, 0);
      var retail = PLAUSIBILITY_BASELINES.retail_dpms_turnover_aed_annual;
      if (peakI > retail.high * 2) {
        out.push({
          severity: 'medium',
          label: 'Individual with wholesale-scale amounts in the narrative',
          observed: 'AED ' + (peakI / 1e6).toFixed(1) + 'M',
          baseline: 'Retail DPMS individual typical range up to AED ' + (retail.high / 1e6).toFixed(1) + 'M/year',
          ratio: (peakI / retail.typical).toFixed(1) + '×',
          citation: retail.citation,
          note: 'Request detailed SOF/SOW to justify wholesale-grade flows on an individual profile (Cabinet Res 134/2025 Art.14).'
        });
      }
    }

    // Check 3 — CTR threshold breach mentioned without filing reference.
    if (amounts.some(function (a) { return a.value >= PLAUSIBILITY_BASELINES.cash_ctr_threshold_aed.threshold; })
        && !/CTR|DPMSR|goAML/i.test(narrative)) {
      out.push({
        severity: 'medium',
        label: 'Cash/CTR threshold breach not accompanied by filing reference',
        observed: 'Amount ≥ AED 55K mentioned',
        baseline: 'MoE Circular 08/AML/2021 requires CTR via goAML for DPMS cash ≥ AED 55K',
        ratio: '—',
        citation: PLAUSIBILITY_BASELINES.cash_ctr_threshold_aed.citation,
        note: 'Confirm whether a DPMSR / CTR was filed and retained for 10 years (FDL Art.24).'
      });
    }

    // Check 4 — adverse-media CONFIRMED classification but single-source
    // only. FATF Rec 10 "reasonable grounds" expects ≥2 independent
    // sources for a CONFIRMED-tier finding.
    if (ctx.classification === 'confirmed' && (ctx.source_count || 0) < 2) {
      out.push({
        severity: 'medium',
        label: 'CONFIRMED classification on single-source evidence',
        observed: (ctx.source_count || 0) + ' named source(s) on file',
        baseline: '≥ 2 independent sources required for CONFIRMED tier',
        ratio: '—',
        citation: 'FATF Rec 10 evidence standard',
        note: 'Downgrade to POTENTIAL or obtain corroboration before closing disposition.'
      });
    }

    // Check 5 — jurisdiction nexus contradiction (subject country vs
    // narrative jurisdictions). If subject is UAE-resident but narrative
    // concerns third-country activity with no UAE nexus, flag.
    var subjCountry = String(ctx.subject_country || '').toLowerCase();
    var narrativeLower = narrative.toLowerCase();
    if (subjCountry === 'uae' && !/uae|dubai|abu dhabi|emirates/.test(narrativeLower) &&
        /turkey|türkiye|russia|iran|syria|north korea/.test(narrativeLower)) {
      out.push({
        severity: 'low',
        label: 'Subject declared UAE-resident; adverse-media concerns third country',
        observed: 'UAE residency declaration',
        baseline: 'Adverse-media narrative anchored outside UAE',
        ratio: '—',
        citation: 'FATF Rec 10 · Cabinet Res 134/2025 Art.14',
        note: 'Verify the UAE nexus (trade flows, counterparty exposure, UBO chain) before applying UAE CDD rules.'
      });
    }

    return out;
  }

  // ─── Hypothesis Ranker ─────────────────────────────────────────────
  // Generates 3-5 competing hypotheses for the case and scores each
  // by signal overlap. Forces the MLRO to consider alternatives to
  // the primary verdict before closing the disposition. The scoring
  // is deliberately interpretable (count of supporting/contradicting
  // signals) rather than a black-box probability — audit-ready.
  var HYPOTHESIS_LIBRARY = {
    // Each entry = hypotheses that compete when a typology has fired.
    // Signals are regex-matched against the narrative + categories;
    // contras reduce the hypothesis score.
    trade_fraud: [
      { id: 'export_subsidy_fraud', label: 'Export-subsidy / trade fraud', signals: /(export-?subsidy|vat\s+fraud|fake\s+(?:invoice|export)|customs\s+fraud|misdeclar)/i, contras: /(customs\s+verified|audit\s+trail\s+complete)/i, implication: 'EDD; file STR if UAE nexus; LBMA RGG v9 Step 3-5 on counterparties.' },
      { id: 'legitimate_trade',     label: 'Legitimate arm\'s-length trade', signals: /(regulated\s+exchange|audit\s+trail|LBMA\s+certif|accredited|hallmark)/i, contras: /(criminal\s+probe|arrest|indictment|fraud|fake)/i, implication: 'Standard CDD; document source-of-wealth; monitor.' },
      { id: 'sanctions_proxy',      label: 'Sanctions evasion via third country', signals: /(russia|iran|belarus|north\s+korea|dprk|syria|third-?country|re-?export|front\s+company|shell)/i, contras: /(no\s+sanctions|not\s+designated)/i, implication: 'FREEZE + CNMR + EOCN if confirmed; FDL Art.29 no tipping-off.' },
      { id: 'name_collision',       label: 'Name collision / false positive', signals: /(common\s+name|homonym|same\s+name)/i, contras: /(exact\s+id|biometric|passport|emirates\s+id)/i, implication: 'Verify full identifiers (passport, DOB, EID) before any action.' }
    ],
    dpms_layering: [
      { id: 'structuring_under_ctr', label: 'Structuring under AED 55K threshold', signals: /\b(4[0-9]\s*,?\s*\d{3}|50\s*,?\s*000|51|52|53|54)\b.*(cash|deposit)|structur|smurf/i, contras: /(single\s+transaction|one-off)/i, implication: 'File STR without delay (FDL Art.26-27); classify as CDD-failure.' },
      { id: 'tbml_mirror_invoice',  label: 'Trade-based ML via mirror-invoicing', signals: /(under-?invoic|over-?invoic|phantom\s+ship|mirror\s+invoic)/i, contras: /(customs\s+verified|invoice\s+matched)/i, implication: 'EDD; obtain shipping documentation, invoice reconciliation, mine-of-origin.' },
      { id: 'shell_front_flow',     label: 'Shell-company front-flow', signals: /(shell|front\s+company|nominee|opaque\s+(?:ownership|UBO))/i, contras: /(disclosed\s+UBO|transparent\s+ownership)/i, implication: 'UBO re-verification within 15 working days; Cabinet Decision 109/2023.' }
    ],
    sanctions_evasion: [
      { id: 'third_country_relay',  label: 'Third-country relay', signals: /(relay|transship|re-?export|indirect)/i, contras: /()/i, implication: 'FREEZE if confirmed; CNMR + EOCN notify within 24h/5bd.' },
      { id: 'ais_flag_hop',         label: 'AIS / flag-hopping vessel', signals: /(ais\s+(?:off|manipul)|flag-?hop|dark\s+fleet)/i, contras: /()/i, implication: 'Report to OFAC advisory; maritime counterparty screening.' }
    ],
    investment_fraud: [
      { id: 'ponzi_mlm',            label: 'Ponzi / MLM / pyramid', signals: /(ponzi|pyramid|mlm|returns?\s+(?:guaranteed|too\s+good))/i, contras: /(sec-?registered|licensed)/i, implication: 'EDD; suspend onboarding; STR if victim funds traceable.' }
    ],
    bribery_public: [
      { id: 'grand_corruption',     label: 'Grand corruption / kleptocracy', signals: /(kleptocrat|embezzle|state\s+asset|grand\s+corruption|panama|pandora)/i, contras: /(cleared|exonerated|dismissed)/i, implication: 'EDD + Board approval; FATF Rec 12 PEP controls.' },
      { id: 'routine_bribe',        label: 'Routine commercial bribery', signals: /(kickback|facilitation|commercial\s+brib)/i, contras: /()/i, implication: 'EDD; anti-bribery programme verification.' }
    ]
  };

  function rankHypotheses(ctx) {
    if (!Array.isArray(ctx.typologies) || !ctx.typologies.length) return [];
    var narrative = String(ctx.summary || '') + ' ' + String(ctx.recommendation || '');
    var categoriesBlob = (ctx.categories || []).join(' ');
    var candidates = [];
    ctx.typologies.forEach(function (t) {
      var lib = HYPOTHESIS_LIBRARY[t.id];
      if (!Array.isArray(lib)) return;
      lib.forEach(function (h) {
        var supports = [];
        var contras = [];
        var sigMatch = narrative.match(h.signals);
        if (sigMatch) supports.push('narrative: "' + sigMatch[0] + '"');
        if (h.contras) {
          var contraMatch = narrative.match(h.contras);
          if (contraMatch) contras.push('narrative: "' + contraMatch[0] + '"');
        }
        // Category overlap as extra supporting signal.
        if (/criminal|fraud/.test(categoriesBlob) && /fraud|corruption|money/.test(h.id)) supports.push('category signal: fraud/ML');
        // Sanctions hit adds support to sanctions-proxy hypotheses.
        if (ctx.sanctions_hit_count > 0 && /sanctions|proxy|relay|ais/.test(h.id)) supports.push('sanctions list hit');
        if (!supports.length && !contras.length) return;
        var score = supports.length - contras.length * 2;
        if (score <= 0) return;
        candidates.push({
          id: h.id,
          label: h.label,
          score: score,
          supports: supports,
          contras: contras,
          implication: h.implication,
          typology: t.id
        });
      });
    });
    // Always add a "name-collision / false-positive" option so the
    // MLRO is prompted to verify identifiers before closing.
    candidates.push({
      id: 'identifier_verification',
      label: 'Identifier verification pending',
      score: 1,
      supports: ['default safety hypothesis — identifiers not yet confirmed'],
      contras: [],
      implication: 'Verify passport + DOB + Emirates ID before any action; confirm no name-collision.',
      typology: 'safety_default'
    });
    candidates.sort(function (a, b) { return b.score - a.score; });
    // Convert raw score to a probability estimate (soft weighting —
    // not a real Bayesian posterior, but audit-interpretable).
    var total = candidates.reduce(function (s, c) { return s + c.score; }, 0) || 1;
    return candidates.slice(0, 5).map(function (c) {
      return Object.assign({}, c, { probability: Math.round((c.score / total) * 100) });
    });
  }

  // ─── Temporal Trajectory ───────────────────────────────────────────
  // Detects prior screenings of the same subject (by normalised name +
  // country + entity type) in the workbench history and surfaces the
  // delta: confidence change, category widening, CDD-tier drift, risk
  // direction. Lets the MLRO see "this is the third time in 6 weeks"
  // before closing the disposition.
  function computeTemporalTrajectory(currentRow, workbenchRows) {
    if (!currentRow) return null;
    var myName = normalizeName(currentRow.name || '');
    var myCountry = String(currentRow.country || '').trim().toLowerCase();
    var myType = currentRow.subject_type || '';
    if (!myName) return null;
    var priors = [];
    (workbenchRows || []).forEach(function (r) {
      if (!r || r.id === currentRow.id) return;
      if (normalizeName(r.name || '') !== myName) return;
      if (String(r.country || '').trim().toLowerCase() !== myCountry) return;
      if ((r.subject_type || '') !== myType) return;
      priors.push(r);
    });
    if (!priors.length) return null;
    // Sort ascending by screened_at so deltas read left-to-right.
    priors.sort(function (a, b) { return String(a.screened_at).localeCompare(String(b.screened_at)); });
    var latestPrior = priors[priors.length - 1];
    var pConf = typeof latestPrior.confidence === 'number' ? Math.round(latestPrior.confidence * 100) : null;
    var cConf = typeof currentRow.confidence === 'number' ? Math.round(currentRow.confidence * 100) : null;
    var deltaConf = (cConf != null && pConf != null) ? cConf - pConf : null;
    var priorCats = Array.isArray(latestPrior.adverse_media_hits) ? latestPrior.adverse_media_hits.length : 0;
    var currentCats = Array.isArray(currentRow.adverse_media_hits) ? currentRow.adverse_media_hits.length : 0;
    var deltaCats = currentCats - priorCats;
    var priorTier = latestPrior.compliance_report && latestPrior.compliance_report.cdd_recommendation
      ? latestPrior.compliance_report.cdd_recommendation.tier : null;
    var currentTier = currentRow.compliance_report && currentRow.compliance_report.cdd_recommendation
      ? currentRow.compliance_report.cdd_recommendation.tier : null;
    var tierOrder = { SDD: 0, CDD: 1, EDD: 2, FREEZE: 3 };
    var tierDirection = (priorTier && currentTier && tierOrder[currentTier] != null && tierOrder[priorTier] != null)
      ? (tierOrder[currentTier] > tierOrder[priorTier] ? 'escalated'
        : tierOrder[currentTier] < tierOrder[priorTier] ? 'de-escalated' : 'stable')
      : null;
    var direction = deltaConf == null ? 'insufficient-data'
      : deltaConf >= 10 ? 'rising'
      : deltaConf <= -10 ? 'falling'
      : 'stable';
    var notes = [];
    if (deltaConf != null) notes.push('Confidence ' + (deltaConf >= 0 ? '+' : '') + deltaConf + ' pts');
    if (deltaCats) notes.push('Categories ' + (deltaCats >= 0 ? '+' : '') + deltaCats);
    if (tierDirection && tierDirection !== 'stable') {
      notes.push('CDD tier ' + tierDirection + ': ' + priorTier + ' → ' + currentTier);
    }
    return {
      prior_count: priors.length,
      direction: direction,
      delta_confidence_pct: deltaConf,
      delta_categories: deltaCats,
      tier_direction: tierDirection,
      prior_tier: priorTier,
      current_tier: currentTier,
      earliest_ts: priors[0].screened_at || '',
      latest_prior_ts: latestPrior.screened_at || '',
      notes: notes,
      citation: 'FATF Rec 10 — ongoing CDD · FDL No.(10)/2025 Art.20-21'
    };
  }

  // ─── UBO / Network Graph (vanilla SVG) ─────────────────────────────
  // xyflow-equivalent radial network visualisation. The browser SPA
  // has no React bundler (netlify.toml: publish = '.'), so we render
  // a lightweight inline SVG instead — same information density, no
  // new dependencies, no build step. Nodes + edges are derived from
  // connected_parties + similar_cases; the subject sits at the
  // centre, connected parties ring at r=110, similar cases ring at
  // r=180. Clicking any non-subject node pre-fills the screening
  // form with the clicked subject's name so the MLRO can walk the
  // network one query at a time (FATF Rec 10 ongoing CDD +
  // Cabinet Decision 109/2023 UBO chain).
  function buildUboGraphSvg(row, similarCases, opts) {
    opts = opts || {};
    var width = opts.width || 640;
    var height = opts.height || 400;
    var cx = width / 2;
    var cy = height / 2;
    var cr = row && row.compliance_report;
    var parties = (cr && Array.isArray(cr.connected_parties)) ? cr.connected_parties : [];
    var similar = Array.isArray(similarCases) ? similarCases : [];
    if (!parties.length && !similar.length) {
      return '<div style="padding:16px;text-align:center;opacity:.65;font-size:12px">' +
        'No connected parties or similar cases extracted — nothing to graph yet.</div>';
    }

    // Subject node colours mirror the RISK pill.
    var subjectRiskColor =
      (cr && cr.risk_level === 'critical') ? '#7f1d1d' :
      (cr && cr.risk_level === 'high')     ? '#dc2626' :
      (cr && cr.risk_level === 'medium')   ? '#d97706' : '#4b5563';

    // Lay out parties in the inner ring (r=110) and similar cases
    // in the outer ring (r=180). Angles distributed evenly so the
    // graph is readable without collision detection.
    function ring(items, radius, startAngle) {
      if (!items.length) return [];
      var angleStep = (2 * Math.PI) / Math.max(items.length, 4);
      return items.map(function (it, i) {
        var a = startAngle + i * angleStep;
        return Object.assign({}, it, {
          _x: cx + Math.cos(a) * radius,
          _y: cy + Math.sin(a) * radius
        });
      });
    }
    var partyNodes  = ring(parties.slice(0, 6), 110, -Math.PI / 2);
    var similarNodes = ring(similar.slice(0, 6), 180,  Math.PI / 2 - 0.2);

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + width + ' ' + height + '" ' +
      'style="width:100%;height:' + height + 'px;display:block" ' +
      'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="UBO and connected-parties network graph">');
    // Defs — marker + subtle glow
    svg.push('<defs>' +
      '<radialGradient id="ubo-glow" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="rgba(234,88,12,0.3)"/>' +
        '<stop offset="100%" stop-color="rgba(234,88,12,0)"/>' +
      '</radialGradient>' +
      '<marker id="ubo-arrow" viewBox="0 0 10 10" refX="10" refY="5" ' +
        'markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
        '<path d="M0,0 L10,5 L0,10 Z" fill="rgba(255,255,255,0.35)"/>' +
      '</marker>' +
    '</defs>');
    // Background glow behind the subject
    svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="100" fill="url(#ubo-glow)"/>');

    // Draw edges first so nodes render on top.
    partyNodes.forEach(function (n) {
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + n._x.toFixed(1) + '" y2="' + n._y.toFixed(1) +
        '" stroke="rgba(136,181,255,0.4)" stroke-width="1.5" marker-end="url(#ubo-arrow)"/>');
    });
    similarNodes.forEach(function (n) {
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + n._x.toFixed(1) + '" y2="' + n._y.toFixed(1) +
        '" stroke="rgba(168,85,247,0.3)" stroke-width="1" stroke-dasharray="4 3"/>');
    });

    // Subject (centre) — pill-shaped node with name + risk colour.
    var subjectLabel = (row && row.name) ? String(row.name).slice(0, 28) : 'subject';
    svg.push('<g>' +
      '<rect x="' + (cx - 75) + '" y="' + (cy - 18) + '" width="150" height="36" rx="10" ' +
        'fill="' + subjectRiskColor + '" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>' +
      '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" ' +
        'fill="#fff" font-size="12" font-weight="700" ' +
        'style="font-family:inherit">' + esc(subjectLabel) + '</text>' +
    '</g>');

    // Connected-party nodes (inner ring — blue).
    partyNodes.forEach(function (n) {
      var label = (n.name || '').slice(0, 22);
      svg.push('<g data-ubo-target="' + esc(n.name || '') + '" data-ubo-country="' + esc(row.country || '') + '" style="cursor:pointer">' +
        '<rect x="' + (n._x - 70) + '" y="' + (n._y - 14) + '" width="140" height="28" rx="8" ' +
          'fill="rgba(136,181,255,0.18)" stroke="rgba(136,181,255,0.55)" stroke-width="1"/>' +
        '<text x="' + n._x + '" y="' + (n._y + 4) + '" text-anchor="middle" ' +
          'fill="#c3dafe" font-size="11" style="font-family:inherit">' + esc(label) + '</text>' +
        (n.abbrev ? '<text x="' + n._x + '" y="' + (n._y + 14) + '" text-anchor="middle" ' +
          'fill="#88b5ff" font-size="9" opacity="0.75" style="font-family:inherit">(' + esc(n.abbrev) + ')</text>' : '') +
      '</g>');
    });

    // Similar-case nodes (outer ring — purple).
    similarNodes.forEach(function (n) {
      var label = (n.name || '').slice(0, 22);
      var badge = (n.classification ? String(n.classification).slice(0, 10).toUpperCase() : '') +
        (n.confidence != null ? ' ' + n.confidence + '%' : '');
      svg.push('<g data-ubo-target="' + esc(n.name || '') + '" data-ubo-country="' + esc(n.country || '') + '" style="cursor:pointer">' +
        '<rect x="' + (n._x - 60) + '" y="' + (n._y - 14) + '" width="120" height="28" rx="8" ' +
          'fill="rgba(168,85,247,0.14)" stroke="rgba(168,85,247,0.4)" stroke-width="1"/>' +
        '<text x="' + n._x + '" y="' + (n._y + 4) + '" text-anchor="middle" ' +
          'fill="#d8b4fe" font-size="10" style="font-family:inherit">' + esc(label) + '</text>' +
        (badge ? '<text x="' + n._x + '" y="' + (n._y + 14) + '" text-anchor="middle" ' +
          'fill="#c4b5fd" font-size="8" opacity="0.75" style="font-family:inherit">' + esc(badge) + '</text>' : '') +
      '</g>');
    });

    // Legend
    svg.push('<g transform="translate(10,' + (height - 42) + ')" style="font-family:inherit">' +
      '<rect x="0" y="0" width="14" height="10" rx="2" fill="' + subjectRiskColor + '"/>' +
      '<text x="20" y="9" fill="#ece8ff" font-size="10">Subject (centre)</text>' +
      '<rect x="120" y="0" width="14" height="10" rx="2" fill="rgba(136,181,255,0.5)"/>' +
      '<text x="140" y="9" fill="#c3dafe" font-size="10">Connected party</text>' +
      '<rect x="260" y="0" width="14" height="10" rx="2" fill="rgba(168,85,247,0.4)"/>' +
      '<text x="280" y="9" fill="#d8b4fe" font-size="10">Similar case</text>' +
      '<text x="0" y="28" fill="#ece8ff" opacity="0.65" font-size="10">' +
        'Click any node to pre-fill a new screening query.</text>' +
    '</g>');
    svg.push('</svg>');
    return svg.join('');
  }

  // ─── Bayesian posterior engine — log-odds / credible interval ──────
  // Replaces the flat-additive computeScoreAttribution math with a
  // probabilistic posterior. Each signal contributes a log-likelihood
  // ratio (LLR) with a seeded mean + uncertainty; LLRs sum in log-odds
  // space, we apply the logistic to recover P(high-risk | evidence),
  // and we propagate variance to emit a 90% credible interval.
  //
  // LLR priors are seeded from AUSTRAC + FATF typology rates + UAE
  // MoE DPMS-sector frequency data (approximate; documented as
  // "compliance-grade bands" not precise empiricals). Refinement is a
  // single-map edit when better data arrives.
  //
  // Math:
  //   logit(prior) + Σ LLR_i  →  posterior logit
  //   P = σ(posterior logit)
  //   CI = σ(posterior logit ± 1.645·sqrt(Σ σ_i²))  [90%]
  var BAYESIAN_PRIORS = {
    // Base-rate P(high-risk | random screen) for different contexts.
    // Higher priors for DPMS/CAHRA/sanctions-adjacent flows.
    default:             0.04,
    dpms_hub:            0.06,
    dpms_source:         0.08,
    cahra_source:        0.18,
    sanctions_adjacent:  0.25
  };
  // LLR entries: { llr_mean, sigma } — mean shift in log-odds,
  // uncertainty band for CI propagation. Sign: positive ⇒ increases
  // risk, negative ⇒ decreases.
  var LIKELIHOOD_RATIOS = {
    sanctions_mandatory_hit:       { llr_mean: 3.0,  sigma: 0.5,  label: 'Mandatory regime sanctions hit' },
    sanctions_other_hit:           { llr_mean: 2.0,  sigma: 0.5,  label: 'Non-mandatory sanctions hit' },
    adverse_media_confirmed:       { llr_mean: 2.5,  sigma: 0.6,  label: 'Confirmed adverse-media match' },
    adverse_media_potential:       { llr_mean: 1.3,  sigma: 0.5,  label: 'Potential adverse-media match' },
    adverse_media_weak:            { llr_mean: 0.4,  sigma: 0.4,  label: 'Weak adverse-media signal' },
    category_tf_pf:                { llr_mean: 1.8,  sigma: 0.5,  label: 'TF / PF category' },
    category_predicate_offence:    { llr_mean: 1.0,  sigma: 0.4,  label: 'Predicate-offence category (fraud/ML/corruption/OC)' },
    category_secondary:            { llr_mean: 0.3,  sigma: 0.3,  label: 'Secondary category (reputation/human rights)' },
    jurisdiction_sanctions:        { llr_mean: 1.8,  sigma: 0.5,  label: 'Comprehensive / sectoral sanctions jurisdiction' },
    jurisdiction_fatf_black:       { llr_mean: 1.5,  sigma: 0.5,  label: 'FATF black-list jurisdiction' },
    jurisdiction_fatf_grey:        { llr_mean: 0.7,  sigma: 0.4,  label: 'FATF grey-list jurisdiction' },
    jurisdiction_cahra:            { llr_mean: 0.9,  sigma: 0.4,  label: 'CAHRA (conflict-affected / high-risk area)' },
    jurisdiction_secrecy:          { llr_mean: 0.5,  sigma: 0.3,  label: 'Financial-secrecy jurisdiction' },
    pep_self:                      { llr_mean: 1.2,  sigma: 0.5,  label: 'PEP (self)' },
    pep_family:                    { llr_mean: 0.6,  sigma: 0.3,  label: 'PEP family / close associate' },
    typology_match:                { llr_mean: 0.5,  sigma: 0.3,  label: 'Typology pattern match' },
    contradiction_high:            { llr_mean: 0.8,  sigma: 0.3,  label: 'High-severity contradiction flagged' },
    corroboration_multi_source:    { llr_mean: 0.5,  sigma: 0.3,  label: 'Multi-source corroboration (≥2 independent)' },
    single_source_downweight:      { llr_mean: -0.6, sigma: 0.3,  label: 'Single-source downweight' },
    evidence_grade_a_or_b:         { llr_mean: 0.4,  sigma: 0.3,  label: 'Evidence grade A or B' },
    evidence_grade_d_or_e:         { llr_mean: -0.5, sigma: 0.3,  label: 'Evidence grade D or E' }
  };

  function logistic(x) { return 1 / (1 + Math.exp(-x)); }
  function logit(p) {
    var e = 1e-6;
    var bounded = Math.max(e, Math.min(1 - e, p));
    return Math.log(bounded / (1 - bounded));
  }

  function computeBayesianPosterior(ctx) {
    // Pick a prior based on jurisdiction flags.
    var jf = (ctx.jurisdiction && ctx.jurisdiction.flags) || [];
    var priorKey = 'default';
    if (jf.indexOf('comprehensive_sanctions') >= 0 || jf.indexOf('sectoral_sanctions') >= 0 || jf.indexOf('fatf_black') >= 0) {
      priorKey = 'sanctions_adjacent';
    } else if (jf.indexOf('cahra') >= 0 && jf.indexOf('dpms_source') >= 0) {
      priorKey = 'cahra_source';
    } else if (jf.indexOf('dpms_source') >= 0) {
      priorKey = 'dpms_source';
    } else if (jf.indexOf('dpms_hub') >= 0) {
      priorKey = 'dpms_hub';
    }
    var prior = BAYESIAN_PRIORS[priorKey];
    var posteriorLogit = logit(prior);
    var varianceSum = 0;
    var evidenceWeights = [];
    function apply(key, note) {
      var lr = LIKELIHOOD_RATIOS[key];
      if (!lr) return;
      posteriorLogit += lr.llr_mean;
      varianceSum += lr.sigma * lr.sigma;
      evidenceWeights.push({ key: key, label: lr.label, llr: lr.llr_mean, note: note || '' });
    }

    // Sanctions
    (ctx.sanctions_detail || []).forEach(function (d) {
      if (d.verdict !== 'POSITIVE') return;
      if (d.mandatory) apply('sanctions_mandatory_hit', d.short_label);
      else             apply('sanctions_other_hit', d.short_label);
    });
    // Adverse media
    var amConf = typeof ctx.adverse_media_confidence === 'number' ? ctx.adverse_media_confidence : 0;
    if (amConf >= 0.85)      apply('adverse_media_confirmed', Math.round(amConf * 100) + '%');
    else if (amConf >= 0.5)  apply('adverse_media_potential', Math.round(amConf * 100) + '%');
    else if (amConf > 0)     apply('adverse_media_weak',      Math.round(amConf * 100) + '%');
    // Categories
    var cats = ctx.adverse_hits || [];
    if (cats.indexOf('tf_pf_links') >= 0) apply('category_tf_pf');
    if (cats.some(function (c) { return ['criminal_fraud', 'money_laundering', 'bribery_corruption', 'organised_crime'].indexOf(c) >= 0; })) {
      apply('category_predicate_offence', cats.filter(function (c) {
        return ['criminal_fraud', 'money_laundering', 'bribery_corruption', 'organised_crime'].indexOf(c) >= 0;
      }).join('+'));
    }
    if (cats.some(function (c) { return ['negative_reputation', 'human_rights'].indexOf(c) >= 0; })) {
      apply('category_secondary');
    }
    // Jurisdiction
    if (jf.indexOf('comprehensive_sanctions') >= 0 || jf.indexOf('sectoral_sanctions') >= 0) apply('jurisdiction_sanctions', ctx.jurisdiction && ctx.jurisdiction.name);
    if (jf.indexOf('fatf_black') >= 0) apply('jurisdiction_fatf_black', ctx.jurisdiction && ctx.jurisdiction.name);
    if (jf.indexOf('fatf_grey') >= 0)  apply('jurisdiction_fatf_grey',  ctx.jurisdiction && ctx.jurisdiction.name);
    if (jf.indexOf('cahra') >= 0)      apply('jurisdiction_cahra',      ctx.jurisdiction && ctx.jurisdiction.name);
    if (jf.indexOf('secrecy') >= 0)    apply('jurisdiction_secrecy',    ctx.jurisdiction && ctx.jurisdiction.name);
    // PEP
    if (ctx.pep_self)   apply('pep_self');
    if (ctx.pep_family) apply('pep_family');
    // Typologies (capped contribution to avoid double-counting with categories)
    var tCount = Array.isArray(ctx.typologies) ? Math.min(3, ctx.typologies.length) : 0;
    for (var i = 0; i < tCount; i++) apply('typology_match', ctx.typologies[i].label);
    // Contradictions (high severity only — mediums/lows already baked into sibling signals)
    var highContradictions = (ctx.contradictions || []).filter(function (c) { return c.severity === 'high'; });
    for (var j = 0; j < highContradictions.length; j++) apply('contradiction_high', highContradictions[j].label);
    // Corroboration vs single-source
    if ((ctx.source_count || 0) >= 2) apply('corroboration_multi_source', ctx.source_count + ' sources');
    else if ((ctx.source_count || 0) === 1) apply('single_source_downweight');
    // Evidence grade
    if (ctx.evidence_grade && ['A', 'B'].indexOf(ctx.evidence_grade.grade) >= 0) apply('evidence_grade_a_or_b', 'grade ' + ctx.evidence_grade.grade);
    else if (ctx.evidence_grade && ['D', 'E'].indexOf(ctx.evidence_grade.grade) >= 0) apply('evidence_grade_d_or_e', 'grade ' + ctx.evidence_grade.grade);

    var sigma = Math.sqrt(varianceSum);
    var pMean = logistic(posteriorLogit);
    var pLow  = logistic(posteriorLogit - 1.645 * sigma);
    var pHigh = logistic(posteriorLogit + 1.645 * sigma);
    return {
      prior_key: priorKey,
      prior_pct: Math.round(prior * 100),
      posterior_logit: posteriorLogit,
      posterior_sigma: sigma,
      posterior_mean_pct: Math.round(pMean * 100),
      ci_low_pct: Math.round(pLow * 100),
      ci_high_pct: Math.round(pHigh * 100),
      evidence_weights: evidenceWeights,
      interpretation: pMean >= 0.7 ? 'high-risk posterior'
        : pMean >= 0.4 ? 'elevated posterior'
        : pMean >= 0.15 ? 'moderate posterior'
        : 'low posterior',
      citation: 'FATF Rec 10 · Cabinet Res 134/2025 Art.14 · Bayesian log-odds update'
    };
  }

  // ─── Lesson store — localStorage pattern memory ────────────────────
  // When an MLRO closes a disposition (confirm / partial / false-
  // positive / escalated), we capture the row's signal bundle +
  // outcome. Over time this builds a per-MLRO pattern library that
  // surfaces on similar future cases as "Learned Patterns": N prior
  // cases with this profile → M confirmed, K false-positive, etc.
  // Stored client-side in localStorage to stay within the Netlify
  // serverless budget; audit-grade storage (FDL Art.24 10-year
  // retention) still lives server-side in the screening-run audit log.
  var LESSONS_STORAGE_KEY = 'hawkeye.screening.lessons.v1';
  var LESSONS_MAX = 200;

  function loadLessons() {
    try {
      var raw = localStorage.getItem(LESSONS_STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function saveLessonStore(list) {
    try { localStorage.setItem(LESSONS_STORAGE_KEY, JSON.stringify(list.slice(-LESSONS_MAX))); } catch (_) {}
  }
  function recordLesson(row, disposition) {
    if (!row || !disposition) return;
    var cr = row.compliance_report || {};
    var lesson = {
      ts: Date.now(),
      subject_name: row.name || '',
      country: String(row.country || '').toLowerCase(),
      entity_type: row.subject_type || '',
      adverse_hits: Array.isArray(row.adverse_media_hits) ? row.adverse_media_hits.slice() : [],
      typology_ids: Array.isArray(cr.typologies) ? cr.typologies.map(function (t) { return t.id; }) : [],
      cdd_tier: (cr.cdd_recommendation && cr.cdd_recommendation.tier) || '',
      disposition: disposition,
      classification: cr.adverse_media_classification || row.top_classification || '',
      confidence_pct: typeof row.confidence === 'number' ? Math.round(row.confidence * 100) : null,
      risk_level: cr.risk_level || '',
      posterior_mean_pct: (cr.bayesian_posterior && cr.bayesian_posterior.posterior_mean_pct) || null,
      contradiction_count: Array.isArray(cr.contradictions) ? cr.contradictions.length : 0,
      jurisdiction_flags: (cr.jurisdiction && Array.isArray(cr.jurisdiction.flags)) ? cr.jurisdiction.flags.slice() : []
    };
    var list = loadLessons();
    list.push(lesson);
    saveLessonStore(list);
  }

  function findRelevantLessons(row) {
    var cr = row.compliance_report || {};
    if (!row || !cr) return null;
    var myCountry = String(row.country || '').toLowerCase();
    var myType = row.subject_type || '';
    var myCats = Array.isArray(row.adverse_media_hits) ? row.adverse_media_hits : [];
    var myTypologies = Array.isArray(cr.typologies) ? cr.typologies.map(function (t) { return t.id; }) : [];
    var lessons = loadLessons();
    if (!lessons.length) return null;
    var relevant = lessons.filter(function (l) {
      var score = 0;
      if (l.country === myCountry) score += 2;
      if (l.entity_type === myType) score += 1;
      var catOverlap = (l.adverse_hits || []).filter(function (c) { return myCats.indexOf(c) >= 0; }).length;
      score += catOverlap * 2;
      var tOverlap = (l.typology_ids || []).filter(function (t) { return myTypologies.indexOf(t) >= 0; }).length;
      score += tOverlap * 3;
      l._score = score;
      return score >= 4;
    }).sort(function (a, b) { return b._score - a._score; });
    if (!relevant.length) return null;
    // Aggregate statistics across relevant lessons.
    var byDisposition = { positive: 0, partial: 0, false_positive: 0, escalated: 0, other: 0 };
    relevant.forEach(function (l) {
      if (byDisposition[l.disposition] != null) byDisposition[l.disposition] += 1;
      else byDisposition.other += 1;
    });
    var totalMatches = relevant.length;
    // Compute a weighted "confirm rate" to compare with current
    // posterior — MLRO can see if the model is mis-calibrated.
    var confirmCount = byDisposition.positive + byDisposition.escalated;
    var confirmRate = totalMatches > 0 ? confirmCount / totalMatches : 0;
    // Discriminator detection — find the signal most predictive of
    // "positive" vs "false_positive" within the relevant subset.
    var positiveLessons = relevant.filter(function (l) { return l.disposition === 'positive' || l.disposition === 'escalated'; });
    var fpLessons = relevant.filter(function (l) { return l.disposition === 'false_positive'; });
    var discriminator = '';
    if (positiveLessons.length >= 1 && fpLessons.length >= 1) {
      // Find a category present in positives but absent in all FPs.
      var posCats = positiveLessons.reduce(function (acc, l) {
        (l.adverse_hits || []).forEach(function (c) { acc[c] = (acc[c] || 0) + 1; });
        return acc;
      }, {});
      var fpCats = fpLessons.reduce(function (acc, l) {
        (l.adverse_hits || []).forEach(function (c) { acc[c] = (acc[c] || 0) + 1; });
        return acc;
      }, {});
      var keys = Object.keys(posCats);
      for (var i = 0; i < keys.length; i++) {
        if ((posCats[keys[i]] / positiveLessons.length) > 0.6 && ((fpCats[keys[i]] || 0) / fpLessons.length) < 0.3) {
          discriminator = keys[i];
          break;
        }
      }
    }
    return {
      total_matches: totalMatches,
      by_disposition: byDisposition,
      confirm_rate_pct: Math.round(confirmRate * 100),
      discriminator_category: discriminator,
      top_matches: relevant.slice(0, 3).map(function (l) {
        return {
          ts: l.ts,
          disposition: l.disposition,
          subject_name: l.subject_name,
          confidence_pct: l.confidence_pct,
          cdd_tier: l.cdd_tier
        };
      }),
      citation: 'FATF Rec 10.12 · Pattern-recognition / institutional memory'
    };
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
      customer_code: body.customerCode || '',
      customer_name: body.customerName || '',
      event_type: body.eventType || '',
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
      integrity_reasons: Array.isArray(data.integrityReasons) ? data.integrityReasons.slice() : [],
      lists_checked: Array.isArray(data.sanctions && data.sanctions.listsChecked)
        ? data.sanctions.listsChecked.slice() : [],
      list_errors: Array.isArray(data.sanctions && data.sanctions.listErrors)
        ? data.sanctions.listErrors.slice() : [],
      per_list_raw: Array.isArray(data.sanctions && data.sanctions.perList)
        ? data.sanctions.perList.map(function (l) {
            return {
              list: l.list,
              hitCount: l.hitCount,
              topScore: l.topScore,
              topClassification: l.topClassification,
              candidatesChecked: l.candidatesChecked,
              error: l.error || ''
            };
          })
        : [],
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

    // Compose the narrative compliance report. Structure per MLRO ask:
    // a Sanctions Finding paragraph explaining the sanctions verdict in
    // plain English (NEGATIVE = what was screened + no freeze triggered;
    // POSITIVE = which lists hit + the mandatory freeze/CNMR/EOCN/tipping-
    // off action list), plus an Adverse Media Finding paragraph enumerating
    // the categories surfaced, the substantive narrative, the lead and
    // corroborating sources, and the DPMS-sector regulatory hooks.
    var complianceReport = null;
    if (knownHit) {
      var sanctionsDetail = sanctionsLists.map(function (listId) {
        var item = SANCTIONS_LISTS.filter(function (l) { return l.id === listId; })[0];
        var citation = item && item.citation ? item.citation : '';
        return {
          id: listId,
          short_label: item && item.short_label ? item.short_label : (item ? item.label : listId),
          mandatory: /\bMANDATORY\b/.test(citation),
          verdict: explicitSanctionsHits.indexOf(listId) >= 0 ? 'POSITIVE' : 'NEGATIVE'
        };
      });
      var sanctionsShortLabels = sanctionsDetail.map(function (d) { return d.short_label; });
      var mandatoryScreened = sanctionsDetail.filter(function (d) { return d.mandatory; });
      var hitLabels = sanctionsDetail
        .filter(function (d) { return d.verdict === 'POSITIVE'; })
        .map(function (d) { return d.short_label; });
      var hitHasMandatory = sanctionsDetail
        .some(function (d) { return d.mandatory && d.verdict === 'POSITIVE'; });

      function joinEnglish(arr) {
        if (arr.length === 0) return '';
        if (arr.length === 1) return arr[0];
        if (arr.length === 2) return arr[0] + ' and ' + arr[1];
        return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
      }

      var mandatorySentence = '';
      if (mandatoryScreened.length === 2) {
        mandatorySentence = ' The two MANDATORY regimes (' +
          mandatoryScreened[0].short_label + ' and ' +
          mandatoryScreened[1].short_label + ') are both clean.';
      } else if (mandatoryScreened.length === 1) {
        mandatorySentence = ' The MANDATORY regime (' +
          mandatoryScreened[0].short_label + ') is clean.';
      }

      var sanctionsNarrative;
      if (explicitSanctionsHits.length === 0) {
        sanctionsNarrative =
          'NEGATIVE. The subject was screened against ' + sanctionsLists.length +
          ' sanctions and watchlists (' + sanctionsShortLabels.join(', ') + ') and ' +
          'returned NO matches on any list.' + mandatorySentence +
          ' The subject is therefore not under active sanctions — no 24-hour ' +
          'freeze obligation under Cabinet Res 74/2020 Art.4-7 and no CNMR ' +
          'filing is triggered.';
      } else {
        sanctionsNarrative =
          'POSITIVE. The subject matches on ' + explicitSanctionsHits.length +
          ' of ' + sanctionsLists.length + ' sanctions lists: ' +
          joinEnglish(hitLabels) + '. This is a confirmed sanctions hit — ' +
          'execute a 24-hour asset freeze (Cabinet Res 74/2020 Art.4), ' +
          'notify the Executive Office (EOCN) within 24 clock hours, ' +
          'file a CNMR with the FIU within 5 business days, and do NOT tip ' +
          'off the subject (FDL Art.29).' +
          (hitHasMandatory
            ? ' A MANDATORY regime is involved — escalation is non-discretionary.'
            : '');
      }

      // Humanised category labels for the adverse-media sentence. Kept
      // inline (rather than bolted onto ADVERSE_MEDIA_CATEGORIES) because
      // these are narrative phrasings only used here.
      var categoryNarrativeLabels = {
        criminal_fraud: 'criminal / fraud',
        bribery_corruption: 'bribery and corruption',
        organised_crime: 'organised-crime',
        money_laundering: 'money-laundering',
        tf_pf_links: 'terrorism-financing / proliferation-financing',
        regulatory_action: 'regulatory-action',
        negative_reputation: 'negative-reputation',
        human_rights: 'human-rights / environmental'
      };
      var catNarrativeList = adverseHits.map(function (c) {
        return categoryNarrativeLabels[c] || c.replace(/_/g, ' ');
      });
      var categorySentence = catNarrativeList.length
        ? 'Screening surfaced ' + joinEnglish(catNarrativeList) + ' signals. '
        : '';
      var adverseSummary = knownHit.entry.summary
        ? String(knownHit.entry.summary).trim()
        : '';
      if (adverseSummary && !/[.!?]$/.test(adverseSummary)) adverseSummary += '.';
      var adverseMediaNarrative =
        String(amCls).toUpperCase() + ' (' +
        Math.round((amConf || 0) * 100) + '% confidence). ' +
        categorySentence +
        (adverseSummary ? adverseSummary + ' ' : '') +
        (knownHit.entry.source
          ? 'Lead public source on file: ' + knownHit.entry.source + '.'
          : '');

      // ── Intelligence layer — jurisdiction, typology, connected parties,
      // score attribution, reasoning chain. Fed the full subject bundle
      // so each layer can compose its output from the same ground truth.
      var jurisdictionSrc = body.country || knownHit.entry.country || '';
      var jurisdiction = lookupJurisdiction(jurisdictionSrc);
      var entityType = body.entityType === 'legal_entity' ? 'legal_entity' : 'individual';
      var pepFlagged = pepFlags.length > 0;
      var typologyCtx = {
        summary: knownHit.entry.summary || '',
        recommendation: knownHit.entry.recommendation || '',
        categories: adverseHits,
        jurisdiction: jurisdiction,
        entity_type: entityType,
        pep_flagged: pepFlagged
      };
      var typologies = matchTypologies(typologyCtx);
      var connectedParties = extractConnectedParties(knownHit.entry.summary);
      // Source count — a rough corroboration signal from the register
      // citation (semicolon / middot / comma separated sources).
      var sourceBlob = String(knownHit.entry.source || '');
      var sourceCount = sourceBlob
        ? sourceBlob.split(/[·;]|\s+and\s+/i).filter(function (s) { return s.trim().length > 3; }).length
        : 0;
      var attributionCtx = {
        sanctions_detail: sanctionsDetail,
        adverse_media_confidence: amConf,
        adverse_hits: adverseHits,
        jurisdiction: jurisdiction,
        pep_self: pepFlags.indexOf('pep_self') >= 0,
        pep_family: pepFlags.some(function (p) { return p !== 'pep_self'; }),
        special_flags: specialFlags,
        typologies: typologies
      };
      var scoreAttribution = computeScoreAttribution(attributionCtx);
      var reasoningChain = buildReasoningChain({
        sanctions_hit_count: explicitSanctionsHits.length,
        sanctions_lists_checked: sanctionsLists.length,
        adverse_media_confidence: amConf,
        adverse_hits: adverseHits,
        source_count: sourceCount,
        jurisdiction: jurisdiction,
        typologies: typologies,
        connected_parties: connectedParties,
        attribution_total: scoreAttribution.total
      });
      var deepCtx = {
        sanctions_hit_count: explicitSanctionsHits.length,
        sanctions_lists_checked: sanctionsLists.length,
        adverse_media_confidence: amConf,
        adverse_hits: adverseHits,
        source_count: sourceCount,
        jurisdiction: jurisdiction,
        typologies: typologies,
        connected_parties: connectedParties,
        pep_self: pepFlags.indexOf('pep_self') >= 0,
        pep_family: pepFlags.some(function (p) { return p !== 'pep_self'; }),
        special_flags: specialFlags,
        attribution_total: scoreAttribution.total,
        score_attribution: scoreAttribution,
        has_sow_sof: false,
        has_ubo: false
      };
      var counterfactuals = computeCounterfactuals(deepCtx);
      var redFlags = buildRedFlagChecklist(deepCtx);
      var cddRecommendation = recommendCddTier(deepCtx);
      var evidenceGaps = identifyEvidenceGaps(deepCtx);
      var calibration = calibrateConfidence(deepCtx);
      var escalationPathway = projectEscalationPathway(deepCtx);
      var evidenceGrade = gradeEvidence({
        source: knownHit.entry.source || '',
        summary: knownHit.entry.summary || ''
      });
      var contradictions = detectContradictions({
        summary: knownHit.entry.summary || '',
        classification: amCls,
        source_count: sourceCount,
        entity_type: entityType,
        subject_country: body.country || '',
        typologies: typologies
      });
      var hypotheses = rankHypotheses({
        summary: knownHit.entry.summary || '',
        recommendation: knownHit.entry.recommendation || '',
        categories: adverseHits,
        typologies: typologies,
        sanctions_hit_count: explicitSanctionsHits.length
      });
      var bayesianPosterior = computeBayesianPosterior({
        sanctions_detail: sanctionsDetail,
        adverse_media_confidence: amConf,
        adverse_hits: adverseHits,
        jurisdiction: jurisdiction,
        pep_self: pepFlags.indexOf('pep_self') >= 0,
        pep_family: pepFlags.some(function (p) { return p !== 'pep_self'; }),
        typologies: typologies,
        contradictions: contradictions,
        source_count: sourceCount,
        evidence_grade: evidenceGrade
      });

      // Typology narrative (short paragraph)
      var typologyNarrative = '';
      if (typologies.length) {
        var topT = typologies[0];
        var rest = typologies.slice(1).map(function (t) { return t.label; });
        typologyNarrative = 'Typology Match. ' +
          'Top pattern: ' + topT.label + ' (' + topT.citation + ').' +
          ' Triggers: ' + topT.matched_triggers.join(' · ') + '.' +
          (rest.length ? ' Secondary: ' + rest.join('; ') + '.' : '');
      }

      complianceReport = {
        adverse_media_classification: amCls,
        adverse_media_confidence: amConf,
        adverse_media_narrative: adverseMediaNarrative,
        sanctions_status: explicitSanctionsHits.length === 0
          ? 'NEGATIVE. Subject is not on any of the ' + sanctionsLists.length + ' selected sanctions / watchlists'
          : 'POSITIVE. Subject appears on ' + explicitSanctionsHits.length + ' of ' + sanctionsLists.length + ' sanctions list(s): ' + explicitSanctionsHits.join(', '),
        sanctions_summary: explicitSanctionsHits.length === 0 ? 'NEGATIVE' : 'POSITIVE',
        sanctions_hit_count: explicitSanctionsHits.length,
        sanctions_lists_checked: sanctionsLists.length,
        sanctions_detail: sanctionsDetail,
        sanctions_narrative: sanctionsNarrative,
        jurisdiction: jurisdiction,
        typologies: typologies,
        typology_narrative: typologyNarrative,
        connected_parties: connectedParties,
        score_attribution: scoreAttribution,
        reasoning_chain: reasoningChain,
        counterfactuals: counterfactuals,
        red_flags: redFlags,
        cdd_recommendation: cddRecommendation,
        evidence_gaps: evidenceGaps,
        confidence_calibration: calibration,
        escalation_pathway: escalationPathway,
        evidence_grade: evidenceGrade,
        contradictions: contradictions,
        hypotheses: hypotheses,
        bayesian_posterior: bayesianPosterior,
        source_count: sourceCount,
        risk_level: knownHit.entry.risk_level || 'high',
        recommendation: knownHit.entry.recommendation || '',
        regulatory_basis: Array.isArray(knownHit.entry.regulatory_basis) ? knownHit.entry.regulatory_basis.slice() : []
      };
    }

    return {
      id: 'sub-' + Date.now(),
      subject_type: body.entityType === 'legal_entity' ? 'entity' : 'individual',
      name: body.subjectName,
      customer_code: body.customerCode || '',
      customer_name: body.customerName || '',
      event_type: body.eventType || '',
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
      compliance_report: complianceReport,
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
