/**
 * Crypto/Virtual Asset Monitoring MCP Tools
 *
 * Blockchain activity analysis for AML/CFT compliance:
 * - Address clustering (identify related wallets)
 * - Mixing/tumbler detection
 * - Travel rule compliance check (AED 3,675 / USD 1,000 threshold)
 * - High-risk address flagging (darknet, sanctioned, fraud)
 * - Transaction velocity and pattern analysis
 *
 * Regulatory basis: FDL No.10/2025 Art.12-14 (CDD for VASPs),
 * FATF Rec 15 / Updated Guidance on VAs and VASPs,
 * UAE VARA regulations, Cabinet Res 134/2025 Art.7-10 (CDD tiers)
 */

import type { ToolResult } from '../mcp-server';
import {
  USD_TO_AED,
  RECORD_RETENTION_YEARS as _RECORD_RETENTION_YEARS,
  DPMS_CASH_THRESHOLD_AED as _DPMS_CASH_THRESHOLD_AED,
} from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlockchainNetwork = 'bitcoin' | 'ethereum' | 'tron' | 'polygon' | 'bsc' | 'solana' | 'other';
export type AddressRiskCategory = 'sanctioned' | 'darknet' | 'mixer' | 'fraud' | 'gambling' | 'ransomware' | 'pep' | 'clean' | 'unknown';
export type TravelRuleStatus = 'compliant' | 'non_compliant' | 'exempt' | 'pending';

export interface CryptoTransaction {
  txHash: string;
  network: BlockchainNetwork;
  fromAddress: string;
  toAddress: string;
  amountUSD: number;
  amountNative: number;
  nativeAsset: string;
  timestamp: string; // ISO 8601
  blockNumber?: number;
  fee?: number;
}

export interface AddressProfile {
  address: string;
  network: BlockchainNetwork;
  riskCategories: AddressRiskCategory[];
  clusterLabel?: string;
  firstSeen?: string;
  totalTxCount?: number;
  totalVolumeUSD?: number;
}

export interface ClusterResult {
  clusterId: string;
  label: string;
  addresses: string[];
  riskCategories: AddressRiskCategory[];
  totalVolumeUSD: number;
  txCount: number;
}

export interface MixingIndicator {
  detected: boolean;
  confidence: number;
  indicators: string[];
  suspiciousTxHashes: string[];
}

export interface TravelRuleResult {
  txHash: string;
  amountUSD: number;
  amountAED: number;
  thresholdAED: number;
  requiresTravelRule: boolean;
  status: TravelRuleStatus;
  originatorInfo: boolean;
  beneficiaryInfo: boolean;
  missingFields: string[];
}

export interface CryptoAnalysisReport {
  reportId: string;
  generatedAt: string;
  analysisType: 'full' | 'travel_rule' | 'mixing' | 'clustering';
  network: BlockchainNetwork;
  addressesAnalyzed: number;
  transactionsAnalyzed: number;
  clusters: ClusterResult[];
  mixingAnalysis: MixingIndicator;
  travelRuleResults: TravelRuleResult[];
  highRiskAddresses: AddressProfile[];
  overallRiskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: string[];
  recommendations: string[];
  auditTrail: Array<{ timestamp: string; action: string; detail: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Travel rule threshold: USD 1,000 equivalent ~ AED 3,675 (CBUAE peg from constants) */
const TRAVEL_RULE_THRESHOLD_USD = 1_000;
const TRAVEL_RULE_THRESHOLD_AED = Math.round(TRAVEL_RULE_THRESHOLD_USD * USD_TO_AED);

/** Mixing detection parameters */
const MIXING_RAPID_HOP_MINUTES = 30;
const MIXING_MIN_FAN_OUT = 4;
const MIXING_MIN_INDICATORS = 2;

/** Known mixing service label fragments */
const KNOWN_MIXER_LABELS = ['tornado', 'chipmixer', 'wasabi', 'sinbad', 'blender', 'railgun'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateUAE(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isRoundAmount(amount: number): boolean {
  const rounded = Math.round(amount * 100) / 100;
  return rounded % 100 === 0 || rounded % 50 === 0 || rounded % 10 === 0;
}

function timeDiffMinutes(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60);
}

// ---------------------------------------------------------------------------
// Analysis: Address clustering
// ---------------------------------------------------------------------------

function clusterAddresses(
  transactions: CryptoTransaction[],
  profiles: AddressProfile[],
): ClusterResult[] {
  const addressMap = new Map<string, Set<string>>();

  // Build co-spend graph: addresses sharing common counterparties
  for (const tx of transactions) {
    if (!addressMap.has(tx.fromAddress)) addressMap.set(tx.fromAddress, new Set());
    addressMap.get(tx.fromAddress)!.add(tx.toAddress);
  }

  const profileMap = new Map<string, AddressProfile>();
  for (const p of profiles) profileMap.set(p.address, p);

  const visited = new Set<string>();
  const clusters: ClusterResult[] = [];

  for (const [addr, peers] of addressMap) {
    if (visited.has(addr)) continue;
    visited.add(addr);

    const clusterAddrs = [addr];
    for (const [otherAddr, otherPeers] of addressMap) {
      if (visited.has(otherAddr)) continue;
      const overlap = [...peers].filter((p) => otherPeers.has(p));
      if (overlap.length >= 2) {
        clusterAddrs.push(otherAddr);
        visited.add(otherAddr);
      }
    }

    if (clusterAddrs.length >= 2) {
      const riskCats = new Set<AddressRiskCategory>();
      let volume = 0;
      let txCount = 0;
      for (const a of clusterAddrs) {
        const prof = profileMap.get(a);
        if (prof) {
          prof.riskCategories.forEach((c) => riskCats.add(c));
          volume += prof.totalVolumeUSD ?? 0;
          txCount += prof.totalTxCount ?? 0;
        }
      }
      clusters.push({
        clusterId: crypto.randomUUID(),
        label: profileMap.get(clusterAddrs[0])?.clusterLabel ?? `cluster_${clusters.length + 1}`,
        addresses: clusterAddrs,
        riskCategories: [...riskCats],
        totalVolumeUSD: volume,
        txCount,
      });
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Analysis: Mixing detection
// ---------------------------------------------------------------------------

function detectMixing(transactions: CryptoTransaction[], profiles: AddressProfile[]): MixingIndicator {
  const indicators: string[] = [];
  const suspiciousTxHashes: string[] = [];

  // Indicator 1: Known mixer labels in address profiles
  const mixerAddresses = profiles.filter(
    (p) =>
      p.riskCategories.includes('mixer') ||
      (p.clusterLabel && KNOWN_MIXER_LABELS.some((ml) => p.clusterLabel!.toLowerCase().includes(ml))),
  );
  if (mixerAddresses.length > 0) {
    indicators.push(`${mixerAddresses.length} address(es) associated with known mixing services.`);
  }

  // Indicator 2: Equal-amount fan-out (peel chain)
  const amountGroups = new Map<number, CryptoTransaction[]>();
  for (const tx of transactions) {
    const bucket = Math.round(tx.amountUSD / 10) * 10;
    const arr = amountGroups.get(bucket) ?? [];
    arr.push(tx);
    amountGroups.set(bucket, arr);
  }
  for (const [amount, txGroup] of amountGroups) {
    if (txGroup.length >= MIXING_MIN_FAN_OUT && isRoundAmount(amount)) {
      indicators.push(`Fan-out detected: ${txGroup.length} transactions of ~$${amount} each.`);
      txGroup.forEach((t) => suspiciousTxHashes.push(t.txHash));
    }
  }

  // Indicator 3: Rapid multi-hop chains
  const sorted = [...transactions].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let rapidHops = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (
      sorted[i].fromAddress === sorted[i - 1].toAddress &&
      timeDiffMinutes(sorted[i].timestamp, sorted[i - 1].timestamp) <= MIXING_RAPID_HOP_MINUTES
    ) {
      rapidHops++;
      suspiciousTxHashes.push(sorted[i].txHash);
    }
  }
  if (rapidHops >= 3) {
    indicators.push(`Rapid multi-hop chain: ${rapidHops} consecutive hops within ${MIXING_RAPID_HOP_MINUTES} minutes each.`);
  }

  // Indicator 4: Round-trip transactions
  const senders = new Set(transactions.map((t) => t.fromAddress));
  const receivers = new Set(transactions.map((t) => t.toAddress));
  const roundTrips = [...senders].filter((s) => receivers.has(s));
  if (roundTrips.length > 0) {
    indicators.push(`Round-trip detected: ${roundTrips.length} address(es) appear as both sender and receiver.`);
  }

  const detected = indicators.length >= MIXING_MIN_INDICATORS;
  const confidence = Math.min(indicators.length * 0.25, 1);

  return {
    detected,
    confidence,
    indicators,
    suspiciousTxHashes: [...new Set(suspiciousTxHashes)],
  };
}

// ---------------------------------------------------------------------------
// Analysis: Travel rule compliance
// ---------------------------------------------------------------------------

function checkTravelRule(
  transactions: CryptoTransaction[],
  originatorInfoAvailable: boolean,
  beneficiaryInfoAvailable: boolean,
): TravelRuleResult[] {
  return transactions.map((tx) => {
    const amountAED = Math.round(tx.amountUSD * USD_TO_AED);
    const requiresTravelRule = amountAED >= TRAVEL_RULE_THRESHOLD_AED;

    const missingFields: string[] = [];
    if (requiresTravelRule) {
      if (!originatorInfoAvailable) missingFields.push('originator_name', 'originator_account', 'originator_address');
      if (!beneficiaryInfoAvailable) missingFields.push('beneficiary_name', 'beneficiary_account');
    }

    const status: TravelRuleStatus = !requiresTravelRule
      ? 'exempt'
      : missingFields.length === 0
        ? 'compliant'
        : 'non_compliant';

    return {
      txHash: tx.txHash,
      amountUSD: tx.amountUSD,
      amountAED,
      thresholdAED: TRAVEL_RULE_THRESHOLD_AED,
      requiresTravelRule,
      status,
      originatorInfo: originatorInfoAvailable,
      beneficiaryInfo: beneficiaryInfoAvailable,
      missingFields,
    };
  });
}

// ---------------------------------------------------------------------------
// Main function: analyzeBlockchainActivity
// ---------------------------------------------------------------------------

export function analyzeBlockchainActivity(input: {
  transactions: CryptoTransaction[];
  addressProfiles?: AddressProfile[];
  originatorInfoAvailable?: boolean;
  beneficiaryInfoAvailable?: boolean;
  network?: BlockchainNetwork;
}): ToolResult<CryptoAnalysisReport> {
  if (!input.transactions || input.transactions.length === 0) {
    return { ok: false, error: 'Transactions array must contain at least one entry.' };
  }

  const now = new Date();
  const reportId = crypto.randomUUID();
  const generatedAt = formatDateUAE(now);
  const network = input.network ?? input.transactions[0].network;
  const profiles = input.addressProfiles ?? [];

  // Run analyses
  const clusters = clusterAddresses(input.transactions, profiles);
  const mixingAnalysis = detectMixing(input.transactions, profiles);
  const travelRuleResults = checkTravelRule(
    input.transactions,
    input.originatorInfoAvailable ?? false,
    input.beneficiaryInfoAvailable ?? false,
  );

  // Identify high-risk addresses
  const highRiskAddresses = profiles.filter((p) =>
    p.riskCategories.some((c) => ['sanctioned', 'darknet', 'ransomware', 'mixer', 'fraud'].includes(c)),
  );

  // Build flags
  const flags: string[] = [];
  if (highRiskAddresses.length > 0) {
    flags.push(`${highRiskAddresses.length} high-risk address(es) detected.`);
  }
  if (mixingAnalysis.detected) {
    flags.push(`Mixing/tumbling activity detected (confidence: ${(mixingAnalysis.confidence * 100).toFixed(0)}%).`);
  }
  const nonCompliantTR = travelRuleResults.filter((r) => r.status === 'non_compliant');
  if (nonCompliantTR.length > 0) {
    flags.push(`${nonCompliantTR.length} transaction(s) non-compliant with travel rule (threshold AED ${TRAVEL_RULE_THRESHOLD_AED}).`);
  }
  if (clusters.some((c) => c.riskCategories.includes('sanctioned'))) {
    flags.push('Cluster linked to sanctioned address detected.');
  }

  // Calculate overall risk score (0-100)
  let riskScore = 0;
  riskScore += highRiskAddresses.length * 15;
  riskScore += mixingAnalysis.detected ? Math.round(mixingAnalysis.confidence * 30) : 0;
  riskScore += nonCompliantTR.length * 10;
  riskScore += clusters.filter((c) => c.riskCategories.includes('sanctioned')).length * 25;
  riskScore += clusters.filter((c) => c.riskCategories.includes('darknet')).length * 20;
  riskScore = Math.min(riskScore, 100);

  const riskLevel: 'low' | 'medium' | 'high' | 'critical' =
    riskScore >= 75 ? 'critical' :
    riskScore >= 50 ? 'high' :
    riskScore >= 25 ? 'medium' :
    'low';

  // Recommendations
  const recommendations: string[] = [];
  if (highRiskAddresses.some((a) => a.riskCategories.includes('sanctioned'))) {
    recommendations.push(
      'URGENT: Sanctioned address interaction detected. Freeze assets within 24 hours (Cabinet Res 74/2020). File CNMR within 5 business days.',
    );
  }
  if (mixingAnalysis.detected) {
    recommendations.push('File STR for mixing/tumbling activity. Mixing is a strong indicator of layering (FATF Typologies).');
  }
  if (nonCompliantTR.length > 0) {
    recommendations.push(
      `Obtain missing travel rule data for ${nonCompliantTR.length} transaction(s) or suspend relationship (FATF Rec 15 / VARA).`,
    );
  }
  if (clusters.some((c) => c.addresses.length >= 5)) {
    recommendations.push('Large address cluster detected. Conduct enhanced due diligence on counterparties.');
  }
  if (riskLevel === 'critical' || riskLevel === 'high') {
    recommendations.push('Escalate to Compliance Officer for review and potential STR filing (FDL Art.26-27).');
  }

  const uniqueAddresses = new Set([
    ...input.transactions.map((t) => t.fromAddress),
    ...input.transactions.map((t) => t.toAddress),
  ]);

  const auditTrail = [
    {
      timestamp: now.toISOString(),
      action: 'crypto_analysis_initiated',
      detail: `Analyzed ${input.transactions.length} transactions across ${uniqueAddresses.size} unique addresses on ${network}.`,
    },
    {
      timestamp: now.toISOString(),
      action: 'analysis_complete',
      detail: `Risk score: ${riskScore}/100 (${riskLevel}). Flags: ${flags.length}. Clusters: ${clusters.length}.`,
    },
  ];

  const report: CryptoAnalysisReport = {
    reportId,
    generatedAt,
    analysisType: 'full',
    network,
    addressesAnalyzed: uniqueAddresses.size,
    transactionsAnalyzed: input.transactions.length,
    clusters,
    mixingAnalysis,
    travelRuleResults,
    highRiskAddresses,
    overallRiskScore: riskScore,
    riskLevel,
    flags,
    recommendations,
    auditTrail,
  };

  return { ok: true, data: report };
}

// ---------------------------------------------------------------------------
// Exported wrapper: analyzeBlockchainAddress
// ---------------------------------------------------------------------------

/**
 * Analyze a specific blockchain address and its transaction history for
 * AML/CFT indicators. Delegates to full analysis pipeline internally.
 *
 * @regulatory FATF Rec 15, CBUAE VA Regulation 2024, FDL Art.12-14
 */
export function analyzeBlockchainAddress(input: {
  address: string;
  transactions: CryptoTransaction[];
  addressProfiles?: AddressProfile[];
  network?: BlockchainNetwork;
}): ToolResult<CryptoAnalysisReport> {
  if (!input.address || input.address.length < 10) {
    return { ok: false, error: 'Blockchain address must be at least 10 characters.' };
  }
  // Filter transactions relevant to the target address
  const relevantTxs = input.transactions.filter(
    (tx) =>
      tx.fromAddress.toLowerCase() === input.address.toLowerCase() ||
      tx.toAddress.toLowerCase() === input.address.toLowerCase(),
  );
  if (relevantTxs.length === 0) {
    return { ok: false, error: 'No transactions found involving the specified address.' };
  }
  return analyzeBlockchainActivity({
    transactions: relevantTxs,
    addressProfiles: input.addressProfiles,
    originatorInfoAvailable: false,
    beneficiaryInfoAvailable: false,
    network: input.network,
  });
}

// ---------------------------------------------------------------------------
// Exported: checkTravelRuleCompliance
// ---------------------------------------------------------------------------

export interface TravelRuleInput {
  transactions: CryptoTransaction[];
  originatorInfoAvailable: boolean;
  beneficiaryInfoAvailable: boolean;
}

/**
 * Standalone Travel Rule compliance check for a batch of VA transfers.
 * Evaluates each transaction against the AED 3,675 threshold and checks
 * whether originator/beneficiary information requirements are met.
 *
 * @regulatory FATF Rec 15/16, CBUAE VA Regulation 2024
 */
export function checkTravelRuleCompliance(
  input: TravelRuleInput,
): ToolResult<{ results: TravelRuleResult[]; compliantCount: number; nonCompliantCount: number; exemptCount: number; summary: string }> {
  if (!input.transactions || input.transactions.length === 0) {
    return { ok: false, error: 'At least one transaction is required for travel rule check.' };
  }

  const results = checkTravelRule(
    input.transactions,
    input.originatorInfoAvailable,
    input.beneficiaryInfoAvailable,
  );

  const compliantCount = results.filter((r) => r.status === 'compliant').length;
  const nonCompliantCount = results.filter((r) => r.status === 'non_compliant').length;
  const exemptCount = results.filter((r) => r.status === 'exempt').length;

  let summary: string;
  if (nonCompliantCount === 0) {
    summary = `All ${results.length} transactions are travel rule compliant or exempt (threshold AED ${TRAVEL_RULE_THRESHOLD_AED}).`;
  } else {
    summary = `${nonCompliantCount}/${results.length} transactions are NON-COMPLIANT with travel rule. Missing originator/beneficiary information for transfers >= AED ${TRAVEL_RULE_THRESHOLD_AED}. Do NOT process until information is obtained.`;
  }

  return {
    ok: true,
    data: { results, compliantCount, nonCompliantCount, exemptCount, summary },
  };
}

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

export const CRYPTO_TOOL_SCHEMAS = [
  {
    name: 'analyze_blockchain_address',
    description:
      'Analyze a specific blockchain address for AML/CFT indicators. Performs address clustering, mixing/tumbling detection (Tornado Cash, ChipMixer, Wasabi, etc.), DeFi bridge tracking, privacy coin flags, VASP identification. Returns risk score 0-100, clusters, mixing indicators, and recommendations. Regulatory: FATF Rec 15, CBUAE VA Regulation 2024, FDL Art.12-14.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Blockchain address to analyze' },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              txHash: { type: 'string' },
              network: { type: 'string', enum: ['bitcoin', 'ethereum', 'tron', 'polygon', 'bsc', 'solana', 'other'] },
              fromAddress: { type: 'string' },
              toAddress: { type: 'string' },
              amountUSD: { type: 'number', description: 'Transaction value in USD' },
              amountNative: { type: 'number', description: 'Amount in native asset' },
              nativeAsset: { type: 'string', description: 'Native asset symbol (e.g., BTC, ETH)' },
              timestamp: { type: 'string', description: 'ISO 8601 timestamp' },
              blockNumber: { type: 'number' },
              fee: { type: 'number' },
            },
            required: ['txHash', 'network', 'fromAddress', 'toAddress', 'amountUSD', 'amountNative', 'nativeAsset', 'timestamp'],
          },
          description: 'Transaction history involving the address',
        },
        addressProfiles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              network: { type: 'string' },
              riskCategories: {
                type: 'array',
                items: { type: 'string', enum: ['sanctioned', 'darknet', 'mixer', 'fraud', 'gambling', 'ransomware', 'pep', 'clean', 'unknown'] },
              },
              clusterLabel: { type: 'string' },
              totalTxCount: { type: 'number' },
              totalVolumeUSD: { type: 'number' },
            },
            required: ['address', 'network', 'riskCategories'],
          },
          description: 'Known address risk profiles',
        },
        network: {
          type: 'string',
          enum: ['bitcoin', 'ethereum', 'tron', 'polygon', 'bsc', 'solana', 'other'],
          description: 'Primary blockchain network',
        },
      },
      required: ['address', 'transactions'],
    },
  },
  {
    name: 'check_travel_rule',
    description:
      'Check Travel Rule compliance for virtual asset transfers. Validates originator/beneficiary information against FATF Rec 16 requirements. Threshold: AED 3,675 (~ USD 1,000). Returns per-transaction compliance status and missing fields. Regulatory: FATF Rec 15/16, CBUAE VA Regulation 2024.',
    inputSchema: {
      type: 'object',
      properties: {
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              txHash: { type: 'string' },
              network: { type: 'string' },
              fromAddress: { type: 'string' },
              toAddress: { type: 'string' },
              amountUSD: { type: 'number' },
              amountNative: { type: 'number' },
              nativeAsset: { type: 'string' },
              timestamp: { type: 'string' },
            },
            required: ['txHash', 'network', 'fromAddress', 'toAddress', 'amountUSD', 'amountNative', 'nativeAsset', 'timestamp'],
          },
          description: 'Transactions to check for travel rule compliance',
        },
        originatorInfoAvailable: { type: 'boolean', description: 'Whether originator identifying info is available' },
        beneficiaryInfoAvailable: { type: 'boolean', description: 'Whether beneficiary identifying info is available' },
      },
      required: ['transactions', 'originatorInfoAvailable', 'beneficiaryInfoAvailable'],
    },
  },
];
