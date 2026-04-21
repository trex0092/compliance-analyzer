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

  // Reasoning modes — control how the executor is prompted. Each
  // mode injects a different "thinking frame" as additional user-
  // facing guidance. The API-side prompt stays the same; the
  // client composes the user-message prefix so the executor knows
  // what kind of answer to optimise for.
  var REASONING_MODES = [
    {
      id: 'standard',
      label: 'Standard',
      description: 'Balanced depth and speed. Default MLRO mode.',
      prefix: ''
    },
    {
      id: 'deep',
      label: 'Deep thinking',
      description: 'Longer chain-of-thought; multi-step reasoning; slower but more thorough.',
      prefix: 'THINK DEEPLY. Walk through your reasoning step-by-step before committing to a conclusion. Show the intermediate inferences, not just the final verdict. Consider at least three alternative framings of the question before settling. Err on the side of more context, not less.\n\n'
    },
    {
      id: 'dialectic',
      label: 'Dialectic (pro + con)',
      description: 'Generate the strongest case FOR and the strongest case AGAINST, then synthesise.',
      prefix: 'USE A DIALECTIC STRUCTURE. Your answer has three sections:\n1. THESIS: the strongest case for the primary verdict (+ cited support)\n2. ANTITHESIS: the strongest case against that verdict (+ cited support)\n3. SYNTHESIS: which side is stronger on the current evidence, and your confidence\n\nDo not favour the thesis over the antithesis in section 2. Attack the primary verdict as hard as you would defend it in section 1.\n\n'
    },
    {
      id: 'data',
      label: 'Data analysis',
      description: 'Structured statistical/tabular analysis of the case context. Computes ratios, thresholds, distributions where possible.',
      prefix: 'TREAT THE CASE CONTEXT AS STRUCTURED DATA. Your answer must include:\n1. DATA SUMMARY: every AED amount, count, date, ratio, percentage in the context — tabulated.\n2. THRESHOLD CHECKS: AED 55K CTR · AED 60K cross-border · AED 25% UBO · 24h freeze · 5 business-day CNMR · 10-year retention.\n3. RATIOS: any derived ratios the MLRO should know (deposit/turnover, cash ratio, velocity, etc.).\n4. OUTLIERS: values that deviate >2× from baselines (LBMA gold shipment AED 2-10M · retail DPMS turnover AED 0.1-10M).\n5. VERDICT: based strictly on the numbers.\n\nBe quantitative first, qualitative second.\n\n'
    },
    {
      id: 'speed',
      label: 'Speed',
      description: 'Fast structured answer — 100 words max in the prose section, full labelled block below.',
      prefix: 'BE FAST AND TERSE. The prose section of your answer must be ≤100 words. Cut filler, cut hedging, cut preamble. Emit the full CDD LEVEL / RED FLAGS / CITATIONS / DEADLINES / CONFIDENCE / GAPS / FOLLOW-UP labelled block as usual.\n\n'
    },
    {
      id: 'parallel',
      label: 'Multi-perspective (3 voices)',
      description: 'Answer as three concurrent specialists — Regulatory Counsel, Financial Analyst, Forensic Investigator — then converge.',
      prefix: 'ADOPT THREE SPECIALIST PERSPECTIVES SEQUENTIALLY.\n\n[REGULATORY COUNSEL] — reads the case through the lens of the UAE AML/CFT/CPF framework. Focuses on which article/resolution is in play and what action it mandates.\n\n[FINANCIAL ANALYST] — reads the case through cash-flow / transaction / volume / threshold math. Focuses on detecting structuring, TBML, layering patterns.\n\n[FORENSIC INVESTIGATOR] — reads the case through evidence quality / connected-party / typology lenses. Focuses on what is knowable vs what remains to be obtained.\n\nAfter the three specialist sections, write a [CONVERGENCE] paragraph summarising where they agree + where they disagree + your synthesis.\n\n'
    },
    // ── 11 additional reasoning frames added 2026-04-21.
    //    Each maps to a distinct analytical tradition (deduction,
    //    induction, Bayesian inference, counterfactual, first-
    //    principles, Socratic self-interrogation, reflective
    //    self-critique, adversarial red-team, statistical, forensic,
    //    strategic). The prefixes steer the executor's thinking
    //    frame; the API-side prompt is unchanged. ──
    {
      id: 'inference',
      label: 'Formal inference (deductive + inductive + abductive)',
      description: 'Label every step: what is deduced from rules, induced from patterns, or abducted as best explanation.',
      prefix: 'USE A FORMAL INFERENCE STRUCTURE. Split your reasoning into three labelled layers:\n1. [DEDUCTIVE] — from the regulation + confirmed facts, what MUST be true? Each step is a rule-application with citation.\n2. [INDUCTIVE] — from the pattern of transactions / behaviours / prior cases, what is LIKELY true? State the sample size and the confidence.\n3. [ABDUCTIVE] — given the evidence as a whole, what is the BEST EXPLANATION? List at least two competing hypotheses, score each, and pick the leader.\n\nDo not mix layers. A claim at [DEDUCTIVE] must be a rule-application; a claim at [INDUCTIVE] must come from observed frequency; a claim at [ABDUCTIVE] must compete against alternatives.\n\n'
    },
    {
      id: 'first_principles',
      label: 'First principles',
      description: 'Strip the question to axioms (regulation + facts), rebuild from zero. No received wisdom.',
      prefix: 'REASON FROM FIRST PRINCIPLES. Do NOT invoke "standard practice" or "this is usually how we do it". Your answer must:\n1. AXIOMS — list the regulatory primitives that apply (articles, thresholds, deadlines) verbatim.\n2. FACTS — list the case-specific facts you consider established.\n3. DERIVATION — show how the verdict is constructed from (1) and (2) using explicit logical steps. Each step names the axiom or fact it depends on.\n4. VERDICT — stated as the terminal node of the derivation.\n\nIf an axiom is missing, say so and stop — do NOT paper over the gap with convention.\n\n'
    },
    {
      id: 'bayesian',
      label: 'Bayesian (prior → likelihood → posterior)',
      description: 'Explicit probabilities. Prior × likelihood → posterior. Show the update.',
      prefix: 'USE A BAYESIAN STRUCTURE. Your answer must be organised as:\n1. HYPOTHESIS — the verdict you are testing (e.g. "H = this is a structuring typology").\n2. PRIOR — P(H) before seeing the evidence, with the base-rate you used (industry / jurisdiction / customer-segment).\n3. LIKELIHOOD — P(evidence | H) vs P(evidence | not H), per factor. Tabulate at least 3 factors.\n4. POSTERIOR — P(H | evidence) after the update, with the arithmetic visible.\n5. SENSITIVITY — which factor dominates? If the weakest factor were removed, would the posterior flip?\n\nUse numeric probabilities (0.00–1.00), not vague labels. Cite FATF / LBMA / UAE base-rates where known; otherwise state the assumption and mark it [ASSUMED].\n\n'
    },
    {
      id: 'counterfactual',
      label: 'Counterfactual (what-if sensitivity)',
      description: 'Remove each factor in turn. Does the verdict flip? Expose the load-bearing evidence.',
      prefix: 'RUN A COUNTERFACTUAL SENSITIVITY ANALYSIS. Your answer must:\n1. BASELINE — state the verdict on the evidence as-presented.\n2. FACTORS — list the 4–6 load-bearing facts the verdict depends on.\n3. PERTURBATIONS — for each factor, re-run the reasoning with that factor REMOVED (or inverted). Show the counterfactual verdict.\n4. LOAD-BEARING — which factor, if removed, flips the verdict? That is the single point of failure in the case.\n5. EVIDENCE GAP — what additional evidence would make the verdict robust to removing any single factor?\n\nThis surfaces which evidence the MLRO must MOST protect in the audit file.\n\n'
    },
    {
      id: 'socratic',
      label: 'Socratic (self-interrogation)',
      description: 'Generate 5 sharp questions about the case, answer each, then synthesise.',
      prefix: 'USE A SOCRATIC STRUCTURE. Do NOT answer directly. Instead:\n1. Generate FIVE questions that a skilled MLRO / MoE inspector / LBMA auditor would ask about this case before forming a verdict. The questions must be specific and evidence-seeking, not generic.\n2. ANSWER each of the five questions from the case context. If the context does not answer it, mark [GAP — need to obtain].\n3. SYNTHESIS — after the five Q&A pairs, state the verdict that emerges from the answers. If the gaps are material, the verdict must be "insufficient evidence, obtain X first".\n\nThe strength of the final verdict is a function of how sharp your five questions were.\n\n'
    },
    {
      id: 'reflective',
      label: 'Reflective (draft → critique → revise)',
      description: 'Write the answer, then critique your own answer, then revise it. Two passes minimum.',
      prefix: 'USE A REFLECTIVE TWO-PASS STRUCTURE. Output three labelled sections:\n1. [DRAFT] — your first-pass analysis and verdict, written quickly.\n2. [SELF-CRITIQUE] — read your own draft as a hostile reviewer. List at least 3 concrete weaknesses: a missed citation, an unsupported leap, an over-confident claim, a threshold that was not checked, a jurisdiction that was not named, a tip-off risk that was not flagged.\n3. [REVISED] — rewrite the analysis, fixing every weakness you identified in section 2. The revised verdict may differ from the draft — say so if it does.\n\nThe revised section is the answer of record. The draft + critique are shown for the audit trail (FDL Art.20-21).\n\n'
    },
    {
      id: 'red_team',
      label: 'Red-team (hostile auditor)',
      description: 'Act as an MoE inspector / LBMA auditor actively trying to break the compliance case.',
      prefix: 'ADOPT A HOSTILE AUDITOR MINDSET. You are an MoE inspector, LBMA Responsible Gold auditor, or UAE FIU reviewer who has been told this file may contain irregularities. Your job is NOT to defend the current position; your job is to find the fault. Structure:\n1. [ATTACK SURFACE] — which articles / thresholds / deadlines / evidence-standards are in scope for challenge?\n2. [FINDINGS] — list at least 4 specific objections, each with the citation that makes it a finding (not an opinion).\n3. [SEVERITY] — rate each finding: observation / minor non-compliance / major non-compliance / regulatory breach.\n4. [REMEDIATION] — what would the compliance team need to produce to close each finding?\n\nDo not soften. An auditor who cannot find fault writes an empty report, which is useless to the firm.\n\n'
    },
    {
      id: 'statistical',
      label: 'Statistical (distributions + z-scores + outliers)',
      description: 'Quantitative distributional analysis: z-scores, percentiles, velocity, outlier detection.',
      prefix: 'DO A STATISTICAL ANALYSIS. Your answer must include:\n1. DISTRIBUTIONS — for every numeric field in the case (transaction amounts, frequencies, intervals, turnovers), describe the distribution: mean, median, range, and — if computable — standard deviation.\n2. Z-SCORES — for each datum, how many standard deviations is it from the expected sector baseline? (LBMA gold shipment AED 2–10M, retail DPMS turnover AED 0.1–10M, bullion-trader account turnover AED 5–50M, ASM refiner monthly intake 1–30kg.)\n3. VELOCITY — transactions per day/week/month. Flag accelerations >2× prior period.\n4. OUTLIERS — which datapoints are at |z| > 2? Which are at |z| > 3?\n5. STATISTICAL VERDICT — the quantitative conclusion before any qualitative overlay.\n\nBe numeric-first. Narrative second.\n\n'
    },
    {
      id: 'forensic',
      label: 'Forensic (known vs need-to-obtain)',
      description: 'Split evidence into confirmed / corroborated / asserted / missing. Direct the investigation.',
      prefix: 'STRUCTURE YOUR ANSWER AS A FORENSIC EVIDENCE LEDGER.\n1. [CONFIRMED] — facts in the case context that are documented (ID, trade licence, bank records, screening hit).\n2. [CORROBORATED] — facts supported by independent source (adverse media, regulator list, public registry).\n3. [ASSERTED] — facts claimed by the subject but not yet corroborated (declared SoW, declared turnover, declared UBO).\n4. [MISSING] — facts the MLRO needs but does not have. Each entry is an investigative action with owner + target-date.\n5. [VERDICT-ON-EVIDENCE] — based only on CONFIRMED + CORROBORATED, what can be concluded? What part of the verdict is still load-bearing on ASSERTED or MISSING evidence?\n\nThis is the ledger the 10-year FDL Art.24 record must survive on.\n\n'
    },
    {
      id: 'analogical',
      label: 'Analogical (typology + precedent match)',
      description: 'Match the case to the nearest FATF/LBMA typology and nearest internal precedent. Transfer the playbook.',
      prefix: 'REASON BY ANALOGY. Your answer must:\n1. NEAREST TYPOLOGY — the closest FATF / LBMA / Wolfsberg / Egmont typology the case resembles. Cite the typology reference. Describe the standard indicator set for that typology.\n2. TYPOLOGY FIT — map each case fact onto the typology\'s expected indicators. Score the fit (0.0–1.0). Missing indicators are flagged explicitly.\n3. NEAREST PRECEDENT — if the firm has seen a similar case before, name the archetype (e.g. "2024 shell-UBO layering", "2025 sub-55K structuring cluster", "CAHRA supplier reassessment"). If not, mark [NO PRIOR].\n4. PLAYBOOK TRANSFER — what worked / did not work in the analogous case, and which steps carry over to the current one?\n5. VERDICT — informed by the typology and the precedent, with the analogical reasoning explicit.\n\n'
    },
    {
      id: 'strategic',
      label: 'Strategic (threat-actor mindset)',
      description: 'Think like the subject. What is the next move to evade detection? Harden the defence.',
      prefix: 'ADOPT A THREAT-ACTOR MINDSET. For this exercise, you are the subject attempting to launder / evade / move funds around the controls. Structure:\n1. [OBJECTIVE] — what is the subject trying to achieve (move X AED, avoid CTR, avoid sanctions screen, avoid UBO disclosure, avoid adverse media)?\n2. [NEXT MOVES] — the 3–5 most likely next moves the subject could make given the current controls (e.g. split across branches, use a nominee, route via a trade invoice, route via VASP, route via a charity, delay past year-end).\n3. [DETECTION SURFACE] — for each next move, which of OUR controls would catch it, and which would MISS it?\n4. [HARDENING] — concrete control upgrades that would cover the detection gaps.\n5. [MLRO VERDICT] — translated back into the MLRO\'s language: action, deadline, citation.\n\nThis frames defence in terms of what the adversary does, not what the policy hopes.\n\n'
    },
    // ── +11 additional reasoning frames added 2026-04-21 (second
    //    expansion, covering meta-reasoning, causal reasoning,
    //    chain-of-verification, adversarial-debate, timeseries,
    //    decision-tree, scale-invariance, zoom, worst-case,
    //    legal-formalism, and purposive construction). ──
    {
      id: 'meta',
      label: 'Meta (reasoning about the reasoning)',
      description: 'Analyse your own epistemic state: what do you know, what do you assume, what would change your mind?',
      prefix: 'DO A META-REASONING PASS. Do NOT jump to the verdict. Analyse your own epistemic state first. Structure:\n1. [KNOWLEDGE] — what do you actually KNOW about this case (directly stated in the context)?\n2. [ASSUMPTIONS] — which inferences rest on assumptions you are making (industry baseline, typical behaviour, prior case familiarity)? List them explicitly and mark each [LOW / MED / HIGH] confidence.\n3. [CALIBRATION] — is your inclination toward a verdict driven by evidence, or by the framing of the question? Stress-test your own anchor.\n4. [MIND-CHANGERS] — list the SPECIFIC evidence that, if surfaced, would flip your verdict. If no such evidence exists, your verdict is over-determined and you should say so.\n5. [VERDICT] — only after sections 1–4 above.\n\nAn MLRO decision that cannot name what would change its own mind is not a decision — it is a preference.\n\n'
    },
    {
      id: 'causal',
      label: 'Causal (cause → effect, not correlation)',
      description: 'Map the causal chain. Distinguish cause, confounder, and mere correlation.',
      prefix: 'BUILD AN EXPLICIT CAUSAL CHAIN. Do NOT conflate correlation with causation. Structure:\n1. [CAUSAL GRAPH] — draw the chain in prose: node → edge (mechanism) → node. E.g. "free-zone incorporation → nominee director → opaque UBO → structuring pattern → sub-55K deposits".\n2. [CONFOUNDERS] — for each edge, name the factor that could be producing the observed correlation WITHOUT the causal link (e.g. the subject is simply in a cash-intensive sector and not structuring). Rate each confounder\'s plausibility.\n3. [MECHANISM] — for each edge you keep, state the concrete mechanism. If you cannot state a mechanism, the edge is correlation, not causation — mark it [CORR-ONLY].\n4. [INTERVENTIONAL TEST] — what control (new rule / enhanced monitoring / data request) would, if applied, break the causal chain without breaking the correlational one? That test distinguishes the two.\n5. [VERDICT] — based on the validated causal chain only.\n\n'
    },
    {
      id: 'chain_of_verification',
      label: 'Chain-of-verification (claims → verified)',
      description: 'Enumerate every claim you intend to make. Verify each one against the evidence before using it.',
      prefix: 'USE CHAIN-OF-VERIFICATION. Do NOT write the verdict first. Structure:\n1. [CLAIMS] — list every factual claim your verdict will rely on (at least 6–10 claims, atomic). E.g. "claim 1: the deposits totalled AED 200K in 3 days".\n2. [VERIFICATION] — for each claim, name the SPECIFIC line in the case context that supports it, OR mark [UNVERIFIED] / [CONTRADICTED] / [INFERRED from …].\n3. [REVISE] — strike through (in prose: "— withdrawn") any claim that is UNVERIFIED or CONTRADICTED. Do NOT carry it into the verdict.\n4. [VERDICT] — construct the verdict using ONLY the verified claims. If striking the unverified claims hollows out the verdict, say so — the right answer may be "insufficient evidence".\n\nThis is the discipline the MoE inspector will apply to the file. Apply it yourself first.\n\n'
    },
    {
      id: 'adversarial_debate',
      label: 'Adversarial debate (two agents + judge)',
      description: 'Two MLRO agents argue opposing verdicts; a third (the judge) decides on the evidence.',
      prefix: 'SIMULATE AN ADVERSARIAL DEBATE with three labelled sections:\n\n[AGENT A — PROSECUTION] — argues for the STRICTER verdict (e.g. freeze, file STR, escalate to EDD). Presents the 3–4 strongest pieces of evidence and the citation for each.\n\n[AGENT B — DEFENCE] — argues for the LESS STRICT verdict (e.g. monitor, no STR, stay at CDD). Presents the 3–4 strongest pieces of counter-evidence and the citation for each.\n\n[JUDGE] — does NOT rehearse either side. Identifies the 2–3 pivotal factual or legal questions the debate hinges on. Rules for each pivotal question citing only the case evidence and the regulation. Issues the verdict with explicit reasoning.\n\nA neither-side judgment means the file has to be sent back to the analyst for more evidence.\n\n'
    },
    {
      id: 'timeseries',
      label: 'Timeseries (temporal pattern)',
      description: 'Plot the case along a time axis. Look for acceleration, periodicity, trend-break, burst.',
      prefix: 'DO A TIMESERIES ANALYSIS. Structure:\n1. [TIMELINE] — order every dated event in the case (deposits, withdrawals, onboarding, re-screens, alerts, filings). Use dd/mm/yyyy.\n2. [CADENCE] — identify the cadence (daily / weekly / month-end / quarter-end / ad-hoc). Note any alignment with reporting / tax / audit cycles.\n3. [TREND-BREAK] — is there a point at which the behaviour materially changed? Name the date and describe the before/after.\n4. [ACCELERATION] — compute the delta: transactions/day in the first half vs the second half, AED/day in the first half vs the second half. Flag >2× acceleration.\n5. [DEADLINES] — express every open obligation in UAE business days from TODAY (21/04/2026) using src/utils/businessDays.ts semantics.\n6. [VERDICT] — what does the temporal pattern add to the verdict that a static view would miss?\n\n'
    },
    {
      id: 'decision_tree',
      label: 'Decision tree (explicit branching)',
      description: 'Build a labelled decision tree. Each node is a test; each leaf is a verdict with citation.',
      prefix: 'CONSTRUCT AN EXPLICIT DECISION TREE. Render it in indented prose (no ASCII art needed). Rules:\n- Each internal node is a YES/NO test against the case (e.g. "sanctions hit ≥ 0.5?", "AED 55K breached?", "PEP?", "UBO layer opaque?").\n- Each edge is labelled YES or NO.\n- Each leaf is a verdict ("FREEZE — Cabinet Res 74/2020 Art.4-7", "EDD — Cabinet Res 134/2025 Art.14", "SDD review 12mo", etc.).\n- Highlight the single path through the tree that THIS case takes — mark each traversed node with ►.\n- List any node where the evidence is ambiguous; those nodes are the ones the MLRO must resolve before closing the file.\n\nThe tree structure must be complete enough to auditably re-run for any similar case.\n\n'
    },
    {
      id: 'scale_invariance',
      label: 'Scale invariance (10× / 0.1× stress)',
      description: 'Re-run the reasoning at 10× and 0.1× the numbers. If the verdict changes, the threshold is gameable.',
      prefix: 'STRESS-TEST THE VERDICT FOR SCALE INVARIANCE. Structure:\n1. [BASELINE] — verdict at the numbers as stated in the case.\n2. [10×] — re-run the analysis with every amount multiplied by 10. State the verdict at 10×.\n3. [0.1×] — re-run the analysis with every amount divided by 10. State the verdict at 0.1×.\n4. [INVARIANCE] — is the verdict the same across all three scales?\n   - If YES → the verdict rests on non-quantitative factors (typology, jurisdiction, behaviour). Name them.\n   - If NO → identify the threshold(s) that cause the flip (AED 55K CTR, AED 60K cross-border, AED 25% UBO, etc.) and name the gaming vulnerability: a sophisticated subject could engineer the amounts to land on the lenient side.\n5. [VERDICT] — the final answer, explicitly addressing any scale-sensitivity the analysis exposed.\n\nThis catches the subjects who have clearly read the thresholds.\n\n'
    },
    {
      id: 'zoom',
      label: 'Zoom (micro ↔ macro alternation)',
      description: 'Alternate the view between one transaction and the 6-month pattern. Both views must be consistent.',
      prefix: 'ALTERNATE MICRO AND MACRO VIEWS. Structure:\n1. [MICRO] — pick the single most telling transaction in the case. Describe it in forensic detail: amount, counterparty, instrument, channel, time, location, purported purpose. What does this single transaction say?\n2. [MACRO] — step back to the full 6-month (or full available) pattern. Describe the aggregate: total volume, typology shape, trend.\n3. [CONSISTENCY] — does the MICRO transaction fit the MACRO pattern? A transaction that fits the macro is ordinary; one that breaks it is diagnostic.\n4. [SECOND MICRO] — pick a SECOND transaction that appears to CONTRADICT your verdict. Examine it with the same forensic care. Does the contradiction hold up, or is it explicable inside the pattern?\n5. [VERDICT] — a verdict that both MICRO and MACRO support. If they disagree, the disagreement is itself the finding.\n\n'
    },
    {
      id: 'worst_case',
      label: 'Worst-case (conservative floor)',
      description: 'At every ambiguity, assume the worst plausible reading. The verdict is the conservative floor.',
      prefix: 'REASON UNDER WORST-CASE ASSUMPTIONS. This mode builds the conservative floor for the MLRO decision — the position that would survive the strictest MoE / LBMA / FIU review. Rules:\n1. Where the evidence is AMBIGUOUS, assume the interpretation that raises risk, not the one that lowers it.\n2. Where a counterparty, jurisdiction, or instrument has mixed signals, weight the concerning signals heavier.\n3. Where a declared fact is uncorroborated, treat it as ASSERTED (not CONFIRMED).\n4. Where a threshold is borderline, treat it as breached.\n5. Where a timeline is tight, treat it as missed.\n\nOutput:\n- [WORST-CASE FINDINGS] — the list of risks under these assumptions.\n- [VERDICT FLOOR] — the strictest action the evidence (under worst-case reading) would support.\n- [WHAT WOULD LIFT IT] — the specific evidence that, if surfaced, would let the firm step down from the floor to a less strict position.\n\nThis is the position the MLRO defends if an audit goes badly. It is not the position the MLRO recommends if evidence is strong.\n\n'
    },
    {
      id: 'legal_formalism',
      label: 'Legal formalism (strict textualism)',
      description: 'Read the law by the letter. No intent, no policy — only the words of the articles and resolutions.',
      prefix: 'REASON BY STRICT LEGAL FORMALISM. Answer the question using ONLY the literal text of the governing instruments. Structure:\n1. [GOVERNING TEXT] — quote the relevant article(s) / resolution(s) / circular(s) verbatim. Cite FDL No.(10)/2025, Cabinet Res 134/2025, Cabinet Res 74/2020, Cabinet Res 156/2025, Cabinet Decision 109/2023, MoE Circular 08/AML/2021, LBMA RGG v9, or FATF Rec.# as the source.\n2. [LITERAL APPLICATION] — apply the quoted text to the case facts word-by-word. Do NOT import policy intent, industry practice, or common-sense gap-filling.\n3. [GAPS] — where the literal text does NOT answer the question, say so explicitly — do not bridge the gap. List what instrument would need to change to close the gap.\n4. [VERDICT] — the answer the literal reading yields.\n\nThis mode is for audit defensibility: every step can be pointed at a clause.\n\n'
    },
    {
      id: 'purposive',
      label: 'Purposive (spirit of the law, anti-gaming)',
      description: 'Read the regulation by its purpose. A structurally compliant-but-evasive act still fails the purposive test.',
      prefix: 'REASON BY PURPOSIVE CONSTRUCTION. Structure:\n1. [PURPOSE] — for each applicable regulation, state its underlying purpose in one sentence (prevent ML / prevent TF / prevent PF / prevent sanctions evasion / protect beneficial ownership transparency / deter proliferation). Cite the article that embeds the purpose.\n2. [LITERAL COMPLIANCE] — is the conduct technically compliant with the letter of the rule? (yes / no / partially)\n3. [PURPOSIVE COMPLIANCE] — does the conduct honour the PURPOSE of the rule, or does it merely satisfy the words while defeating the aim? Name any evasion pattern: sub-threshold structuring, nominee use, layering, trade-invoice mis-description, VASP bridging, charity misuse.\n4. [TENSION] — where literal and purposive readings diverge, flag it. FATF and UAE AML jurisprudence normally favour the purposive reading in enforcement.\n5. [VERDICT] — the answer under the purposive reading, with explicit note of any departure from the purely literal one.\n\n'
    },
    // ── +6 additional reasoning frames added 2026-04-21 (third
    //    expansion, covering ensemble voting, inversion, Occam's
    //    razor, ontological categorisation, contradiction-finding,
    //    and principle-based compliance reasoning). ──
    {
      id: 'ensemble',
      label: 'Ensemble (5 brief hypotheses, majority vote)',
      description: 'Generate 5 independent brief analyses, then majority-vote the verdict.',
      prefix: 'DO AN ENSEMBLE ANALYSIS. Generate FIVE short independent analyses (labelled [E1] through [E5]), each no more than 80 words. Each must reach its own verdict without referring to the others. After the five, write an [ENSEMBLE VERDICT] section that:\n1. Tabulates the five verdicts.\n2. Takes the majority (3 or more agreeing) as the ensemble verdict.\n3. Surfaces any minority-opinion concern the MLRO should be aware of — a 2:3 split is more informative than a 5:0 consensus.\n4. States the overall confidence based on the split.\n\nIf the five genuinely disagree (no majority), that is the finding — the case is under-determined and requires more evidence.\n\n'
    },
    {
      id: 'inversion',
      label: 'Inversion (work backwards from the verdict)',
      description: 'Assume the verdict is X. What evidence would need to be true? Is it?',
      prefix: 'REASON BY INVERSION. Do NOT build forward from the evidence to the verdict. Instead:\n1. [ASSUMED VERDICT A] — pick the most likely verdict (e.g. "file STR"). Ask: what evidence would NEED to be true for this to be the correct verdict? List those conditions.\n2. [CHECK A] — for each condition in (1), is it met in the case? Mark YES / NO / PARTIALLY.\n3. [ASSUMED VERDICT B] — pick the opposite verdict (e.g. "no STR, continue monitoring"). What conditions would need to hold?\n4. [CHECK B] — same evaluation.\n5. [ACTUAL VERDICT] — which set of conditions is more completely satisfied by the evidence? State it with the gap that remains.\n\nInversion catches the case where the forward reasoning looks plausible but the required conditions for the chosen verdict are not actually present.\n\n'
    },
    {
      id: 'occams',
      label: "Occam's razor (simplest explanation)",
      description: 'Of the competing hypotheses, prefer the one that explains the evidence with the fewest assumptions.',
      prefix: 'APPLY OCCAM\'S RAZOR. Structure:\n1. [COMPETING HYPOTHESES] — list at least 3 plausible explanations for the observed pattern (e.g. structuring / cash-intensive retail / misreporting / TBML). Each hypothesis gets one line.\n2. [ASSUMPTIONS] — for each hypothesis, count the assumptions it requires (hidden UBO, off-book supplier, undocumented SoW, coincidental timing, etc.). Be explicit.\n3. [EXPLANATORY COVERAGE] — does the hypothesis explain ALL the evidence, or only some? A simple hypothesis that only explains half the evidence is weaker than a slightly more complex one that explains all of it.\n4. [WINNER] — the hypothesis with the best assumptions-to-coverage ratio.\n5. [CAVEAT] — where Occam\'s razor would lead to a lenient verdict but the regulatory floor (worst-case reading) demands stricter action, the floor wins. Say so explicitly.\n\n'
    },
    {
      id: 'ontological',
      label: 'Ontological (categorise first, then reason)',
      description: 'Classify the subject, the activity, the flow, and the regime before attempting any verdict.',
      prefix: 'START WITH A STRICT ONTOLOGICAL CLASSIFICATION before any inference. Structure:\n1. [SUBJECT] — natural person / legal entity / trust / foundation / charity / unincorporated body / public-sector / sovereign. Pick one.\n2. [ACTIVITY] — DPMS gold retail / DPMS wholesale / bullion trading / refining / jewellery manufacture / scrap import / pawn-broking / e-commerce gold / something else. Pick one.\n3. [FLOW CLASS] — cash / wire / trade / virtual asset / bearer instrument / physical commodity transfer. Pick one.\n4. [REGIME] — which of FDL Art.12-14, Cabinet Res 134/2025, Cabinet Res 74/2020, Cabinet Res 156/2025, Cabinet Decision 109/2023, MoE Circular 08/AML/2021, LBMA RGG v9 are in scope? Enumerate.\n5. Only AFTER the classification is complete, reason toward the verdict. A misclassification in (1)-(4) produces a verdict answered under the wrong law.\n\n'
    },
    {
      id: 'contradiction',
      label: 'Contradiction-finding (scan for internal inconsistency)',
      description: 'A case that contradicts itself is a red flag. Scan carefully — declared vs observed, claim vs document.',
      prefix: 'SCAN FOR INTERNAL CONTRADICTIONS. The objective is NOT to evaluate the verdict but to locate every place where the case contradicts itself. Structure:\n1. [DECLARED vs OBSERVED] — the customer\'s stated profile (occupation, turnover, purpose, counterparties) vs what actually transits. List each mismatch.\n2. [DOCUMENT vs CLAIM] — any documentary evidence that contradicts the subject\'s verbal or written claim. Cite the document.\n3. [TIMELINE INCONSISTENCY] — events that cannot both be true (e.g. incorporation date before UBO\'s stated tenure; licence validity gap; re-screen date before onboarding).\n4. [CROSS-ENTITY CONFLICT] — any conflict with related-party data (same UBO declares different turnover across two entities; same address with different occupants).\n5. [VERDICT] — a single material contradiction is probable cause for EDD uplift. Two or more is probable cause for STR consideration. State which threshold is crossed.\n\n'
    },
    {
      id: 'principle_based',
      label: 'Principle-based (the 5 compliance principles)',
      description: 'Evaluate against risk-based / proportionate / effective / documented / independent.',
      prefix: 'EVALUATE AGAINST THE FIVE FOUNDATIONAL COMPLIANCE PRINCIPLES. For each principle, state the case-specific question, the answer, and the evidence citation:\n1. [RISK-BASED] — is the response calibrated to the risk, not to a procedural default? (FATF Rec 1, Cabinet Res 134/2025 Art.5)\n2. [PROPORTIONATE] — is the proposed action proportionate to the finding — not over-restrictive and not under-restrictive?\n3. [EFFECTIVE] — does the action actually address the risk, or does it merely generate paperwork?\n4. [DOCUMENTED] — is every step, decision, and rationale captured in the 10-year FDL Art.24 audit file?\n5. [INDEPENDENT] — is the decision free from customer-relationship / commercial / reputational pressure? Has it been (or will it be) reviewed by an independent second pair of eyes (four-eyes)?\n\nA PASS on all five is a defensible position. A FAIL on any one is the first finding an auditor will hand back.\n\n'
    },
    // ── 100 additional reasoning modes added 2026-04-21: formal logic,
    //    cognitive frames, quantitative analysis, investigation methods,
    //    regulatory-specific walks, legal argumentation, analytical
    //    business frames, and hybrid advanced patterns. Batch 1/4. ──
    { id: 'modus_ponens', label: 'Modus ponens (strict rule)', description: 'Apply each regulatory premise as a strict if-then deduction.', prefix: 'APPLY STRICT MODUS PONENS. For each premise: state the rule (if X then Y), state the fact (X holds), conclude Y. No rule without premise. No conclusion without rule.\n\n' },
    { id: 'modus_tollens', label: 'Modus tollens (contrapositive)', description: 'Reason from absence of consequent to absence of antecedent.', prefix: 'APPLY MODUS TOLLENS. For each regulatory rule (if X then Y): if Y is absent in the case, conclude X cannot be the full cause. Use to eliminate typologies rather than confirm them.\n\n' },
    { id: 'reductio', label: 'Reductio ad absurdum', description: 'Assume the opposite verdict and derive a contradiction.', prefix: 'USE REDUCTIO AD ABSURDUM. (1) Assume the opposite of the most likely verdict. (2) Trace the regulatory consequences. (3) Find the contradiction with observed facts. (4) Conclude the opposite is false.\n\n' },
    { id: 'syllogistic', label: 'Classical syllogism', description: 'Major premise → minor premise → conclusion, cited.', prefix: 'STRUCTURE AS SYLLOGISMS. Major premise: the regulation (full citation). Minor premise: the case fact. Conclusion: the verdict. Chain syllogisms to reach the final disposition.\n\n' },
    { id: 'propositional_logic', label: 'Propositional logic', description: 'Name each proposition, combine with connectives, evaluate.', prefix: 'RENDER AS PROPOSITIONS. Label each fact P, Q, R... Define the regulatory rule as a formula (P AND Q → R). Evaluate truth values against the case and derive the verdict.\n\n' },
    { id: 'predicate_logic', label: 'First-order logic', description: 'Quantify over parties, transactions, dates.', prefix: 'USE FIRST-ORDER LOGIC. Quantify over parties / transactions / dates. Example: ∀x (Transaction(x) ∧ Cash(x) ∧ AED(x) ≥ 55000 → CTR-required(x)). Instantiate against the case.\n\n' },
    { id: 'fuzzy_logic', label: 'Fuzzy logic (graded truth)', description: 'Truth values 0–1 for borderline cases.', prefix: 'USE FUZZY LOGIC. Assign graded truth in [0,1] to each predicate (e.g. "cash-intensive" = 0.7). Combine with fuzzy AND (min) / OR (max). Report a graded verdict, not binary.\n\n' },
    { id: 'probabilistic_logic', label: 'Probabilistic logic', description: 'Probabilities on propositions; propagate via product / sum rules.', prefix: 'COMBINE LOGIC WITH PROBABILITY. Assign P(proposition) to each premise. Propagate: P(A∧B) = P(A)P(B|A); P(A∨B) = P(A)+P(B)-P(A∧B). Report posterior probability of each verdict.\n\n' },
    { id: 'default_reasoning', label: 'Default reasoning', description: 'Apply the default rule unless an exception fires.', prefix: 'APPLY DEFAULT REASONING. State the default regulatory rule. Enumerate the exceptions. Check each against the case; if none fire, apply the default. Make every non-default move explicit.\n\n' },
    { id: 'non_monotonic', label: 'Non-monotonic (revisable)', description: 'Treat the verdict as revisable as new evidence arrives.', prefix: 'REASON NON-MONOTONICALLY. State the current verdict given current evidence. List the specific new facts that would REVISE the verdict. Make revision triggers explicit so the MLRO knows what to monitor.\n\n' },
    { id: 'paraconsistent', label: 'Paraconsistent (conflicting evidence)', description: 'Tolerate contradictions without collapsing the analysis.', prefix: 'USE PARACONSISTENT REASONING. The evidence contains contradictions — document them. Do NOT let one contradiction invalidate everything. Partition the case into consistent sub-claims and reason within each.\n\n' },
    { id: 'modal_logic', label: 'Modal logic (necessity / possibility)', description: 'Distinguish necessarily-true / possibly-true / contingent claims.', prefix: 'USE MODAL OPERATORS. Mark each claim NECESSARY (□) if true under all interpretations, POSSIBLE (◇) if true under some, CONTINGENT otherwise. Apply duties to necessary claims first; flag possible claims for EDD.\n\n' },
    { id: 'deontic_logic', label: 'Deontic logic (obligation / permission)', description: 'Label each action OBLIGATORY / PERMITTED / FORBIDDEN.', prefix: 'USE DEONTIC OPERATORS. Map each duty to O(action) [obligatory], P(action) [permitted], or F(action) [forbidden]. Verify no O-violations and no F-performances. Use for STR/freeze/notification.\n\n' },
    { id: 'temporal_logic', label: 'Temporal logic (deadlines)', description: 'Reason about duties over time: deadlines, cycles, retention.', prefix: 'USE TEMPORAL OPERATORS. ALWAYS(duty) = continuous obligation. EVENTUALLY(duty, T) = must be done by T. UNTIL(A, B) = A holds until B triggers. Map 10-year / 24h / 5-day duties to temporal formulas.\n\n' },
    { id: 'epistemic_logic', label: 'Epistemic logic (known / unknown)', description: 'Distinguish what the firm KNOWS, BELIEVES, and does NOT KNOW.', prefix: 'USE EPISTEMIC OPERATORS. K(firm, fact) = knows. B(firm, fact) = believes. ¬K(firm, fact) = does not know. Flag every ¬K that creates regulatory liability (wilful blindness under FDL Art.14).\n\n' },
    { id: 'system_1', label: 'System 1 (fast intuitive)', description: 'First-impression read; used to seed deeper System 2 analysis.', prefix: 'DELIVER A SYSTEM-1 READ FIRST. What is your immediate gut verdict in one sentence? Then flag what might be wrong with that gut read. This is a SEED, not a final answer.\n\n' },
    { id: 'system_2', label: 'System 2 (deliberate)', description: 'Slow, analytical, methodical — explicit chain-of-rule-application.', prefix: 'ENGAGE SYSTEM 2 DELIBERATELY. Slow down. For every claim, demand: (a) the specific citation, (b) the specific case fact, (c) the logical link. No intuition. No shortcuts.\n\n' },
    { id: 'dual_process', label: 'Dual-process (1 + 2 reconciled)', description: 'Run gut and deliberate side-by-side; reconcile.', prefix: 'RUN DUAL-PROCESS REASONING. Section A: System-1 gut read (2-3 sentences). Section B: System-2 deliberate analysis (full citations). Section C: Reconciliation — where they agree/disagree and which to trust.\n\n' },
    { id: 'ooda', label: 'OODA loop (Boyd)', description: 'Observe → Orient → Decide → Act — with loop-back triggers.', prefix: 'STRUCTURE AS AN OODA LOOP. OBSERVE: what the case shows. ORIENT: which regulatory frame applies + firm\'s priors. DECIDE: the verdict. ACT: the concrete next step. Note the trigger that would force a loop-back.\n\n' },
    { id: 'pre_mortem', label: 'Pre-mortem (assume failure)', description: 'Assume the verdict fails audit in 12 months; trace back.', prefix: 'RUN A PRE-MORTEM. Assume: in 12 months, an audit finds the verdict was wrong and the firm is penalised. Trace the 3-5 most likely failure paths. For each, specify the preventive control missing today.\n\n' },
    { id: 'post_mortem', label: 'Post-mortem (retrospective)', description: 'Treat the case as closed; what would a later auditor conclude?', prefix: 'RUN A POST-MORTEM. The case is closed. A senior auditor re-reads it in 2 years. Write findings from THEIR perspective: was the verdict defensible, what evidence was missing, what process gaps showed up.\n\n' },
    { id: 'steelman', label: 'Steelman the opposing verdict', description: 'Build the strongest possible case AGAINST the current verdict.', prefix: 'STEELMAN THE OPPOSING VERDICT. Construct the strongest argument AGAINST the verdict you would otherwise pick. Cite regulations, raise gaps, offer alternative typologies. Only in the final paragraph state which side wins.\n\n' },
    { id: 'hindsight_check', label: 'Hindsight-bias check', description: 'Guard against reasoning from known outcome back to "obvious" signals.', prefix: 'GUARD AGAINST HINDSIGHT BIAS. Identify any signal that is "obvious" only because the outcome is known. For each, ask: would the MLRO have flagged it at the time given only pre-outcome evidence? If no, discount it.\n\n' },
    { id: 'cognitive_bias_audit', label: 'Cognitive-bias audit', description: 'Explicitly name anchoring / confirmation / availability biases.', prefix: 'AUDIT FOR COGNITIVE BIASES. At each inference, name any bias at risk: ANCHORING, CONFIRMATION, AVAILABILITY, REPRESENTATIVENESS. Correct for each before concluding.\n\n' },
    { id: 'confidence_calibration', label: 'Confidence calibration', description: 'Stress-test whether confidence matches actual evidence strength.', prefix: 'CALIBRATE CONFIDENCE DELIBERATELY. For each claim, state: (a) stated confidence %, (b) evidence that justifies it, (c) whether the evidence actually supports that level. If weak, REVISE down. No false precision.\n\n' },
    // Batch 2/4 — quantitative + investigation frames.
    { id: 'planning_fallacy', label: 'Planning-fallacy check', description: 'Pessimistic timeline: multiply best-case estimate by reference-class factor.', prefix: 'GUARD AGAINST THE PLANNING FALLACY. Any best-case estimate (investigation close, filing turnaround, remediation) gets multiplied by a reference-class factor (typ. 1.5-2.5x). State the naive estimate, the factor used, and the calibrated estimate.\n\n' },
    { id: 'availability_check', label: 'Availability-heuristic check', description: 'Am I overweighting cases I remember vs their actual base rate?', prefix: 'CHECK THE AVAILABILITY HEURISTIC. Before applying any typology, ask: am I picking this because it\'s truly the best match, or because it\'s the typology most recently / most vividly in my memory? Re-run against the full typology catalogue.\n\n' },
    { id: 'framing_check', label: 'Framing-effect check', description: 'Test whether a different framing of the same facts changes the verdict.', prefix: 'TEST FRAMING EFFECTS. Re-state the case facts from three different framings: (1) customer\'s self-narrative, (2) firm\'s control perspective, (3) regulator\'s enforcement lens. If the verdict changes across framings, the reasoning is framing-dependent and must be reconciled.\n\n' },
    { id: 'overconfidence_check', label: 'Overconfidence check', description: 'Challenge priors that are too tight; widen uncertainty bounds.', prefix: 'CHECK FOR OVERCONFIDENCE. For every probability or range you state, ask: is this tighter than the evidence supports? Widen the uncertainty band. A 95% confidence interval must survive adversarial stress, not just feel comfortable.\n\n' },
    { id: 'anchoring_avoidance', label: 'Anchoring avoidance', description: 'Drop the initial numeric anchor and re-estimate from scratch.', prefix: 'AVOID ANCHORING. Identify the first numeric anchor in the case (a risk score, a CDD tier, a prior verdict). Ignore it. Re-estimate the key quantity from scratch using the base-rate plus evidence. Then compare to the anchor — if they differ, trust the re-estimate and explain the drift.\n\n' },
    { id: 'monte_carlo', label: 'Monte Carlo (simulation in prose)', description: 'Run 1000 hypothetical scenarios, report the distribution of outcomes.', prefix: 'RUN A MONTE-CARLO-IN-PROSE. Enumerate the key uncertain variables (each with a plausible range). Walk through ~5 representative scenario draws (low / low-mid / mid / mid-high / high). Report the distribution of verdicts and flag the tail cases.\n\n' },
    { id: 'fermi', label: 'Fermi estimation', description: 'Order-of-magnitude estimate when exact numbers are unavailable.', prefix: 'USE FERMI ESTIMATION. Break the unknown into 3-5 estimable sub-quantities. Order-of-magnitude each. Multiply / combine. Report the final estimate to the nearest power of 10 and note the dominant source of uncertainty.\n\n' },
    { id: 'expected_utility', label: 'Expected utility', description: 'EV of each possible action across outcome scenarios.', prefix: 'COMPUTE EXPECTED UTILITY. For each candidate action (freeze / EDD / dismiss / STR), enumerate outcomes with probabilities and utilities (penalty risk, reputational cost, ongoing-monitoring cost, revenue forgone). Pick the action with maximum expected utility.\n\n' },
    { id: 'minimax', label: 'Minimax (minimise the maximum loss)', description: 'Pick the action whose worst-case loss is smallest.', prefix: 'APPLY MINIMAX. For each candidate action, identify the worst-case regulatory / reputational / financial loss. Pick the action whose worst case is smallest — even if its expected case is not the best. Use when tail risk dominates.\n\n' },
    { id: 'maximin', label: 'Maximin (maximise the guaranteed)', description: 'Pick the action whose floor outcome is highest.', prefix: 'APPLY MAXIMIN. For each action, identify the minimum guaranteed outcome (the worst the firm can still defend). Pick the action with the highest floor. Appropriate when the regulator\'s threshold of acceptable conduct is a hard line.\n\n' },
    { id: 'cvar', label: 'CVaR / tail-risk', description: 'Focus on the worst 5% of scenarios rather than the mean.', prefix: 'APPLY CONDITIONAL VALUE AT RISK. Identify the worst 5% of outcome scenarios (penalty, enforcement, licence risk). Report the AVERAGE loss across just those scenarios, not the overall mean. Decisions must survive the tail, not just the centre.\n\n' },
    { id: 'regret_min', label: 'Regret minimisation', description: 'Pick the action whose future regret is smallest.', prefix: 'MINIMISE FUTURE REGRET. For each action, imagine the 2-year retrospective: what would a later auditor / MoE / board regret most about this decision? Pick the action whose retrospective regret is smallest. Tilts toward conservatism on tipping-off and freeze duties.\n\n' },
    { id: 'marginal', label: 'Marginal analysis', description: 'What does each extra control or evidence item actually buy?', prefix: 'ANALYSE AT THE MARGIN. For each proposed additional control / evidence request / monitoring step, state: (a) marginal cost, (b) marginal reduction in residual risk, (c) whether that ratio beats alternative uses of the same cost. Stop adding when marginal benefit falls below marginal cost.\n\n' },
    { id: 'cost_benefit', label: 'Explicit cost-benefit', description: 'Quantified trade-off: compliance cost vs risk reduced.', prefix: 'RUN AN EXPLICIT COST-BENEFIT. Quantify (in AED / hours / FTE): (a) the compliance action cost, (b) the risk-weighted avoided loss (penalty × probability). Decision threshold: proceed if benefit ≥ 3x cost unless the residual risk crosses a regulatory floor (then proceed regardless).\n\n' },
    { id: 'break_even', label: 'Break-even threshold', description: 'What level of evidence flips the verdict?', prefix: 'IDENTIFY THE BREAK-EVEN THRESHOLD. For each possible verdict flip (e.g. dismiss → EDD → STR → freeze), state the specific additional evidence or probability shift that would flip it. This tells the MLRO exactly what to monitor and what to request next.\n\n' },
    { id: 'real_options', label: 'Real-options (value of waiting)', description: 'What is the value of waiting for more evidence before acting?', prefix: 'VALUE THE OPTION TO WAIT. For each action, estimate (a) the cost of acting now, (b) the cost of deferring by N days, (c) the probability that waiting produces decision-relevant evidence. Only defer when the option value exceeds the regulatory cost of delay (and never defer a freeze past 24h or an STR past "without delay").\n\n' },
    { id: 'sensitivity_tornado', label: 'Sensitivity / tornado analysis', description: 'Rank inputs by how much they move the verdict.', prefix: 'BUILD A TORNADO CHART IN PROSE. Rank the top 5 input assumptions by how much their plausible range moves the verdict. Start with the assumption that matters most. If the top-ranked assumption is weakly supported, the verdict is not yet defensible.\n\n' },
    { id: 'risk_adjusted', label: 'Risk-adjusted severity', description: 'Weight severity by probability; report adjusted exposure.', prefix: 'REPORT RISK-ADJUSTED SEVERITY. For each risk, multiply (probability) × (severity if realised) × (time horizon). Rank. Use risk-adjusted numbers — not raw severity — to prioritise action and allocate oversight.\n\n' },
    { id: 'loss_aversion_check', label: 'Loss-aversion check', description: 'Correct for the bias that makes losses feel ~2× gains.', prefix: 'CORRECT FOR LOSS AVERSION. Prospect theory: people weight losses ~2x gains. If the verdict leans conservative because the downside "feels" big, re-weight gains and losses symmetrically and re-derive. Keep a bias toward conservatism only where the regulation explicitly demands it.\n\n' },
    { id: 'portfolio_view', label: 'Portfolio view (firm-wide)', description: 'Assess this case as part of the firm\'s aggregate risk, not in isolation.', prefix: 'ADOPT A PORTFOLIO VIEW. Assess this case not in isolation but as part of the firm\'s aggregate exposure: jurisdiction mix, typology concentration, PEP density, cash intensity, correspondent-tier exposure. A single moderate case in a concentrated portfolio may warrant action that a standalone case would not.\n\n' },
    { id: 'five_whys', label: 'Five whys (iterative root cause)', description: 'Ask "why" five times to expose the deepest cause.', prefix: 'APPLY FIVE WHYS. Starting from the most visible symptom, ask "why did this happen?" five times in sequence. Each answer becomes the subject of the next question. Report the chain. The fifth "why" should expose the process / policy / training gap driving the case.\n\n' },
    { id: 'fishbone', label: 'Fishbone (Ishikawa)', description: 'Categorise causes across people / process / technology / data / environment.', prefix: 'BUILD A FISHBONE DIAGRAM IN PROSE. Five spines: (1) People — who missed, who misread, who lacked training. (2) Process — which SOP failed. (3) Technology — which system misfired. (4) Data — which data was wrong / missing. (5) Environment — market, regulatory, or jurisdictional drivers. List contributing causes under each.\n\n' },
    { id: 'fmea', label: 'FMEA (failure-mode-effect)', description: 'For each failure mode: severity × occurrence × detection = RPN.', prefix: 'APPLY FMEA. For each identified failure mode, score: SEVERITY (1-10), OCCURRENCE probability (1-10), DETECTION difficulty (1-10). Multiply to get the Risk Priority Number. Rank by RPN. Target controls to reduce the highest-RPN modes first.\n\n' },
    { id: 'pareto', label: 'Pareto 80/20', description: 'Identify the ~20% of factors driving ~80% of the risk.', prefix: 'APPLY PARETO. Of the risk factors present, which ~20% are driving ~80% of the exposure? Concentrate control effort on those. Report the Pareto split explicitly so the MLRO knows what to defund if budget is tight.\n\n' },
    { id: 'swiss_cheese', label: 'Swiss-cheese (layered defences)', description: 'Map each control as a slice with holes; find the aligned-hole path.', prefix: 'APPLY THE SWISS-CHEESE MODEL. Enumerate each defensive control (onboarding, screening, monitoring, STR, MLRO review, audit). Each has holes (blind spots). Trace the specific path where holes in successive slices align to produce the risk. Recommend the control whose hole is cheapest to close.\n\n' },
    // Batch 3/4 — investigation tails + regulatory-specific walks.
    { id: 'bowtie', label: 'Bowtie (threat → event → consequence)', description: 'Preventive barriers on the left, mitigative barriers on the right.', prefix: 'BUILD A BOWTIE. CENTRE: the top event (e.g. "unreported STR", "sanctions bypass"). LEFT: the threats that could cause it + the preventive barriers between each threat and the centre. RIGHT: the consequences if it happens + the mitigative barriers between centre and each consequence. Identify the weakest barrier.\n\n' },
    { id: 'kill_chain', label: 'Kill-chain (evasion sequence)', description: 'Decompose the evasion into sequenced steps; break the chain early.', prefix: 'DECOMPOSE AS A KILL-CHAIN. Order the steps an adversary must complete (reconnaissance → placement → layering → integration → extraction). For each step present in the case, identify the specific control that could break the chain earliest. Earlier-break controls are worth more than later-break ones.\n\n' },
    { id: 'timeline_reconstruction', label: 'Timeline reconstruction', description: 'Strict chronology: who did what, when, with what evidence.', prefix: 'RECONSTRUCT THE TIMELINE STRICTLY. Output a dd/mm/yyyy-ordered table: date · event · actor · evidence source. No narrative assertions that aren\'t anchored to a row. Gaps in the timeline are first-class findings; mark each gap explicitly.\n\n' },
    { id: 'evidence_graph', label: 'Evidence graph', description: 'Nodes = facts. Edges = inferences. Report the weakest edge.', prefix: 'BUILD AN EVIDENCE GRAPH. NODES: each atomic fact (document / transaction / statement / observation). EDGES: each inferential step ("fact A supports verdict B because ..."). Report the WEAKEST edge and state what evidence would strengthen it.\n\n' },
    { id: 'link_analysis', label: 'Link analysis (entity network)', description: 'Map the network of connected parties and inferred relationships.', prefix: 'RUN LINK ANALYSIS. Enumerate every party mentioned (individuals, entities, addresses, bank accounts, wallets, phones). Draw the inferred relationships (UBO, director, signatory, counterparty, beneficial, correspondent). Highlight any hub node with suspiciously high degree.\n\n' },
    { id: 'three_lines_defence', label: 'Three lines of defence', description: 'Evaluate first line (business), second (compliance), third (audit) posture.', prefix: 'EVALUATE THREE LINES OF DEFENCE. FIRST LINE (business ownership): did front-office apply correct CDD at onboarding / ongoing? SECOND LINE (compliance function): did MLRO / screening / monitoring catch it? THIRD LINE (internal audit): has it been independently tested? Score each line PASS / GAP / FAIL.\n\n' },
    { id: 'five_pillars', label: 'Five pillars of the AML programme', description: 'Internal controls / independent audit / MLRO / training / risk-based CDD.', prefix: 'ASSESS THE FIVE-PILLAR COMPLIANCE PROGRAMME. (1) Internal controls (policy, SOPs). (2) Independent audit. (3) Designated MLRO. (4) Ongoing training. (5) Risk-based CDD. For each, cite the case evidence that the pillar held or the specific gap. A missing pillar is a structural defect, not a one-off.\n\n' },
    { id: 'risk_based_approach', label: 'Risk-based approach (FATF Rec 1)', description: 'Calibrate controls to risk; resist both over- and under-response.', prefix: 'APPLY THE RISK-BASED APPROACH. Start from the firm\'s documented risk assessment (FATF Rec 1, Cabinet Res 134/2025 Art.5). Map the case to its risk segment. Verify the proposed control is PROPORTIONATE — neither over-applying EDD to low-risk nor under-applying to high-risk. Justify each step by the risk it addresses.\n\n' },
    { id: 'fatf_effectiveness', label: 'FATF effectiveness (Immediate Outcomes)', description: 'Map the case to FATF\'s 11 Immediate Outcomes of effectiveness.', prefix: 'MAP TO FATF IMMEDIATE OUTCOMES. Select the two to three IOs most relevant to this case (e.g. IO.3 supervision, IO.4 preventive measures, IO.5 legal persons, IO.6 financial intelligence, IO.7 ML investigation, IO.10 TF preventive). For each selected IO, state whether the case shows an effective outcome, a partial effectiveness, or a gap.\n\n' },
    { id: 'wolfsberg_faq', label: 'Wolfsberg FAQ walkthrough', description: 'Apply the Wolfsberg FAQ decision points line by line.', prefix: 'WALK THE WOLFSBERG FAQ. Select the relevant Wolfsberg paper for the case (PEP / Correspondent Banking / Beneficial Ownership / Financial Crime Principles). Walk each FAQ question applied to the case facts. Output: question · Wolfsberg guidance · case-specific answer.\n\n' },
    { id: 'lbma_rgg_five_step', label: 'LBMA RGG v9 five-step walk', description: 'Step 1 policy → 2 risk → 3 DD → 4 audit → 5 report, explicitly.', prefix: 'WALK THE LBMA RGG v9 FIVE-STEP FRAMEWORK. STEP 1: the firm\'s policy posture on supply-chain DD. STEP 2: the risk assessment of the specific supply chain in the case. STEP 3: the DD executed on the CAHRA segment. STEP 4: independent audit coverage. STEP 5: public reporting posture. Score each step PASS / PARTIAL / FAIL with evidence.\n\n' },
    { id: 'oecd_ddg_annex', label: 'OECD DDG Annex red-flag walk', description: 'Walk OECD Due Diligence Guidance Annex I/II red flags.', prefix: 'WALK THE OECD DDG ANNEX RED FLAGS. Enumerate the relevant Annex I (mineral supply chain) / Annex II (CAHRA) red flags against the case. For each present flag, state: flag · evidence · mitigation status · residual risk. Focus on the unmitigated residual rather than the flag count.\n\n' },
    { id: 'typology_catalogue', label: 'FATF typology catalogue match', description: 'Walk the FATF typology catalogue methodically; not pattern-match.', prefix: 'APPLY THE FATF TYPOLOGY CATALOGUE METHODICALLY. Do not pattern-match to the first typology that looks close. Walk the catalogue (structuring, smurfing, TBML over/under-invoicing, phantom shipment, shell layering, BMPE, hawala, loan-back, casino-out, real-estate, VASP mixing, freight-forwarder fronting, cash-courier). Report the top 3 matches and score each.\n\n' },
    { id: 'article_by_article', label: 'FDL Article-by-Article trace', description: 'Apply FDL No.10/2025 article-by-article to the case.', prefix: 'TRACE FDL No.(10)/2025 ARTICLE BY ARTICLE. Walk at least Art.12 (CDD), Art.14 (thresholds), Art.20-21 (CO duties), Art.24 (retention), Art.26-27 (STR), Art.29 (tipping-off), Art.35 (TFS). For each article, output: article · duty · case-specific application · status (met / at risk / breached).\n\n' },
    { id: 'cabinet_res_walk', label: 'Cabinet Resolution walk', description: 'Walk Cabinet Res 134/2025, 74/2020, 156/2025, 109/2023, 71/2024.', prefix: 'WALK THE CABINET RESOLUTIONS. For each in scope — Cabinet Res 134/2025 (Implementing Regs), 74/2020 (TFS/freeze), 156/2025 (PF/dual-use), Cabinet Decision 109/2023 (UBO), Cabinet Res 71/2024 (penalties) — cite the specific article triggered by the case and the required action.\n\n' },
    { id: 'circular_walk', label: 'MoE / CBUAE circular walk', description: 'MoE 08/AML/2021 + related circulars, applied to the case.', prefix: 'WALK THE RELEVANT CIRCULARS. MoE Circular 08/AML/2021 (DPMS) is the default. Also consider CBUAE FI circulars where the counterparty is banked, SCA circulars where investment products are in play, VARA rulebook where virtual assets transit. Cite the specific paragraph driving each obligation.\n\n' },
    { id: 'list_walk', label: 'Sanctions list-by-list walk', description: 'Walk UN → OFAC → EU → UK → UAE → EOCN explicitly.', prefix: 'WALK THE SANCTIONS LISTS EXPLICITLY. For the subject and every related party: UN Consolidated · OFAC SDN + non-SDN · EU Consolidated · UK OFSI · UAE EOCN Local · EOCN de-listing. For each list: screened (y/n) · hit (y/n) · confidence · action. Never skip a list (CLAUDE.md rule).\n\n' },
    { id: 'ubo_tree_walk', label: 'UBO / ownership-tree walk', description: 'Walk the shareholding tree to the natural-person UBO; flag opacity.', prefix: 'WALK THE UBO TREE. Start at the customer. At each layer, list: owner · % · jurisdiction · corporate form · evidence source. Continue until a natural person with ≥25% effective control is reached (Cabinet Decision 109/2023). Flag any secrecy-jurisdiction hop, any nominee, any chain that cannot be completed.\n\n' },
    { id: 'jurisdiction_cascade', label: 'Jurisdiction-risk cascade', description: 'Home / host / transit / beneficiary jurisdiction risks in sequence.', prefix: 'RUN A JURISDICTION-RISK CASCADE. Enumerate: (a) home (firm\'s licensed jurisdiction), (b) host (customer\'s residency / incorporation), (c) transit (any intermediary jurisdiction touched by funds / goods), (d) beneficiary (where the value lands). For each, state the FATF / EU / US / UAE risk rating and the specific mitigation required.\n\n' },
    { id: 'sanctions_regime_matrix', label: 'Multi-regime sanctions matrix', description: 'Resolve conflicts-of-law between UN / OFAC / EU / UK / UAE.', prefix: 'BUILD A MULTI-REGIME SANCTIONS MATRIX. Columns: UN · OFAC · EU · UK · UAE · EOCN. Rows: (a) does each regime apply to this case? (b) what action does it require? (c) what is the strictest element across all? Where two regimes conflict, default to the STRICTEST — with a citation trail.\n\n' },
    { id: 'kpi_dpms_thirty', label: '30-KPI DPMS compliance mapping', description: 'Map the case to the 30 DPMS compliance KPIs.', prefix: 'MAP THE CASE TO THE 30-KPI DPMS COMPLIANCE FRAMEWORK. For each KPI in scope (onboarding coverage · sanctions screening · CTR filing · DPMSR filing · STR filing · UBO re-verification · training completion · sanctions-list freshness · etc.), report: KPI · target · case-specific value · status. Use the output to drive the firm\'s dashboard.\n\n' },
    { id: 'emirate_jurisdiction', label: 'UAE Emirate-level jurisdiction', description: 'Distinguish DFSA / FSRA / onshore / free-zone jurisdiction for DPMS.', prefix: 'DISTINGUISH THE EMIRATE-LEVEL JURISDICTION. Identify whether the activity sits in DFSA (DIFC), FSRA (ADGM), onshore UAE (MoE-supervised DPMS), or a specific free zone. Cite the governing regulator for each leg of the transaction. Apply the regulator\'s specific rulebook, not just the federal baseline.\n\n' },
    { id: 'source_triangulation', label: 'Source-of-wealth triangulation', description: 'Cross-reference three independent sources of SoW / SoF evidence.', prefix: 'TRIANGULATE SOURCE OF WEALTH. For the subject\'s declared SoW / SoF, require corroboration from at least THREE independent sources (tax filing + bank statements + commercial registry, or equivalent). Report: source · evidence · freshness · any inconsistency between sources. Single-source corroboration is treated as a gap.\n\n' },
    { id: 'retention_audit', label: 'FDL Art.24 retention audit', description: 'Verify every artefact the case produces is captured for 10 years.', prefix: 'AUDIT 10-YEAR RECORD RETENTION. For each artefact the case produces (CDD file · screening result · STR draft · MLRO decision · freeze notice · CNMR filing), confirm: captured (y/n) · storage location · retention-until date · access-control. Missing retention coverage is a FDL Art.24 finding in its own right.\n\n' },
    { id: 'peer_benchmark', label: 'Peer benchmark (sector comparison)', description: 'Compare the case to peer-firm disclosures for the same sector/size.', prefix: 'BENCHMARK AGAINST PEERS. Compare the case\'s risk posture (CDD depth, STR rate, sanctions-hit rate, UBO coverage) to published peer benchmarks in the same sector and size band. Where the firm lags the peer median, flag a potential control gap; where it leads, capture it as an audit-defensible positive.\n\n' },
    // Batch 4/4 — legal argumentation + analytical business + hybrid.
    { id: 'toulmin', label: 'Toulmin argument structure', description: 'Claim · Grounds · Warrant · Backing · Qualifier · Rebuttal.', prefix: 'STRUCTURE THE ARGUMENT IN TOULMIN FORM. CLAIM: the verdict. GROUNDS: the case facts that support it. WARRANT: the regulatory principle that links grounds to claim. BACKING: the citation that validates the warrant. QUALIFIER: the confidence / scope. REBUTTAL: the conditions that would defeat the claim.\n\n' },
    { id: 'irac', label: 'IRAC legal structure', description: 'Issue · Rule · Application · Conclusion.', prefix: 'STRUCTURE AS IRAC. ISSUE: the precise compliance question. RULE: the regulation that governs it (cited). APPLICATION: how the rule maps to the case facts. CONCLUSION: the disposition. One IRAC block per legal question; chain them for multi-issue cases.\n\n' },
    { id: 'craac', label: 'CRAAC with authority', description: 'Conclusion · Rule · Analogous authority · Application · Conclusion.', prefix: 'STRUCTURE AS CRAAC. CONCLUSION (preview): one-line verdict. RULE: cited regulation. ANALOGOUS AUTHORITY: the closest prior UAE MoE / FIU / LBMA ruling, circular, or enforcement action. APPLICATION: facts → rule → analogy. CONCLUSION (final): reinforced verdict with citation chain.\n\n' },
    { id: 'rogerian', label: 'Rogerian (mutual understanding first)', description: 'State the opposing view fairly before arguing; lower the adversarial tone.', prefix: 'USE ROGERIAN ARGUMENTATION. Step 1: state the opposing position so fairly that a reasonable holder would accept the restatement. Step 2: identify the common ground. Step 3: then present your position as a refinement rather than an opposition. Appropriate when the MLRO must convince an internal stakeholder, not just log a verdict.\n\n' },
    { id: 'policy_vs_rule', label: 'Policy vs rule layer', description: 'Separate the rule\'s letter from its regulatory policy intent.', prefix: 'SEPARATE POLICY FROM RULE. (1) State what the rule LITERALLY requires. (2) State what regulatory POLICY the rule serves. (3) If the case falls in a textual gap, apply policy intent, not mechanical rule text. (4) If the literal rule produces a result contrary to policy intent, flag to the MLRO.\n\n' },
    { id: 'de_minimis', label: 'De minimis / materiality', description: 'Test whether the matter is below a reasonable materiality floor.', prefix: 'APPLY THE DE MINIMIS TEST. Is the conduct below a reasonable materiality floor (financial, reputational, frequency)? If yes, document the de minimis finding and the floor applied. If no, proceed. Note: de minimis does NOT apply to sanctions duties or to tipping-off — those have no floor.\n\n' },
    { id: 'proportionality_test', label: 'Proportionality test', description: 'Necessary · suitable · least-restrictive.', prefix: 'APPLY THE PROPORTIONALITY TEST. Is the proposed action (a) NECESSARY to address the risk, (b) SUITABLE to actually address it, (c) the LEAST-RESTRICTIVE option that would still address it? All three must hold. If any fails, pick a less-restrictive action.\n\n' },
    { id: 'stare_decisis', label: 'Stare decisis (prior-decision consistency)', description: 'Defer to prior MLRO / firm decisions unless distinguished.', prefix: 'APPLY STARE DECISIS. Find the firm\'s most similar prior MLRO decision. Apply the same disposition unless the present case can be DISTINGUISHED on specific, stated facts. Inconsistency across similar cases is itself an audit finding — avoid drift.\n\n' },
    { id: 'analogical_precedent', label: 'Analogical precedent (prior ruling)', description: 'Find the closest prior UAE MoE / LBMA / FIU ruling.', prefix: 'FIND THE CLOSEST ANALOGICAL PRECEDENT. Search for the closest prior UAE MoE enforcement action / LBMA audit finding / FIU typology advisory / similar firm case. Cite it. Explain which facts map and which do not. Apply by analogy where the mapping is strong.\n\n' },
    { id: 'gray_zone_resolution', label: 'Conflict-of-law resolution', description: 'Apply lex specialis and lex posterior to reconcile rule conflict.', prefix: 'RESOLVE CONFLICT OF LAW. Where two regulatory rules apply and point in different directions, resolve using: LEX SPECIALIS (the more specific rule governs) and LEX POSTERIOR (the later rule governs). State which principle you applied and why. If neither resolves, escalate.\n\n' },
    { id: 'swot', label: 'SWOT (compliance posture)', description: 'Strengths · Weaknesses · Opportunities · Threats for the firm\'s posture.', prefix: 'RUN A SWOT ON THE FIRM\'S POSTURE. STRENGTHS: controls and evidence that hold. WEAKNESSES: controls that do not. OPPORTUNITIES: improvements the case enables. THREATS: external pressures (regulator focus, sector risk, adverse media). Use to prioritise remediation.\n\n' },
    { id: 'pestle', label: 'PESTLE macro scan', description: 'Political / Economic / Social / Technological / Legal / Environmental.', prefix: 'RUN A PESTLE SCAN OF THE CASE CONTEXT. POLITICAL (sanctions regimes, FATF listing). ECONOMIC (commodity cycles, AED stress). SOCIAL (sector reputational posture). TECHNOLOGICAL (VASP, tokenised gold, privacy coins). LEGAL (new circulars, pending legislation). ENVIRONMENTAL (CAHRA sourcing, ESG). Flag the factor most likely to flip the verdict in the next 12 months.\n\n' },
    { id: 'porter_adapted', label: 'Porter-adapted crime typology', description: 'Adapt Porter\'s five forces to criminal-ecosystem pressure on the firm.', prefix: 'ADAPT PORTER\'S FIVE FORCES TO CRIME TYPOLOGY. (1) Threat of entry — new laundering typologies. (2) Substitutes — alternative channels (VASP, hawala, gold). (3) Bargaining power of customers (high-volume clients pressuring lower CDD). (4) Bargaining power of suppliers (correspondent banks, refiners). (5) Rivalry — peer firms undercutting compliance standards. Identify where the firm is exposed.\n\n' },
    { id: 'steep', label: 'STEEP risk scan', description: 'Social / Technological / Economic / Environmental / Political context.', prefix: 'RUN A STEEP SCAN. SOCIAL: demographic & cultural drivers of the case. TECHNOLOGICAL: new crime typologies enabled by tech. ECONOMIC: market conditions creating pressure. ENVIRONMENTAL: climate / CAHRA / resource-conflict factors. POLITICAL: sanctions, enforcement tone, jurisdictional shifts. Rank by near-term impact.\n\n' },
    { id: 'lens_shift', label: 'Lens shift (multiple perspectives)', description: 'Re-read the case as regulator / firm / customer / victim.', prefix: 'SHIFT LENSES. Re-read the case through four lenses in order: (1) REGULATOR — what\'s the enforcement exposure? (2) FIRM — what\'s the commercial and reputational exposure? (3) CUSTOMER — what are their legitimate interests? (4) VICTIM / PREDICATE-OFFENCE TARGET — who is harmed if the activity is criminal? Summarise how the verdict looks from each lens.\n\n' },
    { id: 'stakeholder_map', label: 'Stakeholder map', description: 'Map every stakeholder, their interest, and their power.', prefix: 'MAP STAKEHOLDERS. List each: stakeholder · interest · power · trust level. Include the customer, UBOs, correspondents, regulators, supervisors, auditors, the firm\'s board, and the MLRO. Identify which stakeholders must be managed actively vs monitored.\n\n' },
    { id: 'scenario_planning', label: 'Scenario planning (3 futures)', description: 'Sketch three plausible 12-month futures and weight them.', prefix: 'RUN SCENARIO PLANNING. Sketch three plausible 12-month futures for this case: BEST CASE, BASE CASE, WORST CASE. For each: key drivers, probability weight, implication for the firm\'s control set. The BASE CASE\'s control plan must survive under the WORST CASE with only incremental adjustment.\n\n' },
    { id: 'war_game', label: 'War-game (red team / blue team)', description: 'Simulate a regulator challenge or adversarial bypass attempt.', prefix: 'WAR-GAME THE CASE. RED TEAM: simulate a regulator inspection or an adversarial evasion attempt. What would they attack / exploit first? BLUE TEAM: the firm\'s defensive posture. Score the top three attack vectors and the firm\'s readiness for each. Report the weakest blue-team leg.\n\n' },
    { id: 'minimum_viable_compliance', label: 'Minimum viable compliance', description: 'Smallest set of actions that meets every obligation.', prefix: 'DESIGN THE MINIMUM-VIABLE-COMPLIANCE ACTION SET. List every regulatory obligation the case triggers. For each, specify the SMALLEST action that still satisfies. Sum the actions. Resist scope creep — but refuse to shrink below any hard regulatory floor.\n\n' },
    { id: 'defence_in_depth', label: 'Defence-in-depth', description: 'Layer controls so no single failure is catastrophic.', prefix: 'DESIGN DEFENCE IN DEPTH. Specify at least three independent control layers that would each need to fail for the case\'s target risk to materialise. For each layer: what it catches, what it misses, what its failure mode is. The case\'s residual risk = probability of all layers failing simultaneously.\n\n' },
    { id: 'bayesian_network', label: 'Bayesian network (multi-variable)', description: 'Factor each driver conditionally; propagate beliefs.', prefix: 'BUILD A SIMPLIFIED BAYESIAN NETWORK. Identify 4-6 key binary drivers (PEP, cash-intensive, CAHRA origin, shell-UBO, adverse-media, sanctions-adjacent). Specify conditional dependencies. For each configuration that the case matches, state P(STR-warranted | configuration). Report the driver contributing the most evidence.\n\n' },
    { id: 'causal_inference', label: 'Causal inference (correlation vs cause)', description: 'Distinguish correlation from causation; avoid spurious inference.', prefix: 'APPLY CAUSAL-INFERENCE DISCIPLINE. For every observed correlation (e.g. "cash inflow correlates with suspicious counterparty"), ask: is this causal, confounded, reverse-causal, or selection-biased? Only causal links support strong regulatory inference. Label each.\n\n' },
    { id: 'counterexample_search', label: 'Counterexample search', description: 'Find a single counterexample that would break the verdict.', prefix: 'SEARCH FOR A DECISIVE COUNTEREXAMPLE. State the proposed verdict. Search exhaustively for a single counter-fact that would make the verdict wrong. If you find one, the verdict is not yet defensible. If you cannot, report the space you searched.\n\n' },
    { id: 'cross_case_triangulation', label: 'Cross-case triangulation', description: 'Find three prior cases that share the key feature; compare.', prefix: 'TRIANGULATE ACROSS CASES. Find three prior cases (inside the firm or in published enforcement actions) that share the key risk feature of the current case. Compare: how each was resolved, what evidence decided, what the outcome was. Use the pattern across three cases as your anchor, not the single current case.\n\n' },
    { id: 'adversarial_collaboration', label: 'Adversarial collaboration', description: 'Two opposing analysts agree on facts first, then disagree on inference.', prefix: 'SIMULATE ADVERSARIAL COLLABORATION. PHASE 1: both positions agree on the set of facts (list them). PHASE 2: each position interprets the same facts toward opposite verdicts, with its strongest case. PHASE 3: identify exactly which fact\'s interpretation is the crux — that is the decision point the MLRO must resolve.\n\n' },
    // ── 100 further reasoning modes added 2026-04-21 (wave 2):
    //    statistical / graph / epistemology / adversarial / behavioral
    //    analytics / compliance-niche / data-integrity / ethics. ──
    { id: 'bayes_theorem', label: 'Bayes\' theorem (explicit prior × likelihood)', description: 'State prior, compute likelihood ratio, derive posterior.', prefix: 'APPLY BAYES\' THEOREM EXPLICITLY. STATE the prior probability of the target hypothesis (base rate). STATE the likelihood ratio given the observed evidence. COMPUTE the posterior. Show the arithmetic. Flag whether the evidence moves the posterior materially or only marginally.\n\n' },
    { id: 'frequentist', label: 'Frequentist interpretation', description: 'Interpret probabilities as long-run frequencies over similar cases.', prefix: 'REASON FREQUENTIST-STYLE. For each probabilistic claim, anchor to the long-run frequency in the relevant reference population. Avoid subjective priors — anchor every probability to a countable historical rate (STR-per-1000-customers, freeze-per-year, etc.).\n\n' },
    { id: 'confidence_interval', label: 'Confidence-interval reporting', description: 'Never a point estimate — always a range with stated confidence.', prefix: 'REPORT EVERY ESTIMATE AS A CONFIDENCE INTERVAL. No point estimates. Each claim: (point, low-bound, high-bound, confidence level). State the basis for the width (sample size, evidence strength). Decisions hinge on the BOUNDS, not the point.\n\n' },
    { id: 'hypothesis_test', label: 'Null / alternative hypothesis test', description: 'Frame the case as H0 vs H1 and compute an implicit p-value.', prefix: 'FRAME AS HYPOTHESIS TEST. H0 (null): case is benign / innocent / typology-A. H1 (alternative): case is suspicious / typology-B. Compute the implicit p-value for the observed evidence under H0. State the decision threshold (e.g. p < 0.05 reject H0). Report decision and confidence.\n\n' },
    { id: 'chi_square', label: 'Chi-square pattern test', description: 'Test observed vs expected distribution of categorical signals.', prefix: 'APPLY CHI-SQUARE LOGIC. Construct the observed vs expected contingency table for the case\'s categorical signals (branch × amount-band, day × transaction-type, counterparty × value-range). Report deviations from expected that exceed what chance alone would explain.\n\n' },
    { id: 'regression', label: 'Regression-style driver decomposition', description: 'Decompose the outcome into independent drivers; report coefficients.', prefix: 'DECOMPOSE REGRESSION-STYLE. Treat the verdict as a dependent variable. Identify independent drivers (PEP, jurisdiction, cash-ratio, typology-match-score). Estimate each driver\'s "coefficient" (marginal contribution to verdict). Report the top-three-coefficient drivers with signs.\n\n' },
    { id: 'time_series', label: 'Time-series anomaly scan', description: 'Flag breaks in level, trend, or seasonality of the activity.', prefix: 'TREAT ACTIVITY AS A TIME SERIES. Describe the baseline level, trend, and seasonality. Flag any LEVEL BREAK (sudden jump), TREND BREAK (change in slope), or SEASONALITY BREAK (out-of-pattern week/month). Any break > 2-sigma of historical variance is a primary finding.\n\n' },
    { id: 'markov_chain', label: 'Markov-chain state transitions', description: 'Model the subject as moving through states with transition probabilities.', prefix: 'MODEL AS A MARKOV CHAIN. Define the states (dormant / retail / cash-intensive / wire-heavy / high-risk). Report the current state and the transition probabilities to adjacent states. A low-probability transition that did occur is a stronger signal than any single observation.\n\n' },
    { id: 'hmm', label: 'Hidden Markov Model', description: 'Observe surface behaviour; infer the hidden intent state.', prefix: 'USE A HIDDEN MARKOV MODEL. Surface behaviour is observed (deposits, wires, purchases). The HIDDEN state is the actor\'s intent (legitimate / structuring / layering / exit). Infer the most likely hidden-state sequence given the observations. Report the Viterbi-best path.\n\n' },
    { id: 'survival', label: 'Survival analysis (time-to-trigger)', description: 'How long until the next risk-event is expected?', prefix: 'APPLY SURVIVAL ANALYSIS. Treat the case as a subject with hazard rate for the next adverse-event (STR trigger / sanctions hit / audit finding). Estimate the time-to-event distribution. Report median time-to-trigger and any feature that elevates hazard materially.\n\n' },
    { id: 'entropy', label: 'Entropy / information content', description: 'Measure evidence informativeness; reject low-entropy "evidence".', prefix: 'MEASURE INFORMATION CONTENT. For each piece of evidence, ask: does it SHIFT the posterior? If the evidence is consistent with both hypotheses equally, it is low-entropy and should be given low weight regardless of volume. Reject volume as a proxy for informativeness.\n\n' },
    { id: 'kl_divergence', label: 'KL-divergence from baseline', description: 'How far has the customer\'s distribution drifted from its own baseline?', prefix: 'COMPUTE KL-DIVERGENCE FROM THE CUSTOMER\'S OWN HISTORICAL BASELINE. For the key observables (cash ratio, counterparty mix, ticket-size distribution, geographic mix), report how much the recent window diverges from the 12-month baseline. High divergence = material change of behaviour = regulatory signal.\n\n' },
    { id: 'mdl', label: 'Minimum description length', description: 'The best hypothesis is the one that most compactly explains the data.', prefix: 'APPLY MINIMUM DESCRIPTION LENGTH. For each candidate hypothesis, count how compactly it explains the full set of observed facts. A hypothesis that requires many exceptions / ad-hoc parameters is longer and less credible. Pick the most compact explanation that covers all material facts.\n\n' },
    { id: 'occam', label: 'Occam\'s razor', description: 'Prefer the simpler hypothesis when both fit the facts.', prefix: 'APPLY OCCAM\'S RAZOR. List all hypotheses that fit the facts. Rank by simplicity (fewest unverified assumptions, fewest coincidences). Pick the simplest. If a "suspicious" verdict requires multiple unlikely coincidences to line up, consider whether the innocent explanation is more parsimonious.\n\n' },
    { id: 'centrality', label: 'Network centrality', description: 'Identify hub nodes in the related-party network.', prefix: 'COMPUTE NETWORK CENTRALITY. Map the related-party network. Identify the NODES with highest degree (most connections) and highest betweenness (most "bridge" paths). Hub nodes are primary targets for DD; bridge nodes are primary targets for de-risking if exit is chosen.\n\n' },
    { id: 'community_detection', label: 'Community detection', description: 'Find clusters of tightly-linked parties; each cluster a suspect group.', prefix: 'DETECT COMMUNITIES. Partition the related-party network into tightly-connected clusters. Report each cluster\'s members, shared attributes (address, UBO, bank), and dominant typology signal. A cluster is a candidate "ring" and should be investigated jointly, not per-member.\n\n' },
    { id: 'motif_detection', label: 'Motif / subgraph pattern match', description: 'Match the network against known laundering subgraph patterns.', prefix: 'SEARCH FOR KNOWN LAUNDERING MOTIFS in the network: (a) star (1 central counterparty with many spokes), (b) chain (A→B→C→D linear flow), (c) ring (cyclic payments), (d) tree (hierarchical fan-out), (e) bipartite (senders all to one receiver set). Name the motif found and its risk implication.\n\n' },
    { id: 'shortest_path', label: 'Shortest path to risk', description: 'Find the shortest hop-chain from the subject to a known risk entity.', prefix: 'COMPUTE SHORTEST PATH. From the subject, find the shortest hop-chain through the related-party network to the nearest: (a) sanctioned entity, (b) PEP, (c) adverse-media target. Report the chain and the number of hops. ≤3 hops = actionable nexus; 4-6 hops = enhanced monitoring; >6 = monitor.\n\n' },
    { id: 'occam_vs_conspiracy', label: 'Occam vs conspiracy threshold', description: 'When does coincidence count begin to outweigh simple explanation?', prefix: 'APPLY THE OCCAM/CONSPIRACY THRESHOLD. Count the coincidences the innocent explanation requires. Compare to the single coordinated-hypothesis count. If the innocent path requires ≥3 independent unlikely coincidences, the coordinated hypothesis begins to outweigh Occam and warrants investigation.\n\n' },
    { id: 'burden_of_proof', label: 'Burden-of-proof allocation', description: 'Who must prove what, and to what standard?', prefix: 'ALLOCATE BURDEN OF PROOF. State: which party must prove which fact? Under which legal / regulatory standard (preponderance / clear-and-convincing / beyond-reasonable-doubt / MLRO "reasonable grounds to suspect" per FDL Art.26-27)? Is the burden met given current evidence? If no, specify what evidence would meet it.\n\n' },
    { id: 'presumption_innocence', label: 'Presumption of innocence guard', description: 'Do not skip the presumption until evidence crosses the bar.', prefix: 'GUARD THE PRESUMPTION OF INNOCENCE. The default for onboarded customers is legitimate activity. Before any adverse verdict, name the specific evidence that defeats the presumption. If the evidence cannot be named in one sentence, the presumption stands and the action is enhanced monitoring, not STR.\n\n' },
    { id: 'popper_falsification', label: 'Popperian falsification', description: 'State what evidence would falsify each hypothesis.', prefix: 'USE POPPERIAN FALSIFICATION. For each hypothesis in play, state the SPECIFIC evidence that would FALSIFY it. Then search for that falsifying evidence. A hypothesis that survives a genuine falsification attempt is more credible than one never tested.\n\n' },
    { id: 'triangulation', label: 'Evidence triangulation (3 independent sources)', description: 'Accept a claim only when three independent sources converge.', prefix: 'TRIANGULATE EVIDENCE. For each material claim, require at least THREE INDEPENDENT sources (documentary, analytical, observational). If only one or two sources confirm, mark the claim as PROVISIONAL. Single-source claims do not support adverse regulatory action.\n\n' },
    { id: 'saturation', label: 'Evidence-saturation check', description: 'Stop gathering when additional evidence no longer shifts the posterior.', prefix: 'CHECK FOR EVIDENCE SATURATION. Continue gathering evidence only while each new item meaningfully shifts the posterior. Once new evidence is repeating (low marginal info), declare saturation and commit to a verdict. Avoid analysis paralysis while respecting the "without delay" STR obligation.\n\n' },
    { id: 'stride', label: 'STRIDE threat model', description: 'Spoofing / Tampering / Repudiation / Info-Disclosure / DoS / EoP.', prefix: 'APPLY STRIDE TO THE CASE. SPOOFING (identity fraud), TAMPERING (evidence integrity), REPUDIATION (deniability), INFORMATION DISCLOSURE (tipping-off risk under FDL Art.29), DENIAL OF SERVICE (system evasion), ELEVATION OF PRIVILEGE (unauthorised access). Identify which STRIDE category is in play.\n\n' },
    // Wave 2 / batch 2 — adversarial + behavioral + compliance-niche.
    { id: 'pasta', label: 'PASTA threat modeling', description: 'Process for Attack Simulation and Threat Analysis — 7 stages.', prefix: 'APPLY PASTA (7 stages): (1) objectives, (2) technical scope, (3) decompose application/process, (4) threat analysis, (5) vulnerability mapping, (6) attack enumeration, (7) risk and impact. Walk each stage briefly against the compliance scenario.\n\n' },
    { id: 'attack_tree', label: 'Attack tree', description: 'Root goal decomposed into AND/OR subgoals; find the cheapest attack path.', prefix: 'BUILD AN ATTACK TREE. ROOT: the adversary\'s goal (bypass CDD / conceal UBO / evade sanctions / structure cash). DECOMPOSE into AND / OR subgoals. Evaluate cost / detectability / feasibility of each branch. The CHEAPEST path is the attack the firm must harden against first.\n\n' },
    { id: 'mitre_attack', label: 'MITRE ATT&CK analog (financial crime)', description: 'Map tactics (reconnaissance → exfiltration) to AML typology stages.', prefix: 'MAP AS A MITRE ATT&CK ANALOG. TACTICS: reconnaissance → initial placement → layering → integration → exfiltration. For each tactic present in the case, identify the TECHNIQUE used and the PROCEDURE (specific execution). Map to the firm\'s existing detection controls.\n\n' },
    { id: 'tabletop_exercise', label: 'Tabletop exercise (inject-driven)', description: 'Introduce injects; test team response step-by-step.', prefix: 'RUN AS TABLETOP EXERCISE. INJECT 1: the initial alert triggers. How does the team respond? INJECT 2: a complication (regulator RFI, adverse media, second typology). How does the response change? INJECT 3: escalation. Document decision points and gaps.\n\n' },
    { id: 'fair', label: 'FAIR quantitative risk', description: 'Loss Event Frequency × Loss Magnitude = annualised loss exposure.', prefix: 'APPLY FAIR (Factor Analysis of Information Risk). Estimate LOSS EVENT FREQUENCY (how often this materialises per year) × LOSS MAGNITUDE (average loss per event: regulatory penalty + remediation + reputational). Report annualised loss exposure and compare to the firm\'s risk appetite threshold.\n\n' },
    { id: 'octave', label: 'OCTAVE operational risk', description: 'Identify critical assets, threats, vulnerabilities, impact.', prefix: 'APPLY OCTAVE. CRITICAL ASSETS (customer data, STR filings, audit trail, MLRO decisions). THREATS to each. VULNERABILITIES enabling threats. IMPACTS if realised. Prioritise by criticality × threat × vulnerability.\n\n' },
    { id: 'velocity_analysis', label: 'Velocity analysis', description: 'Rate of change across transactions, parties, amounts.', prefix: 'ANALYSE VELOCITY. Compute rates-of-change: transactions/day vs baseline, new-counterparties/week, amount-per-transaction drift, cash-ratio drift. Flag any velocity exceeding 2-sigma of the customer\'s own 12-month baseline. Sudden velocity spikes are first-class signals regardless of absolute size.\n\n' },
    { id: 'spike_detection', label: 'Spike detection (CUSUM-style)', description: 'Cumulative-sum statistical process control; detect regime shift.', prefix: 'APPLY SPIKE / CUSUM DETECTION. Compute cumulative sum of deviations from baseline mean. A sudden upward inflection in the CUSUM signals regime change. Report the date of inflection and the triggering transactions.\n\n' },
    { id: 'seasonality', label: 'Seasonality-aware review', description: 'Separate seasonal baseline from anomalous signal.', prefix: 'ADJUST FOR SEASONALITY. Establish the customer\'s seasonal baseline (Ramadan, Eid, wedding season, gold-price cycle, quarterly tax windows). Evaluate the current activity AGAINST the season-adjusted expectation, not the annual mean. A deviation that looks anomalous in absolute terms may be explained by season.\n\n' },
    { id: 'regime_change', label: 'Regime-change detection', description: 'Identify structural break in behaviour / environment.', prefix: 'DETECT REGIME CHANGE. Look for a specific date after which the customer\'s behaviour or environment structurally shifted (ownership change, management change, jurisdiction change, licence change, macro shock). State the suspected change-point date and the differential behaviour pre/post.\n\n' },
    { id: 'sentiment_analysis', label: 'Sentiment / tone analysis of communications', description: 'Evaluate the tone of customer communications for stress signals.', prefix: 'ANALYSE SENTIMENT OF COMMUNICATIONS. Review the customer\'s emails / chat / call notes for tone signals: urgency, evasiveness, aggression, over-explanation, inconsistent follow-through, emotional escalation when queried. Sudden tone-shift correlated with compliance queries is a flag.\n\n' },
    { id: 'entity_resolution', label: 'Entity resolution (disambiguation)', description: 'Determine whether two records refer to the same person / entity.', prefix: 'PERFORM ENTITY RESOLUTION. Given name variants, transliterations, date-of-birth approximations, ID numbers with partial matches, addresses with slight variations — determine whether the records refer to the same or different subjects. Report confidence and the basis.\n\n' },
    { id: 'narrative_coherence', label: 'Narrative-coherence check', description: 'Stress-test the customer\'s explanatory narrative for internal consistency.', prefix: 'STRESS-TEST NARRATIVE COHERENCE. The customer\'s self-explanation has multiple parts: occupation, SoW, purpose, counterparties, volumes. Check each pair for internal consistency. Flag any pair where the story does not hang together without an ad-hoc explanation.\n\n' },
    { id: 'linguistic_forensics', label: 'Linguistic forensics', description: 'Analyse written statements for deception markers, inconsistencies.', prefix: 'APPLY LINGUISTIC-FORENSICS DISCIPLINE. In customer statements (onboarding forms, RFI replies, STR-denial letters), look for: reduced self-reference, hedging escalation, tense shifts, overly precise dates with imprecise substance, over-specificity in one area to cover vagueness in another. Name the markers present.\n\n' },
    { id: 'pattern_of_life', label: 'Pattern-of-life analysis', description: 'Build a baseline of "normal" then flag deviations.', prefix: 'BUILD THE CUSTOMER\'S PATTERN OF LIFE. Describe a typical week: which branches, which counterparties, which amount bands, which times of day, which devices/channels. Then flag every deviation from the pattern in the current window. Deviations are candidate evidence.\n\n' },
    { id: 'peer_group_anomaly', label: 'Peer-group anomaly', description: 'Compare the customer to their segment peers; flag outliers.', prefix: 'COMPARE TO PEER GROUP. Define the customer\'s peer group (same sector, same size, same jurisdiction, same product set). Compute where the customer sits in the peer distribution on key metrics. Flag any metric where the customer is >2-sigma outlier relative to peers.\n\n' },
    { id: 'insider_threat', label: 'Insider-threat overlay', description: 'Could an internal actor be facilitating this?', prefix: 'CONSIDER INSIDER THREAT. Could an employee of the firm be facilitating the observed pattern (knowingly or unknowingly)? Review: who owns the customer relationship, who approved onboarding, who overrode alerts, who processed the transactions. If a single internal actor appears across these touchpoints, flag.\n\n' },
    { id: 'collusion_pattern', label: 'Collusion pattern detection', description: 'Are two or more parties coordinating in a non-arm\'s-length way?', prefix: 'DETECT COLLUSION PATTERNS. Signs: transactions timed within minutes, rounded amounts that match other rounded amounts, shared counsel / address / bank-branch, language re-use in documentation, mutually advantageous pricing vs market. Name the specific collusion indicator.\n\n' },
    { id: 'self_dealing', label: 'Self-dealing / conflict review', description: 'Is the transaction at arm\'s length, or is there a concealed conflict?', prefix: 'REVIEW FOR SELF-DEALING. Identify any undisclosed relationship between the parties to a transaction: common ownership, common directors, shared family, shared counsel. If arm\'s-length pricing cannot be evidenced, flag as related-party and apply the elevated disclosure standard.\n\n' },
    { id: 'front_running', label: 'Front-running detection', description: 'Pre-trade activity exploits knowledge of pending trade flow.', prefix: 'TEST FOR FRONT-RUNNING. Pre-trade: is there activity that positions to benefit from the pending trade flow of other clients / the firm? Include related-party trades, option positioning, cash pre-positioning. Front-running is market abuse even where the predicate is not a traditional AML offence.\n\n' },
    { id: 'wash_trade', label: 'Wash-trade / circular-trade scan', description: 'Same-beneficial-owner on both sides of a trade = wash.', prefix: 'SCAN FOR WASH / CIRCULAR TRADES. Identify pairs of trades where beneficial ownership is the same on both sides (direct or through related parties). Cyclic flow A→B→C→A with matched or near-matched volumes is a circular-trade signal. Report as market-abuse and AML typology.\n\n' },
    { id: 'spoofing', label: 'Spoofing / layering (market abuse)', description: 'Detect bid/ask-layer manipulation patterns.', prefix: 'DETECT SPOOFING / LAYERING (market abuse). Bid/ask layers placed and cancelled before execution, asymmetric order-to-trade ratios, co-located order patterns. Distinct from AML "layering" — name the market-abuse layering and the evidential pattern.\n\n' },
    { id: 'ghost_employees', label: 'Ghost-employee detection', description: 'Payroll / vendor entries without real beneficiaries.', prefix: 'DETECT GHOST EMPLOYEES / VENDORS. Check: consistent payments to a payroll or vendor entry that lacks independent existence indicators (no address, no tax filings, no phone, single signatory matching the approver, duplicate IBAN). Flag entries whose beneficiary evidence is entirely self-attested.\n\n' },
    { id: 'lapping', label: 'Lapping / teeming-and-lading', description: 'Cover a shortfall on account A with receipts intended for B.', prefix: 'DETECT LAPPING. Pattern: a shortfall on customer-account A is hidden by applying an incoming receipt intended for customer-account B, then B\'s shortfall hidden with C\'s incoming, rolling forward. Detect via out-of-order or delayed application of receipts that do not reconcile one-to-one.\n\n' },
    { id: 'ethical_matrix', label: 'Ethics — utilitarian vs deontological vs virtue', description: 'Evaluate the decision under three ethics frames; look for convergence.', prefix: 'EVALUATE ETHICS IN THREE FRAMES. UTILITARIAN: which choice maximises aggregate welfare of stakeholders? DEONTOLOGICAL: which choice respects the duty / rule / right at stake? VIRTUE: what would a person of good character do here? Report convergence / divergence across the three; a divergence is the hard case requiring escalation.\n\n' },
    // Wave 2 / batch 3 — data integrity + compliance operations.
    { id: 'provenance_trace', label: 'Data provenance trace', description: 'Trace every asserted fact back to its ultimate source.', prefix: 'TRACE PROVENANCE OF EACH MATERIAL FACT. For every claim in the case, identify: (a) primary source (original document), (b) any transformations (extraction, translation, aggregation), (c) chain-of-custody. Facts with broken provenance cannot support regulatory action.\n\n' },
    { id: 'lineage', label: 'Data lineage audit', description: 'Where did the data enter the firm? Who touched it? Where is it stored?', prefix: 'AUDIT DATA LINEAGE. For each critical datum in the case, state: entry point (channel, date, operator), intermediate systems (KYC, screening, monitoring), current storage (Netlify Blob key, retention class), downstream consumers. Any gap in lineage is an Art.24 retention finding.\n\n' },
    { id: 'tamper_detection', label: 'Tamper / integrity detection', description: 'Check for inconsistent metadata, edits, or signature breaks.', prefix: 'CHECK FOR TAMPERING. Metadata inconsistencies (modification timestamps post-dating storage), signature breaks on attested documents, version mismatches between filed vs original. Name any integrity concern. A tampered document cannot support a compliance verdict.\n\n' },
    { id: 'source_credibility', label: 'Source credibility tiering', description: 'Tier-1 regulator / Tier-2 press / Tier-3 blog / Tier-4 anonymous.', prefix: 'TIER EACH SOURCE. Tier 1: regulator, court, sanctions designation, primary government document. Tier 2: major news outlet with editorial process. Tier 3: niche/industry blog, secondary aggregator. Tier 4: anonymous, unverified. Do not treat tier-3/4 as actionable without tier-1/2 corroboration.\n\n' },
    { id: 'completeness_audit', label: 'Evidence-completeness audit', description: 'What required evidence is missing?', prefix: 'AUDIT EVIDENCE COMPLETENESS against the applicable regulatory checklist. Enumerate every required item (ID, proof-of-address, UBO declaration, SoW corroboration, screening results, board-approval record, etc.) and mark present / absent / stale. A FAIL on completeness is the first finding.\n\n' },
    { id: 'freshness_check', label: 'Data-freshness check', description: 'How current is the evidence relative to the risk?', prefix: 'CHECK EVIDENCE FRESHNESS. For each datum, state its as-of date. Compare to the risk horizon (high-risk customers: evidence < 3 months; standard: < 12 months). Stale evidence for a high-risk customer is itself a control failure even if the evidence was correct when gathered.\n\n' },
    { id: 'reconciliation', label: 'Reconciliation across sources', description: 'Do independent sources agree on the key facts?', prefix: 'RECONCILE ACROSS INDEPENDENT SOURCES. For each key fact, compare what the customer declared, what the firm\'s systems recorded, what external data (registry, sanctions list, adverse media) shows. Material discrepancies are primary findings, not clerical errors.\n\n' },
    { id: 'discrepancy_log', label: 'Discrepancy-log enforcement', description: 'Every unresolved discrepancy is logged until resolved or escalated.', prefix: 'ENFORCE DISCREPANCY LOG DISCIPLINE. Every unresolved inconsistency goes into the case discrepancy log with: date raised, nature, owner, due date, resolution. Discrepancies past due are escalated. An unresolved discrepancy for >30 days on a medium-risk case is a control failure.\n\n' },
    { id: 'data_quality_score', label: 'Data-quality composite score', description: 'Completeness × accuracy × freshness × consistency = confidence multiplier.', prefix: 'COMPUTE A DATA-QUALITY SCORE. Scale 0-1 on: COMPLETENESS (required fields present), ACCURACY (evidenced), FRESHNESS (age vs horizon), CONSISTENCY (cross-source agreement). Product = confidence multiplier. Do not commit to a verdict if the data-quality score is below 0.6.\n\n' },
    { id: 'conflict_interest', label: 'Conflict-of-interest matrix', description: 'Map the analyst\'s / firm\'s / decision-maker\'s conflicts.', prefix: 'BUILD A CONFLICT-OF-INTEREST MATRIX. For the decision about this case, who could benefit / suffer by each possible verdict? Map: customer relationship owner, approver, MLRO, internal audit, external counsel. Any conflict should be declared and the decision re-assigned or dual-staffed.\n\n' },
    { id: 'four_eyes_stress', label: 'Four-eyes gate stress test', description: 'Would an independent second reviewer reach the same verdict?', prefix: 'STRESS-TEST AGAINST FOUR EYES. Assume an independent second reviewer will read this reasoning with zero context. Does the written record alone carry them to the same verdict without needing to ask questions? If not, identify the gaps in the write-up. Four-eyes failures are process failures.\n\n' },
    { id: 'escalation_trigger', label: 'Escalation-trigger identification', description: 'Does this case cross any of the six MLRO escalation triggers?', prefix: 'CHECK THE SIX MLRO ESCALATION TRIGGERS. (1) Sanctions match confidence ≥ 0.5. (2) Threshold edge (AED 55K / 60K / 25%). (3) STR/SAR/CTR/DPMSR/CNMR drafting. (4) Verdicts of freeze/escalate. (5) CDD tier change (SDD↔CDD↔EDD). (6) Any action visible to subject (Art.29 tipping-off risk). State which fire.\n\n' },
    { id: 'sla_check', label: 'Regulatory SLA check', description: 'Is the response within the 24h / 5-day / 15-day / 30-day clocks?', prefix: 'CHECK EVERY APPLICABLE REGULATORY SLA. 24h freeze (Cabinet Res 74/2020), 5 business days CNMR, 15 working days UBO re-verification (Cabinet Decision 109/2023), 30 days policy update, 10 years retention (FDL Art.24), "without delay" STR (FDL Art.26-27). Report compliance / breach on each.\n\n' },
    { id: 'audit_trail_reconstruction', label: 'Audit-trail reconstruction', description: 'Can the case be reconstructed end-to-end from the trail alone?', prefix: 'RECONSTRUCT THE AUDIT TRAIL. Attempt to rebuild the full decision story using only the artefacts currently in the case file — no personal memory, no live questioning. If reconstruction fails at any step, that step has an audit-trail gap to close.\n\n' },
    { id: 'control_effectiveness', label: 'Control-effectiveness rating', description: 'Design-effectiveness + operating-effectiveness × test evidence.', prefix: 'RATE CONTROL EFFECTIVENESS. For each control touching this case, rate: DESIGN effectiveness (would it work if operated correctly?), OPERATING effectiveness (does it work as designed?), TESTING (when last tested, sample size). A design-effective control with weak operating evidence is still a gap.\n\n' },
    { id: 'residual_vs_inherent', label: 'Residual vs inherent risk', description: 'Separate raw-risk from control-adjusted risk in the write-up.', prefix: 'SEPARATE INHERENT FROM RESIDUAL RISK. INHERENT: risk if no controls applied. RESIDUAL: risk after controls. Report both. A low residual hiding a high inherent with weak controls is a fragility — one control failure reverts to the inherent level.\n\n' },
    { id: 'risk_appetite_check', label: 'Risk-appetite boundary check', description: 'Does the case push against the firm\'s documented risk appetite?', prefix: 'CHECK AGAINST RISK APPETITE. The firm has a documented risk appetite statement (Cabinet Res 134/2025 Art.5). Is this case inside, at, or outside that boundary? Outside-appetite cases require either (a) targeted exit, (b) risk-appetite revision by the board, (c) documented one-off exception with rationale.\n\n' },
    { id: 'kri_alignment', label: 'KRI alignment', description: 'Does the case breach any of the firm\'s KRIs?', prefix: 'CHECK KRI ALIGNMENT. Evaluate the case against the firm\'s Key Risk Indicators (cash-ratio, high-risk-jurisdiction-exposure, STR-rate, aging-alert-backlog, stale-CDD-count, etc.). Which KRIs are breached? Each breach triggers a specific remediation path per the firm\'s framework.\n\n' },
    { id: 'regulatory_mapping', label: 'Article-to-control mapping', description: 'Each regulatory duty is mapped to a specific firm control.', prefix: 'MAP EVERY APPLICABLE REGULATORY ARTICLE TO A SPECIFIC FIRM CONTROL. For each in scope (FDL Art.12, 14, 20-21, 24, 26-27, 29, 35, Cabinet Res articles, Cabinet Decisions), name the control that discharges the duty. If any duty has no mapped control, that is a structural gap.\n\n' },
    { id: 'exception_log', label: 'Exception-log discipline', description: 'Exceptions must be named, approved, time-bound, and reviewed.', prefix: 'APPLY EXCEPTION-LOG DISCIPLINE. Any action that deviates from standard policy is an exception. An exception is valid only with: (a) written rationale, (b) approval by the policy owner, (c) time limit, (d) review date. Unnamed exceptions are policy drift, not exceptions.\n\n' },
    { id: 'training_inadequacy', label: 'Training-inadequacy hypothesis', description: 'Could inadequate training explain the observed gap?', prefix: 'CONSIDER TRAINING INADEQUACY. Before concluding the case is adversarial, ask: is the observed gap explainable by inadequate training of the relevant staff? Map the action to who should have done what, their training record, and their role-specific content coverage. Training gaps and adversary action have different remediation paths.\n\n' },
    { id: 'staff_workload', label: 'Staff-workload / attention-dilution', description: 'Workload pressure produces the same failure modes as bad actors.', prefix: 'CONSIDER WORKLOAD DILUTION. High-workload analysts produce the same kind of misses as an adversary intent on bypass. Compare alert-volume / staff / hours to peer benchmarks. If workload is >1.5x peer median, workload must be ruled in as a candidate cause before adversary is accepted.\n\n' },
    { id: 'documentation_quality', label: 'Documentation-quality review', description: 'Is the write-up defensible to an auditor who was never in the room?', prefix: 'JUDGE DOCUMENTATION QUALITY. An auditor with no prior context reads only the case file. Can they reconstruct: the question, the evidence, the reasoning, the decision, the sign-off, the next review date? If any is missing, the documentation is insufficient even if the decision was correct.\n\n' },
    { id: 'policy_drift', label: 'Policy-drift detection', description: 'Current practice no longer matches written policy — which moved?', prefix: 'DETECT POLICY DRIFT. Compare current operating practice against the written policy in force. If they differ, identify which drifted: policy stale vs practice, practice loosened vs policy. Either way it is a finding; the remediation path differs (update policy vs retrain staff).\n\n' },
    { id: 'verdict_replay', label: 'Verdict replay (counter-test)', description: 'Re-apply the decision to the same case with swapped neutral facts.', prefix: 'RUN A VERDICT-REPLAY TEST. Change one neutral fact (customer nationality, transaction time-of-day, occupation label) to its counterpart. Does your verdict still hold? If it flips, you are reasoning from a proxy, not from the core signal. Revise or defend the reliance.\n\n' },
    // Wave 2 / batch 4 — crypto + trade finance + specialist frames.
    { id: 'chain_analysis', label: 'On-chain forensics', description: 'Wallet clustering, hop analysis, exposure scoring.', prefix: 'APPLY ON-CHAIN FORENSICS. Cluster wallets via common-spend heuristic + attribution data. Trace hops to the subject\'s wallet from each cluster. Score exposure to sanctioned / mixer / darknet / ransomware clusters. Report the HIGHEST-risk touch and its hop count.\n\n' },
    { id: 'taint_propagation', label: 'Taint propagation model', description: 'FIFO / LIFO / poison / haircut taint accounting.', prefix: 'APPLY A TAINT-PROPAGATION MODEL. Pick a method: FIFO (first-in-first-out), LIFO (last-in-first-out), POISON (any touch contaminates wholly), HAIRCUT (proportional). Trace how much "tainted" value reached the subject under that model. Report the model-dependent exposure range.\n\n' },
    { id: 'privacy_coin_reasoning', label: 'Privacy-coin obfuscation scoring', description: 'What attribution evidence survives a Monero / Zcash leg?', prefix: 'EVALUATE PRIVACY-COIN OBFUSCATION. For each XMR / ZEC-shielded / Dash-PrivateSend leg: (a) what is left to attribute? (b) is there off-chain evidence that re-anchors the subject (exchange-side KYC, timing correlation, amount matching)? Report residual attribution confidence.\n\n' },
    { id: 'bridge_risk', label: 'Cross-chain bridge risk', description: 'Bridge hop turns one wallet cluster into many; evaluate the jump.', prefix: 'EVALUATE BRIDGE RISK. A cross-chain bridge breaks direct-chain traceability. For each bridge hop in the case: (a) is bridge-event data correlatable (tx hash, timing, amount, metadata)? (b) what is the bridge operator\'s own attribution posture? (c) does the post-bridge cluster contain prior flags?\n\n' },
    { id: 'mev_scan', label: 'MEV / sandwich scan', description: 'Is the customer acting as a searcher or a victim of MEV?', prefix: 'SCAN FOR MEV ACTIVITY. Is the customer\'s wallet set active as a SEARCHER (front-running, sandwich attacks, arbitrage) or as a VICTIM (consistent slippage, sandwiched trades)? Report the pattern and its tax / AML implications.\n\n' },
    { id: 'stablecoin_reserve', label: 'Stablecoin reserve-risk analysis', description: 'What is the issuer\'s reserve transparency and black-listing capability?', prefix: 'ANALYSE STABLECOIN RESERVE RISK. Issuer\'s attestation cadence, auditor independence, reserve composition, freeze/blacklist capability, historical incident record. A stablecoin issuer without monthly attestations + blacklist capability carries materially elevated residual risk regardless of chain.\n\n' },
    { id: 'nft_wash', label: 'NFT wash-trading scan', description: 'Same-owner-on-both-sides NFT trades = wash.', prefix: 'SCAN FOR NFT WASH-TRADING. Map each trade to the beneficial owner on both sides. A match = wash. Also flag rapid buy-sell roundtrips, uniform floor pricing, self-referential marketplace listings. Score the case as laundering / valuation-inflation / tax.\n\n' },
    { id: 'defi_smart_contract', label: 'DeFi smart-contract risk', description: 'Which contracts did funds touch? What were their risk flags?', prefix: 'EVALUATE DEFI SMART-CONTRACT RISK. For each contract the funds touched: address, audit status, exploit history, governance control, admin-key risk, front-end / back-end divergence. A fund-touching contract with exploit history carries compliance risk even if the touch itself is routine.\n\n' },
    { id: 'ucp600_discipline', label: 'UCP 600 LC discipline', description: 'Letter-of-credit documentary compliance per UCP 600.', prefix: 'APPLY UCP 600 DISCIPLINE to the LC case. Verify documentary compliance: presented vs required docs, strict-compliance standard, bank\'s-own-obligation, discrepancy handling, time windows. Non-compliance does not itself imply AML concern, but any ad-hoc waiver is a control signal.\n\n' },
    { id: 'tbml_overlay', label: 'TBML overlay on ordinary trade', description: 'Layer TBML indicators onto a routine trade; isolate the abnormal.', prefix: 'OVERLAY TBML INDICATORS ON A ROUTINE TRADE. Isolate what is normal for this sector / route / counterparty vs what deviates. Deviations to score: invoice-vs-market spread, repeat amendments, unusual LC amendment requests, non-standard settlement channels, freight-forwarder opacity.\n\n' },
    { id: 'insurance_wrap', label: 'Insurance-wrap / life-bond review', description: 'Life-insurance products used as investment wrappers — AML overlay.', prefix: 'REVIEW INSURANCE-WRAP / LIFE-BOND RISK. Life-insurance products used as investment vehicles concentrate AML risk at (a) premium origination, (b) in-policy switching, (c) surrender / partial withdrawal, (d) assignment. Evaluate each stage.\n\n' },
    { id: 'real_estate_cash', label: 'Real-estate cash-purchase review', description: 'Cash purchase of property — FATF high-risk typology.', prefix: 'APPLY FATF REAL-ESTATE CASH-PURCHASE TYPOLOGY. Red flags: rapid resale, all-cash, purchase-via-SPV, back-to-back transfer within a family group, property above declared SoW, agent with same client pattern. Score typology match.\n\n' },
    { id: 'art_dealer', label: 'Art / high-value-goods dealer review', description: 'Dealer-side AML review of high-value art sales.', prefix: 'APPLY ART / HIGH-VALUE-GOODS AML DISCIPLINE. Red flags: anonymous intermediaries, freeport storage, provenance gaps, rapid resale, price vs market distortion, cash / crypto settlement. Cite EU 5AMLD art-dealer obligations and equivalent UAE treatment.\n\n' },
    { id: 'yacht_jet', label: 'Yacht / private-jet flag-state review', description: 'Flag-of-convenience and beneficial-ownership concealment.', prefix: 'REVIEW YACHT / PRIVATE-JET FLAG AND BO. Flag-of-convenience vessels and N-reg / M-reg aircraft often mask beneficial ownership via single-purpose SPVs. Trace: flag state, registration, true operator, charter flows. Sanctioned-person linkage is common in this segment.\n\n' },
    { id: 'family_office_signal', label: 'Family-office / concentrated-wealth review', description: 'Single-family office risk: concentration, governance, PEP overlap.', prefix: 'REVIEW FAMILY-OFFICE RISK. Single-family offices often combine: concentrated wealth, minimal external oversight, multi-generational PEP overlap, cross-jurisdictional holdings, private-trust-company layers, philanthropy conduit. Each elevates risk even where each is lawful.\n\n' },
    { id: 'market_manipulation', label: 'Market manipulation detection', description: 'Classic manipulation typologies: ramp, cornering, painting-the-tape.', prefix: 'DETECT MARKET MANIPULATION TYPOLOGIES: (a) ramp (coordinated buying to inflate), (b) cornering (dominant position to distort), (c) painting-the-tape (synthetic volume to mislead), (d) pump-and-dump, (e) bear raid. Name the typology, its evidential signature, and regulatory basis.\n\n' },
    { id: 'advance_fee', label: 'Advance-fee / 419 fraud pattern', description: 'Fee-in-advance scam patterns reaching the firm.', prefix: 'DETECT ADVANCE-FEE / 419 SCAM TOUCH. Signs: small-amount inbound "fee" payments from multiple unrelated parties to a single UAE account, outbound to a single foreign beneficiary, narrative of large promised return. The firm typically sits on the receiving leg; apply appropriate STR/freeze posture.\n\n' },
    { id: 'app_scam', label: 'APP (authorised push-payment) scam', description: 'Customer authorised the payment but under deception.', prefix: 'SCREEN FOR APP (AUTHORISED PUSH-PAYMENT) SCAM. The payer authorised the transfer voluntarily, but under deception (romance scam, investment scam, impersonation, invoice redirection). Look for victim-side hallmarks: prior absence of similar-beneficiary relationship, emotional duress signal, atypical amount, irreversible channel.\n\n' },
    { id: 'bec_fraud', label: 'Business email compromise pattern', description: 'Invoice / payment-detail redirect via compromised email.', prefix: 'SCREEN FOR BEC / INVOICE-REDIRECT PATTERN. Features: change-of-bank-details request received shortly before payment, subtle email-domain spoof, urgency language, familiar counterparty but new beneficiary account. Typically presents to the firm as a routine vendor payment.\n\n' },
    { id: 'synthetic_id', label: 'Synthetic-identity detection', description: 'Fabricated identity built from mixed real + synthetic attributes.', prefix: 'DETECT SYNTHETIC IDENTITIES. Flags: recently-built credit or bureau footprint, name-SSN/passport mismatch patterns, address-history discontinuity, phone-number velocity, SIM-swap indicator. Synthetic IDs are often onboarded successfully then used for higher-risk typologies.\n\n' },
    { id: 'ponzi_scheme', label: 'Ponzi / pyramid pattern review', description: 'New-investor inflows fund old-investor returns.', prefix: 'SCREEN FOR PONZI / PYRAMID PATTERNS. Core feature: new inflows fund prior-investor "returns." Downstream signs: recruiter-commission structures, tiered sign-up incentives, guaranteed-return narrative, rapid asset growth without commensurate underlying economic activity, redemption suppression when growth slows.\n\n' },
    { id: 'invoice_fraud', label: 'Invoice-fraud pattern review', description: 'Duplicate / inflated / fictitious vendor invoicing.', prefix: 'REVIEW INVOICE-FRAUD PATTERNS. Duplicate invoice numbers with mismatched supporting docs, inflated pricing vs market, fictitious vendor (no verifiable existence), round-trip vendor (same beneficial owner as payer), sequence-jumping invoice numbers. Apply to both customer and internal audit contexts.\n\n' },
    { id: 'phoenix_company', label: 'Phoenix-company pattern', description: 'New company rising from an insolvent predecessor\'s ashes.', prefix: 'DETECT PHOENIX-COMPANY PATTERN. Same directors / beneficial owners operate a new entity immediately after the previous one fails, leaving creditors unpaid. Customers presenting new legal entities with familiar personnel and "same business, different wrapper" justification warrant lookback.\n\n' },
    { id: 'sanctions_maritime_stss', label: 'Ship-to-ship transfer review', description: 'Sanctions evasion via STS transfers — OFAC / OFSI guidance.', prefix: 'REVIEW SHIP-TO-SHIP TRANSFER RISK per OFAC / OFSI maritime guidance. Flag: AIS-off during STS, reflag shortly before STS, multiple name changes, STS in disputed waters, unexplained transit divergence. Apply to any shipment transiting maritime legs.\n\n' },
    { id: 'kyb_strict', label: 'Strict Know-Your-Business walkthrough', description: 'Entity existence, activity, supply-chain, management integrity.', prefix: 'WALK KYB STRICTLY. (1) ENTITY EXISTENCE: incorporation docs + registry match. (2) ACTIVITY: evidence of real commercial operations (invoices, staff, premises, digital footprint). (3) SUPPLY-CHAIN: evidenced suppliers and customers. (4) MANAGEMENT: fit-and-proper on directors + UBO. Name any gap.\n\n' }
  ];

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
    },
    // ── 15 additional templates added 2026-04-21 covering LBMA, PF,
    //    VASP/crypto, TBML, NPO, governance, training, and more. ──
    {
      id: 'lbma_rgg',
      label: 'LBMA RGG v9 — responsible gold review',
      question: 'Assess the case below against the LBMA Responsible Gold Guidance v9 five-step framework (policy → risk assessment → CAHRA due diligence → audit → reporting). Identify which step raises concern, cite the relevant OECD DDG annex, and score residual risk (low/medium/high).'
    },
    {
      id: 'cross_border_60k',
      label: 'Cross-border cash AED 60K declaration',
      question: 'Does the movement below breach the Cabinet Res 134/2025 Art.16 AED 60,000 cross-border cash / BNI declaration threshold? If yes, list the declaration filing obligations, the border-point reporting path, the goAML CNMR requirement, and the 10-year retention implication (FDL Art.24).'
    },
    {
      id: 'correspondent_risk',
      label: 'Correspondent banking risk',
      question: 'Assess the correspondent-banking relationship below against Wolfsberg Correspondent Banking Principles and CBUAE Correspondent Banking Standard. Focus on shell-bank exposure, Know-Your-Correspondent-Customer depth, nested-account risk, and jurisdiction risk. Recommend relationship disposition (maintain / enhanced monitoring / exit).'
    },
    {
      id: 'vasp_crypto',
      label: 'VASP / crypto flow review',
      question: 'Review the virtual-asset flow below against FATF Rec 15 and VARA Rulebook. Identify any mixer / tumbler / privacy-coin use, sanctioned-wallet exposure (OFAC SDN list), and Travel-Rule data completeness. Flag any structural evasion typology.'
    },
    {
      id: 'tbml_pattern',
      label: 'Trade-based ML pattern review',
      question: 'Assess the trade transactions below against FATF TBML typologies (over-invoicing, under-invoicing, multiple invoicing, phantom shipments, mis-described goods, fictitious trade). Cite at least three FATF TBML red flags present, and score money-laundering probability (low / medium / high).'
    },
    {
      id: 'shell_company',
      label: 'Shell company indicators',
      question: 'Analyse the entity below for shell-company indicators: residency-only address, no employees, nominee directors / UBO, opaque ownership chain, secrecy-jurisdiction formation, dormant commercial activity, cross-linked to other shell entities. Cite FATF Guidance on Transparency and Beneficial Ownership and score (not-a-shell / possibly / likely / confirmed).'
    },
    {
      id: 'npo_risk',
      label: 'NPO / charity sector risk',
      question: 'Assess the NPO / charity below per FATF Rec 8, UAE Cabinet Res 156/2025 (CPF), and MoE supervision of charitable entities. Identify TF-misuse indicators (unusual beneficiaries, conflict-zone operations, opaque funding, politically-exposed trustees). Recommend supervisory action.'
    },
    {
      id: 'multi_regime_sanctions',
      label: 'Complex multi-regime sanctions review',
      question: 'The case below implicates multiple sanctions regimes simultaneously (possibly UN + OFAC + EU + UK + UAE). Map each regime\'s applicability, identify the strictest restriction, resolve conflicts-of-law, and cite the governing regulatory basis for the freeze / non-freeze decision.'
    },
    {
      id: 'ai_governance',
      label: 'AI governance self-audit',
      question: 'Audit the AI-assisted decision below against EU AI Act Art.14 (human oversight), NIST AI RMF (govern / map / measure / manage), ISO/IEC 42001 AI management-system clauses, and UAE AI Ethics Principles. Flag any black-box reasoning without human-in-the-loop, any auto-action without four-eyes, any training-data bias risk, and any explainability gap.'
    },
    {
      id: 'adverse_media_triage',
      label: 'Adverse-media hit triage',
      question: 'Triage the adverse-media hit(s) below. For each hit: (1) classify category (criminal / corruption / sanctions-linked / regulatory / reputational), (2) assess source credibility (tier-1 regulator / tier-2 major press / tier-3 blog / tier-4 anonymous), (3) confirm subject identity match (strong / weak / false-positive), (4) recommend action (no-action / enhanced monitoring / EDD uplift / file STR).'
    },
    {
      id: 'grievance_whistleblower',
      label: 'Grievance / whistleblower triage',
      question: 'Triage the report below per Fed Decree-Law 32/2021 (whistleblower protection) and FDL Art.29 (tipping-off / confidentiality). Classify as: operational incident / HR grievance / customer complaint / anonymous whistleblower / named whistleblower. Recommend the investigation path, confidentiality controls, and whether regulator notification is required.'
    },
    {
      id: 'mlro_appointment',
      label: 'MLRO / Deputy appointment compliance',
      question: 'Verify the appointment below against Cabinet Res 134/2025 Art.11 (MLRO qualifications), Cabinet Res 134/2025 Art.18 (CO change notification — 14 calendar days), and FDL Art.20-21 (CO duty of care). Check: qualifications / independence / authority / resource adequacy / board attestation / regulator notification lodged.'
    },
    {
      id: 'training_compliance',
      label: 'Annual training compliance check',
      question: 'Review the staff training record below against Cabinet Res 134/2025 Art.11 (annual AML/CFT/CPF training) and FATF Rec 18 (internal policies and training). For each staff member: check training completion, role-specific content coverage, refresher cadence, attestation evidence. Flag anyone overdue or missing.'
    },
    {
      id: 'four_eyes_rationale',
      label: 'Four-eyes approval reasoning',
      question: 'You are the SECOND approver on the decision below. The first approver has signed off. Review their reasoning independently — do NOT defer to their verdict. Challenge the key assumptions, stress-test the regulatory citation, and either confirm the approval with your own rationale or escalate with a specific objection.'
    },
    {
      id: 'pf_dual_use',
      label: 'Proliferation financing / dual-use goods',
      question: 'Screen the transaction below under Cabinet Res 156/2025 (PF + dual-use controls) and UNSCR 1540. Identify any strategic-goods export, any dual-use controlled item, any WMD-nexus end-user, any catch-all concern, and any sanctioned proliferation actor. Recommend licensing / blocking / reporting action.'
    },
    // ── 25 additional MLRO question templates added 2026-04-21
    //    (second expansion) covering structuring, TBML subtypes,
    //    placement/layering/integration, PEP-RCA, high-risk
    //    jurisdictions, trust structures, VASP on/off-ramp, FATF
    //    greylist onboarding, bearer shares, nominee directors,
    //    free-zone red flags, art/HVG, gold doré, refresher
    //    cadence, STR vs CTR vs CNMR selection, turnover anomaly
    //    detection, TF red flags, smurfing, round-tripping, crypto
    //    mixer / privacy-coin, sectoral vs SDN sanctions, nominee
    //    pool, multi-jurisdictional UBO, EDD uplift triggers,
    //    effective-control UBO, and adverse-media source tiering.
    //    Designed to pair with the expanded reasoning modes above:
    //    many of them benefit from Bayesian / counterfactual /
    //    reflective / chain-of-verification frames. ──
    {
      id: 'structuring_pattern',
      label: 'Structuring detection — sub-55K clustering',
      question: 'Analyse the deposit/withdrawal pattern below for structuring (smurfing) against the MoE Circular 08/AML/2021 AED 55K CTR threshold. Apply a Bayesian frame: prior for this customer segment, likelihood of the observed clustering under H=structuring vs H=legitimate. Quantify the posterior and name the threshold the subject appears to be gaming.'
    },
    {
      id: 'str_vs_ctr',
      label: 'STR vs CTR vs CNMR — which filing applies',
      question: 'For the event below, determine which filing obligation applies — STR, SAR, CTR, DPMSR, CNMR, or more than one simultaneously. Cite the governing article (FDL Art.26-27 for STR/SAR, MoE Circular 08/AML/2021 for CTR/DPMSR, Cabinet Res 74/2020 Art.4-7 for CNMR) and the goAML report type code.'
    },
    {
      id: 'pep_rca',
      label: 'PEP relative-or-close-associate screen',
      question: 'The subject below is not directly a PEP, but is connected by family, business, or professional association. Apply FATF Rec 12 PEP-RCA guidance and Wolfsberg PEP FAQs. Is the subject in-scope as an RCA? If yes, scope the EDD: relationship evidence, source-of-wealth dependency on the PEP, ongoing-monitoring cadence.'
    },
    {
      id: 'sow_vs_sof',
      label: 'Source of wealth vs source of funds',
      question: 'Differentiate the source-of-wealth (SoW) question from the source-of-funds (SoF) question for the subject below. Scope the evidence required for each under Cabinet Res 134/2025 Art.14 and FATF Rec 10. Note the 10-year FDL Art.24 retention rule. List the documentary standards the firm must meet.'
    },
    {
      id: 'grey_blacklist_jurisdiction',
      label: 'FATF grey / blacklist jurisdiction onboarding',
      question: 'The prospective client has a nexus to a FATF grey-listed (or black-listed) jurisdiction per the most recent FATF plenary. Scope the EDD requirements under FATF Rec 19 and Cabinet Res 134/2025 Art.14. Identify whether enhanced ongoing monitoring, senior-management approval, and regulator-notification is required.'
    },
    {
      id: 'layering_stage',
      label: 'Placement / layering / integration — ML stage',
      question: 'Classify the activity below into the placement, layering, or integration stage of money laundering. Cite the FATF typology it best matches. Identify the controls the firm should have at each stage and flag which stage is the weakest link in the current pattern.'
    },
    {
      id: 'bearer_shares',
      label: 'Bearer-share company exposure',
      question: 'The entity below has (or historically had) bearer shares in its ownership chain. Apply Cabinet Decision 109/2023 and FATF Rec 24 transparency requirements. Is the current UBO disclosure sufficient, or does bearer-share exposure persist? List the de-materialisation / custody evidence required.'
    },
    {
      id: 'nominee_director',
      label: 'Nominee director red flag',
      question: 'The entity below uses a nominee director / corporate service provider. Assess the nominee arrangement against Cabinet Decision 109/2023 (effective control test), FATF Rec 24-25, and the UAE MoE beneficial-ownership guidance. Distinguish legitimate corporate use from UBO-concealment use. Score the risk.'
    },
    {
      id: 'effective_control_ubo',
      label: 'Effective control UBO (beyond 25%)',
      question: 'The shareholding tree below has no ≥25% holder, but there is a natural person who exercises effective control by other means (board appointment, voting agreement, golden share, financing dependency). Apply Cabinet Decision 109/2023 Art.5 effective-control test and FATF Rec 24. Who is the UBO of record, and what evidence supports it?'
    },
    {
      id: 'free_zone_red_flags',
      label: 'UAE free-zone red-flag scan',
      question: 'The subject is a UAE free-zone entity. Scan for free-zone-specific red flags: single-purpose formation, residency-only address, activity mismatch with licensed scope, multiple free-zone licences for overlapping activities, sudden ownership changes, licence-renewal lapses. Cite the MoE / free-zone-authority guidance that makes each a red flag.'
    },
    {
      id: 'vasp_on_off_ramp',
      label: 'VASP on-ramp / off-ramp flow',
      question: 'Trace the fiat ↔ virtual-asset flow below. Under FATF Rec 15, VARA Rulebook, and the UAE VASP Travel Rule, identify each conversion node, the VASP licensing status, the Travel-Rule data completeness, and any mixer / privacy-coin / chain-hopping indicator between the on-ramp and the off-ramp.'
    },
    {
      id: 'privacy_coin',
      label: 'Privacy-coin / mixer exposure',
      question: 'The flow below touches a privacy coin (Monero / Zcash shielded) or a mixer / tumbler (Tornado Cash, ChipMixer-equivalent). Apply FATF Rec 15 and OFAC Tornado Cash designation guidance. Is continued processing prohibited or merely elevated risk? Scope the mandatory actions.'
    },
    {
      id: 'round_tripping',
      label: 'Round-tripping pattern',
      question: 'Analyse the flows below for round-tripping (A → B → C → A, possibly across jurisdictions or instrument types). Cite the FATF round-tripping typology, the TBML overlaps, and the red flags that distinguish round-tripping from legitimate treasury rebalancing. Score the probability.'
    },
    {
      id: 'cuckoo_smurfing',
      label: 'Cuckoo smurfing detection',
      question: 'The pattern below shows multiple third parties depositing cash into the subject\'s account on the same day, with matching outbound wires. Apply the cuckoo-smurfing typology (FATF 2021 guidance) and assess. Distinguish legitimate third-party deposits from cuckoo-smurfing with structured indicators.'
    },
    {
      id: 'tbml_invoicing',
      label: 'TBML — invoice-level scrutiny',
      question: 'Given the invoice and shipping documentation below, determine whether the trade is over-invoiced, under-invoiced, multiple-invoiced, or describes phantom goods. Cite the FATF TBML typology for each finding. Compute the per-unit price anomaly vs global benchmark where possible.'
    },
    {
      id: 'art_hvg',
      label: 'Art / high-value goods risk',
      question: 'The transaction below involves art, antiquities, luxury watches, or high-end collectables outside the DPMS scope. Apply FATF 2021 Art Market Guidance and any UAE high-value-goods circular in effect. Identify provenance-opacity, cultural-property risk, and the customer\'s declared purpose vs holding pattern.'
    },
    {
      id: 'gold_dore_asm',
      label: 'Gold doré / ASM sourcing review',
      question: 'Assess the doré-gold supply chain below under LBMA RGG v9 Step 2-4 and UAE MoE RSG (Responsible Sourcing of Gold) framework. For an ASM (artisanal and small-scale mining) origin, apply the OECD DDG Annex II red flags, CAHRA conflict-affected/high-risk-area test, and the supplier KYC depth required before receipt.'
    },
    {
      id: 'refresher_cadence',
      label: 'Review cadence — SDD / CDD / EDD',
      question: 'For the customer below, state the mandatory periodic-review cadence under Cabinet Res 134/2025: SDD (12 months), CDD (6 months), EDD (3 months, senior-management sign-off). Identify whether the current cadence is appropriate or needs tightening given any change of circumstance.'
    },
    {
      id: 'turnover_anomaly',
      label: 'Declared vs observed turnover anomaly',
      question: 'Compare the customer\'s DECLARED annual turnover to the OBSERVED 12-month turnover through the firm. Apply a z-score analysis against the sector baseline. If observed >2× declared, enumerate the compliance implications (EDD uplift, SoF re-verification, STR consideration, CO escalation) and their citations.'
    },
    {
      id: 'tf_red_flags',
      label: 'Terrorist-financing red flags (distinct from ML)',
      question: 'Screen the case for terrorist-financing (TF) red flags under FATF Rec 5-8, UAE Cabinet Res 74/2020 (TFS), and the UNSCR 1267/1373 lists. Distinguish TF indicators from ML indicators — low-value dispersed funding, conflict-zone beneficiaries, charity conduits, rapid-turnover accounts. Score TF-likelihood independently of ML-likelihood.'
    },
    {
      id: 'edd_uplift_trigger',
      label: 'EDD uplift — specific triggering evidence',
      question: 'The customer is currently on CDD. Identify which SPECIFIC pieces of evidence in the case below would trigger an uplift to EDD under Cabinet Res 134/2025 Art.14. Map each trigger to the exact article clause. Distinguish triggers that are mandatory (regulatory) from those that are risk-based (firm policy).'
    },
    {
      id: 'multi_jurisdictional_ubo',
      label: 'Multi-jurisdictional UBO chain (>3 layers)',
      question: 'The beneficial-ownership chain spans four or more jurisdictions. Apply Cabinet Decision 109/2023, FATF Rec 24-25, and the Wolfsberg BO transparency principles. For each layer, identify the jurisdiction\'s UBO-disclosure regime, the information obtainable, and the transparency gap. Is the chain fit for reliance or does it require regulator consultation?'
    },
    {
      id: 'sectoral_vs_sdn',
      label: 'Sectoral sanctions vs SDN — match classification',
      question: 'The sanctions hit below is against a sectoral-sanctions list (e.g. OFAC SSI, UK OFSI sectoral, EU sectoral). Distinguish its implications from an SDN / asset-freeze designation. Apply Cabinet Res 74/2020 and the specific sectoral regime. What conduct is prohibited, what is merely restricted, and what reporting is required?'
    },
    {
      id: 'adverse_media_tiering',
      label: 'Adverse media — source tiering + confirmation',
      question: 'Rate each adverse-media hit below on a 4-tier source-credibility scale (tier-1 regulator / law-enforcement, tier-2 major press with byline, tier-3 small press / blog, tier-4 anonymous / syndicated scrape). Apply FATF Rec 10 and Wolfsberg adverse-media guidance. Assess the subject-identity match strength and recommend action commensurate with both credibility and match strength.'
    },
    {
      id: 'fourth_party_payment',
      label: 'Fourth-party payment processor exposure',
      question: 'The flow below involves a fourth-party payment processor (payment aggregator, PSP, e-wallet, digital-currency exchanger) between the firm and the ultimate counterparty. Apply FATF Rec 16 wire-transfer rules and the UAE Travel Rule guidance. Scope the KYC-on-counterparty obligation and identify any intermediated-opacity risk.'
    },
    {
      id: 'golden_visa_nexus',
      label: 'Investor-visa / residency-by-investment nexus',
      question: 'The subject was granted UAE residency via an investor / golden-visa route. Apply FATF 2023 Citizenship and Residency by Investment (CBI/RBI) guidance, UAE Cabinet Res 134/2025, and MoE EDD expectations. Is the investment evidence still valid? Scope the ongoing-monitoring and re-verification duties.'
    },
    {
      id: 'nlp_contextual',
      label: 'Natural-language contextual analysis — free query',
      question: 'Use the context below to answer the MLRO\'s plain-language question. Pull out every quantitative datum, every date, every named party, every jurisdiction. Map them to the applicable UAE AML/CFT/CPF framework. Deliver a verdict in plain English supported by citations and followed by the standard labelled structured block.'
    },
    // ── +10 additional templates added 2026-04-21 (third expansion)
    //    covering sanctions-delta explanation, correspondent nested
    //    account, trust / foundation structure, DPMS sector-risk
    //    assessment, freeze-notification chain, MoE inspection
    //    readiness, enterprise-wide risk-assessment (EWRA) input,
    //    outsourced / shared-service reliance, gifting / charity
    //    payout, and scenario-hypothesis stress test. ──
    {
      id: 'sanctions_delta',
      label: 'Sanctions re-screen — delta explanation',
      question: 'The subject below cleared the prior sanctions screen but now returns a hit on the current run. Compare the two screen results, identify whether it is a list-update delta, a fuzzy-match re-weighting, a subject-data change, or a genuine new designation. Cite the list (UN / OFAC / EU / UK / UAE LTFS / EOCN) and recommend action.'
    },
    {
      id: 'nested_correspondent',
      label: 'Nested correspondent account',
      question: 'The correspondent-banking relationship below is potentially being used as a nested account (the correspondent\'s customer is itself a bank that is using the account to serve its own customers). Apply the Wolfsberg Correspondent Banking Principles, CBUAE Correspondent Banking Standard, and FATF Rec 13. Identify the transparency gap and recommend disposition.'
    },
    {
      id: 'trust_foundation',
      label: 'Trust / foundation structure review',
      question: 'Assess the trust / foundation / Anstalt structure below against Cabinet Decision 109/2023 UBO obligations, FATF Rec 25, and Wolfsberg Private Banking Principles. Identify the settlor, protector, trustees, named and unnamed beneficiaries; any discretionary-distribution opacity; and any letters-of-wishes / side agreements that shift effective control.'
    },
    {
      id: 'dpms_ewra',
      label: 'DPMS enterprise-wide risk assessment (EWRA)',
      question: 'Construct or critique the inputs for the firm\'s Enterprise-Wide Risk Assessment (EWRA) for the DPMS sector under MoE Circular 08/AML/2021 and FATF Rec 1-2. Cover: customer risk, product risk, channel risk, jurisdiction risk, emerging-threat risk. For each dimension, state the inherent-risk score, control effectiveness, and residual-risk output.'
    },
    {
      id: 'freeze_notification_chain',
      label: 'Freeze — internal + external notification chain',
      question: 'For the freeze event below, walk through the mandatory internal + external notification chain under Cabinet Res 74/2020: (1) freeze action & internal escalation to CO, (2) EOCN 24-hour notification, (3) CNMR 5-business-day filing, (4) MLRO board report, (5) external regulator lines. Identify the owner, trigger, artefact, and FDL Art.29 tip-off safeguards for each step.'
    },
    {
      id: 'moe_inspection_readiness',
      label: 'MoE inspection readiness — 24-hour readiness check',
      question: 'Assume an MoE inspection request arrives tomorrow for the case below. Walk through the 24-hour readiness check: audit-pack assembly, UBO register currency, sanctions-screen evidence, STR/CTR/CNMR filings on file, four-eyes trail completeness, training records up-to-date, risk-assessment current. Flag any gap that would fail the inspection.'
    },
    {
      id: 'outsourced_reliance',
      label: 'Outsourced / shared-service reliance',
      question: 'The firm relies on an outsourced provider / group-shared-service for the compliance function below (screening / KYC verification / adverse-media / record-keeping). Apply FATF Rec 17 and Cabinet Res 134/2025 on third-party reliance. Is the reliance permissible, documented, risk-rated, and within the 10-year retention? Identify the control failures that would shift accountability back to the firm.'
    },
    {
      id: 'gifting_charity_payout',
      label: 'Gift / charity payout review',
      question: 'The subject\'s accounts show significant gifting / charity payouts. Apply FATF Rec 8, Cabinet Res 156/2025, and UAE charitable-giving supervision. Distinguish zakat / legitimate personal philanthropy from TF-misuse indicators (conflict-zone beneficiaries, shell charities, round-tripping via charity, politically-exposed trustees).'
    },
    {
      id: 'scenario_stress',
      label: 'Scenario hypothesis stress-test',
      question: 'Take the case below. Generate THREE alternative hypotheses about what the subject is really doing (most-innocent / most-plausible / most-malicious). For each hypothesis, stress-test against the evidence: what supports it, what contradicts it, what evidence would disambiguate. Conclude with the MLRO\'s working hypothesis and the follow-up evidence required to confirm or falsify.'
    },
    {
      id: 'wallet_chain_hop',
      label: 'VASP multi-chain hop analysis',
      question: 'Trace the virtual-asset flow below across multiple chains and protocols (native chain → bridge → wrapped asset → secondary chain → back). Apply FATF Rec 15 and VARA Rulebook. Identify every sanctioned protocol touch, every mixer touch, and every privacy-coin step. Assess Travel-Rule data continuity. Score evasion likelihood.'
    },
    // ── 100 additional question templates added 2026-04-21: CDD/EDD
    //    variants, sanctions edge cases, UBO depth, sector DPMS, VASP,
    //    TBML subtypes, governance, filing/retention, incident. ──
    { id: 'cdd_prospect_individual', label: 'Classify CDD tier — prospect (individual)', question: 'Given the natural-person prospect below, classify the correct CDD tier (SDD / CDD / EDD) under Cabinet Res 134/2025 Art.7-10 and Art.14. State each trigger that drove the tier, the mandatory review cycle (3 / 6 / 12 months), whether senior-management sign-off is required, and what minimum evidence set is needed before onboarding can complete.' },
    { id: 'cdd_prospect_entity', label: 'Classify CDD tier — prospect (legal entity)', question: 'For the legal-entity prospect below, classify CDD tier and set the ownership / control / UBO verification plan. Identify the corporate form, the jurisdiction risk, the apparent UBO layer depth, and any nominee / bearer / trust feature that forces EDD. Cite Cabinet Res 134/2025 Art.7-10 + Cabinet Decision 109/2023.' },
    { id: 'cdd_simplified_eligibility', label: 'Simplified CDD eligibility', question: 'Assess whether the case below qualifies for SIMPLIFIED CDD under Cabinet Res 134/2025 Art.7-10. Walk the low-risk criteria (publicly-listed entity / regulated FI / government body / low-risk product). Output: eligible (y/n) · specific criterion met · documentation required · required monitoring cadence.' },
    { id: 'cdd_refresh_trigger', label: 'CDD refresh trigger analysis', question: 'Decide whether the event below triggers a full CDD refresh or just a limited update. Consider: material change in ownership, adverse-media hit, sanctions re-screen match, risk-tier change, law enforcement request, new jurisdiction exposure. Cite Cabinet Res 134/2025 Art.19 and set the refresh scope + deadline.' },
    { id: 'cdd_ongoing_cadence', label: 'Set ongoing-monitoring cadence', question: 'Set the correct ongoing-monitoring cadence for the customer below — review interval, transaction-monitoring rule set, sanctions re-screen frequency, UBO re-verification window (Cabinet Decision 109/2023 — 15 working days for changes). Justify each cadence against the customer\'s risk tier.' },
    { id: 'cdd_walk_in', label: 'Walk-in / occasional transaction above threshold', question: 'A non-customer has requested a one-off DPMS transaction above the occasional-threshold (AED 55K cash under MoE Circular 08/AML/2021 or AED 15K under FATF Rec 10 occasional-transaction floor). Specify the ID&V, UBO, SoF, and record-keeping obligations that still apply without full onboarding. Cite FDL Art.12 and the Circular.' },
    { id: 'cdd_non_resident', label: 'Non-resident UAE customer CDD', question: 'The customer below is non-resident in the UAE and transacts cross-border. Set the CDD tier, the residency-verification plan, the jurisdiction-risk factor, the home-tax-residency evidence, and the ongoing cadence. Cite Cabinet Res 134/2025 Art.14 and FATF Rec 10-12.' },
    { id: 'cdd_digital_onboarding', label: 'Digital / remote onboarding CDD', question: 'The customer is being onboarded fully remotely (digital ID&V, video KYC, no in-person attendance). Specify the CDD uplifts required for remote non-face-to-face onboarding under FATF Rec 10 + Cabinet Res 134/2025. Identify the specific liveness, document-authenticity, and deep-fake-resistance controls required.' },
    { id: 'cdd_legacy_upgrade', label: 'Legacy-customer upgrade to current CDD', question: 'A legacy customer onboarded under prior standards must be upgraded to current CDD (Cabinet Res 134/2025). Specify: the prioritisation order (high-risk first), the evidence to re-collect, the disposition rule if the customer refuses (exit / freeze-pending-review), the deadline per FDL Art.24 retention, and the audit trail required.' },
    { id: 'cdd_third_party_reliance', label: 'Third-party CDD reliance (FATF Rec 17)', question: 'The firm proposes to rely on a third-party financial institution\'s CDD for the customer below. Assess eligibility under FATF Rec 17 + Cabinet Res 134/2025: is the third party an eligible FI, is its CDD adequate, is it supervised, can the firm access the underlying data on request? Output: reliance permitted (y/n) · conditions · fallback.' },
    { id: 'edd_sow_scope', label: 'EDD — source-of-wealth evidence scope', question: 'Scope the EDD source-of-wealth evidence required for the subject below. Consider: inherited wealth, business profits, professional income, real-estate disposal, investment returns. For each, specify the documentary standard, the 10-year FDL Art.24 retention requirement, the jurisdiction-of-origin risk, and the corroborating-source standard (three independent sources).' },
    { id: 'edd_sof_transaction', label: 'EDD — source-of-funds for a specific transaction', question: 'The single transaction below is large / unusual relative to the customer\'s profile. Specify the SOF evidence required for just this transaction (not the whole wealth base). Walk: originating account / bank statement, counterparty relationship evidence, underlying commercial rationale, documentary trail. Cite FATF Rec 10 and Cabinet Res 134/2025 Art.14.' },
    { id: 'edd_pep_family', label: 'PEP family / close-associate EDD extension', question: 'The customer is a PEP per FATF Rec 12. Scope the EDD extension to family members and close associates per Wolfsberg PEP FAQs. List the defined family tier, the close-associate criteria, the ongoing-monitoring cadence, and the senior-management approval chain required before onboarding any extended party.' },
    { id: 'edd_high_risk_jurisdiction', label: 'EDD for high-risk jurisdiction exposure', question: 'The customer transacts with / has ownership in / receives funds from a FATF-grey-listed or high-risk jurisdiction. Scope the EDD: sanctions overlap, beneficial-ownership transparency, corruption index, enforcement cooperation. Cite Cabinet Res 134/2025 Art.14 and the relevant FATF ICRG listing.' },
    { id: 'edd_complex_structure', label: 'EDD for complex / layered structure', question: 'The customer is a layered corporate structure (multi-jurisdiction holding chain, trust, foundation, nominee). Scope the EDD: ownership map, control map (voting, signatory, protector, enforcer), purpose-of-structure rationale, tax residency. Cite Cabinet Decision 109/2023 and FATF Recommendations 24-25.' },
    { id: 'edd_sanctions_adjacent', label: 'EDD — near-sanctioned nexus', question: 'The subject is not directly sanctioned but has a near-sanctioned nexus (common director, shared address, same UBO, jurisdictional link). Scope the EDD to determine whether the relationship imports sanctions risk. Cite Cabinet Res 74/2020, UN 1267/1988 sanctions regime guidance, and OFAC 50% rule analogues.' },
    { id: 'edd_cash_intensive', label: 'EDD for cash-intensive customer', question: 'The customer operates a cash-intensive business (DPMS retail, money-service business, hospitality). Scope the EDD: cash-handling controls, deposit velocity, nominal-ticket analysis, cash-to-turnover ratio, CTR history. Cite MoE Circular 08/AML/2021 and FATF Rec 10.' },
    { id: 'edd_correspondent_triggered', label: 'EDD triggered by correspondent-bank RFI', question: 'The firm has received a correspondent-bank RFI on the customer below. Scope the defensive EDD response: the specific information the correspondent is requesting, the firm\'s existing evidence, gaps to close, response deadline, confidentiality / tipping-off management per FDL Art.29. Format for correspondent-bank reply.' },
    { id: 'edd_adverse_media_triggered', label: 'EDD triggered by adverse-media hit', question: 'An adverse-media alert has surfaced on the customer below. Scope the EDD: confirm subject-match strength, classify media tier (regulator / major-press / blog / anonymous), map allegation to AML/CFT/CPF typology, request targeted evidence. Decide: no action / enhanced monitoring / EDD uplift / exit / STR consideration.' },
    { id: 'edd_sanctions_dismiss_rationale', label: 'EDD to support sanctions dismissal', question: 'The firm proposes to DISMISS a potential sanctions match on the customer below as a false positive. Build the EDD rationale: distinguishing identity evidence (dob, nationality, address, ID numbers), non-match on secondary attributes, third-party identity-verification, and sign-off chain. Cite Cabinet Res 74/2020 and document for audit.' },
    { id: 'sanc_partial_match_decision', label: 'Partial sanctions-match decision framework', question: 'The screening result is a PARTIAL match (confidence 0.5-0.89). Build the decision framework: evidence for identity match, evidence against, confidence scoring methodology, approval chain, documentation standard. Tie the outcome to the four decision paths (confirm → freeze · dismiss → document · escalate → CO · defer → evidence-gathering).' },
    { id: 'sanc_delisting_posture', label: 'Post-delisting residual posture', question: 'The subject was recently DE-LISTED from a sanctions regime. Set the residual posture: immediate CDD refresh, residual reputational-risk monitoring, continued transaction-monitoring tailoring, documentation of the delisting verification. Cite Cabinet Res 74/2020 delisting provisions and the original listing basis.' },
    { id: 'sanc_ofac_eo', label: 'OFAC Executive-Order-driven designation', question: 'The match is under an OFAC Executive Order (e.g. EO 14024 Russia, EO 13818 Magnitsky, EO 13224 SDGT). Walk the specific EO: scope, secondary-sanctions risk, 50% rule, any general licences, wind-down period, blocked-property handling. Map to Cabinet Res 74/2020 enforcement path.' },
    { id: 'sanc_secondary_exposure', label: 'Secondary-sanctions exposure analysis', question: 'The direct customer is not sanctioned, but a counterparty / correspondent / UBO is sanctioned. Assess SECONDARY-SANCTIONS exposure for the firm under OFAC / EU / UK secondary provisions. Map to Cabinet Res 74/2020 freeze duty and the firm\'s correspondent-banking posture.' },
    { id: 'sanc_list_freshness', label: 'Sanctions list-freshness audit', question: 'Audit the firm\'s sanctions-list freshness across all mandatory lists (UN / OFAC / EU / UK / UAE EOCN). For each list: last refresh date, lag vs publication, screening coverage across the customer book, any stale-list exposure. Cite Cabinet Res 74/2020 Art.4-7 and MoE Circular 08/AML/2021 screening obligations.' },
    // Batch 2/4 — UBO depth + DPMS sector + VASP / crypto.
    { id: 'ubo_25_threshold', label: 'Apply the 25% UBO threshold', question: 'Apply the 25% beneficial-ownership threshold (Cabinet Decision 109/2023) to the ownership tree below. Walk each layer, compute effective ownership, identify each natural person crossing 25%, and flag any indirect chain that individually sits below 25% but whose aggregated control might trigger. Output the UBO register entries required.' },
    { id: 'ubo_effective_control', label: 'Effective-control UBO (ownership-below-25%)', question: 'The entity below has no single 25% owner, but effective control sits with specific individuals via voting rights, board appointment, veto power, or contractual arrangement. Identify those effective-control UBOs per Cabinet Decision 109/2023 + FATF Rec 24. Document the evidence standard for each effective-control basis.' },
    { id: 'ubo_indirect_chain', label: 'Indirect-chain UBO calculation', question: 'Compute the UBO chain through the multi-layer ownership below. For each layer, multiply through the chain to the natural person. Report each natural person and their aggregate indirect percentage. Flag any chain that cannot be fully resolved and the specific Cabinet Decision 109/2023 article triggered.' },
    { id: 'ubo_nominee_directors', label: 'Nominee directors / shareholders', question: 'The customer\'s directors / shareholders are nominees. Identify the BENEFICIAL principals behind each nominee arrangement. Cite FATF Rec 24-25 on nominee-arrangement transparency and Cabinet Decision 109/2023. Specify the documentary evidence required (nominee declaration, underlying trust deed) and the jurisdictional disclosure standard.' },
    { id: 'ubo_bearer_shares', label: 'Bearer-share entity UBO', question: 'The entity below is incorporated in a jurisdiction that still permits bearer shares. Assess the UBO gap: identify every natural person who could hold the bearer certificates, specify the immobilisation / declaration control in force, and state the firm\'s disposition (proceed with EDD uplift / exit) under Cabinet Decision 109/2023 + FATF Rec 24.' },
    { id: 'ubo_trust_chain', label: 'Trust — settlor / trustee / beneficiary / protector', question: 'The ownership includes a TRUST layer. Map the four trust roles (settlor, trustee, beneficiary, protector) per FATF Rec 25 + Cabinet Decision 109/2023. Apply the UBO test to each role. Identify any role concealed, any discretionary-beneficiary class requiring further identification, and any letter-of-wishes red flag.' },
    { id: 'ubo_foundation_chain', label: 'Foundation — founder / council / beneficiary', question: 'The ownership includes a FOUNDATION (Liechtenstein, Panama, Jersey). Map the roles: founder, foundation council, beneficiaries, protector. Apply the effective-control UBO test. Cite Cabinet Decision 109/2023 and FATF guidance on legal arrangements. Identify any role requiring further evidence.' },
    { id: 'ubo_secrecy_jurisdiction', label: 'UBO chain through secrecy jurisdiction', question: 'The UBO chain passes through at least one secrecy jurisdiction (BVI, Cayman, Panama, Marshall Islands, Seychelles, etc). Assess the opacity risk: is the jurisdiction FATF-compliant on beneficial ownership, does the firm have reliable primary documentation, what mitigation is sufficient. Cite FATF Rec 24 and the OECD Global Forum rating.' },
    { id: 'ubo_refusal_disposition', label: 'Customer refuses UBO disclosure', question: 'The customer has refused to complete UBO disclosure beyond a specific layer (citing privacy, confidentiality, legal privilege). Decide the disposition under Cabinet Decision 109/2023 + FDL Art.14: refuse onboarding / terminate existing relationship / escalate to CO / file STR. Document the decision rationale and any tipping-off constraint under FDL Art.29.' },
    { id: 'ubo_reverification_event', label: 'UBO re-verification on ownership change', question: 'An ownership-change event has occurred (new shareholder, new director, new UBO). Walk the re-verification obligations: Cabinet Decision 109/2023 15-working-day deadline, refreshed documentary evidence, cross-check against sanctions / PEP / adverse media, UBO-register update, audit trail. Compute the deadline using businessDays.ts semantics.' },
    { id: 'dpms_retail_threshold', label: 'DPMS retail — AED 55K cash threshold', question: 'The DPMS retail transaction below involves cash at or near the AED 55K threshold. Apply MoE Circular 08/AML/2021 and FDL Art.2: is this a single transaction, a linked series (aggregation), or a structuring attempt? Specify the CTR filing obligation, the goAML DPMSR path, and the 15-business-day filing deadline.' },
    { id: 'dpms_wholesale_invoice', label: 'DPMS wholesale invoice review', question: 'Review the wholesale gold/jewellery invoice below against MoE Circular 08/AML/2021 and LBMA RGG v9. Verify: weight-vs-value plausibility, assay/fineness consistency, origin declaration, transport chain-of-custody, counterparty LBMA/DMCC status. Score TBML likelihood (over/under/phantom-invoicing).' },
    { id: 'dpms_scrap_gold', label: 'Scrap-gold ingestion due diligence', question: 'The supply leg below is scrap-gold ingestion. Apply MoE Circular 08/AML/2021 + LBMA RGG v9 + OECD DDG. Walk: seller KYC, weight/fineness verification, origin declaration, CAHRA check, secondary-market history, settlement channel. Flag any break in the chain-of-custody and the disposition.' },
    { id: 'dpms_hallmark_verification', label: 'Hallmark / assay verification', question: 'The DPMS transaction involves hallmarked bullion or jewellery. Walk the hallmark/assay verification chain per Dubai Good Delivery (DGD) + LBMA standards: stamp authenticity, assay-house credibility, certificate freshness, weight-per-hallmark consistency, any prior adverse enforcement on the refiner. Output hallmark disposition.' },
    { id: 'dpms_pawn_broker', label: 'Pawn-broker AML obligations', question: 'The business segment below is pawn-broking of precious metals / jewellery. Apply MoE Circular 08/AML/2021 + FATF DPMS guidance: onboarding standard, pledge-and-redemption monitoring, default-auction record-keeping, CTR / STR triggers, 10-year FDL Art.24 retention. Identify any gap against the sectoral template.' },
    { id: 'dpms_refiner_cahra', label: 'Refiner CAHRA DD (LBMA RGG v9 Step 3)', question: 'The upstream refiner supplies from CAHRA (Conflict-Affected and High-Risk Area). Walk LBMA RGG v9 Step 3 CAHRA DD in detail: red-flag screening, enhanced site visits, supplier chain traceability, armed-group-exposure risk, ICGLR regional mechanism alignment. Output: residual risk score + mitigation programme.' },
    { id: 'dpms_bullion_loco', label: 'Bullion loco-swap / location transfer', question: 'The transaction is a loco-swap / location transfer of unallocated bullion (loco-London to loco-Dubai, or similar). Walk the custody / title transfer, the vaulting chain, the SWIFT / platform messaging, any intermediary broker, any sanctions / jurisdictional touch. Cite LBMA / DMCC market standards and the UAE CPF regime.' },
    { id: 'dpms_goaml_dpmsr', label: 'DPMS goAML DPMSR construction', question: 'Construct the goAML DPMSR XML filing for the quarterly cash transactions below (MoE Circular 08/AML/2021). Specify: reporting period, aggregate cash volumes by customer, CTR-eligible entries, XML schema elements required, the firm\'s goAML organisation ID, and the filing deadline (15 business days after quarter end).' },
    { id: 'dpms_kpi_quarterly', label: 'DPMS quarterly KPI rollup', question: 'Roll up the DPMS quarterly KPIs: onboarded customers, CDD-tier distribution, STR count, CTR count, DPMSR entries, CAHRA-exposure, sanctions hits, UBO-register completeness, training completion. Map to the 30-KPI DPMS compliance framework and flag KPIs below target.' },
    { id: 'dpms_cross_border_physical', label: 'DPMS cross-border physical gold movement', question: 'The case below involves physical cross-border gold movement (hand-carry, freight, vault-to-vault). Apply Cabinet Res 134/2025 Art.16 AED 60K BNI declaration, customs declaration, freight-forwarder KYC, transit-country sanctions, origin certificates. Identify the filing path and the evidence retention plan.' },
    { id: 'vasp_wallet_screen', label: 'VASP wallet address screening', question: 'Screen the wallet address(es) below against sanctioned wallets (OFAC SDN digital-asset annex), mixer / tumbler services (Tornado, Blender, Sinbad, ChipMixer lineage), darknet-market-associated clusters, and ransomware-clusters. Cite FATF Rec 15, VARA Rulebook, and applicable OFAC cyber designations. Output wallet-risk disposition.' },
    { id: 'vasp_travel_rule', label: 'VASP Travel-Rule data review', question: 'Review the Travel-Rule payload for the VA transfer below: originator name / account / physical address, beneficiary name / account / wallet. Apply FATF Rec 16 Travel Rule and VARA VASP obligations. Identify missing / incomplete fields, verify plausibility, and specify the remediation / hold / return path.' },
    { id: 'vasp_mixer_exposure', label: 'Mixer / tumbler exposure', question: 'The wallet path touches a mixer / tumbler service (confirmed or suspected). Apply FATF Rec 15 guidance + OFAC mixer designations (Tornado, Blender precedent). Walk: hops through mixer, post-mix attribution, de-anonymisation confidence, sanctions-designation impact. Decide disposition (hold / refuse / STR / freeze).' },
    { id: 'vasp_privacy_coin', label: 'Privacy-coin / opaque-ledger exposure', question: 'The transaction leg involves a privacy coin (Monero, Zcash shielded, Dash PrivateSend) or opaque-ledger technique. Apply FATF Rec 15 + VARA Rulebook. Assess: Travel-Rule feasibility, de-anonymisation evidence, trading-platform delisting posture, regulatory-intent signal. Decide firm posture (prohibit / restrict / exit-and-file).' },
    { id: 'vasp_stablecoin_issuer', label: 'Stablecoin issuer / reserve transparency', question: 'The counterparty issues or intermediates a stablecoin (USDT, USDC, DAI, or local equivalent). Assess reserve-transparency, issuer sanctions-risk posture, redemption history, blacklisting capability, cross-chain bridge exposure. Cite VARA + CBUAE virtual-asset guidance + FSB stablecoin principles.' },
    // Batch 3/4 — TBML subtypes + governance + filing / retention.
    { id: 'tbml_over_invoicing', label: 'TBML — over-invoicing', question: 'Test the trade transactions below for OVER-INVOICING (invoice value materially above fair-market value of goods shipped). Benchmark against published commodity / product ranges, freight weight and unit-price sensibility, counterparty margin norms. Cite FATF TBML typology and score probability.' },
    { id: 'tbml_under_invoicing', label: 'TBML — under-invoicing', question: 'Test for UNDER-INVOICING (invoice below fair-market value). Cross-check shipping volumes, assay/fineness, insured value, destination duty declaration. Identify beneficiary of the value differential. Cite FATF TBML typology and score probability.' },
    { id: 'tbml_phantom_shipment', label: 'TBML — phantom shipment', question: 'Assess whether the invoice below may correspond to a PHANTOM (never-shipped) movement. Walk: freight-forwarder KYC, bill-of-lading validity, port-records cross-check, warehouse / vault receipt, inspection certificate. Cite FATF TBML typology.' },
    { id: 'tbml_multiple_invoicing', label: 'TBML — multiple invoicing', question: 'Investigate whether the same underlying shipment has been invoiced multiple times through different channels. Compare: invoice numbers, dates, amounts, banking chains. Identify the duplicated leg and the net value moved. Cite FATF TBML typology.' },
    { id: 'tbml_misdescribed_goods', label: 'TBML — mis-described goods', question: 'Evaluate whether the described goods on the invoice materially differ from the actual goods (e.g. "scrap brass" declared, refined gold shipped; "industrial alloy" declared, bullion moved). Cross-check with assay, customs declarations, HS codes. Cite FATF TBML typology and MoE Circular 08/AML/2021.' },
    { id: 'tbml_round_tripping', label: 'TBML — round-tripping', question: 'Analyse the trade pattern below for ROUND-TRIPPING (goods leaving and returning to the same origin through an intermediary, to justify cross-border cash / wire flows). Map the ownership of the intermediary, the economic rationale, the value-add at the intermediary, the tax / sanctions effect.' },
    { id: 'tbml_cuckoo_smurfing', label: 'Cuckoo smurfing pattern', question: 'Investigate whether the remittance pattern below is consistent with CUCKOO SMURFING (illicit funds deposited into legitimate customer accounts to clear value transfers). Walk the sender / recipient roles, the ignorance / awareness signals, and the ML3 / VRP framework. Cite FATF + AUSTRAC typology.' },
    { id: 'tbml_bmpe', label: 'Black Market Peso Exchange (BMPE) pattern', question: 'Assess whether the cross-border flows below show BMPE characteristics: parallel exchange outside official channels, third-party payer / receiver, trade-settlement inversion, structured cash placement. Apply to UAE context (dirham / hawala / DPMS trade settlement). Cite FATF and regional typology.' },
    { id: 'tbml_free_trade_zone', label: 'Free-trade-zone (FTZ) layering', question: 'The case passes through a free-trade zone (DMCC / JAFZA / Dubai Airport FZ / Abu Dhabi Global Market). Assess FTZ-specific ML/TF risks: relaxed customs, re-export typologies, warehouse rental without real activity, letterbox entities. Cite FATF FTZ guidance and UAE FTZ authority rulebooks.' },
    { id: 'tbml_maritime_bunker', label: 'Maritime bunker / fuel trade layering', question: 'The case involves maritime bunker, fuel-oil, or petroleum-product trade. Assess sanctions-evasion typologies (AIS switch-off, STS transfers, flag-state abuse, sanctioned-port calls) and TBML overlays. Cite UK OFSI maritime guidance + OFAC Russian oil price cap + MLA advisories.' },
    { id: 'gov_policy_gap', label: 'AML policy gap analysis', question: 'Audit the firm\'s AML/CFT policy against Cabinet Res 134/2025 + FDL No.10/2025 + MoE Circular 08/AML/2021. For each mandatory policy section (risk-based approach, CDD tiers, EDD triggers, sanctions, TFS, STR, training, record-keeping, MLRO authority), compare current policy text vs mandatory coverage. Flag every gap.' },
    { id: 'gov_board_oversight', label: 'Board / senior-management oversight', question: 'Assess board / senior-management oversight of the firm\'s AML/CFT programme per Cabinet Res 134/2025 Art.5 (risk appetite) + FDL Art.20-21. Check: documented risk appetite, quarterly MLRO reports reviewed by board, KPI tracking, incident-escalation path, resource adequacy for the compliance function. Rate BOARD-READY / PARTIAL / GAP.' },
    { id: 'gov_mlro_authority', label: 'MLRO authority / independence', question: 'Assess MLRO authority and independence. Check: reporting line (direct to board), authority to file STR without management veto, resources, tenure protection, conflict-of-interest guardrails. Cite Cabinet Res 134/2025 Art.11 + FDL Art.20-21. Flag any structural constraint that could compromise independent filing.' },
    { id: 'gov_risk_assessment_refresh', label: 'Enterprise-wide risk-assessment refresh', question: 'The firm\'s enterprise-wide AML/CFT/CPF risk assessment is due for refresh. Scope the refresh per Cabinet Res 134/2025 Art.5: customer-segmentation, product-channel matrix, jurisdiction matrix, typology update, control-effectiveness review, residual risk scoring. Define the refresh timeline and sign-off chain.' },
    { id: 'gov_training_matrix', label: 'Role-based training matrix', question: 'Build the role-based AML/CFT training matrix for the firm: MLRO / CO / front-office / ops / legal / board / auditors. For each role, specify: annual hours, role-specific content, case-study material, attestation evidence, refresher cadence. Cite Cabinet Res 134/2025 Art.11 + FATF Rec 18.' },
    { id: 'gov_independent_audit', label: 'Independent-audit coverage of AML programme', question: 'Scope the independent audit of the firm\'s AML/CFT programme per Cabinet Res 134/2025 + FATF Rec 18. Define the audit universe, sample sizes for CDD files, STR history review, sanctions screening coverage, governance review. Identify which prior audit findings remain open.' },
    { id: 'gov_policy_update_circular', label: 'Policy update to incorporate new circular', question: 'A new MoE / CBUAE / VARA / EOCN circular has been published. Scope the policy update: impacted sections, drafting changes, training-refresh triggers, system-configuration changes, sign-off chain, 30-day update deadline per CLAUDE.md rule. Cite the new circular and the existing policy version to update.' },
    { id: 'gov_board_attestation', label: 'Board attestation of AML posture', question: 'Draft the board-level attestation of the firm\'s AML/CFT posture for the period below. Cover: risk-appetite adherence, MLRO independence, control effectiveness, residual risk, open audit findings, enforcement exposure, resource adequacy. Cite FDL Art.20-21 and the firm\'s regulatory commitments.' },
    { id: 'gov_change_notification', label: 'MLRO / CO change notification to regulator', question: 'An MLRO / Deputy MLRO / CO change is planned. Walk the notification obligation per Cabinet Res 134/2025 Art.18 (CO change notification — 14 calendar days). Include: outgoing / incoming fit-and-proper evidence, board resolution, regulator-facing form, confidentiality, transition plan.' },
    { id: 'gov_vendor_risk', label: 'Third-party / vendor AML risk', question: 'Assess the AML/CFT risk of the third-party vendor / outsourced-service-provider below (screening, KYC/CDD, IT, payments). Apply the firm\'s TPRM framework + FATF Rec 17 reliance principles. Identify residual risk, contractual mitigants, ongoing oversight, exit triggers.' },
    { id: 'filing_str_narrative', label: 'Compose STR narrative (goAML)', question: 'Compose the UAE FIU STR narrative for the case below in goAML format. Structure: Who (parties) / What (suspicious activity) / When (dates) / Where (jurisdictions) / Why (red flags) / How (mechanism). Cite FDL Art.26-27 drafting standard, FDL Art.29 tipping-off constraint, and the filing "without delay" obligation.' },
    { id: 'filing_ctr_aggregation', label: 'CTR linked-transaction aggregation', question: 'Decide whether the transaction series below must be AGGREGATED for a single CTR filing (MoE Circular 08/AML/2021). Consider: same-customer rule, same-day rule, beneficial-ownership link, structuring indicator. Compute aggregate value vs AED 55K threshold and output the filing determination.' },
    { id: 'filing_dpmsr_quarterly', label: 'Quarterly DPMSR filing preparation', question: 'Prepare the DPMSR quarterly filing per MoE Circular 08/AML/2021. Assemble: customer list, transaction extracts, CTR entries, STR cross-references, record-keeping attestation. Validate the goAML XML schema, confirm the 15-business-day filing deadline, and identify any missing input.' },
    { id: 'filing_cnmr_freeze', label: 'CNMR construction post-freeze', question: 'A sanctions freeze has been executed. Construct the CNMR (Cross-Border Monitoring Report / Confiscation Notification) within the 5-business-day deadline per Cabinet Res 74/2020 Art.4-7. Include: freeze execution evidence, value frozen, counterparty details, EOCN correspondence, CNMR XML structure. Use businessDays.ts semantics for the deadline.' },
    { id: 'filing_retention_package', label: 'FDL Art.24 10-year retention package', question: 'Assemble the 10-year retention package for the case below per FDL Art.24. Inventory: CDD file, screening logs, transaction records, STR draft + filing, MLRO decision memo, board attestations, audit evidence. Specify storage, access-control, tamper-evidence, retrieval SLA, and expiry computation.' },
    // Batch 4/4 — incident response + specialist topics.
    { id: 'incident_24h_freeze', label: 'Execute the 24h sanctions freeze', question: 'A sanctions match has been confirmed. Execute the 24-hour asset freeze under Cabinet Res 74/2020 Art.4-7. Walk: freeze mechanics (account, wire, pending transaction), internal instruction chain, EOCN notification, freeze evidence, and the 5-business-day CNMR follow-up. Track the deadline in clock hours, not business days.' },
    { id: 'incident_str_no_tipping', label: 'STR workflow with no-tipping-off discipline', question: 'An STR trigger has been identified. Walk the filing workflow while strictly observing FDL Art.29 no-tipping-off: internal-only communications, external-facing posture, declining requests for account information from the subject, continuing ordinary service where feasible, MLRO decision memo. Draft the internal communication template.' },
    { id: 'incident_breach_containment', label: 'AML control-breach containment', question: 'A control breach has been detected (missed sanctions hit, unfiled STR, UBO not re-verified, sanctions list stale). Scope the containment: scope of breach, root cause, remediation sequence, regulator notification obligation, affected customer population, 10-year retention of the breach record.' },
    { id: 'incident_regulator_request', label: 'Regulator RFI / information request', question: 'The firm has received a formal information request from MoE / CBUAE / FIU / EOCN / VARA. Scope the response: legal review, scope clarification, record gathering, privilege assertion, submission deadline, CO / MLRO sign-off, ongoing-investigation confidentiality. Cite the governing article.' },
    { id: 'incident_law_enforcement', label: 'Law-enforcement production order', question: 'A law-enforcement production order has been received. Walk compliance under FDL + UAE criminal-procedure rules: legal review, scope validation, privileged-information carve-out, record production, FDL Art.29 tipping-off constraint on the subject, evidence continuity. Draft the internal process memo.' },
    { id: 'incident_whistleblower', label: 'Internal whistleblower report triage', question: 'An internal whistleblower report has been received concerning AML conduct. Triage per Fed Decree-Law 32/2021 (whistleblower protection) + FDL Art.29 confidentiality. Classify severity, initial investigation path, ring-fencing, reporting-line-bypass if needed, regulator-notification threshold, protection of the reporter.' },
    { id: 'incident_tipping_off_audit', label: 'Tipping-off risk audit', question: 'Audit the recent correspondence / account-closure / service-change actions for TIPPING-OFF risk under FDL Art.29. For each action, assess: did it signal the STR / freeze / investigation status to the subject? Classify: safe / borderline / tipping-off. For borderline, build remedial-posture plan.' },
    { id: 'incident_public_statement', label: 'Public statement / press response', question: 'The firm may be mentioned in adverse-press coverage of the case below. Draft the public-statement posture consistent with: FDL Art.29 tipping-off, ongoing-investigation confidentiality, regulator coordination, reputational-risk management, litigation-privilege carve-outs. Identify what can / cannot be said.' },
    { id: 'incident_penalty_exposure', label: 'Penalty / enforcement exposure', question: 'Assess the firm\'s penalty / enforcement exposure under Cabinet Res 71/2024 (administrative penalties AED 10K–100M) for the identified issue. Classify the violation tier, likelihood of enforcement, mitigating factors, remediation credit, disclosure strategy. Cite the governing Cabinet Res 71/2024 article.' },
    { id: 'incident_remediation_plan', label: 'Remediation plan after audit finding', question: 'An independent audit has issued a finding on the case below. Build the remediation plan: root cause, corrective action, preventive action, ownership, timeline, testing, evidence, regulator-facing narrative. Cite the audit standard and the firm\'s remediation policy.' },
    { id: 'pf_dual_use_controls', label: 'PF / dual-use goods controls (Cabinet Res 156/2025)', question: 'Screen the transaction below for PF / dual-use-goods exposure under Cabinet Res 156/2025 and UNSCR 1540. Identify: strategic-goods classification, end-user / end-use verification, catch-all concern, proliferator nexus, licensing requirement. Decide: licence / block / report.' },
    { id: 'sanctions_ownership_50', label: 'OFAC 50% rule and analogues', question: 'Apply the OFAC 50% rule (entities ≥50% owned by SDN persons are themselves SDN) to the ownership structure below. Compute aggregated ownership, identify any 50%+ aggregated threshold crossing, and map to EU / UK / UN / UAE equivalents. Output: ownership-derived SDN status.' },
    { id: 'sanctions_wind_down', label: 'Wind-down / general-licence analysis', question: 'Assess whether a sanctions GENERAL LICENCE (OFAC / EU / UK / UAE) or WIND-DOWN period applies to the transaction below. Walk the specific licence conditions, eligible activity, reporting obligations, expiry. Decide: transaction permitted-under-licence, permitted-in-wind-down, or blocked.' },
    { id: 'correspondent_kyc', label: 'Correspondent-bank / FI KYCC pack', question: 'Build the KYCC (Know-Your-Correspondent-Customer) pack for the correspondent relationship below. Include: AML-questionnaire completion, UBO/control disclosure, sanctions-programme attestation, periodic certification cadence, Wolfsberg CBDDQ alignment. Cite CBUAE Correspondent Banking Standard + Wolfsberg Principles.' },
    { id: 'nested_correspondent_kycc', label: 'Nested-correspondent / downstream CB (KYCC depth)', question: 'Assess the nested-correspondent relationship below (correspondent\'s correspondent). Walk: direct-correspondent KYCC, nested-relationship awareness, monitoring reach, RFI-answer capacity. Cite Wolfsberg Correspondent Banking Principles + CBUAE guidance. Decide: maintain / enhanced oversight / restrict / exit.' },
    { id: 'payment_originator_info', label: 'Payment-originator information (Wire Transfer Rec 16)', question: 'Verify the completeness of payment-originator and beneficiary information on the wire-transfer leg below per FATF Rec 16. Identify any missing field, any intermediary that stripped data, and the remediation obligation. Decide: process / hold / return / RFI.' },
    { id: 'npo_tf_risk', label: 'NPO / charity TF-risk assessment', question: 'Assess TF-abuse risk on the NPO / charity below per FATF Rec 8 and Cabinet Res 156/2025. Walk: beneficiary selection, conflict-zone operations, fund flows, trustee-integrity, regulator supervision. Differentiate proportionate supervision from de-risking.' },
    { id: 'high_risk_jur_list', label: 'High-risk jurisdiction re-screen (FATF public statement)', question: 'A FATF public statement has updated the high-risk / grey-listed jurisdictions. Scope the re-screen impact on the firm\'s customer book: affected customers, re-tiering plan, EDD uplifts, monitoring cadence changes, regulator-notification obligation. Compute the turnaround timeline.' },
    { id: 'adverse_media_source_tier', label: 'Adverse-media source tiering (explicit 4-tier weights)', question: 'Apply the adverse-media source-tiering framework to the hits below: Tier 1 (regulator / court / sanctions designation) · Tier 2 (major outlet) · Tier 3 (minor or niche blog) · Tier 4 (anonymous / unverified). Weight by source tier + allegation category + recency + subject-match strength. Output disposition.' },
    { id: 'golden_visa_residency', label: 'Golden-visa residency-pathway review', question: 'The customer below holds UAE golden-visa status. Assess the residency / investment / employment pathway used to qualify. Verify supporting evidence, tax residency, source-of-funds for any investment threshold, and any FATF Rec 12 PEP overlay. Cite UAE immigration authority framework + Cabinet Res 134/2025.' },
    { id: 'exit_client_risk', label: 'Customer exit with containment', question: 'The firm has decided to exit the customer relationship below for AML/CFT reasons. Walk the exit: notice period consistent with FDL Art.29 (no tipping-off on underlying rationale), funds-return path, residual monitoring, regulator-notification threshold, 10-year retention, reputational and litigation risk.' },
    { id: 'sanctions_ambiguous_nationality', label: 'Ambiguous-nationality sanctions disambiguation', question: 'The subject\'s nationality / citizenship is ambiguous (dual national, stateless, recent re-naturalisation, diplomatic passport). Walk the sanctions-screening disambiguation: each nationality against each regime, strictest-applicable rule, evidence-of-nationality standard, and the cited Cabinet Res 74/2020 basis for the outcome.' },
    { id: 'beneficial_transfer', label: 'Beneficial-transfer / assignment analysis', question: 'The transaction involves an ASSIGNMENT or beneficial transfer of rights (contract, debt, future receivable). Identify the economic beneficiary, map to AML/CFT risk (concealed parties, informal transfer of value, title fragmentation). Cite FATF Rec 16 + CBUAE transfer-of-value guidance.' },
    { id: 'cash_courier_ctn', label: 'Cash courier / CTN (AED 60K cross-border)', question: 'Assess the cash-courier / cross-border-cash case below against Cabinet Res 134/2025 Art.16 (AED 60K declaration). Walk: declaration evidence, border-point filing, customs coordination, CNMR / goAML reporting overlay, source-of-funds corroboration.' },
    { id: 'sanctions_maritime_dark_fleet', label: 'Maritime dark-fleet sanctions analysis', question: 'The shipment / vessel below shows dark-fleet indicators (AIS off, flag-state of convenience, ship-to-ship transfer, sanctioned-port call). Apply OFAC / UK OFSI / EU maritime advisories. Assess sanctions-evasion risk and map to Cabinet Res 74/2020 + 156/2025 UAE enforcement.' },
    // ── 100 further templates added 2026-04-21 (wave 2):
    //    trade finance, real estate, insurance, family office,
    //    luxury goods, payment services, investment funds, market
    //    abuse, fraud, and compliance operations. ──
    { id: 'tf_lc_ucp600', label: 'LC under UCP 600 — documentary compliance', question: 'Review the letter of credit below for documentary compliance under UCP 600 + AML overlay. Check presented-vs-required docs, strict-compliance threshold, discrepancy handling, bank\'s own-obligation, time windows, and any TBML red flags in the supporting commercial documents.' },
    { id: 'tf_standby_lc', label: 'Standby LC abuse pattern', question: 'Assess whether the standby letter of credit below is being used as a payment-of-last-resort in a TBML pattern. Evaluate: draw pattern, correlation with trade flows, beneficiary vs applicant common ownership, repeated short-dated SBLCs, cover-payment behaviour. Cite ISP98 + FATF TBML guidance.' },
    { id: 'tf_escrow', label: 'Escrow / structured-settlement review', question: 'The firm acts as escrow agent on the settlement below. Walk the KYC on both payer and payee, release conditions, triggering events, compliance checkpoints pre-release, tipping-off constraints per FDL Art.29, and withdrawal-at-risk thresholds.' },
    { id: 'tf_bank_guarantee', label: 'Bank guarantee / aval review', question: 'Review the bank-guarantee / aval instrument below for misuse risk. Consider: on-demand vs conditional terms, underlying commercial contract, counter-guarantee chain, draw triggers, and potential use as a value-transfer channel (rather than genuine risk-mitigation).' },
    { id: 'tf_forfaiting_factoring', label: 'Forfaiting / factoring risk', question: 'Assess the forfaiting / factoring transaction below for AML risk. Identify the underlying receivables, the true seller, the true buyer, any concealment of economic beneficiary, discount-rate consistency with market, and recourse-vs-non-recourse structure implications.' },
    { id: 'tf_open_account', label: 'Open-account settlement audit', question: 'Review the open-account trade pattern below. Without an LC or SBLC, verify: underlying goods / services evidence, delivery records, payment-to-delivery timing, counterparty continuity, pricing reasonableness. Open-account combined with emerging-market counterparties elevates TBML risk.' },
    { id: 'tf_structured_commodity', label: 'Structured commodity finance review', question: 'Review the structured-commodity-finance deal below (prepayment / tolling / warehouse-receipt-finance). Evaluate: collateral control, warehouse-operator independence, off-taker credit, hedging alignment, cross-border title flow, and opportunities for phantom-inventory fraud.' },
    { id: 'tf_trade_loan_collateral', label: 'Trade-loan collateral review', question: 'Assess the trade-loan collateral structure below. Verify: collateral existence, valuation independence, perfection of security, custody, release triggers, and whether the loan is genuinely financing a trade or is a disguised cash advance.' },
    { id: 'tf_lc_discrepancy_waiver', label: 'LC discrepancy-waiver pattern', question: 'The LC settlement below has a pattern of repeated documentary discrepancies waived by the applicant. Assess whether this waiver pattern is benign commercial practice or a compliance-evasion signal. Cite UCP 600 Art.14-16 and FATF TBML typologies.' },
    { id: 'tf_merchant_forfait_chain', label: 'Trade finance — multi-party forfait chain', question: 'The receivable has been forfaited and resold through 3 onward holders before final settlement. Reconcile each hop\'s transfer documentation, verify economic substance at each hop, identify any concealed beneficial ownership of the receivable, and apply FATF Rec 16.' },
    { id: 're_cash_purchase', label: 'Real estate — all-cash property purchase', question: 'The buyer proposes all-cash purchase of the UAE property below. Apply FATF real-estate high-risk typology: SoW corroboration, purchase-via-SPV review, rapid-resale risk, agent KYC, beneficial-owner identification on SPV side, price-vs-market benchmark.' },
    { id: 're_sponsor_upstream', label: 'Real estate — golden-visa-linked investment property', question: 'The property acquisition below is structured to qualify the buyer for a UAE golden-visa investor route. Verify: investment threshold compliance, property valuation independence, fund-source for the equity, ongoing holding requirement, exit-strategy implications for visa eligibility.' },
    { id: 're_offplan_payment_plan', label: 'Real estate — off-plan payment plan AML review', question: 'Review the off-plan property payment-plan below. Payments span 3-5 years, multiple instalments from potentially different sources. Evaluate each inbound against the buyer\'s SoF, source-country risk, third-party-payer controls, and AED 60K cross-border cash overlap.' },
    { id: 're_agent_dd', label: 'Real estate — agent AML compliance review', question: 'Assess the real-estate agent firm below for AML compliance under UAE DPMS-equivalent treatment and the agent\'s own licence obligations. Review: CDD on sides, source-of-funds verification, reporting obligations, record-keeping, agent-UBO.' },
    { id: 're_transfer_family', label: 'Real estate — intra-family transfer', question: 'The property is being transferred within a family (gift / inheritance / below-market sale). Assess whether the transfer is legitimate estate planning or AML-adjacent concealment. Check: consistency with estate-planning documents, tax filings, valuation independence, any PEP-nexus.' },
    { id: 're_reit_flow', label: 'Real estate — REIT / fund flow review', question: 'Review the investor inflow into the UAE-based REIT below. Apply investor KYC: UBO of feeder vehicles, source-of-funds, jurisdiction-risk, and structured-product overlay (where the REIT is packaged inside another wrapper).' },
    { id: 'ins_life_surrender', label: 'Insurance — life-policy early surrender', question: 'Assess the early-surrender request on the single-premium life policy below. Apply Joint Money Laundering Steering Group (JMLSG) life-insurance typologies: surrender penalty ignored, surrender to third-party account, surrender in cash, short-holding-period pattern. Cite UAE IA regulations + FATF Rec 10.' },
    { id: 'ins_single_premium', label: 'Insurance — large single-premium investment wrapper', question: 'Review the single-premium investment-wrapper policy below (premium AED 8M+). Verify: SoW of premium, UBO of the policyholder and life-insured, beneficiary identification, in-policy switching controls, and any assignment history.' },
    { id: 'ins_pep_life', label: 'Insurance — PEP life policy', question: 'The life-insurance policy below has a PEP as policyholder or life-insured. Scope the EDD: SoW corroboration, beneficiary identity, senior-management approval, ongoing monitoring cadence, FATF Rec 12 overlay to Wolfsberg PEP principles.' },
    { id: 'ins_claim_proceeds', label: 'Insurance — claim-proceeds payout review', question: 'A large claim proceeds payout is pending on the policy below. Verify: claim legitimacy, payee-account alignment with policy details, beneficiary identification, third-party assignment, SoF on any premium top-ups preceding the claim. Cite FATF Rec 10 + UAE IA guidance.' },
    { id: 'ins_reinsurance_xborder', label: 'Insurance — cross-border reinsurance flow', question: 'Review the reinsurance premium / claim flow below. Verify: reinsurer licensing, jurisdiction-risk, sanctions screening on the reinsurer, intermediary KYC, reasonableness of premium-cession ratios, and potential for the reinsurance channel to serve as a value-transfer layer.' },
    { id: 'ins_sanctions_nexus', label: 'Insurance — sanctions-nexus on policy parties', question: 'Screening has flagged the policy parties below against sanctions lists (policyholder, life-insured, beneficiary, claim-payee, broker). Walk the action under UAE EOCN + OFAC / OFSI / EU + industry war-exclusion clauses. Decide: void / exit / freeze / continue with blocking.' },
    { id: 'ins_ils_bond', label: 'Insurance-linked securities (catastrophe bond) review', question: 'The firm is distributing an ILS / catastrophe bond. Review: investor-side KYC, underlying reinsurance structure, trigger mechanism, sponsor / sponsor-affiliate transparency, and the ILS vehicle\'s own UBO and jurisdiction risk.' },
    { id: 'ins_life_settlement', label: 'Insurance — life-settlement market review', question: 'A customer proposes to buy / sell a life-settlement interest. Apply secondary-market policy-AML typology: original-policy origination integrity, assignment-chain, investor KYC, beneficial-interest transparency, jurisdiction risk.' },
    { id: 'ins_annuity_large', label: 'Insurance — large annuity purchase', question: 'The customer proposes a large annuity purchase (AED 12M+). Verify: SoW for the lump-sum, beneficiary identification, potential use as a wealth-concealment wrapper, early-surrender penalty structure, and whether annuity aligns with the customer\'s actual life-stage profile.' },
    // Wave 2 / batch 2 templates — family office + luxury + payments.
    { id: 'fo_single_family', label: 'Single-family office onboarding', question: 'Scope CDD for the single-family office below. Apply FATF Rec 10 + Cabinet Res 134/2025 + Wolfsberg PEP FAQ where family members are PEPs. Identify each beneficiary branch, concentrated-wealth indicators, cross-border holdings, private-trust-company layers, and philanthropic-conduit structures.' },
    { id: 'fo_multi_family', label: 'Multi-family office onboarding', question: 'Scope CDD for the multi-family office (MFO) below. Treat the MFO as the direct customer and apply downstream KYC on each underlying family. Apply FATF Rec 17 reliance principles where the MFO has performed CDD, and set the look-through obligation for each underlying investment.' },
    { id: 'fo_succession', label: 'Family office — succession event', question: 'The family office has undergone a succession event (patriarch deceased, intergenerational transfer, governance-handover). Re-verify UBO, beneficial-control, protector / enforcer roles, sensitivity of new decision-makers, and whether risk-appetite of the office has shifted materially.' },
    { id: 'fo_private_trust', label: 'Family office — private trust company', question: 'Review the private trust company (PTC) vehicle below. Apply FATF Rec 25 legal-arrangement transparency: settlor, PTC-directors, protector, beneficiary-class, PTC-director-appointment chain. Cite Cabinet Decision 109/2023 beneficial-ownership threshold and legal-arrangement disclosure.' },
    { id: 'fo_concentrated_position', label: 'Family office — concentrated single-stock position', question: 'The family office holds a concentrated single-stock / single-asset position (>30% of net worth). Review: origin of position, potential insider-status of family members vis-à-vis the underlying issuer, restricted-stock status, related-party trade history, and hedging / monetisation structures.' },
    { id: 'fo_philanthropy', label: 'Family office — philanthropy vehicle review', question: 'Review the charity / foundation attached to the family office. Apply FATF Rec 8 NPO risk framework: stated purpose, beneficiary transparency, geographic distribution, cross-border flows, grantmaking controls, trustee integrity, and any PEP-beneficiary overlap.' },
    { id: 'fo_art_collection', label: 'Family office — art collection under management', question: 'The family office has 180+ artworks under management. Apply EU 5AMLD art-dealer obligations + UAE-equivalent treatment. Scope: provenance records, freeport storage, insurance-valuation independence, sales-channel KYC, loan-to-institution chains, any price-manipulation indicators.' },
    { id: 'fo_yacht_jet', label: 'Family office — yacht / private-jet holding', question: 'The family office holds yachts / private jets via SPVs. Verify: flag-state risk, charter-flow KYC, crew-payment AML, real beneficial-ownership (not SPV-nominal), and whether any SPV has sanctioned-person linkage or unusual jurisdictional placement.' },
    { id: 'fo_next_gen_governance', label: 'Family office — next-gen governance review', question: 'The family office is transitioning decision-making to the next generation. Review new signatory authorities, new PEP-status implications (next-gen family members entering politics / appointments), revised risk-appetite, and any revisions to the CDD basis relied upon at original onboarding.' },
    { id: 'fo_cross_border_settlor', label: 'Family office — cross-border settlor trust', question: 'The trust has a settlor in jurisdiction A, beneficiaries in jurisdictions B-D, trustees in E, and UAE-based assets. Scope the multi-jurisdiction AML/CFT overlay including tax-residency declarations, CRS / FATCA reporting, and any jurisdiction-specific PEP treatment.' },
    { id: 'lux_art_dealer', label: 'Luxury — art dealer transaction', question: 'Review the art-dealer transaction below. Apply EU 5AMLD / UAE dealer-in-high-value-goods obligations (AED 55K threshold equivalent). Verify buyer / seller KYC, provenance chain, freeport storage touch, settlement channel (cash / crypto / escrow), and rapid-resale history.' },
    { id: 'lux_watch_dealer', label: 'Luxury — watch dealer transaction', question: 'The watch-dealer transaction below is AED 380K for a single high-end timepiece. Apply DPMS-equivalent AML treatment. Verify: buyer CDD, SoF, serial-number provenance, any re-sale / warranty-transfer history, and cross-border movement controls.' },
    { id: 'lux_classic_car', label: 'Luxury — classic-car dealer transaction', question: 'Apply AML due-diligence to the classic-car sale below (AED 4.6M). Identify buyer / seller, vehicle provenance, prior-owner chain, appraisal integrity, settlement channel, and whether title transfer matches beneficial-ownership change.' },
    { id: 'lux_yacht_broker', label: 'Luxury — yacht broker transaction', question: 'Review the yacht broker / intermediary transaction. Verify: vessel KYC (flag, build, registration), buyer / seller / broker KYC, SPV ownership layers, charter-history, sanctions-screening on all parties, and escrow / settlement flow.' },
    { id: 'lux_jewellery_export', label: 'Luxury — high-end jewellery export', question: 'Scope AML for the high-end jewellery export (AED 2.8M). Apply MoE Circular 08/AML/2021 + export-compliance overlay. Verify: provenance of stones, buyer KYC, shipment route, customs-value alignment, and any conflict-diamond (Kimberley Process) implication.' },
    { id: 'pay_msb_onboard', label: 'Payment — MSB / remittance agent onboarding', question: 'Scope CDD on the money service business / remittance agent applying to become a correspondent. Apply CBUAE rules + FATF Rec 14 + Cabinet Res 134/2025. Verify licence, MLRO, transaction-monitoring capacity, sanctions-programme, correspondent-network risk, and settlement channels.' },
    { id: 'pay_prepaid_card', label: 'Payment — prepaid-card programme review', question: 'Review the prepaid-card programme below. Apply FATF Rec 15 + CBUAE retail-payment guidance. Assess: loading limits, reloading rules, KYC at onboarding vs top-up, cross-border usage monitoring, sanctions-screening on cardholder + merchant legs.' },
    { id: 'pay_digital_wallet', label: 'Payment — digital-wallet operator review', question: 'Review the digital-wallet operator applying for services. Verify: licensing, BIN-sponsor relationship, KYC standards, transaction-monitoring capacity, velocity controls, and cross-border P2P exposure. Apply CBUAE Retail-Payment-Services framework + FATF Rec 16.' },
    { id: 'pay_bnpl_merchant', label: 'Payment — BNPL merchant-acquirer review', question: 'The BNPL lender is onboarding via the firm. Scope CDD: ownership, underwriting methodology, merchant-onboarding standards, consumer-complaint record, and AML risk in merchant-aggregator relationships (indirect onboarding chain).' },
    { id: 'pay_cross_border_rails', label: 'Payment — cross-border-rails compliance', question: 'The firm proposes to use an alternate cross-border payment rail (beyond SWIFT). Apply FATF Rec 16 + CBUAE + correspondent-bank Wolfsberg treatment. Verify: rail-operator KYC, Travel-Rule-equivalence, settlement-finality risk, and sanctions-screening coverage.' },
    { id: 'pay_merchant_acquirer', label: 'Payment — merchant acquirer book review', question: 'Audit the firm\'s merchant-acquirer book for AML risk. Identify: high-risk MCC codes, chargeback-rate outliers, merchants with BIN-spoofing patterns, dormant-then-active merchants, and any cross-border MCC mismatch with physical location.' },
    { id: 'pay_instant_rail_fraud', label: 'Payment — instant-rail fraud pattern', question: 'Review the instant-payment-rail activity for fraud patterns. Identify mule-account indicators, scale of first-party fraud (authorised push-payment scams), unusual velocity, beneficiary-concentration, and any emerging scam typology (romance / invoice / investment).' },
    { id: 'pay_agent_network', label: 'Payment — agent / sub-agent network', question: 'Audit the payment-service-provider\'s agent / sub-agent network. For each agent: licence, KYC on end-customers, AML-training, sanctions-screening posture, transaction-monitoring escalation. Report gaps that import AML risk via the agent layer.' },
    { id: 'pay_pix_equiv', label: 'Payment — PIX-equivalent fast-payment risk', question: 'Analyse fast-payment (PIX / UPI / FedNow analog) flows through the firm. Typical risks: authorised push-payment fraud, mule accounts, immediate irreversibility, reduced beneficiary-verification. Report control posture and escalation triggers.' },
    { id: 'pay_merchant_layering', label: 'Payment — merchant processor as layering channel', question: 'A merchant processor in the firm\'s network may be used as a layering channel (genuine-looking merchant activity concealing illicit flows). Review: chargeback anomalies, refund-to-original-source reversals, round-tripping across merchants, MCC-vs-actual-business mismatches.' },
    // Wave 2 / batch 3 templates — investment funds + market abuse + fraud.
    { id: 'fund_capital_call', label: 'Fund — capital-call inbound', question: 'Review the capital-call inbound from investor-LP. Verify: SoF consistent with subscription-time declarations, any intermediary side-letter vehicle, sanctions-screening, tax-residency, and any change-of-UBO since subscription.' },
    { id: 'fund_distribution', label: 'Fund — distribution to LP', question: 'Review the fund distribution to LP. Verify the payment account aligns with the LP\'s onboarding, no assignment-of-distribution-rights to third parties, sanctions-screening, and tax-withholding alignment.' },
    { id: 'fund_side_letter', label: 'Fund — side-letter discovery', question: 'A side-letter has been discovered granting preferential rights to a specific LP. Assess AML implications: MFN-clause impact, concealed-investor risk, and whether the LP\'s special terms mask a beneficial-ownership concealment.' },
    { id: 'fund_master_feeder', label: 'Fund — master-feeder through secrecy jurisdiction', question: 'Review the master-feeder fund structure where the feeder is in a secrecy jurisdiction. Apply look-through KYC: actual investor identity, feeder-vehicle independence, administrator KYC, tax-transparency implications, and any nominee-investor pattern.' },
    { id: 'fund_gp_carry', label: 'Fund — GP carry distribution', question: 'Review the GP-carry distribution below. Verify GP beneficial ownership, any promote-sharing side-arrangements with non-GP parties, sanctions-screening on the GP entity, and whether carry timing correlates with any compliance event.' },
    { id: 'fund_sub_fund', label: 'Fund — sub-fund AML segregation', question: 'The umbrella-fund structure has multiple sub-funds. Verify per-sub-fund AML controls: investor KYC segregation, sanctions-screening segregation, strategy-specific risk overlays, and any cross-subscription between sub-funds that could obscure investor origin.' },
    { id: 'fund_crypto_vehicle', label: 'Fund — crypto / tokenised fund review', question: 'Review the crypto / tokenised fund structure. Verify: token-holder KYC, on-chain transfer controls, whitelist/blacklist enforcement, VARA compliance, custody arrangement, and any cross-chain transfer implications.' },
    { id: 'fund_secondary_market', label: 'Fund — secondary-interest sale', question: 'A secondary-interest sale of LP interests is proposed. KYC the buyer and seller, verify the transfer conforms to fund documents, assess whether the secondary channel is being used as a value-transfer conduit, and apply FATF beneficial-owner transparency.' },
    { id: 'fund_nominee_investor', label: 'Fund — nominee investor review', question: 'A subscribing investor is a nominee for an undisclosed principal. Apply Cabinet Decision 109/2023 nominee-transparency + FATF Rec 24-25. Require documentary disclosure of the principal and evaluate whether to accept the nominee arrangement or exit.' },
    { id: 'fund_charter_redemption', label: 'Fund — large redemption request', question: 'A large redemption has been requested by an investor. Verify: proceeds-account aligns with subscription records, any assignment-of-redemption-proceeds, sanctions-screening, and whether the timing or amount is inconsistent with the investor\'s prior pattern.' },
    { id: 'market_insider', label: 'Market abuse — insider-dealing detection', question: 'Assess whether the trading pattern below is consistent with insider-dealing. Look for: timing vs corporate-action calendar, trader relationship to issuer-insiders, atypical size relative to account history, and cross-account coordination.' },
    { id: 'market_front_running', label: 'Market abuse — front-running', question: 'Test the trading pattern for front-running. Identify pre-trade activity that positions to benefit from pending client trade flow, related-party trades, option positioning, and cash pre-positioning. Cite market-abuse + AML overlap.' },
    { id: 'market_spoofing', label: 'Market abuse — spoofing / layering', question: 'Detect spoofing / layering in the order book below. Look for bid/ask layers placed and cancelled before execution, asymmetric order-to-trade ratios, and the cancel-before-fill pattern. Score the evidence and recommend disposition.' },
    { id: 'market_wash_trade', label: 'Market abuse — wash / circular trade', question: 'Scan the trade log for wash / circular trades. Identify same-beneficial-owner on both sides, cyclic volume patterns, and round-tripping through related accounts. Report market-abuse classification and AML-overlap.' },
    { id: 'market_painting', label: 'Market abuse — painting the tape', question: 'Evaluate the trading pattern for painting-the-tape behaviour (synthetic volume to mislead the market). Check period-end / publication-window concentration, cross-account coordination, and price-vs-volume correlation anomaly.' },
    { id: 'market_cornering', label: 'Market abuse — cornering / squeeze', question: 'Assess whether the position-build-up is consistent with cornering / short-squeeze intent. Examine: position size vs float, cross-venue aggregation, counter-position in derivatives, and the holder\'s prior market-abuse history.' },
    { id: 'market_pnd', label: 'Market abuse — pump-and-dump', question: 'Detect pump-and-dump pattern in the low-float security below. Look for: coordinated promotion, synthetic-volume ramp, insider-distribution at peak, social-media signal, and post-distribution collapse. Apply market-abuse regime + AML overlap.' },
    { id: 'market_churning', label: 'Market abuse — churning', question: 'Evaluate the adviser\'s trading pattern for churning (excessive trading to generate commissions). Compute turnover-ratio, cost-to-equity ratio, and in-and-out round-trip trades. Compare to the client\'s investment objective and best-execution obligation.' },
    { id: 'market_kiting', label: 'Market abuse / operational — kiting', question: 'Evaluate the cross-account / cross-bank transfer pattern for kiting. Look for float-exploitation, circular transfers without settlement finality, and inflated balance displays. Distinguish operational from deliberate kiting intent.' },
    { id: 'fraud_bec', label: 'Fraud — business email compromise', question: 'A change-of-bank-details request has been received shortly before a large payment. Assess BEC indicators: email-domain analysis, request-timing, beneficiary-newness, counterparty-verification call-back evidence. Decide: hold / verify / release / escalate.' },
    { id: 'fraud_app_scam', label: 'Fraud — authorised push-payment scam', question: 'The customer reports after-the-fact that a payment they authorised was induced by deception. Apply APP-scam protocol: recovery attempt, beneficiary-bank notification, Contingent Reimbursement Model equivalence, STR consideration, and future-protective controls on the customer.' },
    { id: 'fraud_romance_scam', label: 'Fraud — romance scam pattern', question: 'The customer is sending atypical payments to a beneficiary they describe as an online relationship. Assess romance-scam indicators: escalating amounts, multiple excuses, never-met-in-person, narrative consistent with known scam playbooks. Decide intervention approach.' },
    { id: 'fraud_investment_scam', label: 'Fraud — investment-scam pattern', question: 'The customer is buying into an investment opportunity with traits of a scam (guaranteed high returns, urgency, unregulated platform, withdraw-to-qualify tier). Apply ScamSmart / FCA / CBUAE patterns. Decide intervention and escalation.' },
    { id: 'fraud_identity_theft', label: 'Fraud — identity theft indicators', question: 'Assess whether the activity is consistent with identity theft (compromised credentials, atypical device, atypical geolocation, unusual request patterns). Determine whether to pause access, force re-authentication, and notify the customer via out-of-band channel.' },
    { id: 'fraud_synthetic_id', label: 'Fraud — synthetic-identity detection', question: 'Evaluate the onboarding application for synthetic-identity indicators: recently-built footprint, name / ID-mismatch patterns, address-history discontinuity, phone-number velocity, SIM-swap signal. Decide onboard / reject / enhanced verification.' },
    // Wave 2 / batch 4 templates — compliance operations + MLRO review.
    { id: 'ops_alert_triage', label: 'Ops — monitoring-alert triage', question: 'Triage the monitoring alert below. Classify: false positive / low-risk / escalate / open case. Apply the firm\'s RBA alert-scoring. Report: 3-line rationale, supporting evidence, and the analyst\'s next action.' },
    { id: 'ops_alert_aging', label: 'Ops — aging-alert backlog risk', question: 'Assess the aging-alert backlog. For each alert >30 days unactioned, classify cause (resource / data / complexity / ownership), quantify regulatory-SLA exposure, and recommend prioritisation.' },
    { id: 'ops_false_positive', label: 'Ops — false-positive reduction plan', question: 'The firm\'s false-positive rate on monitoring rule X is 94%. Scope a reduction plan: rule-tuning, threshold review, segment-specific treatment, and validation evidence. Preserve the true-positive discovery rate.' },
    { id: 'ops_tuning_governance', label: 'Ops — rule-tuning governance', question: 'Assess governance around transaction-monitoring rule changes: change-proposal template, effectiveness-testing before/after, back-testing, sign-off chain, documentation retention per FDL Art.24.' },
    { id: 'ops_dashboard_kpi', label: 'Ops — compliance dashboard KPI audit', question: 'Audit the firm\'s compliance dashboard for KPI coverage, data freshness, calculation accuracy, and drill-down integrity. Map each KPI to its regulatory driver and identify missing KPIs.' },
    { id: 'ops_pen_test_aml', label: 'Ops — AML process pen-test', question: 'Design a controlled pen-test of the firm\'s AML process (onboarding bypass, alert-evasion, structuring-detection). Specify test scenarios, success criteria, rollback, regulator-notification posture, and documentation.' },
    { id: 'ops_segmentation_model', label: 'Ops — customer-segmentation model review', question: 'Review the customer-segmentation model driving monitoring rule selection. Assess: segmentation variables, model drift, transition-churn, mis-segmentation rate, and regulatory defensibility.' },
    { id: 'ops_tm_calibration', label: 'Ops — transaction-monitoring calibration', question: 'Calibrate transaction-monitoring thresholds against current risk posture, peer benchmarks, and prior-year productive-alert statistics. Propose new thresholds, expected alert volume, and coverage.' },
    { id: 'ops_model_validation', label: 'Ops — model validation (risk-scoring)', question: 'Validate the risk-scoring model in use. Evaluate: training-data currency, feature drift, stability, back-testing, fairness, and explainability. Report gaps and proposed remediation.' },
    { id: 'ops_outsourced_ctl', label: 'Ops — outsourced-control review', question: 'Assess the outsourced control (screening / monitoring / KYC). Verify: provider SOC-2, contractual AML clauses, data-residency, audit-rights, exit-plan. Apply FATF Rec 17 reliance + CBUAE outsourcing.' },
    { id: 'mlro_str_review', label: 'MLRO — STR draft review', question: 'Review the STR draft below before filing. Check: Who-What-When-Where-Why-How completeness, citation, deadline compliance "without delay" (FDL Art.26-27), Art.29 tipping-off guardrails, and goAML schema alignment.' },
    { id: 'mlro_four_eyes', label: 'MLRO — four-eyes review with reversal right', question: 'Four-eyes approval on the decision below. Challenge key assumptions, stress-test regulatory citations, confirm / reverse with specific objection. Reversal must include a concrete alternative action.' },
    { id: 'mlro_override', label: 'MLRO — override of first-line decision', question: 'The MLRO is considering overriding a first-line decision. Document: first-line rationale, evidence gap, MLRO\'s counter-reasoning, governance basis for override, and written record for audit.' },
    { id: 'mlro_training_refresh', label: 'MLRO — training refresh after circular', question: 'A new MoE / CBUAE / VARA circular requires a firm-wide training refresh. Scope: content, delivery channel, role-coverage, completion deadline (30 days per CLAUDE.md), attestation, record-keeping.' },
    { id: 'mlro_regulator_briefing', label: 'MLRO — regulator-briefing preparation', question: 'Prepare an MLRO briefing for an upcoming regulator meeting. Cover: risk-profile, STR volumes, sanctions freezes, open-audit-findings, policy changes since last meeting. Anchor each point to a regulatory basis.' },
    { id: 'mlro_board_report', label: 'MLRO — quarterly board report', question: 'Compose the MLRO quarterly board report. Include: risk-appetite adherence, KRI trends, STR/CTR volumes, sanctions activity, open audit findings, resource adequacy. Cite Cabinet Res 134/2025 Art.5 and FDL Art.20-21.' },
    { id: 'mlro_risk_appetite_change', label: 'MLRO — risk-appetite change assessment', question: 'The firm is considering changing its risk appetite (sector / jurisdiction / product). Assess the AML implications: customer-book re-tiering, policy updates, training, system changes, regulator-notification.' },
    { id: 'mlro_annual_risk_assessment', label: 'MLRO — annual AML/CFT risk assessment', question: 'Scope the annual enterprise-wide AML/CFT/CPF risk assessment per Cabinet Res 134/2025 Art.5. Cover: customer-segmentation, product-channel matrix, jurisdiction matrix, typology update, control-effectiveness, residual risk.' },
    { id: 'mlro_regulator_rfi_response', label: 'MLRO — regulator RFI response', question: 'Draft the response to the regulator information request. Ensure: full responsive scope, privileged / carve-out handling, evidence-pack assembly, sign-off chain, and record retention per FDL Art.24.' },
    { id: 'mlro_ai_governance_self', label: 'MLRO — AI-governance self-audit', question: 'Audit the firm\'s AI-assisted compliance decisions against EU AI Act Art.14 + NIST AI RMF + ISO/IEC 42001 + UAE AI Ethics. Identify any black-box decision, auto-action without four-eyes, training-data bias, explainability gap.' },
    { id: 'audit_lookback', label: 'Audit — lookback sample design', question: 'Design a 12-month lookback sample to test a specific control. Specify: population, sampling methodology (random / risk-weighted), sample size, acceptance thresholds, deviation-handling, and re-test plan if deviation rate is elevated.' },
    { id: 'audit_finding_remediation', label: 'Audit — finding remediation tracking', question: 'Track remediation of the identified audit finding. Verify: root-cause, corrective action, preventive action, owner, deadline, testing evidence. Re-audit after remediation to confirm closure before reporting to regulator.' },
    { id: 'audit_independent_assurance', label: 'Audit — independent-assurance scope', question: 'Scope the independent-assurance engagement for the AML programme. Cover: risk-assessment process, policy adequacy, control effectiveness, STR filing quality, sanctions / UBO coverage, training, and governance.' },
    { id: 'audit_data_sampling', label: 'Audit — data-sampling integrity', question: 'Assess the integrity of the audit\'s data sample. Verify: sample-frame alignment with population, random/risk-weighted selection evidence, no cherry-picking, documented exclusions, and evidence-retention of the sample.' },
    { id: 'incident_lessons_learned', label: 'Incident — lessons-learned synthesis', question: 'Synthesise lessons learned from the resolved incident. For each root cause, detail: what happened, why, what control failed, what remediation, what monitoring. Feed findings into policy-update and training-refresh workstreams.' }
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
    },
    // ── +12 additional scenario presets added 2026-04-21, covering
    //    VASP mixer exposure, TBML phantom shipment, round-tripping,
    //    cuckoo smurfing, PF / dual-use goods, charity TF, adverse
    //    media tiered sources, golden-visa nexus, multi-jurisdiction
    //    UBO chain, free-zone red flags, cross-border cash AED 60K,
    //    and nested correspondent account. Designed to exercise the
    //    expanded reasoning modes (Bayesian, counterfactual,
    //    reflective, adversarial-debate, chain-of-verification). ──
    {
      id: 'vasp_mixer',
      label: 'VASP flow through Tornado Cash',
      question: 'The inbound crypto flow passed through a sanctioned mixer. Is continued processing permitted? What filings and freeze actions apply?',
      context: 'Customer Z: UAE-resident retail investor, VARA-compliant VASP account active since 2024. On 14 Apr 2026 received 4.2 ETH traced on-chain through Tornado Cash (OFAC SDN designated Aug 2022) originating from a wallet cluster labelled "phishing proceeds" by three chain-analytics providers. Customer purpose declaration: "DeFi yield farming"; no Travel-Rule originator data.'
    },
    {
      id: 'tbml_phantom',
      label: 'TBML — phantom shipment invoice',
      question: 'Does the invoice below evidence a phantom-shipment TBML typology? What additional evidence would confirm or rule it out?',
      context: 'Customer P: UAE free-zone gold-trading LLC. Invoice 2026-0412 declares 120kg of 22k gold scrap purchased from Zambian supplier for AED 21.8M. Shipping documents show Emirates SkyCargo AWB weight: 4.6kg total. No mining licence copies on file for the supplier. Prior two invoices on the same supplier also show weight-vs-value anomalies.'
    },
    {
      id: 'round_trip_hk',
      label: 'Round-tripping via Hong Kong',
      question: 'Is this a round-tripping pattern? What citation supports the finding?',
      context: 'Customer Q: UAE free-zone entity. Pattern since Jan 2026: monthly outbound wire AED 4.5M to Hong Kong trading company HK-Co A. Within 7 days: inbound wire AED 4.3-4.5M from HK-Co B (different name, different address, but UBO chain traces back to the same Monaco-resident natural person who is also Customer Q\'s UBO). Declared purpose of both flows: "inventory settlement".'
    },
    {
      id: 'cuckoo_smurf',
      label: 'Cuckoo smurfing signature',
      question: 'Does the pattern below fit the cuckoo-smurfing typology? What controls should the firm activate?',
      context: 'Customer R: UAE SME trader, personal account. Pattern over 6 weeks: 11 third-party cash deposits totalling AED 489K, from 11 distinct unrelated individuals with no declared connection to Customer R. Each deposit matched within 24 hours by Customer R outbound wire of ~40K to an Indian trading company. Customer R\'s declared turnover: AED 600K/yr.'
    },
    {
      id: 'pf_dual_use_goods',
      label: 'PF / dual-use goods export',
      question: 'Does the shipment below raise proliferation-financing concerns under Cabinet Res 156/2025 and UNSCR 1540?',
      context: 'Customer S: Dubai-based trading company. Outbound shipment: 400kg of isostatic graphite (Wassenaar Arrangement dual-use Category 1), destination declared as a Southeast Asian distributor, end-user documentation naming an unlisted entity with a registered office at a residential address. Purchase paid AED 1.2M via wire from a Cypriot intermediary.'
    },
    {
      id: 'charity_tf',
      label: 'Charity payouts — TF indicators',
      question: 'Do the charity payouts below trigger FATF Rec 8 concerns? Is an STR warranted?',
      context: 'Customer T: UAE corporate, AED 400M annual turnover. Recent pattern: monthly AED 180-220K charitable donations to a UK-registered charity (Cause-for-Conflict Foundation). Charity\'s declared beneficiaries: schools in a conflict-affected zone. Three of the named school administrators appear on open-source adverse media tied to a designated group. Donation receipts show subject gave cash to a UAE intermediary who then wired to the UK charity.'
    },
    {
      id: 'adverse_media_tier2',
      label: 'Adverse media — tier-2 press hit',
      question: 'How should the firm treat this adverse-media hit? Does it meet the threshold for EDD uplift or STR consideration?',
      context: 'Customer U: UAE corporate client of 4 years, no prior adverse indicators. Adverse-media scan 18 Apr 2026 surfaced a 2024 article in a mid-tier European business weekly naming the UBO as under preliminary investigation in a Cypriot bribery case. No charges filed; investigation status unclear. One blog reference from an anonymous source (tier-4). No regulator sanction list hit. Identity match: name + DOB + nationality confirmed.'
    },
    {
      id: 'golden_visa',
      label: 'Golden-visa investor onboarding',
      question: 'Scope the EDD requirements for this golden-visa investor.',
      context: 'Prospective client: Russian-national investor, UAE golden-visa granted 2023 on the basis of AED 2M real-estate investment. Currently seeking to open a bullion-trading account with planned turnover AED 80M/yr. Declared SoW: inherited family assets + real-estate portfolio. No adverse media at this time. Note: FATF Feb 2024 statement re Russian-nexus residency-by-investment schemes in scope.'
    },
    {
      id: 'multi_jur_ubo',
      label: 'Multi-jurisdictional UBO chain (4 layers)',
      question: 'How should the firm handle UBO due-diligence on a four-layer offshore chain?',
      context: 'Customer V: UAE free-zone LLC. Ownership: 100% held by Cayman SPV → 100% Jersey Trust (discretionary) → Jersey trustee company → named settlor (Lebanese resident). Declared UBO: the settlor. Jersey trustee refuses to confirm current beneficiary list citing trust privacy. Cayman registry returns nominee directors only. Customer V declines to provide letters of wishes.'
    },
    {
      id: 'free_zone_red_flags',
      label: 'Free-zone red-flag cluster',
      question: 'Is the pattern of free-zone licensing below diagnostic of UBO concealment?',
      context: 'Related-party cluster: six free-zone entities across three UAE free zones. Each registered to the same UBO, each declaring different (sometimes overlapping) commercial activity. Three share the same registered address. One licence expired and was re-registered as a new entity with a slightly altered name the same week. Combined transit through the firm: AED 34M in 10 months.'
    },
    {
      id: 'cross_border_cash_60k',
      label: 'Cross-border cash AED 60K near-threshold',
      question: 'Does the cross-border cash movement below trigger the declaration threshold? What filings apply?',
      context: 'Passenger W: UAE resident returning from Zurich 19 Apr 2026. Declared cash carried on entry: AED 58K. Secondary-inspection count: AED 74K in a mix of CHF, EUR, USD, AED. Passenger held two additional undeclared gold bars (cumulative 100g, assessed AED 28K). No prior declarations in the CNMR history.'
    },
    {
      id: 'nested_correspondent',
      label: 'Nested correspondent relationship',
      question: 'How should the firm treat the nested-account indicator below?',
      context: 'The firm\'s correspondent-banking relationship with Bank K (jurisdiction: FATF grey-listed) has, over Q1 2026, processed wires from at least five sub-banks not named in the original onboarding. Three of the sub-banks\' customers appear in onward-wire remitter fields with no evidence of KYC on the originator. Wolfsberg Correspondent Banking Principles require transparency on nested relationships.'
    },
    // ── 100 additional scenario presets added 2026-04-21: DPMS retail,
    //    bullion / refiner, VASP / crypto, TBML subtypes, PEP / RCA,
    //    sanctions edge cases, UBO / trust / foundation, NPO / TF,
    //    cross-border cash, and correspondent / payment. ──
    { id: 'dpms_retail_micro_structure', label: 'DPMS retail micro-structuring', question: 'Is this a structuring pattern and what filings apply?', context: 'Retail DPMS Dubai Gold Souk, 3 weeks Jan-Feb 2026. Customer D: 11 cash purchases AED 52K-54K each, all same seller, no repeated ID capture above 55K threshold. Declared income: AED 240K/year retail-staff. Purchases uniformly just below MoE Circular 08/AML/2021 threshold.' },
    { id: 'dpms_retail_buyback', label: 'DPMS retail buy-back pattern', question: 'Does the sell-back pattern justify an STR?', context: 'Customer E bought AED 680K gold jewellery in Jan 2026 via four cash tranches just below CTR. Returned 18 Apr 2026 to sell 70% back for bank-wire settlement; wire destination is a Hong Kong trading LLC with no prior relationship. Resale value declared at purchase price — no expected margin loss explained.' },
    { id: 'dpms_retail_expatriate_cash', label: 'Expatriate cash windfall', question: 'What CDD tier and SoF evidence apply?', context: 'Customer F: long-term UAE resident, declared annual income AED 180K domestic-worker. Walked into DMCC showroom 12 Apr 2026 with AED 420K cash for bullion purchase. States inheritance from deceased uncle in home jurisdiction; no documentary evidence on hand. Requests collection in two days.' },
    { id: 'dpms_retail_third_party_payer', label: 'Third-party payer at DPMS counter', question: 'How should the firm treat the third-party payer?', context: 'Customer G buys AED 92K bullion for ID declared as his own. Payment made on-counter by unrelated individual (stated cousin) using POS card registered to a UAE-based LLC. No prior customer account for either party. Receipt issued to Customer G.' },
    { id: 'dpms_retail_rapid_resale', label: 'Rapid sale-and-return', question: 'Is this a wash / cleaning typology?', context: 'Customer H: 8 purchases of gold coins 5g-25g each at different Souk stalls within 4 hours on 15 Apr 2026. Cumulative AED 74K. Returned to firm later same day offering bulk sale for single bank wire to a third-party UAE LLC account. Coin hallmarks mixed (Emirates Gold / PAMP / UAE 999 generic).' },
    { id: 'dpms_retail_franchise_chain', label: 'Franchise chain — repeated 54K', question: 'Does the cross-branch aggregation trigger a CTR?', context: 'DPMS retail franchise (4 branches DXB + 2 AUH). Customer I appears at 5 of 6 branches over 12 days, each time purchasing AED 51-54K cash. No repeat ID trigger per-branch; aggregation logic not enabled. Cumulative 5-branch spend AED 268K. Customer declines loyalty enrolment.' },
    { id: 'dpms_retail_digital_gold', label: 'Digital-gold pull + physical redeem', question: 'How does the digital layer change the CDD?', context: 'Customer J opened a digital-gold account (non-VASP, DMCC-regulated platform) Feb 2026 with AED 340K funded by third-party UAE LLC wire. On 18 Apr 2026 requested physical redemption at DPMS outlet. Physical handover point has no independent UBO evidence on the LLC funder.' },
    { id: 'dpms_retail_cash_courier', label: 'Courier-delivered cash purchase', question: 'Is the courier-delivery model compatible with CDD?', context: 'Customer K (non-resident, visiting UAE 10 days) instructed DPMS retailer to accept cash delivered by a named courier (AED 128K) and hold goods until pickup. No prior courier-KYC. Customer requests invoice in the courier\'s name. Cash packaging labelled as a foreign-exchange bureau receipt.' },
    { id: 'dpms_retail_wedding_batch', label: 'Bulk wedding-gold pickup', question: 'How do we evidence the purpose and SoF?', context: 'Customer L booked AED 910K of wedding-gold over 3 weeks under "family wedding" purpose. Collection by 3 different named family members over 5 days, mixed cash + multiple UAE-bank cheques from different signatories. Marriage licence on file but family-structure representation shifts between visits.' },
    { id: 'dpms_retail_golden_visa_shopper', label: 'Golden-visa holder premium purchase', question: 'What EDD overlay applies for this golden-visa profile?', context: 'Customer M holds UAE golden visa (investor route, AED 2M real-estate). Quarterly purchases Jan-Apr 2026 total AED 1.6M in investment bullion. Payment split: 40% personal-wire + 60% third-party LLC-wire (declared wholly-owned by M but incorporation docs pending). Requested stored-vault arrangement off-site.' },
    { id: 'bullion_wholesale_loco_split', label: 'Wholesale bullion loco-split settlement', question: 'Does the loco-swap leg alter the sanctions posture?', context: 'Firm-to-firm bullion trade 19 Apr 2026: 50kg delivery loco-Dubai, paid loco-London unallocated to counterparty N. Counterparty is DMCC-licensed with UBO residing in a FATF-grey jurisdiction. Settlement platform lists a London correspondent with recent secondary-sanctions enforcement history.' },
    { id: 'bullion_refiner_recycled_scrap', label: 'Refiner recycled-scrap intake', question: 'What DD gap applies to the scrap origin?', context: 'Refiner client O intakes 240kg recycled scrap over Feb-Apr 2026; origin declared "mixed secondary" from three UAE aggregators. One aggregator\'s UBO list refreshed 12 Apr 2026 and now includes a PEP from a CAHRA jurisdiction. Assay variance on lot 3 exceeds tolerance; origin-certificate scans low-resolution.' },
    { id: 'bullion_dore_drc_asm', label: 'Dore from DRC artisanal source', question: 'Is the continuation defensible under LBMA RGG?', context: 'Refiner intake: 14kg Dore bars from North Kivu artisanal (ASM) source, offered 18 Apr 2026. No LBMA accreditation. OECD DD Step 2 attestation present but CAHRA flag-check incomplete. Prior 2024 intake from adjacent Uganda refiner now appears in ICGLR non-compliance bulletin.' },
    { id: 'bullion_hallmark_mismatch', label: 'Hallmark / assay mismatch on intake', question: 'What hallmark-disposition applies?', context: 'Refiner intake 15 Apr 2026: 8kg bars stamped "Emirates Gold 999". Independent assay returns 986 fineness. Declared seller is new DMCC-licensed reseller (incorporation 2025). Seller UBO matches a director of a 2023 entity dissolved for regulatory infractions in the Souk.' },
    { id: 'bullion_dgd_refiner_deaccred', label: 'DGD refiner de-accreditation risk', question: 'What posture applies while de-accreditation is pending?', context: 'Counterparty refiner P lost LBMA Good Delivery status Mar 2026 pending review. Firm has inventory 120kg of P\'s prior production. DGD standard in Dubai still recognises P conditionally. Active open orders for P\'s March-April lots under contract, settlement 29 Apr 2026.' },
    { id: 'bullion_vault_custody_transfer', label: 'Vault custody transfer (unallocated → allocated)', question: 'What identity-continuity evidence is required?', context: 'Customer Q converted 180kg unallocated metal to allocated 29 Mar 2026, new bar-list issued with specific serials. On 19 Apr 2026 Q instructs transfer of 60kg allocated to new beneficial owner (sibling, different jurisdiction) with no customer-prior-relationship. Bar-serial chain-of-custody must remain intact under DMCC Vault standard.' },
    { id: 'bullion_letter_of_credit_gold', label: 'Gold-backed letter of credit (TBML signal)', question: 'Is the LC pattern consistent with TBML?', context: 'Firm acts as advising bank on a USD 11M LC for Hong Kong-based importer. Underlying: 180kg scrap-gold export from a Dubai LLC. LC terms require docs-against-payment at destination. Exporter invoice price matches LBMA PM fix but insured value in customs declaration is 42% below invoice. Freight route via a low-inspection port.' },
    { id: 'bullion_good_delivery_dispute', label: 'Good-delivery standard dispute', question: 'How to resolve the delivery dispute without collapsing DD?', context: 'Refined lot delivered to counterparty R (DMCC-licensed jeweller) fails independent re-assay (987 vs 999 declared). Firm inspects and finds one bar in the lot carries an intact but mis-applied hallmark. Refiner requests swap with replacement bars and confidentiality. Dispute amount AED 1.6M, pending 5-day settlement.' },
    { id: 'bullion_cross_border_transit', label: 'Cross-border transit via FTZ', question: 'What FTZ-layer ML risk applies?', context: 'Firm moves 80kg bullion from DMCC vault through JAFZA bonded corridor for re-export to Singapore over 12 Apr 2026. Intermediate FTZ holding duration 9 days (declared re-export prep). Re-invoice value at FTZ exit is 3% above entry invoice. Freight forwarder recently onboarded with partial UBO file.' },
    { id: 'bullion_letter_box_supplier', label: 'Letter-box refiner supplier', question: 'Is this refiner a letter-box entity?', context: 'Supplier S (registered in a free zone) has no visible physical premises, shared registered agent with 14 unrelated entities, no employees on record, website published in Jan 2026, but has billed AED 22M of refined bullion Feb-Apr 2026. Bank account at a FATF-grey-jurisdiction correspondent. Declared UBO resident in secrecy jurisdiction.' },
    { id: 'vasp_sanctioned_wallet', label: 'VASP — sanctioned-wallet brush', question: 'Is freeze required and over what scope?', context: 'Customer T (VARA-regulated VASP client) received 12 ETH 18 Apr 2026 from a wallet cluster linked by Chainalysis to OFAC SDN designation (EO 14024 Russia). Customer\'s hot wallet holds 128 ETH total; 18 ETH outbound transaction is pending to Binance. Deposit entered via native Ethereum, no bridge hop.' },
    { id: 'vasp_mixer_inbound', label: 'VASP — mixer-inbound deposit', question: 'What is the disposition for mixer-traced funds?', context: 'Deposit 0.8 BTC on 17 Apr 2026 traced through ChipMixer residual cluster (partial attribution, 68% confidence). Customer U has 4-month history of small-value deposits and two prior alerts (Feb 2026) on Tornado.Cash residual. Current balance 2.4 BTC. Withdrawal request pending to a Binance account.' },
    { id: 'vasp_travel_rule_missing', label: 'VASP — Travel-Rule missing originator', question: 'Hold, return, or request remediation?', context: 'Incoming VA transfer 45 ETH 19 Apr 2026 on behalf of Customer V. Travel-Rule payload missing originator physical address and originator account number. Originator VASP is FATF-grey-jurisdiction-based, published ETA guarantee in prior months. Amount above AED 3K Travel-Rule floor.' },
    { id: 'vasp_bridge_wrapped_hop', label: 'VASP — bridge / wrapped-asset hop', question: 'Score evasion likelihood across the hop sequence.', context: 'Flow 16-18 Apr 2026: native BTC 3.2 → wrapped WBTC via external bridge → Ethereum → swapped via DEX to renBTC → back to BTC via second bridge. Five separate protocol touches. Two protocols have prior Chainalysis flags for wash/evasion. Final BTC address matches a cluster with adverse-media press mentions.' },
    { id: 'vasp_stablecoin_large_redemption', label: 'Stablecoin large redemption', question: 'What reserve-transparency risk applies?', context: 'Customer W requests USDT→AED settlement AED 14.5M on 20 Apr 2026. Issuer has partial reserve-audit lag (last audit attested Q3 2025). Prior redemption cadence for W: AED 150K monthly. Source: declared liquidated holdings from a prior ICO participation (2021). No prior tax / exchange statement.' },
    // Batch 2/4 — VASP tail + TBML + PEP/RCA.
    { id: 'vasp_privacy_coin_swap', label: 'VASP — privacy-coin swap leg', question: 'What posture applies to the XMR/ZEC leg?', context: 'Customer X attempted swap ETH→XMR via a non-KYC counter on 18 Apr 2026 (AED 420K equivalent). After two-hop Monero transit, XMR was swapped back to BTC via a second non-KYC platform and deposited into the firm. De-anonymisation evidence inconclusive; platform selection is historical pattern across 6 prior deposits.' },
    { id: 'vasp_darknet_cluster', label: 'VASP — darknet-cluster inbound', question: 'What scope of freeze / STR applies?', context: 'Deposit 2.1 BTC on 19 Apr 2026 from a wallet cluster with 0.74 Chainalysis attribution to a defunct darknet marketplace (2022). Customer Y has clean 14-month history, no prior alerts. Withdrawal request pending AED 720K to UAE bank account; the bank is a correspondent partner with its own STR-exposure policies.' },
    { id: 'vasp_chain_hop_evasion', label: 'VASP — five-chain evasion sequence', question: 'Score the evasion likelihood.', context: 'Sequence 13-20 Apr 2026: BTC→WBTC (bridge A)→Ethereum→USDT (Uniswap)→BSC (bridge B)→USDT-BSC→Avalanche (bridge C)→USDC.e→redeem-to-fiat. Each hop adds 4-12 minutes. Flow originator is a wallet attributed to a FATF-grey-jurisdiction exchange with known Travel-Rule gaps.' },
    { id: 'vasp_nft_layering', label: 'VASP — NFT wash / layering', question: 'Is this a layering pattern via NFT trades?', context: 'Customer Z between Feb-Apr 2026 minted 14 NFTs on Ethereum, sold same-artist set to three wallets later attributed to Z by blockchain analytics. Gross settlement USDT 620K rotated through the wallets; firm processed redemptions totalling AED 1.8M. All purchases at suspiciously uniform floor prices.' },
    { id: 'vasp_defi_flash_layering', label: 'VASP — DeFi flash-loan layering', question: 'Does the flash-loan pattern warrant STR?', context: 'Wallet attributed to Customer AA executed 9 flash-loan cycles on Aave + Compound on 17 Apr 2026. Loans fully repaid in-block but used to shift 3,400 ETH through intermediary DEX pools, with a 0.4% spread captured to a separate wallet later funded back into Customer AA\'s account via a CEX. Scale: AED 12M rotational.' },
    { id: 'tbml_over_invoice_textile', label: 'TBML — textile over-invoicing', question: 'Is the invoice consistent with market value?', context: 'Exporter BB invoices a Dubai-based importer USD 2.8M for 14,000m industrial-weight polyester Apr 2026. Market price for the same grade: USD 1.4M. Declared margin 2%. Importer is a new DMCC LLC with three directors sharing an address with 18 other LLCs. LC advised via a FATF-grey-jurisdiction bank.' },
    { id: 'tbml_under_invoice_electronics', label: 'TBML — electronics under-invoicing', question: 'Does the under-invoicing pattern trigger STR?', context: 'Wholesale electronics importer CC declares USD 180K per 40-foot container for imported smartphones Apr 2026. Customs re-valuation estimates USD 420K. Beneficiary of the 57% differential is a Hong Kong trading LLC wholly owned by a UAE-resident PEP\'s close associate. Freight pattern consistent over 4 months.' },
    { id: 'tbml_phantom_shipment_steel', label: 'TBML — phantom-shipment steel', question: 'Any evidence the shipment actually moved?', context: 'Exporter DD invoiced USD 6.2M for 3,800 MT steel rebar shipped Jebel Ali→Istanbul on 14 Apr 2026. Bill of lading references a vessel not listed at Jebel Ali on that date per port authority log. Warehouse weight receipt shows stock intact. Importer pre-paid wire AED 22.8M to exporter. Phantom-shipment suspicion.' },
    { id: 'tbml_multiple_invoice_gold', label: 'TBML — multiple-invoicing gold', question: 'How many of the invoices correspond to genuine shipments?', context: 'Refiner EE issued three invoices Feb-Apr 2026 for the same 42kg bullion lot to three different buyers across DMCC, Singapore, and Hong Kong. Only one physical shipment recorded at Dubai vault. Settlement channels: one SWIFT wire + two USDT on-chain + one escrow release. Declared-weight reconciliation missing for two invoices.' },
    { id: 'tbml_misdescribed_goods', label: 'TBML — mis-described scrap vs refined', question: 'Does the HS-code mismatch trigger STR?', context: 'Shipment declared at Jebel Ali Apr 2026 as "mixed scrap brass" HS 74040000 under tariff-low treatment. Independent inspection sampling finds 18kg refined-gold bars embedded in scrap crates. Exporter declines to clarify; sent via freight forwarder with two prior advisory letters from Customs. Value understated AED 4.8M.' },
    { id: 'tbml_round_tripping_smelter', label: 'TBML — round-tripping via smelter', question: 'Does the round-trip have a commercial rationale?', context: 'UAE refiner FF sent 180kg scrap to related smelter in Oman for processing Feb 2026, received 176kg refined back Mar 2026 at 4% weight loss (industry norm: 1-2%). Invoicing both directions declared at elevated unit price vs DMCC benchmark. Net outbound cash AED 3.1M to Oman entity — shared UBO.' },
    { id: 'tbml_cuckoo_smurfing', label: 'TBML — cuckoo smurfing at DPMS', question: 'Is this cuckoo smurfing consistent with AUSTRAC typology?', context: 'DPMS customer GG (established legitimate jeweller) reports 8 unexplained cash deposits into his operating account Feb-Apr 2026 totalling AED 480K, followed by equivalent-value gold purchases by walk-in third parties later that week. Third parties hold non-sequential local IDs. GG did not invite the deposits.' },
    { id: 'tbml_bmpe_parallel', label: 'TBML — BMPE parallel settlement', question: 'Is this a BMPE pattern using the DPMS as a settlement point?', context: 'Customer HH (UAE LLC, import/export metals) receives 12 irregular third-party AED wire deposits Feb-Apr 2026, each from different remitters, matched to USD outbound wires to a Latin America counterpart. DPMS purchases by HH track the dirham inflows. No trade-invoice match on AED side.' },
    { id: 'tbml_ftz_warehouse_letterbox', label: 'TBML — FTZ letterbox warehouse', question: 'Is the FTZ rental a real operation?', context: 'Customer II rents a JAFZA warehouse cell (0 staff, 1 annual visit) but invoices AED 4.2M of re-export gold jewellery through Feb-Apr 2026 using the warehouse address as the shipment origin. No inward stock records at the cell. Forwarder submits self-generated delivery confirmations.' },
    { id: 'tbml_maritime_aisoff', label: 'TBML — AIS-off bunker stop', question: 'Does the dark-fleet indicator apply?', context: 'Vessel JJ (flagged Cook Islands, recent reflag) called at Fujairah 12 Apr 2026 for bunker + partial cargo transfer. AIS was off for 9 hours during STS transfer with an unidentified counterpart. Operator is a UAE-registered shipping LLC with 2025 OFAC Russian-oil advisories on its prior vessel. Bunker supplier paid via UAE intermediary.' },
    { id: 'pep_domestic_minister', label: 'PEP — sitting domestic minister', question: 'What EDD scope and approvals apply?', context: 'Prospective client KK, sitting domestic Deputy Minister in a FATF-grey jurisdiction. Opens bullion-trading account, declared turnover AED 38M/year. Declared SoW: public-sector salary + family business (wholesale commodities). Family business opaque on UBO, incorporation in BVI. No prior adverse media.' },
    { id: 'pep_family_extension', label: 'PEP — close-associate extension', question: 'Does the close-associate relationship trigger EDD?', context: 'Customer LL (no PEP status directly) has been identified via open-source research as business partner and room-mate of sitting foreign PEP MM. LL\'s entity has received 4 wires from MM\'s sibling, another close associate. Firm\'s ongoing-monitoring flagged the connection 15 Apr 2026. Board approval pending decision.' },
    { id: 'pep_international_org', label: 'PEP — international-organisation official', question: 'Classify the PEP tier and the resulting EDD scope.', context: 'Customer NN is a senior official of an international organisation headquartered in UAE (secondary diplomatic status). Declared SoW: organisation salary + family inheritance. Onboarded 2023 at standard tier; 2026 review flags a recent adverse-media article in tier-2 press alleging corruption. Family assets span three jurisdictions.' },
    { id: 'pep_former_official_decay', label: 'PEP — former official, decay window', question: 'When does the EDD requirement ease?', context: 'Customer OO was a minister 2017-2022 (high-risk jurisdiction). Onboarded under firm\'s legacy EDD Feb 2023. Current date Apr 2026; some domestic regimes treat residual PEP status up to 5 years post-tenure. Customer requests tier downgrade to standard CDD citing time elapsed. No adverse signals last 18 months.' },
    { id: 'pep_rca_nephew', label: 'Relative / close associate (RCA) via family chain', question: 'Does the nephew relationship import PEP risk?', context: 'Customer PP is nephew of a serving high-risk-jurisdiction head-of-state. PP himself holds no political office. Onboarding 2026 Q1 declared SoW: private-equity returns (managed by uncle\'s family office). Wire pattern in Feb-Apr 2026 includes two inbound from a foundation whose protector is the head-of-state\'s wife.' },
    { id: 'pep_secondary_title', label: 'PEP — secondary / honorific title', question: 'Is honorific title sufficient to trigger PEP?', context: 'Customer QQ holds a ceremonial / honorific title (non-political) from a foreign kingdom, but also sits on a state-owned enterprise\'s board. Declared UBO of a DMCC LLC trading bullion. Total onboarded assets AED 8M. Honorific appears on LinkedIn profile; state-enterprise board appointment is on official gazette.' },
    { id: 'pep_cash_onboarding', label: 'PEP — cash onboarding at DPMS', question: 'Can this onboarding proceed?', context: 'PEP RR (foreign parliamentarian) arrives at DPMS outlet 20 Apr 2026 with AED 380K cash for first-time purchase. Senior-management pre-approval not obtained. Support documentation for SoW: home-jurisdiction asset declaration, 2-year-old. No prior relationship. Reservation held pending same-day decision.' },
    { id: 'pep_escrow_structure', label: 'PEP — escrow / trust structure', question: 'Is the trust structure a concealment attempt?', context: 'PEP SS establishes trust in Jersey Feb 2026 with Jersey professional trustee; settled AED 14M liquid assets. Beneficiary class: "immediate family." Trust assets used to subscribe a UAE property via SPV. Protector: SS\'s long-time legal counsel. Firm services the SPV-level bank account.' },
    { id: 'pep_wolfsberg_cert', label: 'PEP — Wolfsberg CBDDQ discrepancy', question: 'How to resolve the CBDDQ inconsistency?', context: 'Correspondent partner bank TT certified "no PEP exposure in remittance flows to UAE DPMS" in Jan 2026 Wolfsberg CBDDQ. Firm\'s own screening Apr 2026 identified two direct PEP remitters via TT in the past 30 days (match confidence 0.94 on one, 0.72 on the other). Firm scheduled CBDDQ reconciliation.' },
    { id: 'pep_political_transition', label: 'PEP — during political transition', question: 'Does the transition elevate risk?', context: 'Customer UU was an opposition parliamentarian in their home jurisdiction 2019-2024; recently appointed Deputy Minister Apr 2026. Onboarded 2022 as standard CDD. Transition coincides with two inbound wires from state-treasury-linked entities (AED 6.4M, 5 Apr 2026 and 11 Apr 2026). No prior state-treasury nexus.' },
    // Batch 3/4 — sanctions edge + UBO / trust / foundation + NPO.
    { id: 'sanc_eu_vs_ofac_conflict', label: 'Sanctions — EU vs OFAC divergence', question: 'Resolve the regime conflict on the pending transaction.', context: 'Counterparty VV is listed under EU Russia regime since Oct 2025 but has NOT been re-designated by OFAC after removal from SDN Feb 2026 pursuant to a settlement. UK OFSI retains listing. UAE EOCN follows the UN consolidated baseline (no listing). Firm has pending AED 3.4M outbound wire to VV, executed via UK-correspondent.' },
    { id: 'sanc_designation_imminent', label: 'Sanctions — imminent-designation media signal', question: 'Can the firm act pre-designation?', context: 'Media reports 19 Apr 2026 indicate OFAC Treasury will designate WW within 48 hours (Russian-finance nexus). Firm has AED 8.8M onboarding pipeline for WW scheduled for closure 21 Apr 2026. Designation not yet on any list. MLRO assessing pre-emptive posture (pause vs proceed with rescission clause).' },
    { id: 'sanc_family_50_rule', label: 'Sanctions — 50% rule family aggregate', question: 'Does aggregated family ownership cross 50%?', context: 'Target entity XX: three shareholders — sanctioned individual YY (28%), YY\'s sister ZZ (17%), ZZ\'s spouse AAB (14%). OFAC 50% rule: aggregation of SDN + non-SDN? Sister and spouse not directly SDN. No unity-of-interest prior finding. Entity requests onboarding in UAE DPMS.' },
    { id: 'sanc_wind_down_general_licence', label: 'Sanctions — wind-down general licence', question: 'Does the GL cover the transaction?', context: 'Firm holds residual 28kg bullion for counterparty ACC designated under OFAC EO 14024 in Mar 2026. GL 102 (wind-down) permits transactions incidental to wind-down through 15 May 2026. Firm proposes settlement of a pre-designation claim via sale of the bullion and transfer to blocked account with USD-correspondent.' },
    { id: 'sanc_crypto_ofac_annex', label: 'Sanctions — OFAC crypto-annex wallet', question: 'Freeze scope on the wallet chain?', context: 'VASP customer ADD has address matching an OFAC SDN crypto-annex entry added 18 Apr 2026. Wallet balance 12.4 BTC, plus 40 outbound transactions in last 7 days averaging 0.3 BTC to various exchange deposit addresses. Firm has onboarded 3 customers whose recent inflows traced back (≤3 hops) to ADD.' },
    { id: 'sanc_secondary_penalty_exposure', label: 'Sanctions — secondary-sanctions exposure', question: 'Quantify the firm\'s secondary exposure.', context: 'Firm processed AED 22M of bullion trade with non-US counterparty AEE in Q1 2026 using USD-correspondent-leg. AEE announced 19 Apr 2026 it received an OFAC subpoena re Russia-nexus transactions in 2024. No current designation. Secondary-sanctions prudence suggests correspondent-impact assessment.' },
    { id: 'sanc_uk_opblock', label: 'Sanctions — UK OFSI OPBlock pattern', question: 'Is the OPBlock instruction actionable?', context: 'UK OFSI 18 Apr 2026 issued OPBlock notice on payments related to counterparty AFF. Firm\'s pending MT103 via London-clearing routed to AFF (AED 1.6M). UAE EOCN has no specific listing but UAE financial institution acting as paying agent has UK-regulated branch obligations. Decision window ≤24h.' },
    { id: 'sanc_fatf_grey_tranche', label: 'Sanctions — FATF-grey re-tiering tranche', question: 'Plan the re-tiering for the affected book.', context: 'FATF Public Statement 19 Apr 2026 added jurisdiction AGG to the grey list. Firm has 73 customers with incorporation or primary residence in AGG. Spread across CDD tiers (SDD 14 / CDD 47 / EDD 12). Firm\'s RBA triggers uplift to EDD for all AGG-nexus customers within 30 days of public statement.' },
    { id: 'sanc_ambiguous_dual_national', label: 'Sanctions — ambiguous dual-national', question: 'Which regime applies?', context: 'Customer AHH presents UAE golden-visa-linked passport + home-country passport (AHH\'s home jurisdiction is sanctioned under EU regime but not UN/OFAC/UAE). Transaction: AED 4.8M bullion sale, settlement to UAE-bank account. Declared tax residency UAE. Recent travel includes the home jurisdiction.' },
    { id: 'sanc_marine_dark_fleet_call', label: 'Sanctions — dark-fleet vessel call', question: 'What is the posture for shipments involving vessel AII?', context: 'Vessel AII (flagged Cook Islands, recent reflag) called at Fujairah 14 Apr 2026 under AIS gap. OFAC maritime advisory 15 Apr 2026 lists AII for Russian-oil price-cap attestation failures. Firm\'s gold shipment AJJ (14kg) was loaded on AII 13 Apr. Consignee is UAE DMCC LLC with prior CBUAE correspondent enquiry.' },
    { id: 'ubo_multi_jur_cascade', label: 'UBO — multi-jurisdiction cascade', question: 'Can the UBO chain be resolved?', context: 'Customer AKK: UAE free-zone LLC. Parent: Cyprus holding. Parent of parent: Seychelles IBC. Final shareholder: BVI trust (trustee: professional firm). Declared UBO: natural person with Monaco residency. Ownership at each layer 100%. No corporate docs above Cyprus provided; trust deed withheld on privacy.' },
    { id: 'ubo_indirect_sub25', label: 'UBO — indirect sub-25% aggregation', question: 'Do the aggregated indirect interests trigger UBO?', context: 'Customer ALL (UAE LLC) has 5 shareholders, each 20%. Shareholder 1 is natural person A. Shareholders 2-5 are entities ultimately owned by family members of A (spouse: 20%; 3 siblings: 20% each via separate SPVs). Individual direct ownership is sub-25% for all; aggregated family-interest at A = 100%.' },
    { id: 'ubo_protector_veto', label: 'UBO — trust protector with veto', question: 'Who is the effective-control UBO?', context: 'Customer AMM: DIFC discretionary trust, settlor deceased 2024, trustee is a DIFC-licensed firm, beneficiary class "descendants." Trust deed grants the PROTECTOR (AMM\'s long-time legal counsel) veto on distributions and trustee replacement. Trust assets AED 48M including a DPMS customer account.' },
    { id: 'ubo_nominee_director_gap', label: 'UBO — nominee director chain', question: 'Who actually controls the entity?', context: 'Customer ANN: UAE free-zone LLC incorporated Nov 2025. Directors: 3 nominees supplied by a formation-agent in Seychelles. Declared UBO: anonymous natural person with limited documentary presence (one utility bill from Panama, 2024). Bank-account signatories: a fourth nominee with 142 other live directorships.' },
    { id: 'ubo_bearer_share_entity', label: 'UBO — bearer-share entity', question: 'Is onboarding possible given bearer-share incorporation?', context: 'Entity AOO (Panama 1996): corporate form still permits bearer shares despite 2013 immobilisation reforms. Customer proposes to onboard AOO as DPMS buyer, provides a 2017 notarised declaration of bearer-holder identity. No evidence of continued immobilisation or current holder verification.' },
    { id: 'ubo_refusal_to_disclose', label: 'UBO — refusal past second layer', question: 'What disposition applies under Cabinet Decision 109/2023?', context: 'Customer APP provides direct shareholding (natural-person UBO at 40%, second layer entity 60%). Refuses second-layer UBO citing commercial confidentiality. AED 12M onboarding pipeline, DPMS wholesale. Firm has already served 15-working-day reminder; deadline 25 Apr 2026.' },
    { id: 'ubo_reverification_missed', label: 'UBO — re-verification deadline breach', question: 'Remediation and regulator-notification posture?', context: 'Customer AQQ reported ownership change 28 Mar 2026 (new 30% shareholder, previously an unrelated Liechtenstein Anstalt). 15 working days = 18 Apr 2026. Today 20 Apr 2026. UBO file still pending verification. Intervening transactions: 3 DPMS purchases, total AED 780K. MoE inspection window open.' },
    { id: 'ubo_golden_share', label: 'UBO — golden-share control right', question: 'Does the golden-share holder qualify as UBO?', context: 'Customer ARR (UAE mining LLC): standard shareholders split 30/30/25/15. A fifth shareholder holds a single GOLDEN SHARE (0.01%) with constitutional veto over: key appointments, reserves disposal, and M&A. Golden-share holder is a foreign state-owned investment vehicle ultimately controlled by a sovereign.' },
    { id: 'ubo_foundation_liechtenstein', label: 'UBO — Liechtenstein Anstalt / Stiftung', question: 'Who are the regulatory UBOs?', context: 'Customer ASS (DMCC LLC) is 100% owned by a Liechtenstein Anstalt. Anstalt has a founder, one-person foundation council, and a "beneficiary" whose identity is in a privileged letter-of-wishes not available to counterparties. Anstalt holds AED 22M in firm-serviced vault storage.' },
    { id: 'ubo_shell_hub_address', label: 'UBO — shell-hub address clustering', question: 'Does the address-cluster trigger structural red flag?', context: 'Customer ATT (UAE free-zone LLC) is one of 47 entities registered at the same free-zone flexi-desk address (single cubicle). Seven of the 47 share UBO with ATT. Three have 2024-25 CBUAE adverse-media. ATT\'s DPMS onboarding pipeline AED 9.8M. Operating activity minimal; utility bills zero.' },
    { id: 'npo_charity_conflict_zone', label: 'NPO — charity with conflict-zone ops', question: 'What TF-risk uplift applies?', context: 'UAE-registered charity AUU delivers humanitarian aid into a conflict zone Jan-Apr 2026. Funds raised: AED 8.2M. Funds deployed via 3 in-country implementing partners. One partner is a local NGO whose principal appeared in UN expert-panel report on financing non-state armed groups (unverified allegation). Charity governance: 5 trustees, 2 PEP-linked.' },
    { id: 'npo_dual_registration', label: 'NPO — dual UAE/foreign registration', question: 'Does the dual registration import TF risk?', context: 'Charity AVV registered in UAE (Dubai Islamic Affairs) + foreign (FATF-grey-jurisdiction). Annual donations AED 4.6M, 60% from UAE donors, 40% from foreign. Foreign chapter operates relief camps in a sanctioned jurisdiction under humanitarian exception licences. Cash-couriered disbursements noted in 2025 audit.' },
    { id: 'npo_anonymous_donor_spike', label: 'NPO — anonymous-donor spike', question: 'Does the pattern trigger enhanced review?', context: 'Charity AWW Feb-Apr 2026 received 42 anonymous donations via cash drop-boxes at branches, cumulative AED 720K. Prior 12-month baseline: AED 40K. No change in campaign activity to explain. Trustee meeting minutes note donation spike without investigation. Cash-handling policy not updated since 2023.' },
    { id: 'npo_sanctioned_beneficiary', label: 'NPO — sanctioned-beneficiary touch', question: 'What posture given the beneficiary match?', context: 'Charity AXX supports healthcare in a conflict zone. Quarterly beneficiary-list review 19 Apr 2026 identifies one local partner clinic whose director was designated by OFAC EO 13224 on 1 Apr 2026. Humanitarian general-licence potentially applies but UAE EOCN listing status not yet confirmed.' },
    { id: 'npo_trustee_pep', label: 'NPO — PEP trustee with foreign chapter funding', question: 'How to mitigate conflict-of-interest?', context: 'Charity AYY\'s chair is a sitting foreign PEP. Foreign chapter receives 28% of inbound donations from entities where the chair has declared beneficial interest. Annual audit notes "related-party flows" without quantification. UAE fundraising permit up for renewal in 60 days; regulator-questionnaire now pending.' },
    // Batch 4/4 — NPO tail + cross-border cash + correspondent / payment.
    { id: 'npo_medical_supplies_proliferation', label: 'NPO — medical-supplies dual-use risk', question: 'Does any shipment touch dual-use items?', context: 'Charity AZZ shipped medical supplies AED 2.1M to a sanctioned-jurisdiction hospital in Mar 2026. Inventory included three centrifuges + laboratory reagents. Centrifuge specifications fall within Cabinet Res 156/2025 dual-use catalogue subject to licensing. No licence filed. Charity\'s logistic partner is flagged in a 2025 EOCN advisory.' },
    { id: 'npo_crypto_donations', label: 'NPO — crypto-donation campaign', question: 'What donor-verification applies to on-chain gifts?', context: 'Charity BAA launched crypto-donation portal Jan 2026. Received 184 ETH + 4.2 BTC + 62K USDT by 19 Apr 2026, equivalent AED 3.1M. Donors pseudonymous. 3 donor wallets traced via blockchain analytics back to a mixer cluster. 1 donor wallet on OFAC SDN crypto-annex as of 18 Apr 2026. Liquidation via VARA-licensed exchange partially executed.' },
    { id: 'npo_pif_platform_layering', label: 'NPO — public-fund platform layering', question: 'Is the platform being used as a TF-layering tool?', context: 'Charity BBB ran a social-media fundraiser via platform BCC (low-regulation payment aggregator). Inbound AED 640K Feb-Apr 2026 from 3,400 micro-donors. Outbound to charity bank: single wire AED 640K. Platform KYC attests on aggregate only. 12 repeating micro-donor cards later matched to prepaid-card BIN linked to a sanctioned jurisdiction.' },
    { id: 'npo_cash_courier_relief', label: 'NPO — cash-courier relief shipment', question: 'Is cash-couriered disbursement defensible?', context: 'Charity BCC disbursed AED 480K in physical cash via a courier to a field office in a sanctioned jurisdiction on 11 Apr 2026. Courier is an employee; no independent chain-of-custody evidence. Cabinet Res 134/2025 Art.16 cross-border cash declaration threshold not triggered (under AED 60K per transit) — cash fragmented across 9 separate trips.' },
    { id: 'npo_governance_collapse', label: 'NPO — governance collapse', question: 'What interim posture applies?', context: 'Charity BDD has, since Jan 2026, lost 4 of 7 trustees (one arrested abroad in non-AML matter, three resigned citing oversight concerns). Annual audit pending, financial controller on notice. Fund balance AED 9.2M in firm-serviced account. No new disbursements since 15 Apr 2026. CO flagged the case to the firm\'s board Apr 2026.' },
    { id: 'cb_cash_60k_arrival', label: 'Cross-border cash — arrival above 60K', question: 'Declaration + CNMR obligations?', context: 'Passenger BEE arrived DXB 15 Apr 2026 declaring AED 118K mixed currencies in cash. Stated purpose: purchasing bullion. No supporting documentation for the declared AED equivalence. Travel itinerary shows 4 short-stay visits in past 90 days, each with declared amounts just under 60K. Aggregation potential.' },
    { id: 'cb_cash_60k_departure', label: 'Cross-border cash — departure above 60K', question: 'Is the departure declaration genuine?', context: 'Passenger BFF departing DXB→Mumbai 19 Apr 2026 declared AED 74K cash. Secondary inspection identified 38K of jewellery + 12K of loose gemstones undeclared. Passenger is registered DPMS customer with AED 1.2M purchases over 90 days paid in cash. Flight booked same-day.' },
    { id: 'cb_bni_undeclared', label: 'Cross-border — undeclared BNI on hand-carry', question: 'What enforcement path applies?', context: 'Passenger BGG apprehended by Customs 17 Apr 2026 with AED 220K worth of bullion bars in hand luggage, undeclared. Cabinet Res 134/2025 Art.16 threshold AED 60K triggered. Passenger is UBO of a DMCC LLC that has three prior declaration-records this year. Cash held inside bullion-accompanying envelopes mixed currency.' },
    { id: 'cb_freight_non_declaration', label: 'Cross-border — freight value understated', question: 'Understatement by what margin and remediation?', context: 'Freight waybill declared AED 22K for jewellery parcel inbound Dubai→Dammam 13 Apr 2026. Customs X-ray inspection revealed gold bullion; independent assessment AED 340K. Consignor: DMCC LLC BHH. Consignee: Saudi personal address. BHH has 4 prior parcels in pattern.' },
    { id: 'cb_cash_smuggle_concealed', label: 'Cross-border — concealed cash in goods', question: 'STR scope given the concealment?', context: 'Cargo shipment declared as "industrial machinery" Dubai→Nairobi 19 Apr 2026. Customs inspection found USD 840K in cash embedded in sealed housing. Shipper: UAE-free-zone LLC BII, DPMS-adjacent. Consignee: Kenya private recipient with no prior trade relationship. Import permit absent.' },
    { id: 'cb_crypto_to_cash_offramp', label: 'Cross-border — crypto off-ramp to cash', question: 'Does the cash-out pattern cross the threshold?', context: 'Customer BJJ off-ramped 28 ETH via VARA-licensed exchange 12 Apr 2026 (AED 340K). Withdrew cash in two collections from currency-exchange partners (AED 180K + AED 160K) on 13-14 Apr 2026 at different Souk outlets. Declared purpose: bullion purchase. Source-of-crypto attestation not filed.' },
    { id: 'cb_hawala_overlap', label: 'Cross-border — hawala-style parallel settlement', question: 'Is the pattern consistent with hawala?', context: 'Customer BKK remitted AED 180K to home-country recipient 9 Apr 2026 via informal paying-and-receiving agent. Same-day AED 180K paid to a UAE counter from an unrelated depositor claiming to be "paying on BKK\'s behalf." Two-step informal settlement — no banking record. DPMS touch: recipient used funds for gold purchase.' },
    { id: 'cb_re_export_ftz_cash', label: 'Cross-border — FTZ re-export with cash settlement', question: 'Does the FTZ re-export trigger declaration?', context: 'Consignor BLL (JAFZA LLC) re-exports 18kg bullion Dubai→Hong Kong 16 Apr 2026. Buyer settles AED 4.8M partly via AED 60K cash delivered to FTZ cashier counter (threshold trigger) + AED 4.74M wire. Cashier is a sub-licensee of BLL\'s freight forwarder.' },
    { id: 'cb_border_declaration_history_gap', label: 'Cross-border — declaration-history gap', question: 'Does the historical gap impact current posture?', context: 'Customer BMM declared AED 78K 15 Apr 2026 arrival. Review of 2024-2025 history: BMM made 8 international trips with prior DPMS purchases, 0 declarations. Retroactive audit suggests he carried undeclared AED 420K cumulative in earlier trips. UAE Customs has not initiated action.' },
    { id: 'cb_diplomatic_carrier', label: 'Cross-border — diplomatic carrier claim', question: 'Does the claimed status immunise from declaration?', context: 'Individual BNN arrived DXB 18 Apr 2026 claiming diplomatic carrier status (MFA-issued ID). Carrying AED 140K cash + AED 620K worth of bullion. Declaration form not submitted. UAE MFA records show BNN is a lower-grade attaché; diplomatic-bag treatment not applicable to personal effects. Firm is downstream bullion-recipient.' },
    { id: 'corresp_nested_bank_flow', label: 'Correspondent — nested-bank onward flow', question: 'Does the nested flow meet Wolfsberg standards?', context: 'Firm\'s correspondent-bank partner BOO (FATF-grey jurisdiction) processed AED 42M of wires into firm\'s nostro Feb-Apr 2026 on behalf of 14 downstream "respondent" banks not named in initial onboarding. Six downstream banks\' underlying remitters are PEP or adverse-media-linked. KYCC pack from BOO last updated 2024.' },
    { id: 'corresp_downstream_sanctions', label: 'Correspondent — downstream sanctions gap', question: 'What correction scope applies?', context: 'Correspondent partner BPP certified "full sanctions screening" in Jan 2026 CBDDQ. Firm discovered 3 downstream-customer wires through BPP in March 2026 that would match UAE EOCN list at 0.8+ confidence if rescreened directly. BPP is a UAE-branch of a foreign bank; has own oversight obligation.' },
    { id: 'corresp_shell_bank_suspected', label: 'Correspondent — shell-bank suspicion', question: 'Does BQQ meet the shell-bank definition?', context: 'Correspondent onboarding request 18 Apr 2026 from BQQ — bank licensed in a secrecy jurisdiction. Physical presence in licence jurisdiction: a shared address with other "international banking licence" holders. No local employees. Group-affiliation claim to a real bank is unverified. Wolfsberg principles prohibit shell-bank correspondent relationships.' },
    { id: 'corresp_cover_payment_miss', label: 'Correspondent — cover-payment data strip', question: 'What remediation applies?', context: 'Intermediary correspondent BRR processes cover payments for firm\'s USD leg and historically did NOT transmit full originator details (MT202COV data stripping). Firm realised gap 12 Apr 2026 across 14 months of flow. Cumulative AED 180M. Correspondent since replaced; residual MT202COV compliance remediation needed.' },
    { id: 'corresp_cbd_downstream_pep', label: 'Correspondent — downstream PEP chain', question: 'Enhanced oversight or exit?', context: 'Firm\'s correspondent BSS certified "no PEP downstream exposure" Jan 2026. Firm identified 4 transactions via BSS 7-19 Apr 2026 where remitter or beneficiary is a sitting-PEP-linked entity (match 0.9 confidence). Cumulative AED 6.4M. BSS\'s own policy gap — not directly a fraud.' },
    { id: 'corresp_cbuae_standard_gap', label: 'Correspondent — CBUAE standard gap', question: 'What remediation scope satisfies CBUAE?', context: 'CBUAE Correspondent Banking Standard (2025 refresh) introduces enhanced periodic review cadence. Firm\'s 28 correspondent relationships were reviewed under prior cadence. Gap: 14 relationships now require re-certification by 30 Jun 2026. One (BTT) has material adverse-media since last review.' },
    { id: 'corresp_payment_intermediary_strip', label: 'Correspondent — payment-intermediary strip', question: 'Process, hold, or return?', context: 'Incoming wire AED 2.4M for firm-customer BUU 19 Apr 2026 via 3 intermediary banks. MT103 originator name + account present. Originator physical address: absent. Intermediary 2 stripped address field. FATF Rec 16 requires originator info completeness. Beneficiary BUU is retail DPMS customer with no prior correspondent-issue.' },
    { id: 'corresp_nested_vasp', label: 'Correspondent — VASP nested inflow', question: 'Does the VASP nesting trigger uplift?', context: 'Firm\'s correspondent BVV (DIFC-based banking) processes flows for a VARA-licensed VASP that serves 8 sub-VASPs (none directly onboarded by firm). 18 Apr 2026 inbound wire AED 1.1M to firm from BVV with payment-reference implying crypto off-ramp origin. Travel-Rule equivalence at the VASP layer unverified.' },
    { id: 'corresp_historical_exit', label: 'Correspondent — historical-relationship exit', question: 'Exit mechanics and residual risk?', context: 'Firm decided to exit correspondent relationship with BWW (FATF-grey jurisdiction, de-risking rationale) 1 May 2026. BWW holds residual nostro balance AED 28M. BWW has 12 downstream sub-bank relationships relying on firm\'s clearing. Exit plan needed: wind-down, customer-notification posture, residual-risk monitoring.' },
    { id: 'corresp_escrow_payment_block', label: 'Correspondent — escrow-payment block', question: 'Is the block release defensible?', context: 'Firm acting as escrow agent holds AED 8.2M pending release to seller BXX upon closing conditions. Compliance alert 17 Apr 2026 triggered by new adverse media on BXX (FCPA-linked investigation announced by US DOJ). Seller disputes. Release date contractually 22 Apr 2026. Correspondent bank signalled reluctance to process.' },
    // ── 100 further scenarios added 2026-04-21 (wave 2):
    //    trade finance, real estate, insurance, family office, luxury
    //    goods, payment services, investment funds, market abuse,
    //    fraud, and compliance operations. ──
    { id: 'tf_lc_discrep', label: 'TF — LC with recurring discrepancies', question: 'Is the waiver pattern defensible?', context: 'Applicant BYY (UAE trading LLC) has presented 11 LC drawings in 10 months for Asian-sourced textile imports. 9 of 11 presentations carried documentary discrepancies waived by BYY each time within 48 hours. Discrepancies recurrent: invoice-vs-packing-list weight mismatch, transport-doc date mismatch. Counterparties: 3 different Hong Kong suppliers.' },
    { id: 'tf_sblc_draw_chain', label: 'TF — SBLC draw chain', question: 'Is this standby a legitimate risk mitigant?', context: 'Firm issued SBLC AED 22M to beneficiary BZZ 14 Apr 2026. Ten days later beneficiary draws AED 8.6M citing non-performance. Applicant CAA (DMCC LLC) pays the claim without dispute. CAA and BZZ share a UBO through two intermediate layers. No underlying commercial contract evidencing AED 22M risk exposure was documented.' },
    { id: 'tf_open_account_spike', label: 'TF — open-account volume spike', question: 'Does the spike justify elevated review?', context: 'UAE exporter CBB shipped AED 4.2M of aluminium scrap to Turkey over 15 months on open account (no LC, no SBLC). Q1 2026 volume rose to AED 9.8M (3x baseline). Buyer payment cadence shifted from 30 days to 5 days. Payment source: 3 different accounts, 2 in jurisdictions not previously used.' },
    { id: 'tf_forfait_receivable', label: 'TF — forfait of receivable', question: 'Evaluate the forfait chain.', context: 'Exporter CCC sold a USD 3.8M trade receivable to forfaiter CDD (Jersey-based) in Feb 2026, discount 12% against face. CDD onward-sold to buyer CEE in BVI at discount 5%. Underlying transaction: machinery sold to Brazilian importer. Importer history shows 2 prior defaults on unrelated invoices.' },
    { id: 'tf_structured_commodity', label: 'TF — tolling deal with inventory leak', question: 'Warehouse-inventory reconciliation gap?', context: 'Structured commodity-finance deal: firm advances AED 28M against 2,000 MT copper cathodes warehoused in Jebel Ali. 10-day warehouse reconciliation 19 Apr 2026 reveals 1,830 MT present (170 MT short). Warehouse operator provides loading-sheet explanation; independent auditor not yet present. Borrower CFF requests next drawdown.' },
    { id: 'tf_collateral_pledge', label: 'TF — collateral-pledge double-use', question: 'Is the same collateral pledged elsewhere?', context: 'Firm took security over 45 tonnes of refined copper (Dubai vault CGG) as collateral for AED 18M loan to borrower CHH Feb 2026. Public filings 16 Apr 2026 show a competing financier lodged a security interest over the "same warehouse-receipt" in Mar 2026. Warehouse receipt numbering overlaps.' },
    { id: 'tf_lc_amendment_flurry', label: 'TF — LC amendment flurry', question: 'Does the amendment cadence signal a sham?', context: 'LC opened 4 Apr 2026 for AED 6.2M for industrial-machinery import. Between 5-18 Apr the LC was amended 7 times: beneficiary-bank, port-of-loading, shipping-line, HS-code, quantity, unit-price, and LC-expiry. Applicant CII refuses to disclose the underlying contract, claiming "commercial sensitivity."' },
    { id: 're_cash_villa', label: 'RE — cash villa purchase', question: 'What CDD / SoF evidence is required?', context: 'Buyer CJJ proposes all-cash purchase of an AED 38M villa in Palm Jumeirah 22 Apr 2026. Non-resident, declared nationality from a FATF-grey jurisdiction. Declared SoW: family inheritance + business profits. No documentary SoW at agent stage. Agent requests closing in 3 business days to meet exchange rate.' },
    { id: 're_goldenvisa_invest', label: 'RE — golden-visa investment property', question: 'Is this a genuine investment or concealed ML?', context: 'Buyer CKK acquired 3 sub-AED 2M apartments over 4 months Feb-Apr 2026 to qualify for UAE golden-visa investor route (aggregate AED 5.8M). Each purchase sits just above minimum threshold. SPV-per-apartment structure. UBO identical (CKK + spouse). Funds wired from 2 different jurisdictions; one is sanctioned.' },
    { id: 're_offplan_payer_switch', label: 'RE — off-plan payer switch', question: 'Who is the real beneficial buyer?', context: 'Off-plan purchase contract AED 12.4M. Initial 20% deposit paid by buyer CLL from UAE bank Jan 2026. Subsequent 30% instalment paid by unrelated UAE LLC Apr 2026. Next 30% due May 2026; buyer signalled it will come from a Cypriot entity. CLL declines to explain multi-payer pattern.' },
    { id: 're_sponsor_upstream', label: 'RE — sponsor / upstream funder hidden', question: 'UBO chain to the real funder?', context: 'Commercial property AED 82M acquired by SPV CMM (DIFC-based) 18 Apr 2026. SPV\'s declared UBO: a natural person in Monaco. Funding: 100% equity from Cayman fund CNN whose investor list is confidential (administrator-held). Cayman fund\'s GP and advisor share office with a previously-sanctioned-person\'s family office.' },
    { id: 're_intra_family_transfer', label: 'RE — intra-family below-market transfer', question: 'Is this gift / evasion / ML?', context: 'UAE villa transferred 15 Apr 2026 from family-member A to family-member B for AED 8M. Recent comparable sales: AED 18-22M. Both parties are UAE nationals, neither PEP. Transaction structured as documented gift + token consideration. Family-member A is subject of a 2024 commercial-court judgement unsatisfied.' },
    { id: 're_rapid_resale', label: 'RE — rapid resale with markup', question: 'Is the markup genuine or layering?', context: 'Apartment bought 10 Feb 2026 AED 3.8M by COO (UAE-resident), resold 14 Apr 2026 to CPP (non-resident) for AED 6.9M. No documented improvements. Original-buyer bank record shows 3-day holding between deposit and purchase. Resale price exceeds current market by ~35%.' },
    { id: 're_reit_large_investor', label: 'RE — REIT large-investor subscription', question: 'How do we KYC the feeder fund?', context: 'Subscription AED 88M into UAE REIT on 19 Apr 2026 by Luxembourg feeder fund CQQ. Feeder\'s investor list is confidential; administrator provides aggregated attestation only. Feeder\'s investment-manager is UK-regulated. Feeder\'s beneficial investors include 2 entities with FATF-grey-jurisdiction UBOs.' },
    { id: 'ins_life_surrender_cash', label: 'Insurance — life surrender to cash', question: 'What AML treatment applies?', context: 'Single-premium unit-linked life policy AED 4.6M purchased 2024. Policyholder CRR requests 18 Apr 2026 full surrender, proceeds payable to a different account than the premium origin. Penalty: AED 460K. Policyholder insists on cash-equivalent payment via bank draft to a third-party UAE LLC.' },
    { id: 'ins_premium_top_up', label: 'Insurance — atypical premium top-up', question: 'Explain the pre-claim top-up pattern?', context: 'Policyholder CSS (life policy) made 4 unscheduled top-ups Feb-Apr 2026 totalling AED 2.1M. Two weeks later filed a claim against the policy for AED 2.6M. Top-ups funded from different third-party sources. Claim narrative concerns an event pre-dating the top-ups.' },
    { id: 'ins_pep_policy', label: 'Insurance — PEP large policy', question: 'EDD scope required?', context: 'Foreign PEP CTT (sitting Minister, FATF-grey jurisdiction) applies for single-premium life policy AED 22M 20 Apr 2026. Premium-source: declared as family-business profits. Documentary SoW: 2-page letter from PEP\'s accountant, no independent corroboration. Beneficiaries: 3 family members in different jurisdictions.' },
    { id: 'ins_claim_third_party', label: 'Insurance — claim payee diverges', question: 'Is the payee assignment legitimate?', context: 'Claim payout AED 5.4M approved 14 Apr 2026 on property-damage policy held by CUU (DMCC LLC). Payout instruction redirects funds to CVV (unrelated UAE LLC) citing a "debt settlement" between CUU and CVV. No supporting-deed evidence. Both entities share a director.' },
    { id: 'ins_reinsurance_route', label: 'Insurance — opaque reinsurance route', question: 'Where is the risk really ceded?', context: 'Primary reinsurer cedes 80% of UAE property portfolio to retrocessionaire CWW (Bermuda). CWW cedes 60% onward to a captive CXX in a sanctioned jurisdiction via intermediate reinsurer CYY (Guernsey). Economic end-risk-bearer is opaque. Quarterly premium flow AED 14M through the chain.' },
    { id: 'ins_sanctions_cedant', label: 'Insurance — sanctions-nexus cedant', question: 'Block, wind-down, or proceed?', context: 'Cedant insurer CZZ (UAE-licensed branch of foreign group) added to EU sanctions list 17 Apr 2026 (Russia nexus). Firm holds reinsurance treaty with CZZ; active claims pending AED 38M. UK OFSI has not yet designated. UN list unchanged. Treaty-exit clause activatable with 60-day notice.' },
    { id: 'ins_ils_investor', label: 'Insurance — ILS investor review', question: 'Is the investor acceptable?', context: 'Catastrophe-bond tranche issued by firm\'s Bermuda SPV 11 Apr 2026. Major subscriber DAA (Cayman fund) has confidential investor list. Fund administrator provides aggregated attestation. Beneficial investors include 1 entity with PEP-linked UBO and 1 entity with prior Luxembourg-regulator enforcement.' },
    { id: 'ins_life_settlement', label: 'Insurance — life-settlement secondary trade', question: 'Investor KYC sufficient?', context: 'DBB seeks to buy a life-settlement interest AED 12M on the UAE secondary market. Policy originally issued 2018 to an unrelated-to-DBB insured. DBB is a Panama SPV; investors undisclosed citing confidentiality. Seller (prior-policy-owner) is an estate trust in Liechtenstein.' },
    { id: 'ins_annuity_lump_sum', label: 'Insurance — annuity lump-sum', question: 'Is the annuity consistent with profile?', context: 'Customer DCC (42, UAE-resident DPMS trader) proposes AED 18M lump-sum purchase of a lifetime-annuity 16 Apr 2026. Declared SoW: trading profits. Prior DCC savings balance at firm: AED 2.3M. No matching historical liquidity event. Annuity-beneficiary list: 2 non-family cousins in a FATF-grey jurisdiction.' },
    { id: 'ins_broker_kyc_gap', label: 'Insurance — broker KYC gap', question: 'Does the broker\'s KYC gap import risk?', context: 'Broker DDD brought policyholder DEE to firm 12 Apr 2026, policy premium AED 6.4M. Broker file review reveals: KYC on DEE limited to a passport scan; no SoW corroboration; no verification of beneficiary. Broker\'s own licence under periodic review by regulator.' },
    { id: 'ins_group_policy_mls', label: 'Insurance — group-policy MSB exposure', question: 'Does the group-policy structure conceal MSB activity?', context: 'Group life-insurance policy DFF covers "employees of a UAE trading LLC." 340 lives insured. HR-file sampling shows 78 employees without payroll records, many appearing to live outside UAE. Group policy allows third-party premium payment by "corporate cash." Potential misuse as MSB facade.' },
    // Wave 2 / batch 2 scenarios — family office + luxury + payments.
    { id: 'fo_pep_patriarch', label: 'FO — PEP patriarch deceased', question: 'Re-verify UBO and succession?', context: 'Family office DGG for a late-PEP patriarch (died Feb 2026). Succession trust activates with 4 adult children (2 UAE residents, 2 abroad including one in a sanctioned jurisdiction). AED 340M under firm-supervised custody. Heir-to-jurisdictional-mapping incomplete; heir 3 has unresolved adverse-media from 2023.' },
    { id: 'fo_mfo_downstream_pep', label: 'FO — MFO downstream PEP surfaced', question: 'Look-through KYC plan?', context: 'MFO DHH onboarded 2024 as relied-on CDD. 18 Apr 2026 investor-change notice reveals new underlying family-D includes a sitting foreign PEP never previously disclosed. MFO claims no onward-duty; firm retains the primary customer relationship. Affected AUM in firm-custody: AED 48M.' },
    { id: 'fo_ptc_veto', label: 'FO — PTC with director veto', question: 'Who controls the vehicle?', context: 'Private Trust Company DII governs AED 180M of family assets. Directors: 3 family members + 1 independent PTC director with a contractual VETO on any distribution to non-family beneficiaries. Veto-holder shares business history with a previously-sanctioned UAE trading LLC (no current designation).' },
    { id: 'fo_concentrated_issuer', label: 'FO — concentrated issuer position', question: 'Insider-status risk on trades?', context: 'Family office DJJ holds a 38% stake in a UAE-listed issuer. One family member sits on the issuer\'s board. FO executed 3 outsized OTC trades on the issuer Jan-Apr 2026 AED 62M total, immediately preceding a dividend surprise and an acquisition rumour. Firm services the custody leg.' },
    { id: 'fo_philanthropy_conduit', label: 'FO — philanthropy with opaque beneficiary', question: 'Is the charity a TF conduit?', context: 'Family foundation DKK (UAE-registered) disburses 72% of its outflow to a single overseas religious entity DLL in a conflict-adjacent jurisdiction. Founder of DKK is a family member of a FATF-grey-jurisdiction PEP. Trustees deliberated on a 19 Apr 2026 grant of AED 3.8M; board minutes terse on recipient DD.' },
    { id: 'fo_art_freeport', label: 'FO — art collection in freeport', question: 'Provenance chain integrity?', context: 'Family office DMM transferred 14 paintings (total AED 88M) into a Luxembourg freeport Feb 2026. Provenance docs missing for 5 (pre-WWII gap). Sold 3 in-freeport to a Hong Kong buyer Apr 2026 at 40% markup with no physical movement. Buyer KYC limited. Re-provenance investigation stalled.' },
    { id: 'fo_yacht_spv_chain', label: 'FO — yacht via SPV chain', question: 'Who really owns the yacht?', context: 'Superyacht (estimated value AED 180M) held via: Panama SPV DNN → Cayman Ltd → Cyprus Ltd → declared UBO family member. Yacht chartered via a third-party agent DOO (Monaco) to external parties; charter fees paid into a different jurisdiction than SPV. Recent flag-change Mar 2026 (Liberia→Marshall Islands).' },
    { id: 'fo_jet_charter', label: 'FO — private-jet with charter flow', question: 'Is the jet used commercially in a disguised way?', context: 'Family-office DPP owns a Gulfstream via a BVI SPV. Logs 96 flights Jan-Apr 2026; 44 commercial-charters via an external broker. Charter clients include a sanctioned person\'s associates (0.86 match confidence, triggered Apr 2026). Revenue reconciled into a separate Cayman vehicle, not the SPV.' },
    { id: 'fo_next_gen_politics', label: 'FO — next-gen entering politics', question: 'Rescope risk profile?', context: 'Next-gen heir DQQ announced candidacy for a cabinet-level position in foreign jurisdiction Mar 2026. DQQ holds a personal brokerage account at firm (AED 4.2M) and signatory powers on the family trust. No prior PEP flag. Campaign costs expected from family trust; trust distribution mechanics unclear.' },
    { id: 'fo_trust_multi_jur', label: 'FO — trust across 5 jurisdictions', question: 'AML overlay compliant?', context: 'Family trust DRR: settlor in Jordan, trustee in Jersey, beneficiaries in UK + Canada + Lebanon, protector in Switzerland, UAE assets AED 120M. FATCA / CRS reporting lagging 6 months; protector-override clause triggered twice in 2025. Protector is a family-friend lawyer with own 2024 bar-disciplinary proceeding (unrelated).' },
    { id: 'lux_art_private_sale', label: 'Luxury — art private-sale', question: 'DPMS-equivalent AML required?', context: 'Art dealer DSS sold a post-war painting AED 6.8M in private treaty 17 Apr 2026. Buyer paid AED 2M cash + AED 4.8M wire from a BVI LLC. Seller: consigned via a Monaco estate. Provenance includes a 2015 ownership gap. Buyer declines further KYC citing privacy.' },
    { id: 'lux_watch_serial', label: 'Luxury — high-end watch with disputed serial', question: 'Sale to proceed?', context: 'Independent watch dealer DTT offers a limited-edition watch AED 1.4M 19 Apr 2026. Serial-number shows two conflicting provenance chains (manufacturer registry vs dealer chain). Buyer DUU paid AED 1.4M cash. Transaction triggers DPMS-equivalent threshold (>AED 55K) and sanctions screening returns 0.62 on buyer.' },
    { id: 'lux_classic_car_escrow', label: 'Luxury — classic-car escrow release', question: 'Release or hold?', context: 'Classic 1960s coupe AED 4.2M held in firm escrow pending title transfer. 18 Apr 2026 seller DVV provides title docs with mismatched chassis number. Buyer DWW (Swiss resident) demands release; has pressed for escrow timing. Original-owner chain includes a 2002 brief OFAC touch (since de-listed).' },
    { id: 'lux_yacht_broker_flow', label: 'Luxury — yacht broker commission split', question: 'Is the commission split a concealed payment?', context: 'Yacht broker DXX handled a sale AED 92M 14 Apr 2026. Broker commission 4% (AED 3.68M) paid into two accounts — AED 2.1M to a Monaco advisory-services LLC, AED 1.58M to a Dubai service company with no history of yachting activity. Each receiver has the same UBO as broker.' },
    { id: 'lux_jewellery_kimberley', label: 'Luxury — high-end jewellery Kimberley gap', question: 'Defensible to ship?', context: 'Firm\'s luxury-jewellery client DYY is re-exporting a diamond necklace AED 8.2M to a Hong Kong buyer 21 Apr 2026. Kimberley Process chain-of-custody broken at 2019 Zimbabwe-origin re-cut leg. Firm asked DYY for supplementary DD; DYY provides a notarised statement (self-attested) but no chain documents.' },
    { id: 'pay_msb_agent_onboard', label: 'Payment — MSB agent onboarding', question: 'Onboard / reject?', context: 'MSB agent DZZ (3 branches UAE) applies to be correspondent for cross-border remittance. Licensed 2024, transaction volume grew from AED 200K/month to AED 48M/month in 14 months. Two prior CBUAE advisory letters on monitoring-rule coverage. No MLRO named; compliance officer is also the group CFO.' },
    { id: 'pay_prepaid_program', label: 'Payment — prepaid-card overseas top-up', question: 'Does the top-up pattern need review?', context: 'Prepaid programme EAA issued 42,000 cards. 3,100 cards received top-ups from overseas payers in Feb-Apr 2026 (cumulative AED 68M). Cardholder KYC collected at issuance; top-up-side KYC not re-collected. Top-ups cluster to 3 specific originating countries, two FATF-grey-listed.' },
    { id: 'pay_wallet_velocity', label: 'Payment — digital wallet abnormal velocity', question: 'Is the velocity normal?', context: 'Digital wallet operator EBB hosts 280K consumer accounts. 920 accounts reached >AED 20K weekly outbound for 8 consecutive weeks Feb-Apr 2026, a 12x increase vs prior baseline. Merchant categories for outbound: gold-retail + MSB. Wallet provider transaction monitoring thresholds unchanged since 2024.' },
    { id: 'pay_bnpl_merchant_chain', label: 'Payment — BNPL merchant chain', question: 'Concealed higher-risk merchants via aggregator?', context: 'BNPL lender ECC onboarded 8,400 merchants via an aggregator EDD in 2024. Sample review 17 Apr 2026: 310 merchants mis-coded (MCC "retail" but actual business is casino / crypto / sports-book). Aggregator\'s own KYC on the sample: self-attested merchant declarations only. Lender\'s direct KYC absent.' },
    { id: 'pay_cross_border_rail', label: 'Payment — alternate cross-border rail', question: 'Travel-Rule compliance?', context: 'Firm using alternate cross-border rail EEE (stablecoin-based) for USD/AED settlements Mar-Apr 2026. 14% of transactions have incomplete Travel-Rule payloads (missing beneficiary address). Rail operator claims bilateral-agreement with partner VASPs. Partner VASPs list unchanged since inception; 2 recently added to FATF-grey watchlist.' },
    { id: 'pay_merchant_chargeback', label: 'Payment — merchant chargeback anomaly', question: 'Merchant continues or terminates?', context: 'Merchant EFF (UAE electronics) processed AED 24M on firm\'s acquiring Jan-Apr 2026. Chargeback rate 4.8% (peer median 0.8%). Chargebacks concentrated on high-value SKUs; refunds directed to different cards than original purchase. Merchant UBO shares address with 2 previously-terminated acquirer merchants.' },
    { id: 'pay_instant_rail_spike', label: 'Payment — instant-rail fraud spike', question: 'What controls apply?', context: 'Firm\'s instant-rail volume grew 6x Feb-Apr 2026. Fraud reports increased 18x. Victim profile: small-amount senders averaging AED 4K, recipients concentrated in 8 UAE accounts. 6 of 8 accounts opened within last 90 days. Customer protection complaint rate also rising.' },
    { id: 'pay_agent_network_kyc', label: 'Payment — agent-network KYC weakness', question: 'Shut agent or remediate?', context: 'PSP EGG has 240-agent network providing end-customer onboarding. Sample audit 15 Apr 2026 on 40 agents reveals 14 with incomplete end-customer KYC (missing identity doc, no SoF), 4 agents have issued onboarding to end-customers whose details later matched sanctions screening. Firm processes EGG\'s clearing.' },
    { id: 'pay_pix_equiv_scam', label: 'Payment — fast-rail APP scam cluster', question: 'What immediate controls apply?', context: 'UAE fast-rail 19 Apr 2026: cluster of 84 reports of APP / impersonation scams AED 12-45K each. Victims sent funds to 22 recipient accounts; 18 of the 22 opened in the past 60 days. One recipient account linked to a multi-step onward flow into a VASP. Firm operates 9 of the 22 receiving accounts.' },
    { id: 'pay_merchant_layering', label: 'Payment — merchant as layering facade', question: 'Is the merchant a facade?', context: 'Merchant EHH onboarded as "electronics retailer" (MCC 5732). Actual site: warehouse with no retail operations. Settled AED 62M Feb-Apr 2026 via POS + online. Settlement routes to a UAE LLC with different UBO than merchant-of-record. Related party holds crypto-exchange licence in a FATF-grey jurisdiction.' },
    // Wave 2 / batch 3 scenarios — funds + market abuse + fraud.
    { id: 'fund_capital_call_source', label: 'Fund — capital call from new source', question: 'Accept or request SoF?', context: 'UAE-based PE fund EII received capital-call inbound AED 44M from LP EJJ on 18 Apr 2026 sourced from a new account in Luxembourg. At subscription (2023) EJJ used a Cayman account. No change-of-detail notification from EJJ. Source bank has 2025 CBUAE advisory on correspondent compliance.' },
    { id: 'fund_distribution_assignment', label: 'Fund — distribution assigned to third party', question: 'Honor assignment or require recomplete KYC?', context: 'LP EKK instructs a pending AED 12M distribution to be paid into account of unrelated party ELL citing "assignment of proceeds." ELL is a UAE LLC with UBO different from EKK and a prior firm-level compliance query (Feb 2026 adverse-media alert, later dismissed). Assignment deed not notarised.' },
    { id: 'fund_side_letter_mfn', label: 'Fund — side-letter preferential terms', question: 'Does the side-letter conceal beneficial interest?', context: 'Side-letter to LP EMM (Swiss) grants most-favoured-nation plus veto over co-investment transactions. EMM\'s stated UBO is a foundation whose beneficiaries are "private discretionary class." Side-letter terms materially diverge from the LPA and were not disclosed to the wider LP group.' },
    { id: 'fund_master_feeder_layers', label: 'Fund — feeder in secrecy jurisdiction', question: 'Look-through acceptable?', context: 'Master fund (Cayman) receives subscriptions via 3 feeders: Luxembourg, Cayman, BVI. BVI feeder has 48 underlying investors, administrator confidentiality restricts disclosure. Firm sought look-through; administrator provides only aggregate. 4 BVI-feeder investors match sanctions screening at 0.7-0.85 confidence.' },
    { id: 'fund_gp_carry_sharing', label: 'Fund — GP carry sharing with external party', question: 'Review the carry-split.', context: 'GP ENN announced 18 Apr 2026 it will share 30% of carry distribution with external advisor EOO (Panama LLC). Advisor has no prior services-agreement with GP. Advisor\'s UBO not disclosed to LPs. Potentially a concealed placement-agent-fee or introduction payment.' },
    { id: 'fund_sub_fund_cross', label: 'Fund — cross-subscription between sub-funds', question: 'Legitimate portfolio construction or layering?', context: 'Umbrella fund has 4 sub-funds. Sub-fund 1 subscribed AED 38M into sub-fund 3 on 12 Apr 2026 (same day) with immediate onward investment into sub-fund 4\'s portfolio. Administrator flagged the timing anomaly. Cross-subscriptions between sub-funds not part of prior pattern.' },
    { id: 'fund_tokenised_subscription', label: 'Fund — tokenised-fund subscription', question: 'On-chain KYC sufficient?', context: 'VARA-regulated tokenised fund EPP received 2.4M USDT subscription on 17 Apr 2026. Subscribing wallet has prior cluster attribution to a mixer service (0.72 confidence). Whitelist addition applied 13 Apr 2026 post-KYC. KYC documents: passport + attestation; no on-chain transaction history review.' },
    { id: 'fund_secondary_interest', label: 'Fund — secondary LP interest sale', question: 'Buyer KYC adequate?', context: 'LP EQQ sold AED 16M of LP interest to buyer ERR on 19 Apr 2026. Buyer is a Jersey trust; beneficiary is disclosed as "the family of a foreign PEP." Transfer price below carrying value (discount 22%). Seller declares no subsequent intent; buyer\'s commitment to fund is valid forward.' },
    { id: 'fund_nominee_principal', label: 'Fund — nominee investor\'s principal disclosed', question: 'Accept the principal as investor?', context: 'Existing LP ESS (Cyprus) attested 16 Apr 2026 it acts as nominee for principal ETT. ETT is a natural person in a FATF-grey jurisdiction, no prior firm-level relationship, no public PEP match. Documentation: a translated nominee-declaration notarised 2022. ETT declines to provide SoW documents.' },
    { id: 'fund_large_redemption', label: 'Fund — outsized redemption with side instruction', question: 'Process or hold?', context: 'LP EUU submitted AED 88M redemption 20 Apr 2026 (34% of fund). Redemption instruction: AED 60M to EUU\'s registered account; AED 28M to a different third-party UAE LLC. Fund document requires payment to "registered LP account." EUU claims verbal pre-agreement with GP. No written authority.' },
    { id: 'market_insider_trade', label: 'Market — insider-dealing suspicion', question: 'STR + market-abuse report?', context: 'Customer EVV (brother of UAE-listed issuer\'s CFO) bought AED 2.4M of issuer\'s shares 3 trading days before a positive earnings surprise on 18 Apr 2026. EVV\'s prior trading pattern on the issuer: zero 12-month activity. Post-announcement trim of position: 40% sold within 48h.' },
    { id: 'market_front_run', label: 'Market — front-running before client block', question: 'Internal investigation scope?', context: 'UAE-licensed broker-dealer trader EWW placed personal trades 11 minutes before executing a client block of AED 18M in the same security, 14 Apr 2026. Personal trade sized at 0.4% of client block but consistently profitable over 9 similar incidents 2024-26. Surveillance alerts previously dismissed.' },
    { id: 'market_spoofing_pattern', label: 'Market — spoofing pattern', question: 'STR + market-abuse investigation?', context: 'Algo trader EXX (proprietary) shows 84% cancel-before-fill ratio on a UAE small-cap stock Mar-Apr 2026. Layered bids consistently 2 ticks above the offer, cancelled within 40ms after offer fill. Cumulative notional AED 22M spoofed layers. Pattern matches MIFID II spoofing annex.' },
    { id: 'market_wash_circ', label: 'Market — wash / circular between related parties', question: 'Related-party pattern?', context: 'Two brokerage accounts EYY-1 and EYY-2 (same UBO family), different nominee holders, consistently take opposite sides on same UAE mid-cap stock. 38 matched trades Feb-Apr 2026, AED 14M notional. Net exposure near-zero; commissions accrue. Apparent wash trading for volume appearance.' },
    { id: 'market_painting_tape', label: 'Market — painting the tape at quarter-end', question: 'Mark-up or abuse?', context: 'Asset manager EZZ for a UAE fund placed 16 on-close buy orders in 4 thinly-traded names on 28 Mar 2026 (quarter-end), AED 34M notional total. Prices lifted 2-6% on close, NAV valuations correspondingly elevated. Names were reversed in first hour of next trading day with minor loss.' },
    { id: 'market_corner_bid', label: 'Market — cornering via derivative', question: 'Position-accumulation intent?', context: 'Trader FAA accumulated via options 32% of the free float of a UAE-listed small cap over 6 weeks, delta-exposure fully disclosed only at 28 Feb position report. Derivative counterparty is a Cayman-domiciled unregulated family office. Underlying stock liquidity insufficient to deliver on expiry without squeeze.' },
    { id: 'market_pump_dump', label: 'Market — pump-and-dump micro-cap', question: 'STR + regulator notification?', context: 'UAE-listed micro-cap FBB saw 420% price rise Feb 2026 on abnormal volume. Social-media promotion coordinated through 8 Telegram channels (later traced to a single operator). Insider-linked accounts distributed AED 28M at peak, price collapsed 72% within 10 days. Firm processed some retail inflows.' },
    { id: 'market_churning_adv', label: 'Market — adviser churning client accounts', question: 'Investigate adviser?', context: 'Adviser FCC managed 14 high-net-worth accounts Q1 2026. Turnover ratio on those accounts: 8.4 (peer median 1.1). Cost-to-equity 11% (peer median 2%). Commission revenue up 6x YoY for adviser. Client mandates: "capital preservation" — inconsistent with observed activity.' },
    { id: 'market_cross_venue', label: 'Market — cross-venue abuse', question: 'Holistic detection?', context: 'Trader FDD executed on UAE exchange the opposite side of his own order placed via a London OTC counterparty. Net economic result: arbitrage of information about UAE auction. Surveillance segmented by venue missed the cross-venue matching. 34 such trades Feb-Apr 2026, AED 4.2M profit.' },
    { id: 'market_kiting_corp', label: 'Market / operational — kiting between corporate entities', question: 'Operational risk or fraud?', context: 'UAE corporate FEE transfers AED 88M repeatedly between two internal accounts 2 days before month-end and reverses after month-end, Feb-Apr 2026 pattern. Effect: inflated month-end average balance used in covenant-compliance reports. External auditor preliminary view: potential covenant circumvention.' },
    { id: 'fraud_bec_redirect', label: 'Fraud — invoice-redirect BEC', question: 'Release, hold, or recall?', context: 'Firm received 19 Apr 2026 email appearing to be from long-standing supplier FFF changing payment bank from UAE to a UK account. Email domain differs by one character. Email timing: 40 minutes before scheduled AED 2.6M payment. Supplier contact number unchanged but went to voicemail when verified.' },
    { id: 'fraud_app_romance', label: 'Fraud — APP romance scam pattern', question: 'Intervene with customer?', context: 'Customer FGG (UAE-resident, retired, age 68) sent 11 outbound wires Jan-Apr 2026 totalling AED 620K to 4 different recipients all in the same Asian jurisdiction. Narrative consistent across wires: "loans to a friend." FGG\'s prior pattern: zero international remittance. Two withdrawals flagged by branch staff; customer insistent.' },
    { id: 'fraud_investment_scam', label: 'Fraud — investment-scam victim', question: 'Prevent ongoing loss?', context: 'Customer FHH invested AED 840K via 14 payments Feb-Apr 2026 into an unregulated crypto-"fund" promising 18%/month returns. Inbound "profit" payments AED 62K suspicious (funded by a prepaid-card cluster). Customer plans AED 2M top-up 22 Apr 2026 to "unlock withdrawal." ScamSmart fits classic playbook.' },
    { id: 'fraud_synthetic_onboard', label: 'Fraud — synthetic-identity onboarding', question: 'Onboard or reject?', context: 'Onboarding application FII (DIFC-entity director) 18 Apr 2026: passport valid, utility bill 3 weeks old, phone SIM activated 12 days ago, LinkedIn 30 days old. Name cluster matches 4 other recent applications with rotating addresses in one free zone. Credit footprint: newly built with 2 unsecured cards.' },
    { id: 'fraud_identity_theft_breach', label: 'Fraud — identity-theft via credential stuff', question: 'Notify customer + restrict access?', context: 'Customer FJJ\'s online banking showed 14 failed-login attempts from 4 geographies 17 Apr 2026, then 1 successful login from a country FJJ has not visited. Subsequent: AED 38K outbound wire to new beneficiary. FJJ reports they did not log in; phone shows no security alerts from firm\'s system.' },
    { id: 'fraud_phoenix_supplier', label: 'Fraud — phoenix supplier pattern', question: 'Onboard new entity or flag?', context: 'New supplier FKK applied 19 Apr 2026 for onboarding. Directors: same 2 individuals who 60 days prior ran supplier FLL that went into liquidation owing the firm AED 820K. New entity shares phone, email domain, and website template with FLL. Claims no legal continuity.' },
    // Wave 2 / batch 4 scenarios — compliance operations + audit.
    { id: 'ops_alert_backlog', label: 'Ops — 60-day alert backlog', question: 'Reprioritise or resource?', context: 'Firm\'s transaction-monitoring team has 2,340 alerts unactioned as of 20 Apr 2026; 412 are >60 days old. 14 high-risk-score alerts are >90 days. Root-cause analysis: analyst headcount down 2 since Jan, alert-volume up 38% since a new rule deployed 1 Feb. MLRO informed 19 Apr.' },
    { id: 'ops_rule_tuning', label: 'Ops — rule tuning with fp explosion', question: 'Tune or roll back?', context: 'Rule R-47 (structuring-detection) deployed 1 Feb 2026 has produced 6,800 alerts, 340 productive (5% conversion). Prior rule: 1,200 alerts, 220 productive (18% conversion). New rule was tuned to a broader segment in response to CBUAE feedback. Governance did not pre-test on historical data.' },
    { id: 'ops_dashboard_drift', label: 'Ops — compliance dashboard KPI drift', question: 'Investigate drift or accept?', context: 'STR-per-1000-customers KPI stood at 2.8 through 2025, dropped to 1.4 in Q1 2026 without corresponding drop in risk signals. Investigation 18 Apr 2026: a data-feed change 6 Feb 2026 dropped part of the alert pipeline. Missing alerts AED 28M cumulative exposure.' },
    { id: 'ops_pen_test_finding', label: 'Ops — internal pen-test found onboarding bypass', question: 'Remediation plan?', context: 'Internal pen-test 15 Apr 2026 successfully onboarded 3 synthetic-identity test-cases using document tampering and alternate-phone-verification bypass. Control that should have rejected: document-authenticity service. Service provider reports vendor-side defect under review.' },
    { id: 'ops_segmentation_drift', label: 'Ops — customer segmentation drift', question: 'Re-segment or remediate?', context: 'Customer-segmentation model was last recalibrated 2024. Model-drift monitoring 17 Apr 2026 indicates 14% of customers sit in the wrong segment vs current risk profile. Consequences: monitoring rule selection mis-applied. Risk of undetected typology elevated.' },
    { id: 'ops_tm_threshold', label: 'Ops — TM threshold tune against peer median', question: 'Raise or lower thresholds?', context: 'Firm\'s monitoring thresholds are ~2.5x peer-median tight on cash-intensity rule, resulting in 11x peer-alert rate and 90%+ false positive rate. CBUAE 2025 thematic review feedback: "alert fatigue masking genuine signals." Proposed recalibration reduces alert count 70%, increases productive conversion to 16%.' },
    { id: 'ops_model_validation', label: 'Ops — risk-scoring model validation', question: 'Model-refresh plan?', context: 'Independent model-validation 14 Apr 2026 on risk-scoring model finds: training-data ends 2023, 2 of 18 features have drifted >3-sigma, model explainability tooling missing for 3 critical features, fairness audit shows segment-specific error rates 2-3x aggregate.' },
    { id: 'ops_outsourced_soc', label: 'Ops — outsourced screening provider SOC-2 gap', question: 'Continue with mitigations or insource?', context: 'Outsourced sanctions-screening provider EJK\'s SOC-2 Type II report lapsed 31 Mar 2026. New report not yet delivered. Firm dependency: 100% of daily screening. Contract penalty clauses available but 90-day notice. Alternate provider transition 120 days.' },
    { id: 'ops_bcp_fault', label: 'Ops — BCP fault on compliance stack', question: 'Acceptable continuity posture?', context: 'Firm\'s compliance-monitoring secondary site failed routine failover test 11 Apr 2026. Primary site unchanged but RTO 72h now unmet. Regulatory-reporting endpoints depend on primary. Next BCP test scheduled Jun 2026. Remediation window estimated 6 weeks.' },
    { id: 'ops_logging_gap', label: 'Ops — logging gap discovered on STR system', question: 'FDL Art.24 retention impact?', context: 'Internal audit 17 Apr 2026 found STR-system event logging disabled 10-27 Feb 2026 during maintenance. 14 STRs filed in window; audit trail of review / approval events absent for those. MLRO has memory-level confirmation but no system-evidence.' },
    { id: 'mlro_str_draft_review', label: 'MLRO — STR draft quality review', question: 'Approve filing or revise?', context: 'STR draft FMM on counterparty FNN: narrative complete on Who-What-When-Where; Why (typology) is vague; How (mechanism) mis-identifies channel (stated SWIFT, actual on-chain). Citation of FATF Rec cited incorrectly. Proposed filing today; "without delay" obligation active per FDL Art.26-27.' },
    { id: 'mlro_four_eyes_reversal', label: 'MLRO — four-eyes reversal in progress', question: 'Reversal defensible?', context: 'First-line decision 18 Apr 2026: dismiss sanctions alert as 0.58 false-positive. Second-pair MLRO review disagrees, citing overlooked address match and passport-suffix match pushing effective confidence to 0.76. Reversal means freeze within 24h of confirmed match window opening.' },
    { id: 'mlro_override_front_office', label: 'MLRO — override of front-office decision', question: 'Document the override?', context: 'Front office recommended EDD continuation for customer FOO (DPMS wholesale, AED 18M AUM, 4 sanctions alerts in 12 months all "dismissed"). MLRO override 19 Apr 2026 decides exit. Commercial pushback from senior relationship manager; MLRO memo and board-notification in draft.' },
    { id: 'mlro_training_rollout', label: 'MLRO — 30-day training rollout deadline', question: 'Achieve coverage?', context: 'New MoE Circular issued 22 Mar 2026; firm\'s policy-update deadline 21 Apr 2026. Training deployment plan: live-session Mon/Tue 28-29 Apr (post-deadline), eLearning alternative by 20 Apr. Attestation collected: 187 of 320 staff (58%). 30-day deadline approaches; MLRO assessing.' },
    { id: 'mlro_regulator_meeting', label: 'MLRO — regulator bilateral meeting', question: 'Prepare briefing pack?', context: 'CBUAE bilateral meeting requested 27 Apr 2026 on "sector-wide TBML trends." Firm sector exposure: DPMS wholesale AED 184M book. Year-to-date STRs: 14. CBUAE advisory letter 2024 still open on 1 remediation item. MLRO and CO preparing joint-briefing, board pre-briefing scheduled 24 Apr.' },
    { id: 'mlro_board_quarter', label: 'MLRO — board quarterly report Q1 2026', question: 'Material items to flag?', context: 'Q1 2026 KPIs: STRs 14 (Q4 2025: 10); sanctions freezes 2 (Q4 2025: 0); open audit findings 3 (new since Q4: 1); training completion 94% (target 100%); risk-appetite breach 1 (temporary exception approved). Board meeting 28 Apr.' },
    { id: 'mlro_risk_appetite_change', label: 'MLRO — proposed risk-appetite change', question: 'Recommend acceptance?', context: 'Business proposal 16 Apr 2026 to expand into correspondent VASP clearing, adds 3 high-risk-jurisdiction VASP partners. Current risk-appetite: "no direct VASP clearing outside FATF-compliant jurisdictions." Proposal: one-off exception. MLRO assessment and board recommendation due 25 Apr.' },
    { id: 'mlro_ew_risk_assessment', label: 'MLRO — enterprise-wide risk assessment refresh', question: 'Scope complete?', context: 'Annual EWRA refresh scheduled Q2 2026. Current EWRA approved Jul 2025. Intervening events: new VARA rulebook, FATF update, CBUAE correspondent-banking standard, new crypto-funds sub-fund, MoE circular. MLRO evaluating whether to bring refresh forward.' },
    { id: 'mlro_rfi_scope', label: 'MLRO — CBUAE RFI scope', question: 'Response strategy?', context: 'CBUAE RFI 17 Apr 2026 requests: (a) 18-month correspondent-banking flow data, (b) all STRs filed since Jul 2025, (c) sanctions-screening exception log, (d) MLRO tenure documentation. Response due 2 May 2026. Privilege considerations apply to part of (b); legal counsel engaged.' },
    { id: 'mlro_ai_self_audit', label: 'MLRO — AI-governance self-audit finding', question: 'Remediate before next review?', context: 'Self-audit 18 Apr 2026 against EU AI Act + NIST AI RMF + ISO/IEC 42001 + UAE AI Ethics flagged: 1 black-box alert-scoring rule (no explanation layer), 2 auto-actions without four-eyes (auto-dismiss of lowest-score alerts), 1 training-data-bias indicator (segment-specific error). Next review 30 days.' },
    { id: 'audit_lookback_sample', label: 'Audit — lookback sample deviation', question: 'Escalate or re-sample?', context: 'Internal-audit 12-month CDD lookback 15 Apr 2026: sample 200 files, 24 deviations found (12% rate, vs 3% acceptance threshold). Deviations concentrate in one branch (16 of 24). Root cause: staff-change mid-year + training lag. Re-sample on that branch proposed.' },
    { id: 'audit_finding_open', label: 'Audit — finding open past-due', question: 'Escalate to board?', context: 'Audit finding #23-04 on "sanctions screening coverage gaps on correspondent flows" opened Apr 2024. Original remediation deadline Dec 2024, extended twice. Currently 14 months past original deadline. Remediation lead changed 3 times. Board audit-committee meeting 28 Apr.' },
    { id: 'audit_independent_engagement', label: 'Audit — independent assurance scope', question: 'Scope acceptable?', context: 'External independent assurance engagement 2026 kicks off 30 Apr. Proposed scope: risk-assessment process + policy adequacy + STR-quality + training + governance. Out-of-scope: sanctions-screening effectiveness + UBO register + goAML filing quality. MLRO requested scope expansion; engagement partner pushing back on timeline.' },
    { id: 'audit_data_integrity', label: 'Audit — sample integrity concern', question: 'Reject sample or proceed?', context: 'External-audit reviewer flagged that internal audit\'s CDD-sample selection 11 Apr 2026 appears to have excluded a particular branch without documented exclusion rationale. Excluded-branch customer base is 14% of firm. Sample used in prior quarter\'s Board report.' },
    { id: 'incident_lessons', label: 'Incident — lessons-learned after sanctions breach', question: 'Sufficient control change?', context: 'Feb 2026 sanctions alert missed on correspondent customer, discovered Apr 2026, freeze executed 14 days late (vs 24h target). Root causes: list-refresh lag, alert-routing mis-config, analyst-workload spike. Remediation: list-refresh automation + alert-routing test + headcount. Implementation 60 days.' }
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
    var reasoningModeOptions = REASONING_MODES.map(function (m) {
      return '<option value="' + m.id + '" title="' + escapeHtml(m.description) + '">' +
        escapeHtml(m.label) + '</option>';
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
      '      <select class="dr-select" id="drReasoningMode" aria-label="Reasoning mode" title="Controls the analytical frame the executor uses">',
      reasoningModeOptions,
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
      '      <span class="dr-hint">Rate-limited 10/min per IP. Streaming · 25s budget.</span>',
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
    // Client-side scope guard — reject obviously out-of-scope prompts
    // before they hit the /api/brain-reason endpoint. The server-side
    // system prompt has a SCOPE GATE too (defence in depth). This
    // client check saves the 25s round trip + avoids the frustrating
    // "the advisor answered a non-compliance question" loop the MLRO
    // reported on 2026-04-21 (the "someone shut at me" typo case that
    // produced a full emergency-response reply).
    //
    // Heuristic: the question is OUT OF SCOPE if it does NOT mention
    // any compliance-domain keyword AND the case context is empty.
    // Short enough to never nag a legitimate shorthand like "draft
    // STR for case 123" because "STR" is in the keyword list.
    var COMPLIANCE_KEYWORDS = [
      'aml', 'cft', 'cpf', 'mlro', 'str', 'sar', 'ctr', 'cnmr', 'dpmsr', 'pmr',
      'cdd', 'sdd', 'edd', 'kyc', 'ubo', 'pep', 'goaml', 'ofac', 'sanction',
      'freeze', 'eocn', 'tfs', 'fatf', 'lbma', 'rgg', 'cahra', 'dpms',
      'customer', 'counterparty', 'subject', 'transaction', 'threshold',
      'screening', 'match', 'adverse media', 'shell company', 'layering',
      'structuring', 'tbml', 'trade-based', 'proliferation',
      'article', 'cabinet res', 'fdl', 'fiu', 'moe', 'cbuae',
      'regulation', 'inspection', 'audit', 'compliance', 'four-eyes',
      'four eyes', 'bayesian', 'risk score', 'onboarding',
      'aed ', 'aed55', 'aed 55', 'aed 60', 'aed 25',
      'verdict', 'escalate', 'confirm match', 'false positive',
      'workflow', 'routine', 'cron', 'narrative', 'filing', 'deadline',
      'hawkeye', 'sterling', 'tenant',
    ];
    function isLikelyCompliance(q, c) {
      var hay = ((q || '') + ' ' + (c || '')).toLowerCase();
      for (var i = 0; i < COMPLIANCE_KEYWORDS.length; i++) {
        if (hay.indexOf(COMPLIANCE_KEYWORDS[i]) !== -1) return true;
      }
      return false;
    }

    runBtn.addEventListener('click', function () {
      var q = (mount.querySelector('#drQuestion').value || '').trim();
      var c = (mount.querySelector('#drContext').value || '').trim();
      var modeId = (mount.querySelector('#drReasoningMode') || {}).value || 'standard';
      var modeDef = REASONING_MODES.filter(function (m) { return m.id === modeId; })[0] || REASONING_MODES[0];
      var modePrefix = modeDef.prefix || '';
      errEl.textContent = '';
      resultWrap.innerHTML = '';
      if (!q) {
        errEl.textContent = 'Enter a compliance question.';
        return;
      }
      // Scope gate first — refuse non-compliance questions before we
      // spend any tokens. Matches the FDL Art.20-21 intent: this tool
      // is the MLRO's reasoning aid, not a general-purpose assistant.
      if (!isLikelyCompliance(q, c)) {
        errEl.textContent =
          'OUT OF SCOPE: this tool only answers UAE AML/CFT/CPF compliance questions. ' +
          'Pick a preset below, or rephrase with a compliance subject ' +
          '(customer / counterparty / transaction / STR / sanctions match / CDD / UBO).';
        return;
      }
      // Pre-flight length guard — the server caps the composed `question`
      // field (modePrefix + user text) at 4000 chars. Warn before submit
      // rather than letting the fetch fail with HTTP 400. Worst
      // reasoning-mode prefix today is ~1030 chars (see REASONING_MODES).
      var MAX_COMPOSED_QUESTION = 4000;
      var composedLen = modePrefix.length + q.length;
      if (composedLen > MAX_COMPOSED_QUESTION) {
        var overflow = composedLen - MAX_COMPOSED_QUESTION;
        errEl.textContent = 'Question + reasoning-mode prefix is ' + composedLen +
          ' chars (limit ' + MAX_COMPOSED_QUESTION + '). Shorten the question by ~' +
          overflow + ' chars, switch to Standard/Speed mode, or move background detail into Case Context.';
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
        body: JSON.stringify({ question: modePrefix + q, caseContext: c || undefined }),
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
              // If no delta arrived before the wall-clock ceiling
              // fired, the server's "Partial reply above" phrasing is
              // misleading — there is no partial to read. Surface a
              // distinct message so the MLRO knows to shorten the
              // prompt instead of hunting for an answer in an empty
              // result area.
              if (fullText && fullText.trim().length > 0) {
                errEl.textContent = data.error || 'Deep reasoning hit the 25s budget. Partial reply above — try a shorter question, the Speed mode, or split into two calls.';
              } else {
                errEl.textContent = 'Deep reasoning timed out before producing any text. Try a shorter question, the Speed mode, or move background detail into the Case Context field.';
              }
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
