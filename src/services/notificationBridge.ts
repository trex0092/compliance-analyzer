/**
 * Notification Bridge — Teams / Email / browser notify fan-out
 * on high-severity verdicts.
 *
 * When the super-brain produces a verdict ≥ escalate, the MLRO
 * needs to know immediately even if they're not in the Asana
 * tab. This bridge emits notifications across three channels:
 *
 *   1. Browser Notification API (if permission granted)
 *   2. Microsoft Teams webhook (if TEAMS_WEBHOOK_URL is configured)
 *   3. Email via the existing email channel (logged via the SPA
 *      workflow engine's `executeEmailAlert` — we just produce
 *      the payload; the legacy module dispatches it)
 *
 * Pure payload builder + thin executors. The builder is
 * unit-tested; the executors are fire-and-forget with
 * localStorage-backed rate limiting so a stuck notification
 * channel can't DoS the dispatcher.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO duty of care — critical
 *     verdicts reach the right person without delay)
 *   - FDL No.10/2025 Art.29 (no tipping off — every notification
 *     uses case id, never entity legal name)
 *   - Cabinet Res 74/2020 Art.4 (24h freeze — escalations must
 *     propagate fast enough to meet the clock)
 */

import type { Verdict } from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationInput {
  caseId: string;
  verdict: Verdict;
  headline: string;
  recommendedAction: string;
  /** Optional Asana task link for click-through. */
  asanaTaskUrl?: string;
  /** ISO timestamp for deterministic tests. */
  atIso?: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  severity: NotificationSeverity;
  channel: 'browser' | 'teams' | 'email';
  /** Pre-serialized JSON payload for the Teams webhook. */
  teamsCard?: Record<string, unknown>;
  /** Pre-rendered plain-text email body. */
  emailBody?: string;
  /** Email subject. */
  emailSubject?: string;
  /** Browser notification options. */
  browserOptions?: { body: string; tag: string; requireInteraction: boolean };
}

// ---------------------------------------------------------------------------
// Severity routing
// ---------------------------------------------------------------------------

function severityForVerdict(verdict: Verdict): NotificationSeverity {
  switch (verdict) {
    case 'freeze':
      return 'critical';
    case 'escalate':
      return 'warning';
    case 'flag':
    case 'pass':
      return 'info';
  }
}

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

export function buildBrowserNotificationPayload(input: NotificationInput): NotificationPayload {
  const severity = severityForVerdict(input.verdict);
  const title = `[${input.verdict.toUpperCase()}] ${input.caseId}`;
  const body = `${input.headline}. ${input.recommendedAction}`;
  return {
    title,
    body,
    severity,
    channel: 'browser',
    browserOptions: {
      body,
      tag: `super-brain-${input.caseId}`,
      requireInteraction: severity === 'critical',
    },
  };
}

export function buildTeamsCardPayload(input: NotificationInput): NotificationPayload {
  const severity = severityForVerdict(input.verdict);
  const color = severity === 'critical' ? 'D94F4F' : severity === 'warning' ? 'E8A030' : '3DA876';
  const title = `Super-Brain ${input.verdict.toUpperCase()} — ${input.caseId}`;
  const body = `${input.headline}\n\n${input.recommendedAction}`;
  const teamsCard: Record<string, unknown> = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: color,
    summary: title,
    title,
    text: body,
    sections: [
      {
        facts: [
          { name: 'Verdict', value: input.verdict.toUpperCase() },
          { name: 'Case', value: input.caseId },
          { name: 'At', value: input.atIso ?? new Date().toISOString() },
        ],
      },
    ],
    potentialAction: input.asanaTaskUrl
      ? [
          {
            '@type': 'OpenUri',
            name: 'Open in Asana',
            targets: [{ os: 'default', uri: input.asanaTaskUrl }],
          },
        ]
      : undefined,
  };
  return {
    title,
    body,
    severity,
    channel: 'teams',
    teamsCard,
  };
}

export function buildEmailPayload(input: NotificationInput): NotificationPayload {
  const severity = severityForVerdict(input.verdict);
  const subject = `[${severity.toUpperCase()}] Super-Brain ${input.verdict.toUpperCase()} — ${input.caseId}`;
  const body = [
    `Super-Brain verdict: ${input.verdict.toUpperCase()}`,
    `Case: ${input.caseId}`,
    `Headline: ${input.headline}`,
    '',
    `Recommended action: ${input.recommendedAction}`,
    '',
    input.asanaTaskUrl ? `Asana task: ${input.asanaTaskUrl}` : 'Asana task: (no link)',
    '',
    'Regulatory basis: FDL No.10/2025 Art.20-21, Art.29 (no tipping off).',
    'This notification is confidential and intended only for the compliance team.',
  ].join('\n');
  return {
    title: subject,
    body,
    severity,
    channel: 'email',
    emailSubject: subject,
    emailBody: body,
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const RATE_STORAGE_KEY = 'fgl_notification_rate_cache';
const RATE_WINDOW_MS = 60_000; // 1 notification per case per minute per channel

interface RateCache {
  [key: string]: number;
}

function readRateCache(): RateCache {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(RATE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as RateCache;
  } catch {
    return {};
  }
}

function writeRateCache(cache: RateCache): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* storage quota */
  }
}

export function shouldSuppress(caseId: string, channel: NotificationPayload['channel']): boolean {
  const cache = readRateCache();
  const key = `${caseId}:${channel}`;
  const now = Date.now();
  const last = cache[key] ?? 0;
  if (now - last < RATE_WINDOW_MS) return true;
  cache[key] = now;
  writeRateCache(cache);
  return false;
}

// ---------------------------------------------------------------------------
// Dispatchers (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Fire a browser notification. Returns true when the notification
 * was dispatched, false when Notification API isn't available or
 * permission hasn't been granted.
 */
export function dispatchBrowserNotification(input: NotificationInput): boolean {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  if (shouldSuppress(input.caseId, 'browser')) return false;
  const payload = buildBrowserNotificationPayload(input);
  try {
    new Notification(payload.title, payload.browserOptions);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fire a Teams card via the configured webhook URL. Env var:
 * TEAMS_WEBHOOK_URL. Returns true on success.
 */
export async function dispatchTeamsCard(input: NotificationInput): Promise<boolean> {
  const url = readEnv('TEAMS_WEBHOOK_URL');
  if (!url) return false;
  if (shouldSuppress(input.caseId, 'teams')) return false;
  const payload = buildTeamsCardPayload(input);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.teamsCard),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) return process.env[key];
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const val = g[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}
