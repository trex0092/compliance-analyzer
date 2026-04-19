/**
 * Life-Story Report Builder — first-screen deep-dive markdown.
 *
 * When a subject is screened for the FIRST time (event types
 * `new_customer_onboarding` or `periodic_review`), the MLRO needs the
 * full life story in one place: name variants, sanctions coverage,
 * 3-year historical adverse media, UBO + shell-company indicators,
 * transaction-risk signals, and a regulatory-anchored action
 * checklist. The output below becomes the Asana task description
 * posted to "The Screenings" section (project 1214124911186857).
 *
 * Compact markdown layout — no horizontal rules between sections so
 * the task description does not waste vertical space in the Asana
 * board column preview. Tables keep information dense without
 * sacrificing readability.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (name-variant due diligence)
 *   - FDL Art.24 (10-yr retention — this document IS the audit record)
 *   - FDL Art.26-27 (STR drafting inputs)
 *   - FDL Art.29 (no tipping off — rendered as a footer)
 *   - Cabinet Res 74/2020 Art.3-7 (sanctions + UN fallback)
 *   - Cabinet Res 134/2025 Art.14 (EDD trigger)
 *   - Cabinet Res 134/2025 Art.19 (periodic internal review — cadence)
 *   - FATF Rec 10 (CDD + onboarding due diligence — 3-year lookback)
 *   - LBMA RGG v9 (responsible gold — CAHRA sourcing controls)
 *   - MoE Circular 08/AML/2021 (DPMS AED 55K CTR threshold)
 */

export interface LifeStoryPerListRow {
  list: string;
  status: 'ok' | 'snapshot' | 'fallback' | 'error';
  topScore: number;
  hitCount: number;
  note?: string;
}

export interface LifeStoryAdverseHit {
  date?: string;
  source?: string;
  title: string;
  url: string;
  relevance?: number;
}

export interface LifeStoryInput {
  screeningId: string;
  ranAt: string;
  subjectName: string;
  aliases?: string[];
  nameVariants?: string[];
  dob?: string;
  nationality?: string;
  entityType?: 'natural' | 'legal' | string;
  jurisdiction?: string;
  eventType?: string;

  integrity: 'complete' | 'degraded' | 'incomplete';
  integrityReasons?: string[];

  verdict: 'clean' | 'monitor' | 'escalate' | 'freeze';
  confidence?: number;
  compositeRisk?: number;
  riskRating?: 'low' | 'medium' | 'high' | 'critical' | string;
  cddLevel?: 'SDD' | 'CDD' | 'EDD' | string;
  reviewCadenceMonths?: number;

  perList: LifeStoryPerListRow[];
  sanctionsTopClassification: string;

  pepHit?: boolean;
  pepDetail?: string;

  adverseMediaWindowDays?: number;
  adverseMediaSinceDate?: string;
  adverseMediaProviders?: string[];
  adverseMediaHits?: LifeStoryAdverseHit[];
  adverseMediaWhyItMatters?: string;

  uboSelfHeldPercent?: number;
  shellCompanyFlags?: string[];
  layeringFlags?: string[];
  vaspWallets?: string[];

  mlroActions?: string[];
  opusAdvisorInvoked?: boolean;
  zkProofSealGid?: string;
}

const HYPHEN = '—';

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : HYPHEN;
}

function fmtPct(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return HYPHEN;
  return n.toFixed(2);
}

function joinOr(xs: readonly string[] | undefined, dash = HYPHEN): string {
  if (!xs || xs.length === 0) return dash;
  return xs.join(', ');
}

function verdictLine(v: LifeStoryInput['verdict']): string {
  switch (v) {
    case 'freeze':
      return 'FREEZE (asset freeze within 24h — Cabinet Res 74/2020 Art.4-7)';
    case 'escalate':
      return 'ESCALATE (EDD required, CO approval mandatory)';
    case 'monitor':
      return 'MONITOR (accept with ongoing monitoring)';
    case 'clean':
    default:
      return 'CLEAN (standard CDD cadence)';
  }
}

/**
 * Build the compact life-story markdown. Every section is kept to
 * a single visual block so Asana's board preview shows maximum
 * density without horizontal rules between sections.
 */
export function buildLifeStoryMarkdown(input: LifeStoryInput): string {
  const out: string[] = [];

  out.push('# SCREENING — FULL LIFE STORY');
  const variantLabel = input.nameVariants?.length
    ? ` (also: ${input.nameVariants.filter((v) => v !== input.subjectName).join(', ')})`
    : input.aliases?.length
      ? ` (also: ${input.aliases.join(', ')})`
      : '';
  out.push(`**Subject:** ${input.subjectName}${variantLabel}`);
  const hdrParts: string[] = [];
  if (input.dob) hdrParts.push(`**DOB:** ${input.dob}`);
  if (input.nationality) hdrParts.push(`**Nat:** ${input.nationality}`);
  if (input.entityType) hdrParts.push(`**Type:** ${input.entityType}`);
  if (input.jurisdiction) hdrParts.push(`**Jurisdiction:** ${input.jurisdiction}`);
  if (hdrParts.length) out.push(hdrParts.join('  '));
  const metaParts: string[] = [];
  if (input.eventType) metaParts.push(`**Event:** ${input.eventType}`);
  metaParts.push(`**Screening ID:** ${input.screeningId}`);
  out.push(metaParts.join('  '));
  const integrityEmoji =
    input.integrity === 'complete' ? '✅' : input.integrity === 'degraded' ? '⚠️' : '❌';
  out.push(
    `**Run:** ${input.ranAt}  **Integrity:** ${input.integrity.toUpperCase()} ${integrityEmoji}`
  );

  out.push('');
  out.push(`## 1. VERDICT — ${verdictLine(input.verdict)}`);
  const vParts: string[] = [];
  if (typeof input.confidence === 'number') vParts.push(`Confidence ${fmtPct(input.confidence)}`);
  if (input.opusAdvisorInvoked) vParts.push('Opus advisor invoked');
  vParts.push('**do NOT notify the subject (FDL Art.29)**');
  out.push(vParts.join(' — '));
  out.push('| Composite risk | CDD level | Review cadence |');
  out.push('|---:|:---:|:---:|');
  const risk = typeof input.compositeRisk === 'number' ? `${input.compositeRisk} / 100` : HYPHEN;
  const rating = input.riskRating ? ` — ${input.riskRating.toUpperCase()}` : '';
  const cadence = input.reviewCadenceMonths ? `${input.reviewCadenceMonths} months` : HYPHEN;
  out.push(`| **${risk}${rating}** | **${input.cddLevel ?? HYPHEN}** | ${cadence} |`);

  out.push('');
  const variantCount = input.nameVariants?.length ?? (input.aliases ? input.aliases.length + 1 : 1);
  out.push(
    `## 2. SANCTIONS (${input.sanctionsTopClassification} — ${variantCount} name variants fanned out)`
  );
  out.push('| List | Status | Top | Note |');
  out.push('|---|---|---:|---|');
  for (const row of input.perList) {
    out.push(`| ${row.list} | ${row.status} | ${fmt(row.topScore)} | ${row.note ?? HYPHEN} |`);
  }

  out.push('');
  out.push(
    `## 3. PEP — ${input.pepHit ? 'HIT' : 'Not PEP'}${input.pepDetail ? `. ${input.pepDetail}` : '. No PEP-by-association.'}`
  );

  out.push('');
  const windowLabel = input.adverseMediaSinceDate
    ? `${input.adverseMediaSinceDate} → ${input.ranAt.slice(0, 10)}`
    : input.adverseMediaWindowDays
      ? `last ${input.adverseMediaWindowDays} days`
      : HYPHEN;
  const hitCount = input.adverseMediaHits?.length ?? 0;
  out.push(`## 4. ADVERSE MEDIA (FATF Rec 10)`);
  out.push(
    `**Window:** ${windowLabel} · **Providers:** ${joinOr(input.adverseMediaProviders)} · **${hitCount} hits deduped**`
  );
  if (hitCount > 0) {
    out.push('| Date | Source | Headline | Rel |');
    out.push('|---|---|---|---:|');
    for (const h of input.adverseMediaHits!) {
      const relStr = typeof h.relevance === 'number' ? h.relevance.toFixed(2) : HYPHEN;
      out.push(`| ${h.date ?? HYPHEN} | ${h.source ?? HYPHEN} | ${h.title} | ${relStr} |`);
    }
  }
  if (input.adverseMediaWhyItMatters) {
    out.push(`**Why it matters:** ${input.adverseMediaWhyItMatters}`);
  }

  out.push('');
  out.push('## 5. UBO & NETWORK');
  const uboBits: string[] = [];
  if (typeof input.uboSelfHeldPercent === 'number') {
    uboBits.push(`${input.uboSelfHeldPercent}% self-held`);
  }
  const flagBits: string[] = [];
  if (input.shellCompanyFlags?.length) flagBits.push(...input.shellCompanyFlags);
  if (input.layeringFlags?.length) flagBits.push(...input.layeringFlags);
  if (input.vaspWallets?.length) {
    flagBits.push(`VASP wallets: ${input.vaspWallets.join(', ')}`);
  } else {
    flagBits.push('No VASP wallets');
  }
  if (flagBits.length > 0) uboBits.push(`**FLAGS:** ${flagBits.join('; ')}`);
  out.push(uboBits.length ? uboBits.join('. ') + '.' : 'No UBO / network flags.');

  out.push('');
  out.push(
    '## 6. TRANSACTION-RISK SIGNALS — If cash ≥ AED 55K → CTR via goAML (MoE Circular 08/AML/2021). If UN-1718/1737 derivative hit → 24h freeze (Cabinet Res 74/2020 Art.4-7).'
  );

  out.push('');
  out.push('## 7. MLRO ACTIONS');
  const actions = input.mlroActions?.length ? input.mlroActions : defaultActionsFor(input.verdict);
  for (const a of actions) out.push(`- [ ] ${a}`);

  out.push('');
  out.push('## 8. AUDIT TRAIL (FDL Art.24 — 10y)');
  const auditBits = [input.screeningId];
  if (input.opusAdvisorInvoked) auditBits.push('Opus advisor trace (subtask)');
  if (input.zkProofSealGid) auditBits.push(`zk-proof seal ${input.zkProofSealGid}`);
  out.push(auditBits.join(' · '));

  return out.join('\n');
}

function defaultActionsFor(verdict: LifeStoryInput['verdict']): string[] {
  switch (verdict) {
    case 'freeze':
      return [
        'FREEZE funds within 24h (Cabinet Res 74/2020 Art.4)',
        'File EOCN notification within 24h',
        'File CNMR within 5 business days',
        'Do NOT notify subject (FDL Art.29)',
      ];
    case 'escalate':
      return [
        'BLOCK onboarding pending EDD (Cabinet Res 134/2025 Art.14)',
        'Senior Mgmt approval before relationship opens',
        'Obtain certified KYC + notarised UBO + source-of-wealth evidence',
        'Pre-emptive STR draft (FDL Art.26-27) — attached as subtask',
        'Add subject + name variants to continuous-monitor watchlist',
      ];
    case 'monitor':
      return [
        'Accept with enhanced ongoing monitoring',
        'Add to continuous-monitor watchlist (daily re-screen)',
        'Re-review in 6 months (Cabinet Res 134/2025 Art.19)',
      ];
    case 'clean':
    default:
      return [
        'Standard CDD cadence — annual review (Cabinet Res 134/2025 Art.19)',
        'Add to continuous-monitor watchlist (daily re-screen)',
      ];
  }
}
