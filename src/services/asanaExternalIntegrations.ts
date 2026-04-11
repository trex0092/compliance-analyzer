/**
 * Asana External Integrations — Asana Phase 3 Cluster N.
 *
 * Five pluggable external integration helpers:
 *
 *   N1 slackBridge          — SLA bucket → Slack alert payload builder
 *   N2 calendarSync          — task with due date → iCal VEVENT builder
 *   N3 docusignApprovalBuilder — high-risk approval → DocuSign envelope
 *   N4 webhookReplayReconciler — detects missed Asana events
 *   N5 emailToTaskParser     — forwarded email → Asana task payload
 *
 * All are pure functions that produce payloads; the actual network
 * calls (Slack webhook, DocuSign API, IMAP) happen at the edge.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — alerting)
 *   - Cabinet Res 134/2025 Art.19 (internal review with signatures)
 *   - FDL No.10/2025 Art.24 (retention — webhook replay prevents gaps)
 */

// ---------------------------------------------------------------------------
// N1 — Slack bridge
// ---------------------------------------------------------------------------

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface SlackAlertPayload {
  channel: string;
  text: string;
  blocks: SlackBlock[];
}

export function buildSlaBreachSlackAlert(input: {
  customerName: string;
  deadlineType: string;
  daysRemaining: number;
  taskGid: string;
}): SlackAlertPayload {
  const urgency =
    input.daysRemaining < 0
      ? '🚨 BREACHED'
      : input.daysRemaining === 0
        ? '⚠ DUE TODAY'
        : '⚠ BREACH RISK';
  return {
    channel: '#compliance-alerts',
    text: `${urgency} — ${input.deadlineType} for ${input.customerName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${urgency}*\n${input.deadlineType} filing for *${input.customerName}* — ${input.daysRemaining} business day(s) remaining.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open task' },
            url: `https://app.asana.com/0/0/${input.taskGid}`,
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// N2 — Calendar sync (iCal VEVENT builder)
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  uid: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  attendeeEmail?: string;
}

export function buildIcalEvent(event: CalendarEvent): string {
  const formatDate = (iso: string) => iso.replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatDate(new Date().toISOString())}`,
    `DTSTART:${formatDate(event.startIso)}`,
    `DTEND:${formatDate(event.endIso)}`,
    `SUMMARY:${event.summary.replace(/[,;]/g, ' ')}`,
    `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`,
  ];
  if (event.attendeeEmail) {
    lines.push(`ATTENDEE:mailto:${event.attendeeEmail}`);
  }
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// N3 — DocuSign approval envelope builder
// ---------------------------------------------------------------------------

export interface DocuSignEnvelope {
  emailSubject: string;
  documents: ReadonlyArray<{ name: string; fileExtension: string; documentId: string }>;
  recipients: ReadonlyArray<{
    email: string;
    name: string;
    roleName: string;
    routingOrder: number;
  }>;
  status: 'sent' | 'created';
}

export function buildApprovalEnvelope(input: {
  caseId: string;
  caseType: string;
  approvers: ReadonlyArray<{ email: string; name: string }>;
  documentBase64: string;
}): DocuSignEnvelope {
  // Two-step routing: primary → independent (Cabinet Res 134/2025 Art.19).
  const recipients = input.approvers.slice(0, 2).map((a, i) => ({
    email: a.email,
    name: a.name,
    roleName: i === 0 ? 'Primary Reviewer' : 'Independent Reviewer',
    routingOrder: i + 1,
  }));
  return {
    emailSubject: `[FOUR-EYES] ${input.caseType} approval — ${input.caseId}`,
    documents: [
      {
        name: `${input.caseId}-approval.pdf`,
        fileExtension: 'pdf',
        documentId: '1',
      },
    ],
    recipients,
    status: 'sent',
  };
}

// ---------------------------------------------------------------------------
// N4 — Webhook replay reconciler
// ---------------------------------------------------------------------------

export interface LocalTaskState {
  taskGid: string;
  lastKnownStatus: 'open' | 'completed';
  lastSeenAt: string;
}

export interface RemoteTaskState {
  taskGid: string;
  remoteStatus: 'open' | 'completed';
  remoteUpdatedAt: string;
}

export interface MissedEvent {
  taskGid: string;
  kind: 'completion_missed' | 'reopened' | 'unknown';
  lastLocalAt: string;
  remoteAt: string;
}

export function reconcileWebhookGaps(
  local: readonly LocalTaskState[],
  remote: readonly RemoteTaskState[]
): MissedEvent[] {
  const missed: MissedEvent[] = [];
  const remoteByGid = new Map(remote.map((r) => [r.taskGid, r]));
  for (const l of local) {
    const r = remoteByGid.get(l.taskGid);
    if (!r) continue;
    if (l.lastKnownStatus !== r.remoteStatus) {
      missed.push({
        taskGid: l.taskGid,
        kind:
          l.lastKnownStatus === 'open' && r.remoteStatus === 'completed'
            ? 'completion_missed'
            : l.lastKnownStatus === 'completed' && r.remoteStatus === 'open'
              ? 'reopened'
              : 'unknown',
        lastLocalAt: l.lastSeenAt,
        remoteAt: r.remoteUpdatedAt,
      });
    }
  }
  return missed;
}

// ---------------------------------------------------------------------------
// N5 — Email-to-task parser
// ---------------------------------------------------------------------------

export interface ParsedEmail {
  from: string;
  subject: string;
  body: string;
  attachments: readonly string[];
}

export interface EmailTaskPayload {
  name: string;
  notes: string;
  attachments: readonly string[];
  citation: string;
}

export function parseEmailIntoTask(email: ParsedEmail): EmailTaskPayload {
  // Sanitise subject to avoid Asana's 300-char cap problems.
  const safeSubject = email.subject.slice(0, 200).replace(/\s+/g, ' ').trim();
  return {
    name: `[EMAIL] ${safeSubject || '(no subject)'}`,
    notes: [
      `From: ${email.from}`,
      ``,
      email.body.slice(0, 20_000),
      ``,
      '---',
      'Auto-created from forwarded email by parseEmailIntoTask.',
    ].join('\n'),
    attachments: email.attachments,
    citation: 'FDL No.10/2025 Art.24 (preserve all regulatory correspondence)',
  };
}
