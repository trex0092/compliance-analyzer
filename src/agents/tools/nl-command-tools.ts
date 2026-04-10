/**
 * Natural Language Command Processor
 *
 * Parses compliance commands from plain English:
 *   "Screen Al Farooq Trading" → screen_entity tool call
 *   "Onboard new customer Naples Jewellery" → onboarding workflow
 *   "File STR for case CASE-123" → filing agent
 *   "What's the risk score for Madison?" → score_risk query
 *   "Check if any CDD reviews are overdue" → scan_cdd_renewals
 *
 * Uses intent classification + entity extraction without external APIs.
 */

import type { ToolResult, ToolCallRequest } from '../mcp-server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentType =
  | 'screen'
  | 'onboard'
  | 'file-str'
  | 'file-ctr'
  | 'file-cnmr'
  | 'check-risk'
  | 'check-cdd'
  | 'create-case'
  | 'check-deadline'
  | 'run-audit'
  | 'check-kpi'
  | 'freeze-assets'
  | 'incident'
  | 'batch-screen'
  | 'analyze-transactions'
  | 'network-analysis'
  | 'predict-risk'
  | 'explain-decision'
  | 'help'
  | 'unknown';

export interface ParsedCommand {
  raw: string;
  intent: IntentType;
  confidence: number;
  entities: {
    entityName?: string;
    entityType?: 'individual' | 'entity';
    caseId?: string;
    filingType?: string;
    dateRange?: { from?: string; to?: string };
    riskLevel?: string;
    amount?: number;
  };
  suggestedToolCall: ToolCallRequest | null;
  alternativeIntents: Array<{ intent: IntentType; confidence: number }>;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Intent patterns
// ---------------------------------------------------------------------------

interface IntentPattern {
  intent: IntentType;
  patterns: RegExp[];
  keywords: string[];
  weight: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'screen',
    patterns: [
      /screen\s+(.+)/i,
      /check\s+sanctions?\s+(?:for\s+)?(.+)/i,
      /run\s+screening\s+(?:on|for)\s+(.+)/i,
      /sanctions?\s+check\s+(.+)/i,
      /is\s+(.+)\s+sanctioned/i,
    ],
    keywords: ['screen', 'screening', 'sanctions', 'check against', 'scan'],
    weight: 1.0,
  },
  {
    intent: 'onboard',
    patterns: [
      /onboard\s+(.+)/i,
      /new\s+customer\s+(.+)/i,
      /register\s+(.+)/i,
      /add\s+(?:new\s+)?(?:customer|client|entity)\s+(.+)/i,
    ],
    keywords: ['onboard', 'new customer', 'register', 'sign up', 'add customer'],
    weight: 1.0,
  },
  {
    intent: 'file-str',
    patterns: [
      /file\s+(?:an?\s+)?str\s+(?:for\s+)?(.+)?/i,
      /submit\s+(?:an?\s+)?str/i,
      /suspicious\s+transaction\s+report/i,
      /report\s+suspicious/i,
    ],
    keywords: ['str', 'suspicious transaction', 'file report', 'submit str'],
    weight: 1.0,
  },
  {
    intent: 'file-ctr',
    patterns: [
      /file\s+(?:an?\s+)?ctr/i,
      /cash\s+transaction\s+report/i,
      /report\s+cash\s+transaction/i,
    ],
    keywords: ['ctr', 'cash transaction report', 'cash report'],
    weight: 1.0,
  },
  {
    intent: 'file-cnmr',
    patterns: [/file\s+(?:an?\s+)?cnmr/i, /confiscation.*notification/i],
    keywords: ['cnmr', 'confiscation', 'notification'],
    weight: 1.0,
  },
  {
    intent: 'check-risk',
    patterns: [
      /(?:what(?:'s| is)\s+the\s+)?risk\s+(?:score|level|rating)\s+(?:for|of)\s+(.+)/i,
      /score\s+risk\s+(?:for\s+)?(.+)/i,
      /assess\s+risk\s+(?:of|for)\s+(.+)/i,
      /how\s+risky\s+is\s+(.+)/i,
    ],
    keywords: ['risk score', 'risk level', 'risk rating', 'assess risk', 'risk assessment'],
    weight: 1.0,
  },
  {
    intent: 'check-cdd',
    patterns: [
      /(?:check|show|list)\s+(?:overdue\s+)?cdd\s+(?:renewals?|reviews?)/i,
      /(?:any|which)\s+cdd\s+(?:reviews?\s+)?(?:are\s+)?overdue/i,
      /due\s+diligence\s+(?:status|review)/i,
    ],
    keywords: ['cdd', 'due diligence', 'renewal', 'overdue review', 'cdd review'],
    weight: 1.0,
  },
  {
    intent: 'check-deadline',
    patterns: [
      /(?:check|when\s+is)\s+(?:the\s+)?(?:filing\s+)?deadline/i,
      /(?:how\s+many|when)\s+(?:days?|business\s+days?)\s+(?:until|left|remaining)/i,
    ],
    keywords: ['deadline', 'due date', 'filing date', 'days remaining'],
    weight: 1.0,
  },
  {
    intent: 'run-audit',
    patterns: [
      /run\s+(?:an?\s+)?audit/i,
      /generate\s+audit\s+(?:report|pack)/i,
      /compliance\s+audit/i,
      /moe\s+(?:readiness|inspection)/i,
    ],
    keywords: ['audit', 'audit report', 'audit pack', 'moe readiness', 'inspection'],
    weight: 1.0,
  },
  {
    intent: 'check-kpi',
    patterns: [
      /(?:show|check|generate)\s+kpi/i,
      /compliance\s+(?:kpi|metrics|dashboard)/i,
      /(?:how\s+are\s+we|performance)\s+(?:doing|metrics)/i,
    ],
    keywords: ['kpi', 'metrics', 'performance', 'compliance score', 'dashboard'],
    weight: 1.0,
  },
  {
    intent: 'freeze-assets',
    patterns: [
      /freeze\s+(?:assets?\s+)?(?:for|of)\s+(.+)/i,
      /asset\s+freeze\s+(.+)/i,
      /block\s+(?:all\s+)?(?:transactions?\s+)?(?:for\s+)?(.+)/i,
    ],
    keywords: ['freeze', 'asset freeze', 'block transactions', 'freeze account'],
    weight: 1.0,
  },
  {
    intent: 'incident',
    patterns: [
      /(?:report|handle|create)\s+(?:an?\s+)?incident/i,
      /sanctions?\s+(?:match|hit)/i,
      /emergency\s+(?:response|compliance)/i,
    ],
    keywords: ['incident', 'emergency', 'sanctions hit', 'sanctions match', 'breach'],
    weight: 1.0,
  },
  {
    intent: 'analyze-transactions',
    patterns: [
      /analyze\s+transactions?\s+(?:for\s+)?(.+)/i,
      /transaction\s+(?:analysis|monitoring|patterns?)/i,
      /detect\s+(?:structuring|anomal)/i,
    ],
    keywords: ['analyze transactions', 'transaction analysis', 'structuring', 'anomaly', 'pattern'],
    weight: 1.0,
  },
  {
    intent: 'predict-risk',
    patterns: [
      /predict\s+(?:risk|future)/i,
      /risk\s+(?:forecast|prediction|trajectory)/i,
      /(?:what\s+will|future)\s+risk/i,
    ],
    keywords: ['predict', 'forecast', 'trajectory', 'future risk', 'early warning'],
    weight: 1.0,
  },
  {
    intent: 'network-analysis',
    patterns: [
      /(?:analyze|map)\s+(?:entity\s+)?network/i,
      /(?:shell\s+company|ownership\s+structure|beneficial\s+owner)/i,
      /(?:who\s+owns|ownership\s+chain)/i,
    ],
    keywords: ['network', 'shell company', 'ownership', 'beneficial owner', 'connected entities'],
    weight: 1.0,
  },
  {
    intent: 'help',
    patterns: [/^help$/i, /what\s+can\s+you\s+do/i, /available\s+commands/i],
    keywords: ['help', 'commands', 'what can you do'],
    weight: 0.5,
  },
];

// ---------------------------------------------------------------------------
// NL Parser
// ---------------------------------------------------------------------------

export function parseCommand(input: string): ToolResult<ParsedCommand> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty command' };
  }

  const scores: Array<{ intent: IntentType; confidence: number; match?: RegExpMatchArray }> = [];

  for (const pattern of INTENT_PATTERNS) {
    let maxConfidence = 0;
    let bestMatch: RegExpMatchArray | undefined;

    // Check regex patterns
    for (const regex of pattern.patterns) {
      const match = trimmed.match(regex);
      if (match) {
        maxConfidence = Math.max(maxConfidence, 0.9 * pattern.weight);
        bestMatch = match;
      }
    }

    // Check keyword matching
    const lowerInput = trimmed.toLowerCase();
    let keywordHits = 0;
    for (const keyword of pattern.keywords) {
      if (lowerInput.includes(keyword.toLowerCase())) {
        keywordHits++;
      }
    }
    if (keywordHits > 0) {
      const keywordConfidence = Math.min(0.8, keywordHits * 0.3) * pattern.weight;
      maxConfidence = Math.max(maxConfidence, keywordConfidence);
    }

    if (maxConfidence > 0) {
      scores.push({ intent: pattern.intent, confidence: maxConfidence, match: bestMatch });
    }
  }

  scores.sort((a, b) => b.confidence - a.confidence);

  const bestIntent = scores[0] ?? { intent: 'unknown' as IntentType, confidence: 0 };
  const entities = extractEntities(trimmed, bestIntent.match);
  const suggestedToolCall = buildToolCall(bestIntent.intent, entities);

  const explanation =
    bestIntent.intent === 'unknown'
      ? `Could not parse command: "${trimmed}". Try: "screen [entity]", "onboard [customer]", "file STR", "check risk for [entity]", or "help".`
      : `Interpreted as: ${bestIntent.intent} (confidence: ${(bestIntent.confidence * 100).toFixed(0)}%)`;

  return {
    ok: true,
    data: {
      raw: trimmed,
      intent: bestIntent.intent,
      confidence: bestIntent.confidence,
      entities,
      suggestedToolCall,
      alternativeIntents: scores.slice(1, 4).map((s) => ({
        intent: s.intent,
        confidence: s.confidence,
      })),
      explanation,
    },
  };
}

// ---------------------------------------------------------------------------
// Entity Extraction
// ---------------------------------------------------------------------------

function extractEntities(input: string, match?: RegExpMatchArray): ParsedCommand['entities'] {
  const entities: ParsedCommand['entities'] = {};

  // Extract entity name from regex capture groups
  if (match) {
    for (let i = 1; i < match.length; i++) {
      if (match[i]) {
        entities.entityName = match[i].trim().replace(/['"]/g, '');
        break;
      }
    }
  }

  // Extract case ID
  const caseMatch = input.match(/case[- ]?([\w-]+)/i);
  if (caseMatch) entities.caseId = caseMatch[1];

  // Extract amounts
  const amountMatch = input.match(/(?:AED|aed)\s*([\d,]+(?:\.\d{2})?)/);
  if (amountMatch) entities.amount = parseFloat(amountMatch[1].replace(/,/g, ''));

  // Detect entity type
  if (/individual|person|human/i.test(input)) {
    entities.entityType = 'individual';
  } else if (/company|entity|corporation|firm|llc/i.test(input)) {
    entities.entityType = 'entity';
  }

  // Extract filing type
  if (/str/i.test(input)) entities.filingType = 'STR';
  else if (/ctr/i.test(input)) entities.filingType = 'CTR';
  else if (/cnmr/i.test(input)) entities.filingType = 'CNMR';
  else if (/dpmsr/i.test(input)) entities.filingType = 'DPMSR';

  return entities;
}

// ---------------------------------------------------------------------------
// Tool Call Builder
// ---------------------------------------------------------------------------

function buildToolCall(
  intent: IntentType,
  entities: ParsedCommand['entities']
): ToolCallRequest | null {
  switch (intent) {
    case 'screen':
      return entities.entityName
        ? {
            name: 'screen_entity',
            arguments: {
              entityName: entities.entityName,
              entityType: entities.entityType ?? 'entity',
            },
          }
        : null;

    case 'check-risk':
      return entities.entityName
        ? {
            name: 'score_risk',
            arguments: { flagCodes: [], context: {} },
          }
        : null;

    case 'check-cdd':
      return { name: 'scan_cdd_renewals', arguments: { customers: [] } };

    case 'check-deadline':
      return {
        name: 'check_filing_deadline',
        arguments: {
          eventDate: new Date().toISOString(),
          filingType: entities.filingType ?? 'STR',
        },
      };

    case 'check-kpi':
      return { name: 'list_kpi_definitions', arguments: {} };

    case 'analyze-transactions':
      return entities.entityName
        ? {
            name: 'analyze_transactions_quant',
            arguments: { entityName: entities.entityName, transactions: [] },
          }
        : null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const NL_COMMAND_TOOL_SCHEMAS = [
  {
    name: 'parse_nl_command',
    description:
      'Parse natural language compliance commands. Extracts intent, entities, and suggests the appropriate tool call. Supports: screen, onboard, file STR/CTR/CNMR, check risk, check CDD, audit, freeze, incident, analyze.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Natural language command (e.g. "Screen Al Farooq Trading")',
        },
      },
      required: ['command'],
    },
  },
] as const;
