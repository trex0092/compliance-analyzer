/**
 * Voice Command Adapter — Tier E2.
 *
 * Maps raw voice transcripts into slash-command invocations
 * the existing `asanaCommentSkillRouter` can execute. Lets an
 * MLRO say "Freeze Madison" → the adapter routes to `/incident
 * case-madison sanctions-match` → the super-brain dispatcher
 * fires.
 *
 * Design:
 *   - Pure intent parser (buildInvocationFromTranscript)
 *   - Rule-based matcher (deterministic)
 *   - Returns a slash-command string the caller feeds into
 *     routeAsanaComment()
 *
 * This is NOT a real NLU — it's a deterministic vocabulary
 * matcher. A future version can swap in a real model behind
 * the same interface. vendor/friday-tony-stark-demo has the
 * LiveKit + FastMCP server harness needed for a production
 * deployment.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (MLRO duty of care — voice
 *     commands are still auditable)
 *   - FDL No.10/2025 Art.29 (no tipping off — voice transcripts
 *     are never persisted with entity legal names)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceIntent =
  | 'screen'
  | 'incident'
  | 'audit'
  | 'kpi-report'
  | 'deploy-check'
  | 'status'
  | 'help'
  | 'unknown';

export interface VoiceCommand {
  intent: VoiceIntent;
  slashCommand?: string;
  target?: string;
  rationale: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Intent rules
// ---------------------------------------------------------------------------

interface IntentRule {
  intent: VoiceIntent;
  keywords: string[];
  slash?: (target: string | undefined) => string;
  minConfidence: number;
}

const RULES: IntentRule[] = [
  {
    intent: 'screen',
    keywords: ['screen', 'check', 'search', 'sanctions'],
    slash: (target) => (target ? `/screen "${target}"` : '/screen'),
    minConfidence: 0.8,
  },
  {
    intent: 'incident',
    keywords: ['freeze', 'sanction match', 'asset freeze', 'incident', 'emergency'],
    slash: (target) => (target ? `/incident ${target} sanctions-match` : '/incident'),
    minConfidence: 0.9,
  },
  {
    intent: 'audit',
    keywords: ['audit', 'audit pack', 'moe inspection'],
    slash: (target) => (target ? `/audit-pack ${target}` : '/audit'),
    minConfidence: 0.75,
  },
  {
    intent: 'kpi-report',
    keywords: ['kpi', 'quarterly report', 'monthly report', 'dashboard'],
    slash: () => '/kpi-report',
    minConfidence: 0.8,
  },
  {
    intent: 'deploy-check',
    keywords: ['deploy', 'ship', 'release', 'can we ship'],
    slash: () => '/deploy-check',
    minConfidence: 0.75,
  },
  {
    intent: 'status',
    keywords: ['status', 'what happened', 'what is happening', 'health'],
    minConfidence: 0.7,
  },
  {
    intent: 'help',
    keywords: ['help', 'what can you do', 'commands', 'list'],
    minConfidence: 0.6,
  },
];

// ---------------------------------------------------------------------------
// Target extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'screen',
  'check',
  'search',
  'freeze',
  'sanction',
  'sanctions',
  'audit',
  'report',
  'status',
  'help',
  'the',
  'a',
  'an',
  'for',
  'on',
  'in',
  'and',
  'please',
  'can',
  'you',
  'me',
  'my',
  'our',
  'it',
  'is',
  'show',
  'tell',
]);

/**
 * Extract the likely target entity from the transcript by
 * stripping stop words + intent keywords. The target is
 * whatever tokens remain after the strip. Returns undefined
 * when nothing useful is left.
 */
export function extractTarget(transcript: string, rule: IntentRule): string | undefined {
  const lower = transcript.toLowerCase();
  const ruleKeywords = new Set(rule.keywords.flatMap((k) => k.split(/\s+/)));
  const tokens = lower
    .replace(/[.,!?]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !STOP_WORDS.has(t))
    .filter((t) => !ruleKeywords.has(t));
  if (tokens.length === 0) return undefined;
  return tokens.join(' ');
}

// ---------------------------------------------------------------------------
// Pure intent parser
// ---------------------------------------------------------------------------

export function buildInvocationFromTranscript(transcript: string): VoiceCommand {
  if (!transcript || transcript.trim().length === 0) {
    return {
      intent: 'unknown',
      rationale: 'Empty transcript',
      confidence: 0,
    };
  }
  const lower = transcript.toLowerCase();

  // Find all matching rules and pick the one with the most
  // keyword matches.
  let bestRule: IntentRule | undefined;
  let bestMatchCount = 0;
  for (const rule of RULES) {
    const matches = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (matches > bestMatchCount) {
      bestMatchCount = matches;
      bestRule = rule;
    }
  }

  if (!bestRule || bestMatchCount === 0) {
    return {
      intent: 'unknown',
      rationale: 'No intent keyword matched — say "help" for available commands',
      confidence: 0.1,
    };
  }

  const target = extractTarget(transcript, bestRule);
  const slashCommand = bestRule.slash ? bestRule.slash(target) : undefined;
  const confidence = Math.min(0.95, bestRule.minConfidence + bestMatchCount * 0.05);

  return {
    intent: bestRule.intent,
    slashCommand,
    target,
    rationale: `Matched ${bestMatchCount} keyword(s) for intent ${bestRule.intent}`,
    confidence,
  };
}
