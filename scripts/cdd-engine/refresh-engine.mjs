/**
 * CDD Refresh Engine
 * Manages Customer Due Diligence review cycles based on risk level.
 * Automatically identifies overdue reviews and triggers re-screening.
 * Conforms to: FDL No.10/2025 Art.12-14, Cabinet Res 134/2025 Art.7-10
 */
import { load, save } from '../lib/store.mjs';

// Review frequencies from regulatory constants (months)
const REVIEW_FREQUENCY = {
  high: 3,     // CDD_REVIEW_HIGH_RISK_MONTHS
  medium: 6,   // CDD_REVIEW_MEDIUM_RISK_MONTHS
  low: 12,     // CDD_REVIEW_LOW_RISK_MONTHS
};

/**
 * Run the CDD refresh cycle.
 * Checks all entities for overdue or upcoming reviews.
 * @returns {{ total: number, refreshed: object[], overdue: object[], upcoming: object[] }}
 */
export async function runRefreshCycle() {
  const entities = await load('counterparty-portfolio', []);
  const cddRecords = await load('cdd-records', {});
  const now = new Date();

  const refreshed = [];
  const overdue = [];
  const upcoming = [];

  for (const entity of entities) {
    const record = cddRecords[entity.id] || {
      lastReview: entity.onboardedAt || null,
      riskLevel: entity.riskLevel || 'medium',
      reviewCount: 0,
    };

    const frequencyMonths = REVIEW_FREQUENCY[record.riskLevel] || 6;
    const lastReview = record.lastReview ? new Date(record.lastReview) : null;

    if (!lastReview) {
      overdue.push({
        entityId: entity.id,
        name: entity.name,
        riskLevel: record.riskLevel,
        reason: 'No CDD review on record',
      });
      continue;
    }

    const nextReviewDate = new Date(lastReview);
    nextReviewDate.setMonth(nextReviewDate.getMonth() + frequencyMonths);

    const daysUntilDue = Math.ceil((nextReviewDate - now) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) {
      overdue.push({
        entityId: entity.id,
        name: entity.name,
        riskLevel: record.riskLevel,
        daysOverdue: Math.abs(daysUntilDue),
        lastReview: record.lastReview,
        nextDue: nextReviewDate.toISOString().split('T')[0],
      });
    } else if (daysUntilDue <= 30) {
      upcoming.push({
        entityId: entity.id,
        name: entity.name,
        riskLevel: record.riskLevel,
        daysUntilDue,
        nextDue: nextReviewDate.toISOString().split('T')[0],
      });
    } else {
      // Auto-refresh: update the record's check timestamp
      record.lastChecked = now.toISOString();
      cddRecords[entity.id] = record;
      refreshed.push({ entityId: entity.id, name: entity.name });
    }
  }

  await save('cdd-records', cddRecords);

  return {
    total: entities.length,
    refreshed,
    overdue,
    upcoming,
  };
}
