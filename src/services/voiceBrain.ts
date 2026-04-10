/**
 * Voice-Controlled Compliance Brain.
 *
 * Turns a speech-to-text transcript into structured compliance actions.
 * Wired to the Friday/Tony-Stark voice pipeline (vendor/friday-tony-stark-demo)
 * via a simple Intent Router — so an MLRO can literally say:
 *
 *   "Hawkeye, screen Acme Metals LLC."
 *   "File an STR for customer C-9912."
 *   "What's my highest-risk customer this week?"
 *   "Freeze the Jones case."
 *
 * Design:
 *   1. A WAKE WORD check strips the "Hawkeye" / "Friday" prefix (configurable).
 *   2. An INTENT CLASSIFIER maps the utterance to one of ~12 compliance intents.
 *   3. An ENTITY EXTRACTOR pulls out the target (customer name, case id, etc.).
 *   4. A CONFIRMATION LEVEL is attached: destructive actions (FREEZE, FILE_STR)
 *      require verbal confirmation before execution.
 *   5. A RESPONSE TEMPLATE is returned so the text-to-speech layer can speak.
 *
 * Critical safety property: the voice layer can NEVER auto-execute a freeze
 * or STR filing. It can only stage them into a confirmation queue. Execution
 * happens only after the user says "confirm" within 30 seconds of the prompt.
 *
 * The parser is deterministic (regex-based) — no LLM is called for intent
 * recognition, which means zero latency and zero hallucinated actions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceIntent =
  | 'screen_entity'
  | 'file_str'
  | 'freeze_entity'
  | 'unfreeze_entity'
  | 'show_risk'
  | 'show_top_risks'
  | 'show_pending_cases'
  | 'show_filings'
  | 'confirm'
  | 'cancel'
  | 'help'
  | 'unknown';

export interface VoiceCommand {
  raw: string;
  transcript: string; // after wake-word strip
  intent: VoiceIntent;
  entity?: string; // customer name, case id, etc.
  confidence: number;
  requiresConfirmation: boolean;
  responseTemplate: string;
}

export interface VoiceBrainConfig {
  wakeWords: readonly string[];
  /** Intents that must be confirmed before execution. */
  destructiveIntents?: readonly VoiceIntent[];
}

const DEFAULT_WAKE_WORDS = ['hawkeye', 'friday', 'hey compliance'];

const DEFAULT_DESTRUCTIVE: VoiceIntent[] = ['file_str', 'freeze_entity', 'unfreeze_entity'];

// ---------------------------------------------------------------------------
// Intent patterns
// ---------------------------------------------------------------------------

interface IntentPattern {
  intent: VoiceIntent;
  pattern: RegExp;
  extract?: (m: RegExpMatchArray) => string | undefined;
  responseTemplate: (entity?: string) => string;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'screen_entity',
    pattern: /\b(?:screen|check|sanctions[- ]check|look up)\s+(.+?)(?:\s+please)?[.?!]*$/i,
    extract: (m) => m[1].trim(),
    responseTemplate: (e) =>
      `Screening ${e ?? 'target'} against all sanctions lists. I'll report back in a moment.`,
  },
  {
    intent: 'file_str',
    pattern: /\b(?:file|submit|raise)\s+(?:an?\s+)?(?:str|sar|suspicious(?:\s+transaction)?)\s+(?:for|on)\s+(.+?)[.?!]*$/i,
    extract: (m) => m[1].trim(),
    responseTemplate: (e) =>
      `I've drafted an STR for ${e ?? 'the entity'}. Do you confirm filing? Say "confirm" within 30 seconds.`,
  },
  {
    intent: 'freeze_entity',
    pattern: /\b(?:freeze|block|suspend|lock)\s+(?:the\s+)?(?:account\s+of\s+|case\s+)?(.+?)[.?!]*$/i,
    extract: (m) => m[1].trim(),
    responseTemplate: (e) =>
      `Preparing to freeze ${e ?? 'the account'}. This action triggers the 24-hour EOCN countdown. Say "confirm" to proceed.`,
  },
  {
    intent: 'unfreeze_entity',
    pattern: /\b(?:unfreeze|release|unblock)\s+(.+?)[.?!]*$/i,
    extract: (m) => m[1].trim(),
    responseTemplate: (e) =>
      `Releasing freeze on ${e ?? 'the account'} requires CO approval. Say "confirm" if you have the authority.`,
  },
  {
    intent: 'show_risk',
    pattern: /\b(?:what.?s?\s+the\s+risk\s+(?:of|for)|risk\s+score\s+for|how\s+risky\s+is)\s+(.+?)[.?!]*$/i,
    extract: (m) => m[1].trim(),
    responseTemplate: (e) => `Looking up risk score for ${e ?? 'the entity'}.`,
  },
  {
    intent: 'show_top_risks',
    pattern: /\b(?:top\s+risks?|highest[- ]risk|riskiest|worst\s+customers?)\b/i,
    responseTemplate: () => `Pulling up your top risks right now.`,
  },
  {
    intent: 'show_pending_cases',
    pattern: /\b(?:pending|open)\s+(?:cases?|investigations?)\b/i,
    responseTemplate: () => `Here are your open compliance cases.`,
  },
  {
    intent: 'show_filings',
    pattern: /\b(?:show|list)\s+(?:my\s+)?(?:str|sar|filings)\b/i,
    responseTemplate: () => `Listing recent regulatory filings.`,
  },
  {
    intent: 'confirm',
    pattern: /^\s*(?:confirm|yes|do it|proceed|execute)[.!]?\s*$/i,
    responseTemplate: () => `Confirmed. Executing now.`,
  },
  {
    intent: 'cancel',
    pattern: /^\s*(?:cancel|no|stop|abort|never\s*mind)[.!]?\s*$/i,
    responseTemplate: () => `Cancelled. No action taken.`,
  },
  {
    intent: 'help',
    pattern: /\b(?:help|what can you do|commands?)\b/i,
    responseTemplate: () =>
      `You can say: screen an entity, file an STR, show top risks, show pending cases, or freeze an account.`,
  },
];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseVoiceCommand(
  raw: string,
  config: Partial<VoiceBrainConfig> = {},
): VoiceCommand {
  const wakeWords = config.wakeWords ?? DEFAULT_WAKE_WORDS;
  const destructive = new Set(config.destructiveIntents ?? DEFAULT_DESTRUCTIVE);

  const stripped = stripWakeWord(raw, wakeWords);

  // Try longest-match-wins: patterns that extract entities are more specific.
  for (const p of INTENT_PATTERNS) {
    const m = stripped.match(p.pattern);
    if (m) {
      const entity = p.extract?.(m);
      const cleanedEntity = entity ? sanitizeEntity(entity) : undefined;
      return {
        raw,
        transcript: stripped,
        intent: p.intent,
        entity: cleanedEntity,
        confidence: cleanedEntity || !p.extract ? 0.9 : 0.6,
        requiresConfirmation: destructive.has(p.intent),
        responseTemplate: p.responseTemplate(cleanedEntity),
      };
    }
  }

  return {
    raw,
    transcript: stripped,
    intent: 'unknown',
    confidence: 0,
    requiresConfirmation: false,
    responseTemplate:
      `I didn't catch that. Try "Hawkeye, screen Acme Metals" or "show my top risks".`,
  };
}

function stripWakeWord(raw: string, wakeWords: readonly string[]): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  for (const w of wakeWords) {
    const wl = w.toLowerCase();
    if (lower.startsWith(wl)) {
      return trimmed
        .slice(w.length)
        .replace(/^[,.\s]+/, '')
        .trim();
    }
  }
  return trimmed;
}

function sanitizeEntity(s: string): string {
  return s
    .replace(/^(the|an?|that|this)\s+/i, '')
    .replace(/\s+please$/i, '')
    .replace(/[.?!,;:]+$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Pending confirmation queue
// ---------------------------------------------------------------------------

export interface PendingAction {
  id: string;
  command: VoiceCommand;
  stagedAt: string;
  expiresAt: string;
}

export class VoiceConfirmationQueue {
  private pending = new Map<string, PendingAction>();
  private readonly ttlMs: number;

  constructor(ttlSeconds = 30) {
    this.ttlMs = ttlSeconds * 1000;
  }

  stage(command: VoiceCommand, now: number = Date.now()): PendingAction {
    const id = `pv-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const action: PendingAction = {
      id,
      command,
      stagedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    };
    this.pending.set(id, action);
    return action;
  }

  confirm(id: string, now: number = Date.now()): PendingAction | null {
    const action = this.pending.get(id);
    if (!action) return null;
    if (Date.parse(action.expiresAt) < now) {
      this.pending.delete(id);
      return null;
    }
    this.pending.delete(id);
    return action;
  }

  cancel(id: string): boolean {
    return this.pending.delete(id);
  }

  reapExpired(now: number = Date.now()): number {
    let n = 0;
    for (const [id, action] of this.pending) {
      if (Date.parse(action.expiresAt) < now) {
        this.pending.delete(id);
        n++;
      }
    }
    return n;
  }

  get size(): number {
    return this.pending.size;
  }
}
