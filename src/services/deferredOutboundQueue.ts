/**
 * Deferred Outbound Queue — tipping-off safe deferred-send buffer
 * for customer-visible messages.
 *
 * Why this exists:
 *   Several workflow paths want to auto-send messages to the
 *   customer (additional CDD evidence request, UBO re-verification
 *   reminder, onboarding follow-up). FDL Art.29 prohibits tipping
 *   off the subject of an investigation. Auto-send creates a real
 *   legal liability — one STR case with a mis-routed reminder
 *   that mentions "compliance review" is enough to trigger an
 *   Art.29 violation.
 *
 *   This queue replaces auto-send with human-in-the-loop deferred
 *   send. Every enqueue runs the message through lintForTippingOff
 *   first — any non-clean message is rejected at enqueue time and
 *   NEVER placed on the queue. Clean messages land in
 *   `pending_mlro_release` status and only move to `released`
 *   after an explicit MLRO dequeue call.
 *
 *   No auto-dispatch. No scheduled send. MLRO is the trigger.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.29    (no tipping off — hard requirement)
 *   Cabinet Res 134/2025 Art.14 (MLRO gates all customer contact
 *                                 during EDD)
 *   EU AI Act Art.14         (human oversight, high-risk AI)
 */

import { lintForTippingOff, type TippingOffReport } from './tippingOffLinter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutboundChannel = 'email' | 'sms' | 'letter' | 'in_app';
export type MessageStatus =
  | 'pending_mlro_release'
  | 'released'
  | 'rejected_tipping_off'
  | 'cancelled';

export interface OutboundMessage {
  id: string;
  tenantId: string;
  recipientRef: string;
  channel: OutboundChannel;
  subject: string;
  body: string;
  status: MessageStatus;
  createdAtIso: string;
  releasedAtIso: string | null;
  lintReport: TippingOffReport;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  tenantId: string;
  recipientRef: string;
  channel: OutboundChannel;
  subject: string;
  body: string;
  now?: () => Date;
}

export class DeferredOutboundQueue {
  private readonly entries: OutboundMessage[] = [];

  /**
   * Try to enqueue a customer-visible message. Lints both subject
   * and body through the tipping-off linter. Returns the persisted
   * entry with a status of either `pending_mlro_release` (clean)
   * or `rejected_tipping_off` (dirty). Rejected messages are
   * still recorded in the audit log but never dispatched.
   */
  enqueue(input: EnqueueInput): OutboundMessage {
    const now = input.now ?? (() => new Date());
    const createdAtIso = now().toISOString();
    const combined = `${input.subject}\n\n${input.body}`;
    const lintReport = lintForTippingOff(combined);

    const entry: OutboundMessage = {
      id: `outbound:${input.tenantId}:${input.recipientRef}:${now().getTime()}`,
      tenantId: input.tenantId,
      recipientRef: input.recipientRef,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
      status: lintReport.clean ? 'pending_mlro_release' : 'rejected_tipping_off',
      createdAtIso,
      releasedAtIso: null,
      lintReport,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Explicit MLRO release — moves a clean message to `released`. */
  release(id: string, now: () => Date = () => new Date()): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    const e = this.entries[idx]!;
    if (e.status !== 'pending_mlro_release') return false;
    this.entries[idx] = { ...e, status: 'released', releasedAtIso: now().toISOString() };
    return true;
  }

  cancel(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    const e = this.entries[idx]!;
    if (e.status !== 'pending_mlro_release') return false;
    this.entries[idx] = { ...e, status: 'cancelled' };
    return true;
  }

  pending(tenantId: string): readonly OutboundMessage[] {
    return this.entries.filter(
      (e) => e.tenantId === tenantId && e.status === 'pending_mlro_release'
    );
  }

  all(): readonly OutboundMessage[] {
    return this.entries.slice();
  }

  size(): number {
    return this.entries.length;
  }
}
