/**
 * Session Manager
 *
 * Manages conversation state, agent context, and audit trail
 * for the compliance agent system. This is the "Session" box
 * from the Agent SDK architecture diagram.
 *
 * Features:
 * - Conversation history with role-based messages
 * - Session metadata (analyst, entity being reviewed, etc.)
 * - Tamper-proof audit chain via SHA-256 hashing
 * - Idle/max-duration timeout enforcement
 * - Session serialization for persistence
 */

import { SESSION_CONFIG } from '../config';
import { appendToChain, verifyChain, type ChainedAuditEvent } from '../../utils/auditChain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
  toolCallId?: string;
}

export interface SessionMetadata {
  analyst: string;
  entityUnderReview?: string;
  workflowId?: string;
  activeAgent?: string;
  tags: string[];
}

export type SessionStatus = 'active' | 'idle' | 'expired' | 'completed';

export interface SessionSnapshot {
  id: string;
  status: SessionStatus;
  metadata: SessionMetadata;
  messages: AgentMessage[];
  auditChain: ChainedAuditEvent[];
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

export class SessionManager {
  readonly id: string;
  private status: SessionStatus = 'active';
  private metadata: SessionMetadata;
  private messages: AgentMessage[] = [];
  private auditChain: ChainedAuditEvent[] = [];
  private createdAt: string;
  private lastActivityAt: string;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private onExpire?: () => void;

  constructor(analyst: string, onExpire?: () => void) {
    this.id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.createdAt = new Date().toISOString();
    this.lastActivityAt = this.createdAt;
    this.onExpire = onExpire;

    this.metadata = {
      analyst,
      tags: [],
    };

    // Start timers
    this.resetIdleTimer();
    this.maxDurationTimer = setTimeout(() => {
      this.expire('Max session duration reached');
    }, SESSION_CONFIG.maxDurationMs);
  }

  // ---- Messages ----

  addMessage(message: AgentMessage): void {
    this.assertActive();
    this.messages.push(message);
    this.touch();
  }

  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  getRecentMessages(count: number): AgentMessage[] {
    return this.messages.slice(-count);
  }

  // ---- Audit Chain ----

  async logAudit(action: string, note?: string): Promise<ChainedAuditEvent> {
    this.assertActive();
    this.auditChain = await appendToChain(this.auditChain, {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      by: this.metadata.analyst,
      action,
      note,
    });
    this.touch();
    return this.auditChain[this.auditChain.length - 1];
  }

  getAuditChain(): ChainedAuditEvent[] {
    return [...this.auditChain];
  }

  async verifyAuditChain(): Promise<{
    valid: boolean;
    checkedCount: number;
    brokenAt: number | null;
  }> {
    return verifyChain(this.auditChain);
  }

  // ---- Metadata ----

  updateMetadata(partial: Partial<SessionMetadata>): void {
    Object.assign(this.metadata, partial);
    this.touch();
  }

  getMetadata(): SessionMetadata {
    return { ...this.metadata };
  }

  // ---- Status ----

  getStatus(): SessionStatus {
    return this.status;
  }

  complete(): void {
    this.status = 'completed';
    this.clearTimers();
  }

  // ---- Snapshot / Serialization ----

  snapshot(): SessionSnapshot {
    return {
      id: this.id,
      status: this.status,
      metadata: { ...this.metadata },
      messages: [...this.messages],
      auditChain: [...this.auditChain],
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      expiresAt: new Date(
        new Date(this.createdAt).getTime() + SESSION_CONFIG.maxDurationMs
      ).toISOString(),
    };
  }

  /** Restore session from a snapshot */
  static restore(snapshot: SessionSnapshot, onExpire?: () => void): SessionManager {
    const session = new SessionManager(snapshot.metadata.analyst, onExpire);
    (session as { id: string }).id = snapshot.id;
    session.status = snapshot.status === 'expired' ? 'expired' : 'active';
    session.metadata = snapshot.metadata;
    session.messages = snapshot.messages;
    session.auditChain = snapshot.auditChain;
    session.createdAt = snapshot.createdAt;
    session.lastActivityAt = snapshot.lastActivityAt;
    return session;
  }

  // ---- Cleanup ----

  destroy(): void {
    this.clearTimers();
    this.status = 'expired';
  }

  // ---- Internals ----

  private touch(): void {
    this.lastActivityAt = new Date().toISOString();
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.status = 'idle';
      // Give grace period, then expire
      this.idleTimer = setTimeout(() => {
        this.expire('Session idle timeout');
      }, 60_000); // 1 min grace after going idle
    }, SESSION_CONFIG.idleTimeoutMs);
  }

  private expire(reason: string): void {
    this.status = 'expired';
    this.clearTimers();
    this.messages.push({
      role: 'system',
      content: `Session expired: ${reason}`,
      timestamp: new Date().toISOString(),
    });
    this.onExpire?.();
  }

  private clearTimers(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  private assertActive(): void {
    if (this.status === 'expired') {
      throw new Error('Session has expired. Start a new session.');
    }
  }
}
