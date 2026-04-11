/**
 * Asana Phase 4 Ultra — 5 "beyond" helpers for Asana compliance workflows.
 *
 *   R1  decisionArchaeology       — one-call "show me everything related
 *                                    to this entity": cases, approvals,
 *                                    filings, audit chain, attachments,
 *                                    Asana task history
 *   R2  complianceCalendar        — year view of all filing deadlines
 *                                    + SLA buckets for MLRO dashboard
 *   R3  inspectorPackBuilder      — one-click ZIP-style bundle with
 *                                    every artefact an inspector needs
 *                                    for a specific entity
 *   R4  asanaWebhookSignatureVerifier — HMAC-SHA-256 verification of
 *                                    inbound Asana webhooks so we can
 *                                    trust task_updated / comment_added
 *                                    events
 *   R5  massRescreenTrigger       — one-button re-run of all customers
 *                                    (e.g. on a new sanctions list drop)
 *                                    with progress reporting + throttling
 *
 * Pure functions with injected transports (HMAC key, Asana client,
 * blob store) so tests run without network access.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21, 24 (CO duty, retention, forensic recall)
 *   - Cabinet Res 134/2025 Art.19 (auditable workflow)
 *   - Cabinet Res 74/2020 Art.4-7 (mass re-screen on new sanctions
 *     list drop triggers 24h freeze window)
 *   - MoE Circular 08/AML/2021 (DPMS inspection pack)
 *   - FATF Rec 10 (ongoing CDD)
 */

// ===========================================================================
// R1 — decisionArchaeology
// ===========================================================================

export interface ArchaeologyEvent {
  at: string;
  source: 'case' | 'approval' | 'filing' | 'audit' | 'asana_task' | 'asana_comment' | 'attachment';
  actor: string;
  summary: string;
  refId: string;
}

export interface ArchaeologyInput {
  entityId: string;
  entityName: string;
  events: readonly ArchaeologyEvent[];
}

export interface ArchaeologyReport {
  entityId: string;
  entityName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  countsBySource: Record<ArchaeologyEvent['source'], number>;
  timeline: readonly ArchaeologyEvent[];
  narrative: string;
}

export function excavateEntityHistory(input: ArchaeologyInput): ArchaeologyReport {
  const timeline = [...input.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const countsBySource: Record<ArchaeologyEvent['source'], number> = {
    case: 0,
    approval: 0,
    filing: 0,
    audit: 0,
    asana_task: 0,
    asana_comment: 0,
    attachment: 0,
  };
  for (const e of timeline) countsBySource[e.source] += 1;

  const first = timeline[0]?.at ?? '';
  const last = timeline[timeline.length - 1]?.at ?? '';
  const narrative =
    timeline.length === 0
      ? `Decision archaeology for ${input.entityName}: no events found.`
      : `Decision archaeology for ${input.entityName}: ${timeline.length} event(s) ` +
        `from ${first.slice(0, 10)} to ${last.slice(0, 10)}. ` +
        Object.entries(countsBySource)
          .filter(([, c]) => c > 0)
          .map(([k, c]) => `${k}=${c}`)
          .join(', ');

  return {
    entityId: input.entityId,
    entityName: input.entityName,
    firstSeenAt: first,
    lastSeenAt: last,
    countsBySource,
    timeline,
    narrative,
  };
}

// ===========================================================================
// R2 — complianceCalendar
// ===========================================================================

export interface CalendarEntry {
  date: string; // ISO date
  kind: 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR' | 'EOCN' | 'CDD_REVIEW' | 'UBO_REVERIFY' | 'LBMA_AUDIT' | 'KPI_REPORT';
  title: string;
  citation: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface CalendarYear {
  year: number;
  entries: readonly CalendarEntry[];
  byMonth: ReadonlyArray<{ month: number; entries: readonly CalendarEntry[] }>;
}

export function buildComplianceCalendar(
  entries: readonly CalendarEntry[],
  year: number
): CalendarYear {
  const yearEntries = entries
    .filter((e) => e.date.slice(0, 4) === String(year))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byMonth: Array<{ month: number; entries: CalendarEntry[] }> = [];
  for (let m = 1; m <= 12; m++) {
    byMonth.push({
      month: m,
      entries: yearEntries.filter((e) => parseInt(e.date.slice(5, 7), 10) === m),
    });
  }

  return { year, entries: yearEntries, byMonth };
}

// ===========================================================================
// R3 — inspectorPackBuilder
// ===========================================================================

export interface InspectorPackArtefact {
  name: string;
  mimeType: string;
  content: string;
  citation: string;
}

export interface InspectorPackInput {
  entityId: string;
  entityName: string;
  inspector: string;
  inspectionDate: string;
  artefacts: readonly InspectorPackArtefact[];
}

export interface InspectorPackManifest {
  entityId: string;
  entityName: string;
  inspector: string;
  inspectionDate: string;
  artefactCount: number;
  artefacts: ReadonlyArray<{
    name: string;
    mimeType: string;
    byteLength: number;
    citation: string;
  }>;
  coverNarrative: string;
  regulatoryIndex: ReadonlyArray<{ citation: string; artefacts: readonly string[] }>;
}

export function buildInspectorPack(input: InspectorPackInput): InspectorPackManifest {
  const byCitation = new Map<string, string[]>();
  for (const a of input.artefacts) {
    const list = byCitation.get(a.citation) ?? [];
    list.push(a.name);
    byCitation.set(a.citation, list);
  }

  const regulatoryIndex = Array.from(byCitation.entries())
    .map(([citation, artefacts]) => ({ citation, artefacts }))
    .sort((a, b) => a.citation.localeCompare(b.citation));

  const coverNarrative = [
    `Inspector pack for ${input.entityName} (${input.entityId})`,
    `Inspector: ${input.inspector}`,
    `Inspection date (dd/mm/yyyy): ${formatDdMmYyyy(input.inspectionDate)}`,
    ``,
    `${input.artefacts.length} artefact(s) bundled.`,
    `Regulations covered: ${regulatoryIndex.length}.`,
    ``,
    `This bundle is retained under FDL No.10/2025 Art.24 for 5 years.`,
    `Tipping-off warning: do not share the content of this pack with`,
    `the subject (FDL No.10/2025 Art.29).`,
  ].join('\n');

  return {
    entityId: input.entityId,
    entityName: input.entityName,
    inspector: input.inspector,
    inspectionDate: input.inspectionDate,
    artefactCount: input.artefacts.length,
    artefacts: input.artefacts.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      byteLength: new TextEncoder().encode(a.content).length,
      citation: a.citation,
    })),
    coverNarrative,
    regulatoryIndex,
  };
}

function formatDdMmYyyy(iso: string): string {
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}/${m}/${y}` : iso;
}

// ===========================================================================
// R4 — asanaWebhookSignatureVerifier
// ===========================================================================

/**
 * Asana webhook payloads carry an X-Hook-Signature HMAC-SHA-256
 * header computed over the raw request body with a secret the
 * service learns during the handshake. This module verifies that
 * header so the brain can trust inbound task_updated / comment_added
 * events.
 *
 * HMAC-SHA-256 computed via Web Crypto, with node:crypto fallback
 * for Node 18 where globalThis.crypto.subtle isn't available.
 */

export async function computeHmacSha256Hex(
  secret: string,
  message: string
): Promise<string> {
  // Prefer Web Crypto (browser + Node 19+).
  const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
  if (g.crypto?.subtle) {
    const enc = new TextEncoder();
    const key = await g.crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await g.crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Node 18 fallback.
  if (typeof process !== 'undefined' && process.versions?.node) {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHmac('sha256', secret).update(message).digest('hex');
  }
  throw new Error('HMAC-SHA-256 unavailable — no Web Crypto and no node:crypto');
}

export interface WebhookVerifyInput {
  secret: string;
  rawBody: string;
  headerSignature: string;
}

export interface WebhookVerifyResult {
  valid: boolean;
  reason?: string;
}

export async function verifyAsanaWebhookSignature(
  input: WebhookVerifyInput
): Promise<WebhookVerifyResult> {
  if (!input.secret) return { valid: false, reason: 'missing secret' };
  if (!input.headerSignature) return { valid: false, reason: 'missing header signature' };

  const expected = await computeHmacSha256Hex(input.secret, input.rawBody);
  const provided = input.headerSignature.trim().toLowerCase();
  // Constant-time-ish comparison: always compare full length to avoid
  // short-circuit timing oracles. (JavaScript `===` is not constant
  // time but this reduces the obvious differential.)
  if (expected.length !== provided.length) {
    return { valid: false, reason: 'length mismatch' };
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0 ? { valid: true } : { valid: false, reason: 'signature mismatch' };
}

// ===========================================================================
// R5 — massRescreenTrigger
// ===========================================================================

export interface MassRescreenConfig {
  customerIds: readonly string[];
  /** Reason for the mass re-screen (e.g. "new UN SDN list 2026-04-11"). */
  triggerReason: string;
  /** Target throughput (customers per minute). Default 60. */
  rpm?: number;
  /** Maximum concurrent re-screens. Default 10. */
  concurrency?: number;
}

export interface MassRescreenPlan {
  total: number;
  batches: ReadonlyArray<{
    batchIndex: number;
    customerIds: readonly string[];
    scheduledAt: string;
  }>;
  estimatedDurationMinutes: number;
  citation: string;
}

export function planMassRescreen(
  config: MassRescreenConfig,
  startAt: Date = new Date()
): MassRescreenPlan {
  const rpm = config.rpm ?? 60;
  const concurrency = config.concurrency ?? 10;
  const batchSize = concurrency;

  const batches: Array<{
    batchIndex: number;
    customerIds: readonly string[];
    scheduledAt: string;
  }> = [];
  let cursor = startAt.getTime();
  const msPerBatch = (batchSize / rpm) * 60 * 1000;

  for (let i = 0; i < config.customerIds.length; i += batchSize) {
    batches.push({
      batchIndex: batches.length,
      customerIds: config.customerIds.slice(i, i + batchSize),
      scheduledAt: new Date(cursor).toISOString(),
    });
    cursor += msPerBatch;
  }

  const estimatedDurationMinutes = Math.ceil(config.customerIds.length / rpm);

  return {
    total: config.customerIds.length,
    batches,
    estimatedDurationMinutes,
    citation:
      `Cabinet Res 74/2020 Art.4-7 (24h freeze window) + FATF Rec 10 ` +
      `(ongoing CDD). Trigger: ${config.triggerReason}.`,
  };
}
