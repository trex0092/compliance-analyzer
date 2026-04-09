/**
 * Cross-Border Wire Analyzer — SWIFT MT103 / MT202 Tools
 *
 * Parse and risk-score SWIFT messages for correspondent banking chains,
 * nested relationships, sanctioned BICs, and unusual routing patterns.
 *
 * Regulatory basis:
 * - FDL No.10/2025 Art.15-16 (thresholds, cross-border)
 * - Cabinet Res 134/2025 Art.16 (cross-border cash/BNI AED 60K)
 * - FATF Rec 16 (wire transfer rules)
 * - FDL No.10/2025 Art.35 (TFS — sanctions screening)
 * - FDL No.10/2025 Art.29 (no tipping off)
 */

import type { ToolResult } from '../mcp-server';
import {
  CROSS_BORDER_CASH_THRESHOLD_AED,
  USD_TO_AED,
  FATF_GREY_LIST,
  PF_HIGH_RISK_JURISDICTIONS,
  EU_HIGH_RISK_COUNTRIES,
} from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SwiftField {
  tag: string;
  value: string;
}

export interface ParsedMT103 {
  messageType: 'MT103';
  transactionRef: string;           // :20:
  senderBIC: string;                // header
  receiverBIC: string;              // header
  orderingCustomer: string;         // :50K: or :50F:
  orderingInstitution?: string;     // :52A:
  senderCorrespondent?: string;     // :53A:
  receiverCorrespondent?: string;   // :54A:
  intermediaryInstitution?: string; // :56A:
  accountWithInstitution?: string;  // :57A:
  beneficiaryCustomer: string;      // :59: or :59A:
  currency: string;                 // :32A: currency code
  amount: number;                   // :32A: amount
  valueDate: string;                // :32A: date (dd/mm/yyyy)
  detailsOfCharges: string;         // :71A: SHA/BEN/OUR
  remittanceInfo?: string;          // :70:
  senderToReceiverInfo?: string;    // :72:
  allFields: SwiftField[];
}

export interface ParsedMT202 {
  messageType: 'MT202';
  transactionRef: string;           // :20:
  relatedRef?: string;              // :21:
  senderBIC: string;
  receiverBIC: string;
  senderCorrespondent?: string;     // :53A:
  receiverCorrespondent?: string;   // :54A:
  intermediaryInstitution?: string; // :56A:
  accountWithInstitution?: string;  // :57A:
  beneficiaryInstitution: string;   // :58A:
  currency: string;
  amount: number;
  valueDate: string;
  senderToReceiverInfo?: string;    // :72:
  allFields: SwiftField[];
}

export type ParsedSwiftMessage = ParsedMT103 | ParsedMT202;

export interface WireChainNode {
  bic: string;
  role: 'sender' | 'receiver' | 'intermediary' | 'correspondent' | 'beneficiary-bank';
  country: string;
  sanctioned: boolean;
  highRiskJurisdiction: boolean;
  fatfGreyList: boolean;
}

export interface WireChainAnalysis {
  id: string;
  analyzedAt: string;
  messageType: 'MT103' | 'MT202';
  chain: WireChainNode[];
  chainDepth: number;
  amountAED: number;
  exceedsCrossBorderThreshold: boolean;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: WireRiskFlag[];
  sanctionedBICs: string[];
  recommendation: string;
}

export interface WireRiskFlag {
  code: string;
  severity: 'info' | 'warning' | 'alert' | 'critical';
  description: string;
  regulatoryRef: string;
}

// ---------------------------------------------------------------------------
// Known sanctioned BICs (sample — in production, pull from live sanctions DB)
// ---------------------------------------------------------------------------

const SANCTIONED_BIC_PREFIXES = [
  'BKSY',   // Syria-related
  'EDBI',   // Iran-related
  'MELIIR', // Bank Melli Iran
  'SEPBIR', // Bank Sepah Iran
  'BKMTIR', // Bank Mellat Iran
  'IKIDIR', // Iran-related
  'KOEXKP', // DPRK-related
] as const;

// ---------------------------------------------------------------------------
// Parsing Utilities
// ---------------------------------------------------------------------------

/**
 * Extract country code (2 chars) from an 8 or 11-character BIC.
 * BIC format: BANKCCLL[bbb]  (CC = country at positions 4-5)
 */
function bicToCountry(bic: string): string {
  const clean = bic.replace(/\s/g, '').toUpperCase();
  if (clean.length >= 6) return clean.substring(4, 6);
  return 'XX';
}

/** Check if a BIC prefix appears in the sanctioned list */
function isBICSanctioned(bic: string): boolean {
  const clean = bic.replace(/\s/g, '').toUpperCase();
  return SANCTIONED_BIC_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

/** Check if a country code is on a high-risk list */
function isHighRiskCountry(cc: string): boolean {
  return (PF_HIGH_RISK_JURISDICTIONS as readonly string[]).includes(cc);
}

/** Check if country is on FATF grey list */
function isFATFGreyCountry(cc: string): boolean {
  return (FATF_GREY_LIST as readonly string[]).includes(cc);
}

/** Check if country is on EU high-risk list */
function isEUHighRisk(cc: string): boolean {
  return (EU_HIGH_RISK_COUNTRIES as readonly string[]).includes(cc);
}

/** Convert SWIFT date YYMMDD to dd/mm/yyyy */
function swiftDateToDDMMYYYY(yymmdd: string): string {
  if (yymmdd.length !== 6) return yymmdd;
  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);
  const century = yy > 50 ? '19' : '20';
  return `${dd}/${mm}/${century}${yymmdd.substring(0, 2)}`;
}

/** Parse SWIFT field tag-value pairs from raw message text */
function parseSwiftFields(raw: string): SwiftField[] {
  const fields: SwiftField[] = [];
  const lines = raw.split('\n');
  let currentTag = '';
  let currentValue = '';

  for (const line of lines) {
    const tagMatch = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tagMatch) {
      if (currentTag) {
        fields.push({ tag: currentTag, value: currentValue.trim() });
      }
      currentTag = tagMatch[1];
      currentValue = tagMatch[2];
    } else if (currentTag) {
      currentValue += '\n' + line;
    }
  }
  if (currentTag) {
    fields.push({ tag: currentTag, value: currentValue.trim() });
  }
  return fields;
}

/** Extract BICs from SWIFT header block {2:...} */
function extractHeaderBICs(raw: string): { senderBIC: string; receiverBIC: string } {
  let senderBIC = '';
  let receiverBIC = '';

  // {1: block — sender BIC
  const block1 = raw.match(/\{1:F01([A-Z0-9]{8,12})/);
  if (block1) senderBIC = block1[1].substring(0, 8);

  // {2: block — receiver BIC
  const block2 = raw.match(/\{2:[IO](\d{3})([A-Z0-9]{8,12})/);
  if (block2) receiverBIC = block2[2].substring(0, 8);

  return { senderBIC, receiverBIC };
}

/** Get field value by tag, or undefined */
function getField(fields: SwiftField[], tag: string): string | undefined {
  return fields.find((f) => f.tag === tag)?.value;
}

/** Parse amount from :32A: field — format: YYMMDDCCCNNN...NNN,NN */
function parseAmountField(value: string): { valueDate: string; currency: string; amount: number } {
  const dateStr = value.substring(0, 6);
  const currency = value.substring(6, 9);
  const amountStr = value.substring(9).replace(/,/g, '.').replace(/\s/g, '');
  return {
    valueDate: swiftDateToDDMMYYYY(dateStr),
    currency,
    amount: parseFloat(amountStr) || 0,
  };
}

// ---------------------------------------------------------------------------
// Tool: parseSwiftMT103
// ---------------------------------------------------------------------------

/**
 * Parse a raw SWIFT MT103 (customer credit transfer) message into
 * structured data for compliance analysis.
 *
 * @regulatory FDL No.10/2025 Art.15-16, FATF Rec 16
 */
export function parseSwiftMT103(input: { rawMessage: string }): ToolResult<ParsedMT103> {
  const raw = input.rawMessage;
  if (!raw || raw.length < 20) {
    return { ok: false, error: 'Raw SWIFT message is too short or empty' };
  }

  const { senderBIC, receiverBIC } = extractHeaderBICs(raw);
  const fields = parseSwiftFields(raw);

  const amountField = getField(fields, '32A');
  if (!amountField) {
    return { ok: false, error: 'Missing mandatory field :32A: (Value Date/Currency/Amount)' };
  }
  const { valueDate, currency, amount } = parseAmountField(amountField);

  const orderingCustomer = getField(fields, '50K') ?? getField(fields, '50F') ?? '';
  const beneficiaryCustomer = getField(fields, '59') ?? getField(fields, '59A') ?? '';

  if (!orderingCustomer) {
    return { ok: false, error: 'Missing ordering customer field :50K: or :50F:' };
  }
  if (!beneficiaryCustomer) {
    return { ok: false, error: 'Missing beneficiary customer field :59: or :59A:' };
  }

  const parsed: ParsedMT103 = {
    messageType: 'MT103',
    transactionRef: getField(fields, '20') ?? '',
    senderBIC,
    receiverBIC,
    orderingCustomer,
    orderingInstitution: getField(fields, '52A'),
    senderCorrespondent: getField(fields, '53A'),
    receiverCorrespondent: getField(fields, '54A'),
    intermediaryInstitution: getField(fields, '56A'),
    accountWithInstitution: getField(fields, '57A'),
    beneficiaryCustomer,
    currency,
    amount,
    valueDate,
    detailsOfCharges: getField(fields, '71A') ?? 'SHA',
    remittanceInfo: getField(fields, '70'),
    senderToReceiverInfo: getField(fields, '72'),
    allFields: fields,
  };

  return { ok: true, data: parsed };
}

/**
 * Parse a raw SWIFT MT202 (bank-to-bank transfer) message.
 * MT202 is higher risk for layering / nesting because the
 * underlying customer information is not visible.
 *
 * @regulatory FDL No.10/2025 Art.15-16, FATF Rec 13
 */
export function parseSwiftMT202(input: { rawMessage: string }): ToolResult<ParsedMT202> {
  const raw = input.rawMessage;
  if (!raw || raw.length < 20) {
    return { ok: false, error: 'Raw SWIFT message is too short or empty' };
  }

  const { senderBIC, receiverBIC } = extractHeaderBICs(raw);
  const fields = parseSwiftFields(raw);

  const amountField = getField(fields, '32A');
  if (!amountField) {
    return { ok: false, error: 'Missing mandatory field :32A:' };
  }
  const { valueDate, currency, amount } = parseAmountField(amountField);

  const beneficiaryInstitution = getField(fields, '58A') ?? '';
  if (!beneficiaryInstitution) {
    return { ok: false, error: 'Missing beneficiary institution field :58A:' };
  }

  const parsed: ParsedMT202 = {
    messageType: 'MT202',
    transactionRef: getField(fields, '20') ?? '',
    relatedRef: getField(fields, '21'),
    senderBIC,
    receiverBIC,
    senderCorrespondent: getField(fields, '53A'),
    receiverCorrespondent: getField(fields, '54A'),
    intermediaryInstitution: getField(fields, '56A'),
    accountWithInstitution: getField(fields, '57A'),
    beneficiaryInstitution,
    currency,
    amount,
    valueDate,
    senderToReceiverInfo: getField(fields, '72'),
    allFields: fields,
  };

  return { ok: true, data: parsed };
}

// ---------------------------------------------------------------------------
// Tool: analyzeWireChain
// ---------------------------------------------------------------------------

/** Convert amount to AED using CBUAE peg */
function toAED(amount: number, currency: string): number {
  if (currency === 'AED') return amount;
  if (currency === 'USD') return amount * USD_TO_AED;
  // For other currencies, approximate via USD. In production use CBUAE rates.
  return amount * USD_TO_AED;
}

/**
 * Build and risk-score the correspondent banking chain from a parsed
 * SWIFT message. Detects nested relationships, sanctioned intermediaries,
 * unusual routing depth, and high-risk jurisdiction exposure.
 *
 * @regulatory FDL No.10/2025 Art.35 (TFS), Cabinet Res 134/2025 Art.16
 */
export function analyzeWireChain(
  input: { message: ParsedMT103 | ParsedMT202 },
): ToolResult<WireChainAnalysis> {
  const msg = input.message;
  const chain: WireChainNode[] = [];
  const flags: WireRiskFlag[] = [];
  const sanctionedBICs: string[] = [];

  // Build chain nodes from all BICs present
  const addNode = (bic: string | undefined, role: WireChainNode['role']) => {
    if (!bic) return;
    const cleanBIC = bic.split('\n')[0].replace(/\s/g, '').toUpperCase();
    if (cleanBIC.length < 6) return;
    const cc = bicToCountry(cleanBIC);
    const sanctioned = isBICSanctioned(cleanBIC);
    if (sanctioned) sanctionedBICs.push(cleanBIC);
    chain.push({
      bic: cleanBIC,
      role,
      country: cc,
      sanctioned,
      highRiskJurisdiction: isHighRiskCountry(cc),
      fatfGreyList: isFATFGreyCountry(cc),
    });
  };

  addNode(msg.senderBIC, 'sender');
  if ('orderingInstitution' in msg) addNode(msg.orderingInstitution, 'correspondent');
  addNode(msg.senderCorrespondent, 'correspondent');
  addNode(msg.receiverCorrespondent, 'correspondent');
  addNode(msg.intermediaryInstitution, 'intermediary');
  addNode(msg.accountWithInstitution, 'correspondent');
  if (msg.messageType === 'MT103') {
    addNode(msg.receiverBIC, 'receiver');
  } else {
    addNode((msg as ParsedMT202).beneficiaryInstitution, 'beneficiary-bank');
    addNode(msg.receiverBIC, 'receiver');
  }

  const chainDepth = chain.length;
  const amountAED = toAED(msg.amount, msg.currency);
  const exceedsCrossBorderThreshold = amountAED >= CROSS_BORDER_CASH_THRESHOLD_AED;

  // ---- Risk flags ----

  // 1. Sanctioned BIC
  if (sanctionedBICs.length > 0) {
    flags.push({
      code: 'SWIFT-SANC-001',
      severity: 'critical',
      description: `Sanctioned BIC(s) detected in chain: ${sanctionedBICs.join(', ')}`,
      regulatoryRef: 'FDL No.10/2025 Art.35, Cabinet Res 74/2020',
    });
  }

  // 2. Excessive chain depth (>3 intermediaries is suspicious)
  const intermediaryCount = chain.filter((n) => n.role === 'intermediary' || n.role === 'correspondent').length;
  if (intermediaryCount >= 3) {
    flags.push({
      code: 'SWIFT-ROUTE-001',
      severity: 'alert',
      description: `Unusually deep correspondent chain: ${intermediaryCount} intermediaries. May indicate layering or nesting.`,
      regulatoryRef: 'FATF Rec 13, FDL No.10/2025 Art.12',
    });
  } else if (intermediaryCount === 2) {
    flags.push({
      code: 'SWIFT-ROUTE-002',
      severity: 'warning',
      description: `Two intermediaries in chain. Review routing justification.`,
      regulatoryRef: 'FATF Rec 13',
    });
  }

  // 3. High-risk jurisdiction in chain
  const hrNodes = chain.filter((n) => n.highRiskJurisdiction);
  if (hrNodes.length > 0) {
    flags.push({
      code: 'SWIFT-JURIS-001',
      severity: 'alert',
      description: `High-risk jurisdiction(s) in chain: ${hrNodes.map((n) => `${n.bic} (${n.country})`).join(', ')}`,
      regulatoryRef: 'Cabinet Res 156/2025, FATF Rec 19',
    });
  }

  // 4. FATF Grey List jurisdiction
  const greyNodes = chain.filter((n) => n.fatfGreyList && !n.highRiskJurisdiction);
  if (greyNodes.length > 0) {
    flags.push({
      code: 'SWIFT-JURIS-002',
      severity: 'warning',
      description: `FATF Grey List jurisdiction(s): ${greyNodes.map((n) => `${n.bic} (${n.country})`).join(', ')}`,
      regulatoryRef: 'FATF Grey List Feb 2026',
    });
  }

  // 5. Cross-border threshold exceeded
  if (exceedsCrossBorderThreshold) {
    flags.push({
      code: 'SWIFT-THRESH-001',
      severity: 'info',
      description: `Amount AED ${amountAED.toLocaleString()} exceeds cross-border threshold AED ${CROSS_BORDER_CASH_THRESHOLD_AED.toLocaleString()}`,
      regulatoryRef: 'Cabinet Res 134/2025 Art.16',
    });
  }

  // 6. MT202 nesting risk — no underlying customer visible
  if (msg.messageType === 'MT202') {
    flags.push({
      code: 'SWIFT-NEST-001',
      severity: 'warning',
      description: 'MT202 bank-to-bank transfer: underlying customer identity not visible. Potential nesting risk.',
      regulatoryRef: 'FATF Rec 13, Wolfsberg Correspondent Banking Principles',
    });
  }

  // 7. Sender/receiver same country but routed through 3rd country
  if (chain.length >= 3) {
    const senderCC = chain[0]?.country;
    const receiverCC = chain[chain.length - 1]?.country;
    if (senderCC && receiverCC && senderCC === receiverCC) {
      const middleCountries = chain.slice(1, -1).map((n) => n.country);
      const foreignHops = middleCountries.filter((cc) => cc !== senderCC);
      if (foreignHops.length > 0) {
        flags.push({
          code: 'SWIFT-ROUTE-003',
          severity: 'alert',
          description: `Sender and receiver are in same country (${senderCC}) but wire routes through foreign jurisdiction(s): ${foreignHops.join(', ')}. Potential layering.`,
          regulatoryRef: 'FATF Typologies, FDL No.10/2025 Art.12',
        });
      }
    }
  }

  // 8. EU High-Risk in chain
  const euHrNodes = chain.filter((n) => isEUHighRisk(n.country));
  if (euHrNodes.length > 0) {
    flags.push({
      code: 'SWIFT-JURIS-003',
      severity: 'warning',
      description: `EU High-Risk Third Country in chain: ${euHrNodes.map((n) => `${n.bic} (${n.country})`).join(', ')}`,
      regulatoryRef: 'EU Delegated Regulation 2026',
    });
  }

  // ---- Risk scoring (likelihood x impact with multipliers) ----
  let riskScore = 0;
  for (const flag of flags) {
    switch (flag.severity) {
      case 'critical': riskScore += 25; break;
      case 'alert': riskScore += 15; break;
      case 'warning': riskScore += 8; break;
      case 'info': riskScore += 2; break;
    }
  }

  // Multiplier for amount
  if (amountAED >= 1_000_000) riskScore = Math.round(riskScore * 1.5);
  else if (amountAED >= 500_000) riskScore = Math.round(riskScore * 1.3);
  else if (amountAED >= CROSS_BORDER_CASH_THRESHOLD_AED) riskScore = Math.round(riskScore * 1.1);

  // Cap at 100
  riskScore = Math.min(riskScore, 100);

  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (riskScore >= 70) riskLevel = 'critical';
  else if (riskScore >= 45) riskLevel = 'high';
  else if (riskScore >= 20) riskLevel = 'medium';
  else riskLevel = 'low';

  // Recommendation
  let recommendation: string;
  if (riskLevel === 'critical') {
    recommendation = 'FREEZE wire and escalate to Compliance Officer immediately. Check sanctions match within 24h per Cabinet Res 74/2020. Do NOT notify counterparties (Art.29 no tipping off).';
  } else if (riskLevel === 'high') {
    recommendation = 'Escalate to Compliance Officer for EDD. Document routing justification. Consider filing STR if suspicion confirmed.';
  } else if (riskLevel === 'medium') {
    recommendation = 'Enhanced review required. Verify intermediary relationships and routing logic. Document findings.';
  } else {
    recommendation = 'Standard processing. Log for audit trail.';
  }

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  return {
    ok: true,
    data: {
      id: crypto.randomUUID(),
      analyzedAt: `${dd}/${mm}/${yyyy}`,
      messageType: msg.messageType,
      chain,
      chainDepth,
      amountAED: Math.round(amountAED * 100) / 100,
      exceedsCrossBorderThreshold,
      riskScore,
      riskLevel,
      flags,
      sanctionedBICs,
      recommendation,
    },
  };
}

// ---------------------------------------------------------------------------
// Schema exports for MCP registration
// ---------------------------------------------------------------------------

export const SWIFT_TOOL_SCHEMAS = [
  {
    name: 'parse_swift_mt103',
    description:
      'Parse a raw SWIFT MT103 (customer credit transfer) message into structured data. Extracts sender/receiver BIC, ordering customer, beneficiary, intermediary banks, amount, currency. Regulatory: FDL Art.15-16, FATF Rec 16.',
    inputSchema: {
      type: 'object',
      properties: {
        rawMessage: { type: 'string', description: 'Raw SWIFT MT103 message text including header blocks' },
      },
      required: ['rawMessage'],
    },
  },
  {
    name: 'parse_swift_mt202',
    description:
      'Parse a raw SWIFT MT202 (bank-to-bank transfer) message. MT202s carry nesting risk since underlying customer info is absent. Regulatory: FATF Rec 13.',
    inputSchema: {
      type: 'object',
      properties: {
        rawMessage: { type: 'string', description: 'Raw SWIFT MT202 message text including header blocks' },
      },
      required: ['rawMessage'],
    },
  },
  {
    name: 'analyze_wire_chain',
    description:
      'Build and risk-score the correspondent banking chain from a parsed SWIFT message. Detects: sanctioned BICs, excessive chain depth, high-risk jurisdictions, nesting, layering patterns. Returns risk score 0-100 and actionable recommendation. Regulatory: FDL Art.35 (TFS), Cabinet Res 74/2020, FATF Rec 13/16.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'object', description: 'Parsed MT103 or MT202 object from parse_swift_mt103/parse_swift_mt202' },
      },
      required: ['message'],
    },
  },
] as const;
