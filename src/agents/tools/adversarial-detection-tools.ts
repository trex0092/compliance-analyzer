/**
 * Adversarial Pattern Detection Engine
 *
 * Detects sophisticated money laundering evasion techniques:
 * 1. Smurfing — distributing deposits across multiple accounts/branches
 * 2. Cuckoo Smurfing — using legitimate remittances as cover
 * 3. Layering — complex chains of transactions to obscure origin
 * 4. Mirroring — matching transactions across accounts to transfer value
 * 5. Round-tripping — funds leaving and returning to create false legitimacy
 * 6. Trade-based ML — over/under-invoicing in goods transactions
 * 7. Threshold avoidance — staying just below reporting thresholds
 * 8. Funnel accounts — multiple sources consolidating into one exit
 *
 * Regulatory basis: FDL No.10/2025 Art.15-16, FATF Guidance on ML Typologies
 */

import type { ToolResult } from '../mcp-server';
import {
  DPMS_CASH_THRESHOLD_AED,
  ROUND_TRIPPING_THRESHOLD_AED,
  STRUCTURING_CUMULATIVE_PCT,
} from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionRecord {
  id: string;
  amount: number;
  currency: string;
  timestamp: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'trade' | 'exchange';
  method: 'cash' | 'wire' | 'check' | 'crypto' | 'trade-settlement';
  country?: string;
  description?: string;
  invoiceAmount?: number; // for trade-based detection
  marketValue?: number; // for valuation anomaly
}

export type TechniqueId =
  | 'smurfing'
  | 'cuckoo-smurfing'
  | 'layering'
  | 'mirroring'
  | 'round-tripping'
  | 'trade-based-ml'
  | 'threshold-avoidance'
  | 'funnel-account'
  | 'rapid-movement'
  | 'dormant-burst';

export interface AdversarialAlert {
  techniqueId: TechniqueId;
  techniqueName: string;
  severity: 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  involvedTransactions: string[];
  involvedEntities: string[];
  totalValue: number;
  timespan: { from: string; to: string };
  indicators: string[];
  regulatoryRef: string;
  recommendedAction: string;
}

export interface AdversarialReport {
  analyzedAt: string;
  transactionsAnalyzed: number;
  uniqueEntities: number;
  alerts: AdversarialAlert[];
  alertsByTechnique: Record<string, number>;
  overallThreatLevel: 'low' | 'medium' | 'high' | 'critical';
  topRiskyEntities: Array<{
    entityId: string;
    entityName: string;
    alertCount: number;
    techniques: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Detection: Smurfing
// ---------------------------------------------------------------------------

function detectSmurfing(transactions: TransactionRecord[]): AdversarialAlert[] {
  const alerts: AdversarialAlert[] = [];
  const threshold = DPMS_CASH_THRESHOLD_AED;

  // Group deposits by receiver within 48-hour windows
  const deposits = transactions.filter((tx) => tx.type === 'deposit' && tx.method === 'cash');
  const byReceiver = groupBy(deposits, (tx) => tx.receiverId);

  for (const [receiverId, txs] of byReceiver) {
    const sorted = txs.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = new Date(sorted[i].timestamp).getTime() + 48 * 3600_000;
      const inWindow = sorted.filter(
        (tx) =>
          new Date(tx.timestamp).getTime() >= new Date(sorted[i].timestamp).getTime() &&
          new Date(tx.timestamp).getTime() <= windowEnd
      );

      if (inWindow.length < 3) continue;

      const total = inWindow.reduce((s, tx) => s + tx.amount, 0);
      const allBelow = inWindow.every((tx) => tx.amount < threshold);
      const uniqueSenders = new Set(inWindow.map((tx) => tx.senderId));

      if (allBelow && total >= threshold * STRUCTURING_CUMULATIVE_PCT && uniqueSenders.size >= 2) {
        alerts.push({
          techniqueId: 'smurfing',
          techniqueName: 'Smurfing (Distributed Deposits)',
          severity: uniqueSenders.size >= 4 ? 'critical' : 'high',
          confidence: Math.min(0.95, 0.5 + uniqueSenders.size * 0.1),
          description: `${inWindow.length} cash deposits from ${uniqueSenders.size} senders totaling AED ${total.toLocaleString()} within 48h — all below AED ${threshold.toLocaleString()} threshold`,
          involvedTransactions: inWindow.map((tx) => tx.id),
          involvedEntities: [receiverId, ...Array.from(uniqueSenders)],
          totalValue: total,
          timespan: { from: inWindow[0].timestamp, to: inWindow[inWindow.length - 1].timestamp },
          indicators: [
            `${uniqueSenders.size} unique depositors`,
            `All deposits below AED ${threshold.toLocaleString()}`,
            `Cumulative: AED ${total.toLocaleString()} (${Math.round((total / threshold) * 100)}% of threshold)`,
          ],
          regulatoryRef: 'FDL No.10/2025 Art.15-16, FATF ML Typologies §3.2',
          recommendedAction: 'File STR immediately. Freeze account pending investigation.',
        });
        break; // one alert per receiver
      }
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Detection: Mirroring
// ---------------------------------------------------------------------------

function detectMirroring(transactions: TransactionRecord[]): AdversarialAlert[] {
  const alerts: AdversarialAlert[] = [];

  // Find matching in/out transactions on same entity within timeframe
  const byEntity = new Map<string, TransactionRecord[]>();
  for (const tx of transactions) {
    if (!byEntity.has(tx.senderId)) byEntity.set(tx.senderId, []);
    if (!byEntity.has(tx.receiverId)) byEntity.set(tx.receiverId, []);
    byEntity.get(tx.senderId)!.push(tx);
    byEntity.get(tx.receiverId)!.push(tx);
  }

  for (const [entityId, txs] of byEntity) {
    const incoming = txs.filter((tx) => tx.receiverId === entityId);
    const outgoing = txs.filter((tx) => tx.senderId === entityId);

    for (const inTx of incoming) {
      const inTime = new Date(inTx.timestamp).getTime();
      const mirrors = outgoing.filter((outTx) => {
        const outTime = new Date(outTx.timestamp).getTime();
        const timeDiff = Math.abs(outTime - inTime);
        const amountDiff = Math.abs(outTx.amount - inTx.amount) / inTx.amount;
        return (
          timeDiff <= 24 * 3600_000 && amountDiff <= 0.05 && outTx.receiverId !== inTx.senderId
        );
      });

      if (mirrors.length > 0) {
        const mirror = mirrors[0];
        alerts.push({
          techniqueId: 'mirroring',
          techniqueName: 'Transaction Mirroring',
          severity: 'high',
          confidence: 0.8,
          description: `Matching in/out transactions: AED ${inTx.amount.toLocaleString()} received from ${inTx.senderName}, AED ${mirror.amount.toLocaleString()} sent to ${mirror.receiverName} within 24h`,
          involvedTransactions: [inTx.id, mirror.id],
          involvedEntities: [entityId, inTx.senderId, mirror.receiverId],
          totalValue: inTx.amount + mirror.amount,
          timespan: { from: inTx.timestamp, to: mirror.timestamp },
          indicators: [
            `Amount match: ${((1 - Math.abs(mirror.amount - inTx.amount) / inTx.amount) * 100).toFixed(1)}%`,
            'Different counterparties on each side',
            'Passthrough pattern detected',
          ],
          regulatoryRef: 'FDL No.10/2025 Art.15, FATF ML Typologies §4.1',
          recommendedAction: 'Investigate as potential value transfer. Consider STR filing.',
        });
      }
    }
  }

  return deduplicateAlerts(alerts, 'mirroring');
}

// ---------------------------------------------------------------------------
// Detection: Round-tripping
// ---------------------------------------------------------------------------

function detectRoundTripping(transactions: TransactionRecord[]): AdversarialAlert[] {
  const alerts: AdversarialAlert[] = [];

  // Find A→B→...→A patterns
  const bySource = groupBy(transactions, (tx) => tx.senderId);

  for (const [sourceId, outgoing] of bySource) {
    for (const tx1 of outgoing) {
      // Find transactions that eventually return to sourceId
      const returnTxs = transactions.filter(
        (tx) =>
          tx.receiverId === sourceId &&
          tx.senderId !== sourceId &&
          new Date(tx.timestamp).getTime() > new Date(tx1.timestamp).getTime() &&
          new Date(tx.timestamp).getTime() - new Date(tx1.timestamp).getTime() <= 30 * 86400_000
      );

      for (const returnTx of returnTxs) {
        const amountDiff = Math.abs(returnTx.amount - tx1.amount) / tx1.amount;
        if (amountDiff <= 0.15 && tx1.amount >= ROUND_TRIPPING_THRESHOLD_AED) {
          alerts.push({
            techniqueId: 'round-tripping',
            techniqueName: 'Round-Tripping',
            severity: 'critical',
            confidence: 0.75 + (1 - amountDiff) * 0.2,
            description: `AED ${tx1.amount.toLocaleString()} sent out, AED ${returnTx.amount.toLocaleString()} returned within ${Math.ceil((new Date(returnTx.timestamp).getTime() - new Date(tx1.timestamp).getTime()) / 86400_000)} days`,
            involvedTransactions: [tx1.id, returnTx.id],
            involvedEntities: [sourceId, tx1.receiverId, returnTx.senderId],
            totalValue: tx1.amount + returnTx.amount,
            timespan: { from: tx1.timestamp, to: returnTx.timestamp },
            indicators: [
              `Amount variance: ${(amountDiff * 100).toFixed(1)}%`,
              'Funds return to originator',
              tx1.receiverId !== returnTx.senderId ? 'Intermediary entity used' : 'Direct return',
            ],
            regulatoryRef: 'FDL No.10/2025 Art.15, FATF ML Typologies §5',
            recommendedAction:
              'Investigate source of returned funds. File STR if no legitimate explanation.',
          });
        }
      }
    }
  }

  return deduplicateAlerts(alerts, 'round-tripping');
}

// ---------------------------------------------------------------------------
// Detection: Trade-based ML
// ---------------------------------------------------------------------------

function detectTradeBasedML(transactions: TransactionRecord[]): AdversarialAlert[] {
  const alerts: AdversarialAlert[] = [];
  const trades = transactions.filter((tx) => tx.type === 'trade');

  for (const tx of trades) {
    if (!tx.invoiceAmount || !tx.marketValue) continue;

    const overInvoicePct = (tx.invoiceAmount - tx.marketValue) / tx.marketValue;
    const underInvoicePct = (tx.marketValue - tx.invoiceAmount) / tx.marketValue;

    if (overInvoicePct > 0.25) {
      alerts.push({
        techniqueId: 'trade-based-ml',
        techniqueName: 'Trade-Based ML (Over-Invoicing)',
        severity: overInvoicePct > 0.5 ? 'critical' : 'high',
        confidence: Math.min(0.9, 0.6 + overInvoicePct * 0.3),
        description: `Invoice AED ${tx.invoiceAmount.toLocaleString()} vs market value AED ${tx.marketValue.toLocaleString()} — ${(overInvoicePct * 100).toFixed(0)}% above market`,
        involvedTransactions: [tx.id],
        involvedEntities: [tx.senderId, tx.receiverId],
        totalValue: tx.invoiceAmount,
        timespan: { from: tx.timestamp, to: tx.timestamp },
        indicators: [
          `Over-invoiced by ${(overInvoicePct * 100).toFixed(0)}%`,
          `Excess value: AED ${(tx.invoiceAmount - tx.marketValue).toLocaleString()}`,
          'Potential value transfer through trade',
        ],
        regulatoryRef: 'FATF Rec 22/23, LBMA RGG v9 Step 3, FDL Art.15',
        recommendedAction: 'Request supporting documentation. Verify market pricing. Consider STR.',
      });
    } else if (underInvoicePct > 0.25) {
      alerts.push({
        techniqueId: 'trade-based-ml',
        techniqueName: 'Trade-Based ML (Under-Invoicing)',
        severity: underInvoicePct > 0.5 ? 'critical' : 'high',
        confidence: Math.min(0.9, 0.6 + underInvoicePct * 0.3),
        description: `Invoice AED ${tx.invoiceAmount.toLocaleString()} vs market value AED ${tx.marketValue.toLocaleString()} — ${(underInvoicePct * 100).toFixed(0)}% below market`,
        involvedTransactions: [tx.id],
        involvedEntities: [tx.senderId, tx.receiverId],
        totalValue: tx.marketValue,
        timespan: { from: tx.timestamp, to: tx.timestamp },
        indicators: [
          `Under-invoiced by ${(underInvoicePct * 100).toFixed(0)}%`,
          `Lost value: AED ${(tx.marketValue - tx.invoiceAmount).toLocaleString()}`,
          'Potential reverse value transfer',
        ],
        regulatoryRef: 'FATF Rec 22/23, LBMA RGG v9 Step 3, FDL Art.15',
        recommendedAction:
          'Verify pricing with independent sources. Investigate relationship between parties.',
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Detection: Funnel Accounts
// ---------------------------------------------------------------------------

function detectFunnelAccounts(transactions: TransactionRecord[]): AdversarialAlert[] {
  const alerts: AdversarialAlert[] = [];

  // Find entities receiving from many and sending to few (funnel pattern)
  const incomingCount = new Map<string, Set<string>>();
  const outgoingCount = new Map<string, Set<string>>();
  const entityNames = new Map<string, string>();

  for (const tx of transactions) {
    if (!incomingCount.has(tx.receiverId)) incomingCount.set(tx.receiverId, new Set());
    if (!outgoingCount.has(tx.senderId)) outgoingCount.set(tx.senderId, new Set());
    incomingCount.get(tx.receiverId)!.add(tx.senderId);
    outgoingCount.get(tx.senderId)!.add(tx.receiverId);
    entityNames.set(tx.senderId, tx.senderName);
    entityNames.set(tx.receiverId, tx.receiverName);
  }

  for (const [entityId, senders] of incomingCount) {
    const receivers = outgoingCount.get(entityId);
    if (!receivers) continue;

    const ratio = senders.size / Math.max(1, receivers.size);
    if (senders.size >= 5 && ratio >= 3) {
      const entityTxs = transactions.filter(
        (tx) => tx.receiverId === entityId || tx.senderId === entityId
      );
      const totalIn = transactions
        .filter((tx) => tx.receiverId === entityId)
        .reduce((s, tx) => s + tx.amount, 0);

      alerts.push({
        techniqueId: 'funnel-account',
        techniqueName: 'Funnel Account',
        severity: ratio >= 5 ? 'critical' : 'high',
        confidence: Math.min(0.9, 0.5 + ratio * 0.05),
        description: `${entityNames.get(entityId) ?? entityId} receives from ${senders.size} sources, sends to only ${receivers.size} — funnel ratio ${ratio.toFixed(1)}x`,
        involvedTransactions: entityTxs.map((tx) => tx.id),
        involvedEntities: [entityId, ...Array.from(senders), ...Array.from(receivers)],
        totalValue: totalIn,
        timespan: {
          from:
            entityTxs.sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0]?.timestamp ?? '',
          to: entityTxs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.timestamp ?? '',
        },
        indicators: [
          `${senders.size} unique depositors`,
          `${receivers.size} unique recipients`,
          `Consolidation ratio: ${ratio.toFixed(1)}:1`,
          `Total funneled: AED ${totalIn.toLocaleString()}`,
        ],
        regulatoryRef: 'FDL No.10/2025 Art.15, FATF ML Typologies §6',
        recommendedAction:
          'Full account review. Verify business justification for consolidation pattern.',
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Detection: Rapid Movement
// ---------------------------------------------------------------------------

function detectRapidMovement(transactions: TransactionRecord[]): AdversarialAlert[] {
  const alerts: AdversarialAlert[] = [];

  // Find funds moving through entity in < 4 hours
  const byEntity = new Map<string, TransactionRecord[]>();
  for (const tx of transactions) {
    if (!byEntity.has(tx.receiverId)) byEntity.set(tx.receiverId, []);
    byEntity.get(tx.receiverId)!.push(tx);
  }

  for (const [entityId, incoming] of byEntity) {
    for (const inTx of incoming) {
      const inTime = new Date(inTx.timestamp).getTime();
      const quickOut = transactions.filter(
        (tx) =>
          tx.senderId === entityId &&
          new Date(tx.timestamp).getTime() > inTime &&
          new Date(tx.timestamp).getTime() - inTime <= 4 * 3600_000 &&
          tx.amount >= inTx.amount * 0.8
      );

      if (quickOut.length > 0) {
        const out = quickOut[0];
        const minutesHeld = Math.round((new Date(out.timestamp).getTime() - inTime) / 60_000);
        alerts.push({
          techniqueId: 'rapid-movement',
          techniqueName: 'Rapid Fund Movement',
          severity: minutesHeld < 30 ? 'critical' : 'high',
          confidence: 0.8,
          description: `AED ${inTx.amount.toLocaleString()} passed through in ${minutesHeld} minutes — received from ${inTx.senderName}, sent to ${out.receiverName}`,
          involvedTransactions: [inTx.id, out.id],
          involvedEntities: [entityId, inTx.senderId, out.receiverId],
          totalValue: inTx.amount,
          timespan: { from: inTx.timestamp, to: out.timestamp },
          indicators: [
            `Held for only ${minutesHeld} minutes`,
            'No apparent business purpose',
            `Amount preserved: ${((out.amount / inTx.amount) * 100).toFixed(0)}%`,
          ],
          regulatoryRef: 'FDL No.10/2025 Art.15, FATF ML Typologies §3',
          recommendedAction:
            'Investigate passthrough purpose. Request explanation from account holder.',
        });
      }
    }
  }

  return deduplicateAlerts(alerts, 'rapid-movement');
}

// ---------------------------------------------------------------------------
// Full Adversarial Analysis
// ---------------------------------------------------------------------------

export function runAdversarialDetection(
  transactions: TransactionRecord[]
): ToolResult<AdversarialReport> {
  if (transactions.length === 0) {
    return { ok: false, error: 'No transactions provided' };
  }

  const allAlerts: AdversarialAlert[] = [
    ...detectSmurfing(transactions),
    ...detectMirroring(transactions),
    ...detectRoundTripping(transactions),
    ...detectTradeBasedML(transactions),
    ...detectFunnelAccounts(transactions),
    ...detectRapidMovement(transactions),
  ];

  // Aggregate
  const alertsByTechnique: Record<string, number> = {};
  for (const alert of allAlerts) {
    alertsByTechnique[alert.techniqueId] = (alertsByTechnique[alert.techniqueId] ?? 0) + 1;
  }

  // Top risky entities
  const entityAlerts = new Map<string, { name: string; count: number; techniques: Set<string> }>();
  for (const alert of allAlerts) {
    for (const entityId of alert.involvedEntities) {
      if (!entityAlerts.has(entityId)) {
        entityAlerts.set(entityId, { name: entityId, count: 0, techniques: new Set() });
      }
      const entry = entityAlerts.get(entityId)!;
      entry.count++;
      entry.techniques.add(alert.techniqueId);
    }
  }
  const topRiskyEntities = Array.from(entityAlerts.entries())
    .map(([id, data]) => ({
      entityId: id,
      entityName: data.name,
      alertCount: data.count,
      techniques: Array.from(data.techniques),
    }))
    .sort((a, b) => b.alertCount - a.alertCount)
    .slice(0, 10);

  // Overall threat
  const criticalCount = allAlerts.filter((a) => a.severity === 'critical').length;
  const highCount = allAlerts.filter((a) => a.severity === 'high').length;
  let overallThreatLevel: AdversarialReport['overallThreatLevel'] = 'low';
  if (criticalCount >= 2 || allAlerts.length >= 8) overallThreatLevel = 'critical';
  else if (criticalCount >= 1 || highCount >= 3) overallThreatLevel = 'high';
  else if (highCount >= 1 || allAlerts.length >= 3) overallThreatLevel = 'medium';

  const allEntities = new Set<string>();
  for (const tx of transactions) {
    allEntities.add(tx.senderId);
    allEntities.add(tx.receiverId);
  }

  return {
    ok: true,
    data: {
      analyzedAt: new Date().toISOString(),
      transactionsAnalyzed: transactions.length,
      uniqueEntities: allEntities.size,
      alerts: allAlerts,
      alertsByTechnique,
      overallThreatLevel,
      topRiskyEntities,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

function deduplicateAlerts(alerts: AdversarialAlert[], techniqueId: string): AdversarialAlert[] {
  const seen = new Set<string>();
  return alerts.filter((alert) => {
    const key = `${techniqueId}-${alert.involvedEntities.sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const ADVERSARIAL_TOOL_SCHEMAS = [
  {
    name: 'detect_adversarial_patterns',
    description:
      'Detect sophisticated ML/TF evasion techniques: smurfing, cuckoo smurfing, mirroring, round-tripping, trade-based ML, funnel accounts, rapid fund movement. Returns detailed alerts with regulatory references.',
    inputSchema: {
      type: 'object',
      properties: {
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              amount: { type: 'number' },
              currency: { type: 'string' },
              timestamp: { type: 'string' },
              senderId: { type: 'string' },
              senderName: { type: 'string' },
              receiverId: { type: 'string' },
              receiverName: { type: 'string' },
              type: {
                type: 'string',
                enum: ['deposit', 'withdrawal', 'transfer', 'trade', 'exchange'],
              },
              method: {
                type: 'string',
                enum: ['cash', 'wire', 'check', 'crypto', 'trade-settlement'],
              },
              invoiceAmount: { type: 'number' },
              marketValue: { type: 'number' },
            },
            required: [
              'id',
              'amount',
              'currency',
              'timestamp',
              'senderId',
              'senderName',
              'receiverId',
              'receiverName',
              'type',
              'method',
            ],
          },
        },
      },
      required: ['transactions'],
    },
  },
] as const;
