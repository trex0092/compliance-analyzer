/**
 * Immediate Risk Alerts — dispatcher that fires an Asana task within
 * seconds of a relevant event for any watched subject.
 *
 * Triggers supported today:
 *   - sanctions-ingest delta (NEW / AMENDMENT / DELISTING across
 *     UN/OFAC SDN/OFAC Cons/EU/UK OFSI/UAE EOCN) — called from
 *     netlify/functions/sanctions-ingest-cron.mts after computeDelta.
 *   - adverse-media hot-ingest hit — called from the hot-ingest path
 *     when a new article mentions a watched subject.
 *   - PEP status change — called when a PEP feed flips a watched
 *     subject from non-PEP to PEP or vice versa.
 *   - UBO status change — called when a UBO register change moves a
 *     watched subject's >25% ownership.
 *
 * For each trigger, the dispatcher:
 *   1. Loads the current watchlist from Netlify Blobs.
 *   2. Scores every (subject, candidate) pair via scoreHitAgainstProfile.
 *   3. Suppresses name-only coincidences (classification 'suppress').
 *   4. Builds a unified Asana task via buildRiskAlertTask.
 *   5. Posts the task to the SCREENINGS project via createAsanaTask.
 *
 * The dispatcher is deliberately I/O-dependency-injected: tests pass in
 * fake loaders and fake Asana posters so the whole flow can be driven
 * deterministically without touching Netlify Blobs or the Asana API.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21    CO monitoring duty (must see immediately)
 *   FDL No.10/2025 Art.24       10yr audit retention of the alert
 *   FDL No.10/2025 Art.29       never notify the subject (footer in task)
 *   FDL No.10/2025 Art.35       TFS — freeze THE subject, not the name
 *   Cabinet Res 74/2020 Art.4   "without delay" — hence "immediate"
 *   Cabinet Res 134/2025 Art.19 periodic internal review of monitoring
 *   FATF Rec 10                 positive identification required
 */

import { getStore } from '@netlify/blobs';
import { createAsanaTask } from './asanaClient';
import { deserialiseWatchlist, listAllEntries, type WatchlistEntry } from './screeningWatchlist';
import { scoreHitAgainstProfile, type IdentityMatchResult } from './identityMatchScore';
import {
  buildRiskAlertTask,
  type RiskAlertChangeType,
  type RiskAlertContext,
  type RiskAlertMatch,
  type RiskAlertScore,
  type RiskAlertTrigger,
} from './riskAlertTemplate';
import {
  calibrateIdentityScore,
  observeIdentityEvidence,
  type CalibratedIdentityScore,
} from './identityScoreBayesian';
import {
  computeCorroboration,
  corroborationForSubject,
  type SubjectCorroboration,
} from './multiListCorroboration';
import { runDeliberativeBrain, type DeliberativeBrainResult } from './deliberativeBrainChain';
import { runForensicInvestigation, type ForensicInvestigation } from './forensicInvestigator';
import type { NormalisedSanction } from './sanctionsIngest';

// ---------------------------------------------------------------------------
// Injected dependencies — swappable for tests
// ---------------------------------------------------------------------------

export interface ImmediateRiskAlertsDeps {
  /** Load the full watchlist — defaults to Netlify Blobs 'screening-watchlist'/'current'. */
  loadWatchlist: () => Promise<WatchlistEntry[]>;
  /** Post a task to Asana — defaults to createAsanaTask(). */
  postTask: (input: {
    name: string;
    notes: string;
    projects: string[];
    tags: string[];
  }) => Promise<{ ok: boolean; gid?: string; error?: string }>;
  /** Env reader — defaults to process.env (allows test override). */
  env: (key: string) => string | undefined;
  /** Clock — defaults to new Date(). */
  now: () => Date;
  /**
   * Load the set of dispatch fingerprints already seen recently — used to
   * suppress duplicate Asana tasks if the cron re-runs on the same delta
   * within the dedup window (24h UTC day by default). Default backing
   * store is Netlify Blobs 'immediate-risk-alerts-dedup'/<YYYY-MM-DD>.
   */
  loadDispatchFingerprints: () => Promise<Set<string>>;
  /** Persist the updated dispatch-fingerprint set. Called at end of run. */
  saveDispatchFingerprints: (fps: Set<string>) => Promise<void>;
}

const WATCHLIST_STORE = 'screening-watchlist';
const WATCHLIST_KEY = 'current';
const DEFAULT_SCREENINGS_PROJECT_GID = '1213759768596515';
const DEDUP_STORE = 'immediate-risk-alerts-dedup';

function dedupKeyForDay(iso: string): string {
  return iso.slice(0, 10);
}

async function defaultLoadWatchlist(): Promise<WatchlistEntry[]> {
  try {
    const store = getStore(WATCHLIST_STORE);
    const raw = (await store.get(WATCHLIST_KEY, { type: 'json' })) as unknown;
    const wl = deserialiseWatchlist(raw);
    return listAllEntries(wl);
  } catch (err) {
    // CRITICAL operability signal: a silent [] here means the sanctions
    // ingest cron will screen every delta against an empty watchlist —
    // every customer match is then invisibly missed. Surface the error
    // so ops can detect Blobs outages that would otherwise produce
    // false "all clear" runs. Return [] preserved for dev/local
    // (Blobs unavailable) and to avoid crashing the cron, but the
    // caller MUST treat repeated empty-on-error signals as a reason
    // to abort dispatch. FDL No.10/2025 Art.20-21.
    console.error(
      '[immediateRiskAlerts] defaultLoadWatchlist failed — screening may run against empty watchlist',
      err
    );
    return [];
  }
}

async function defaultLoadDispatchFingerprints(): Promise<Set<string>> {
  try {
    const store = getStore(DEDUP_STORE);
    const key = dedupKeyForDay(new Date().toISOString());
    const raw = (await store.get(key, { type: 'json' })) as unknown;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((v): v is string => typeof v === 'string'));
  } catch (err) {
    // Empty dedup set is safe (strictly worse mode is duplicate alerts,
    // not missed alerts) but the error still needs ops visibility.
    console.warn(
      '[immediateRiskAlerts] defaultLoadDispatchFingerprints failed — duplicates may fire',
      err
    );
    return new Set();
  }
}

async function defaultSaveDispatchFingerprints(fps: Set<string>): Promise<void> {
  // CAS-with-union. Two concurrent sanctions-ingest-cron instances
  // (Netlify scheduled functions do not guarantee single-writer
  // semantics — if a run overruns its interval, the next tick starts
  // while the previous is still writing) both loaded the same
  // fingerprint set at T0, each appended their own newly-seen
  // fingerprints, and then each called setJSON without onlyIfMatch.
  // The second writer silently clobbered the first writer's
  // fingerprints, collapsing the per-day dedup window mid-run and
  // producing duplicate Asana alert tasks for the same subject.
  //
  // Fix: read-with-etag → union with our in-memory set → write with
  // onlyIfMatch. On CAS mismatch, re-read and re-union — never lose a
  // fingerprint. If CAS retries are exhausted, fall through to a
  // plain setJSON so dedup failures remain non-fatal (duplicate
  // alerts are strictly better than dropped alerts, per the original
  // comment). CLAUDE.md mandates CAS for all read-modify-write blob
  // mutations. Regulatory basis: FDL No.(10)/2025 Art.24 (audit-trail
  // integrity — duplicate-alert records confuse the 10yr audit).
  const store = getStore(DEDUP_STORE);
  const key = dedupKeyForDay(new Date().toISOString());
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let etag: string | null = null;
    let current: Set<string>;
    try {
      const withMeta = await (
        store as unknown as {
          getWithMetadata?: (
            k: string,
            opts?: { type: 'json' }
          ) => Promise<{ data: unknown; etag?: string | null } | null>;
        }
      ).getWithMetadata?.(key, { type: 'json' });
      if (withMeta?.data && Array.isArray(withMeta.data)) {
        current = new Set(
          (withMeta.data as unknown[]).filter((v): v is string => typeof v === 'string')
        );
      } else {
        current = new Set();
      }
      etag = withMeta?.etag ?? null;
    } catch {
      current = new Set();
      etag = null;
    }

    // Union — preserve every fingerprint from both the on-disk set and
    // our in-memory set. Never drop.
    for (const fp of fps) current.add(fp);

    try {
      const opts: { onlyIfMatch?: string; onlyIfNew?: boolean } = etag
        ? { onlyIfMatch: etag }
        : { onlyIfNew: true };
      const res = await (
        store as unknown as {
          setJSON?: (
            k: string,
            v: unknown,
            opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }
          ) => Promise<{ modified?: boolean } | void>;
        }
      ).setJSON?.(key, Array.from(current), opts);
      const landed = !res || (res as { modified?: boolean }).modified !== false;
      if (landed) return;
      // CAS mismatch — another writer beat us. Loop to re-read + re-union.
    } catch {
      // Network / transport error on write — fall through to retry.
    }
  }

  // CAS exhausted. Fall back to best-effort plain write so dedup
  // never blocks the dispatch path. Duplicate alerts remain a
  // strictly better failure mode than dropped alerts.
  try {
    await store.setJSON(key, Array.from(fps));
  } catch (err) {
    console.warn(
      '[immediateRiskAlerts] defaultSaveDispatchFingerprints CAS exhausted + fallback failed',
      err
    );
  }
}

export function createDefaultDeps(): ImmediateRiskAlertsDeps {
  return {
    loadWatchlist: defaultLoadWatchlist,
    postTask: (input) =>
      createAsanaTask({
        name: input.name,
        notes: input.notes,
        projects: input.projects,
        tags: input.tags,
      }),
    env: (key) => process.env[key],
    now: () => new Date(),
    loadDispatchFingerprints: defaultLoadDispatchFingerprints,
    saveDispatchFingerprints: defaultSaveDispatchFingerprints,
  };
}

/**
 * Stable fingerprint for a single (subject, candidate) dispatch within
 * a UTC day. Used to guarantee at-most-once Asana task creation per
 * (subject, list, reference, changeType) per day even if the cron
 * retries or multiple crons fire on the same delta.
 */
function dispatchFingerprint(subjectId: string, candidate: CandidateEntry, dayIso: string): string {
  return [
    subjectId,
    candidate.list.trim().toUpperCase(),
    candidate.reference.trim(),
    candidate.changeType,
    dayIso,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Public input shapes
// ---------------------------------------------------------------------------

/**
 * A single candidate to evaluate against the watchlist. Source-agnostic —
 * the caller maps the native delta/hit shape into this before invoking
 * the dispatcher.
 */
export interface CandidateEntry {
  list: string;
  reference: string;
  primaryName: string;
  aliases?: string[];
  dateOfBirth?: string;
  nationality?: string;
  idNumber?: string;
  listedOn?: string;
  reason?: string;
  changeType: RiskAlertChangeType;
  /** For AMENDMENT: free-text summary of what changed. */
  amendmentSummary?: string;
}

export interface DispatchContext {
  trigger: RiskAlertTrigger;
  runId: string;
  commitSha?: string;
}

export interface DispatchTaskRecord {
  subjectId: string;
  subjectName: string;
  list: string;
  reference: string;
  severity: 'ALERT' | 'POSSIBLE' | 'CHANGE';
  classification: IdentityMatchResult['classification'];
  composite: number;
  ok: boolean;
  gid?: string;
  error?: string;
}

export interface DispatchSummary {
  trigger: RiskAlertTrigger;
  runId: string;
  watchlistSize: number;
  candidatesEvaluated: number;
  /** Suppressed by scoring (name-only coincidence / pin-mismatch on CHANGE). */
  suppressed: number;
  /** Suppressed by the idempotent dispatch-fingerprint cache (duplicate same-day). */
  deduped: number;
  /** Suppressed by runtime guards (unknown changeType, malformed candidate). */
  rejected: number;
  tasksAttempted: number;
  tasksCreated: number;
  tasksFailed: number;
  tasks: DispatchTaskRecord[];
}

const VALID_CHANGE_TYPES: readonly RiskAlertChangeType[] = ['NEW', 'AMENDMENT', 'DELISTING'];

function isValidCandidate(c: CandidateEntry): boolean {
  if (typeof c.list !== 'string' || c.list.trim().length === 0) return false;
  if (typeof c.reference !== 'string' || c.reference.trim().length === 0) return false;
  if (typeof c.primaryName !== 'string' || c.primaryName.trim().length === 0) return false;
  if (!VALID_CHANGE_TYPES.includes(c.changeType)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Core dispatcher
// ---------------------------------------------------------------------------

/**
 * Build a RiskAlertScore from the raw identityMatchScore output. The
 * template needs the same payload plus the "clamped" flag so the
 * reviewer can see that an alert band was downgraded.
 */
function buildScore(raw: IdentityMatchResult, hasResolved: boolean): RiskAlertScore {
  const clamped = !hasResolved && raw.composite >= 0.8 && raw.classification === 'possible';
  return {
    composite: raw.composite,
    breakdown: raw.breakdown,
    classification: raw.classification,
    clamped,
  };
}

function candidateToMatch(c: CandidateEntry): RiskAlertMatch {
  return {
    list: c.list,
    reference: c.reference,
    entryName: c.primaryName,
    entryAliases: c.aliases,
    entryDob: c.dateOfBirth,
    entryNationality: c.nationality,
    entryId: c.idNumber,
    listedOn: c.listedOn,
    reason: c.reason,
    changeType: c.changeType,
    amendmentSummary: c.amendmentSummary,
  };
}

/**
 * Evaluate one candidate against one subject. Returns `null` when the
 * hit should be suppressed (name-only coincidence on a non-CHANGE
 * event). AMENDMENT/DELISTING events only fire if the subject has a
 * pinned listEntryRef that matches the candidate — otherwise they are
 * list-wide noise, not subject-specific.
 */
function shouldDispatch(
  subject: WatchlistEntry,
  candidate: CandidateEntry,
  score: IdentityMatchResult
): boolean {
  if (candidate.changeType === 'AMENDMENT' || candidate.changeType === 'DELISTING') {
    const pin = subject.resolvedIdentity?.listEntryRef;
    if (!pin) return false;
    return (
      pin.list.trim().toUpperCase() === candidate.list.trim().toUpperCase() &&
      pin.reference.trim() === candidate.reference.trim()
    );
  }
  // NEW: fire on alert or possible only. Suppress is name-only noise.
  return score.classification !== 'suppress';
}

/**
 * Optional overrides the cron uses to share a single watchlist read and
 * a single dispatch-fingerprint load across multiple sources in one
 * invocation. Nothing outside the cron should pass these — the defaults
 * (loading from Netlify Blobs once per call) are correct for every
 * other caller.
 */
export interface DispatchOverrides {
  /** Pre-loaded watchlist so the cron doesn't re-fetch the blob N times. */
  subjects?: readonly WatchlistEntry[];
  /** Pre-loaded dedup fingerprint set, mutated in place. */
  fingerprints?: Set<string>;
}

export async function dispatchImmediateAlerts(
  candidates: readonly CandidateEntry[],
  ctx: DispatchContext,
  deps: ImmediateRiskAlertsDeps = createDefaultDeps(),
  overrides: DispatchOverrides = {}
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    trigger: ctx.trigger,
    runId: ctx.runId,
    watchlistSize: 0,
    candidatesEvaluated: candidates.length,
    suppressed: 0,
    deduped: 0,
    rejected: 0,
    tasksAttempted: 0,
    tasksCreated: 0,
    tasksFailed: 0,
    tasks: [],
  };

  if (candidates.length === 0) return summary;

  const subjects = overrides.subjects ?? (await deps.loadWatchlist());
  summary.watchlistSize = subjects.length;
  if (subjects.length === 0) return summary;

  const projectGid = deps.env('ASANA_SCREENINGS_PROJECT_GID') || DEFAULT_SCREENINGS_PROJECT_GID;
  const generatedAtIso = deps.now().toISOString();
  const dayKey = dedupKeyForDay(generatedAtIso);

  // Load the dedup fingerprints once at the start; mutate and save at
  // the end so every dispatched alert is remembered across the entire
  // cron run (and re-runs on the same day).
  const ownsFingerprints = overrides.fingerprints === undefined;
  const seenFingerprints = overrides.fingerprints ?? (await deps.loadDispatchFingerprints());
  const newlyFingerprinted = new Set<string>();

  // Cross-list corroboration is computed ONCE from the dedup fingerprint
  // set at the start of the run. The map is then looked up per-subject
  // inside the loop — cheap, no extra I/O, and shared across every
  // candidate for a given subject. The set already includes dispatches
  // from earlier sources in the same cron batch, so by the time we
  // reach source N the map reflects "how many lists have flagged THIS
  // subject today across all sources" — exactly the World-Check
  // consolidated-list view.
  const corroborationMap = computeCorroboration(seenFingerprints);

  for (const subject of subjects) {
    for (const candidate of candidates) {
      if (!isValidCandidate(candidate)) {
        summary.rejected += 1;
        continue;
      }

      const score = scoreHitAgainstProfile(
        {
          listEntryName: candidate.primaryName,
          listEntryAliases: candidate.aliases,
          listEntryDob: candidate.dateOfBirth,
          listEntryNationality: candidate.nationality,
          listEntryIdNumber: candidate.idNumber,
          listEntryRef: { list: candidate.list, reference: candidate.reference },
        },
        subject.subjectName,
        subject.resolvedIdentity
      );

      if (!shouldDispatch(subject, candidate, score)) {
        summary.suppressed += 1;
        continue;
      }

      const fp = dispatchFingerprint(subject.id, candidate, dayKey);
      if (seenFingerprints.has(fp)) {
        summary.deduped += 1;
        continue;
      }

      const alertCtx: RiskAlertContext = {
        trigger: ctx.trigger,
        runId: ctx.runId,
        generatedAtIso,
        commitSha: ctx.commitSha,
      };
      const riskScore = buildScore(score, score.hasResolvedIdentity);

      // Bayesian calibration of the linear composite — gives the MLRO
      // a true posterior P(match | evidence), an uncertainty interval,
      // and the top counterfactual moves. The identity shape passed to
      // observeIdentityEvidence mirrors the "hit" shape that
      // scoreHitAgainstProfile consumed, so observation and scoring
      // stay in lockstep.
      const evidence = observeIdentityEvidence(subject.resolvedIdentity, {
        listEntryDob: candidate.dateOfBirth,
        listEntryNationality: candidate.nationality,
        listEntryIdNumber: candidate.idNumber,
        listEntryRef: { list: candidate.list, reference: candidate.reference },
      });
      const calibrated: CalibratedIdentityScore = calibrateIdentityScore(
        riskScore.breakdown,
        evidence
      );
      const corroboration: SubjectCorroboration = corroborationForSubject(
        corroborationMap,
        subject.id
      );

      // Five-step deliberative chain — dynamic prior → calibrated
      // posterior → hypothesis ranking → temporal decay → confidence
      // triage. Produces the auditable chain-of-thought block that
      // makes the decision legible to MLRO + MoE inspectors. The
      // `listedOn` field on the candidate is the closest we have to
      // an "evidence observed at" timestamp; when missing we fall
      // back to generatedAtIso so the chain still runs (decay=1.0).
      const evidenceObservedAtIso = candidate.listedOn || generatedAtIso;
      const brain: DeliberativeBrainResult = runDeliberativeBrain({
        subject,
        breakdown: riskScore.breakdown,
        evidence,
        list: candidate.list,
        evidenceObservedAtIso,
        nowIso: generatedAtIso,
      });

      // Forensic investigation packet — red flags, identity gaps,
      // prioritised next investigative steps. Runs downstream of the
      // brain chain so it can consume the calibrated posterior + the
      // hypothesis ranking.
      const forensic: ForensicInvestigation = runForensicInvestigation({
        subject,
        breakdown: riskScore.breakdown,
        evidence,
        calibrated,
        hypotheses: brain.hypotheses,
        corroboration,
        isAmendment: candidate.changeType === 'AMENDMENT',
      });

      const task = buildRiskAlertTask({
        subject,
        match: candidateToMatch(candidate),
        score: riskScore,
        ctx: alertCtx,
        calibrated,
        corroboration,
        brain,
        forensic,
      });

      summary.tasksAttempted += 1;
      const res = await deps.postTask({
        name: task.title,
        notes: task.notes,
        projects: [projectGid],
        tags: task.tags,
      });

      // Mark the fingerprint as seen the moment the task is posted —
      // even on Asana failure — so a retry of the same cron doesn't
      // fire two Asana tasks for the same event. A failed task is
      // surfaced via summary.tasksFailed + tasks[].error; the MLRO
      // sees the failure and can re-dispatch manually if needed.
      seenFingerprints.add(fp);
      newlyFingerprinted.add(fp);

      const record: DispatchTaskRecord = {
        subjectId: subject.id,
        subjectName: subject.subjectName,
        list: candidate.list,
        reference: candidate.reference,
        severity: task.severity,
        classification: score.classification,
        composite: score.composite,
        ok: res.ok,
        gid: res.gid,
        error: res.error,
      };
      summary.tasks.push(record);
      if (res.ok) summary.tasksCreated += 1;
      else summary.tasksFailed += 1;
    }
  }

  // Persist the fingerprint set only if we own it; when the caller
  // passes a shared set (cron batch across sources) they will persist
  // once at the end of the batch.
  if (ownsFingerprints && newlyFingerprinted.size > 0) {
    await deps.saveDispatchFingerprints(seenFingerprints);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Convenience adapter — NormalisedSanction → CandidateEntry
// ---------------------------------------------------------------------------

/**
 * Map a sanctions-ingest delta to the dispatcher's candidate shape.
 * NEW entries map 1:1. AMENDMENT entries carry a summary of which
 * fields changed so the reviewer knows whether the designation is
 * materially different (e.g. a new passport number vs a cosmetic alias
 * tweak).
 */
export function candidatesFromSanctionsDelta(
  added: readonly NormalisedSanction[],
  modified: ReadonlyArray<{ before: NormalisedSanction; after: NormalisedSanction }>,
  removed: readonly NormalisedSanction[]
): CandidateEntry[] {
  const out: CandidateEntry[] = [];
  for (const s of added) {
    out.push(normalisedToCandidate(s, 'NEW'));
  }
  for (const pair of modified) {
    const c = normalisedToCandidate(pair.after, 'AMENDMENT');
    c.amendmentSummary = summariseAmendment(pair.before, pair.after);
    out.push(c);
  }
  for (const s of removed) {
    out.push(normalisedToCandidate(s, 'DELISTING'));
  }
  return out;
}

function normalisedToCandidate(
  s: NormalisedSanction,
  changeType: RiskAlertChangeType
): CandidateEntry {
  return {
    list: s.source,
    reference: s.sourceId,
    primaryName: s.primaryName,
    aliases: s.aliases,
    dateOfBirth: s.dateOfBirth,
    nationality: s.nationality,
    reason: s.remarks,
    changeType,
  };
}

function summariseAmendment(before: NormalisedSanction, after: NormalisedSanction): string {
  const parts: string[] = [];
  if (before.primaryName !== after.primaryName) {
    parts.push(`name "${before.primaryName}" → "${after.primaryName}"`);
  }
  if (before.dateOfBirth !== after.dateOfBirth) {
    parts.push(`DoB ${before.dateOfBirth ?? '(none)'} → ${after.dateOfBirth ?? '(none)'}`);
  }
  if (before.nationality !== after.nationality) {
    parts.push(`nationality ${before.nationality ?? '(none)'} → ${after.nationality ?? '(none)'}`);
  }
  if (before.programmes.join(',') !== after.programmes.join(',')) {
    parts.push(`programmes [${before.programmes.join(', ')}] → [${after.programmes.join(', ')}]`);
  }
  const beforeAliases = [...before.aliases].sort().join('|');
  const afterAliases = [...after.aliases].sort().join('|');
  if (beforeAliases !== afterAliases) {
    parts.push(`aliases ${before.aliases.length} → ${after.aliases.length} entries`);
  }
  return parts.length > 0 ? parts.join('; ') : 'Record hash changed (no field-level diff computed)';
}

// ---------------------------------------------------------------------------
// Internals exported for tests
// ---------------------------------------------------------------------------

export const __test__ = {
  buildScore,
  candidateToMatch,
  shouldDispatch,
  normalisedToCandidate,
  summariseAmendment,
};
