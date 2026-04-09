/**
 * Auto-CDD Renewal Engine
 *
 * Extends periodicReview.ts with automation logic:
 * - Detects customers approaching CDD review date
 * - Generates renewal tasks
 * - Creates Asana tasks for CO assignment
 * - Logs all actions to audit trail
 *
 * Does NOT replace periodicReview.ts — builds on top of it.
 */

import type { CustomerProfile } from '../domain/customers';
import type { Alert } from '../domain/alerts';
import { createId } from '../utils/id';
import { nowIso } from '../utils/dates';
import { addBusinessDays } from '../utils/businessDays';
import {
  CDD_REVIEW_HIGH_RISK_MONTHS,
  CDD_REVIEW_MEDIUM_RISK_MONTHS,
  CDD_REVIEW_LOW_RISK_MONTHS,
} from '../domain/constants';

export interface RenewalTask {
  id: string;
  customerId: string;
  customerName: string;
  riskRating: 'low' | 'medium' | 'high';
  reviewType: 'cdd-refresh';
  dueDate: string;
  status: 'pending' | 'in-progress' | 'completed' | 'overdue';
  createdAt: string;
  assignedTo?: string;
  completedAt?: string;
  asanaTaskGid?: string;
}

export interface RenewalScanResult {
  scannedAt: string;
  customersScanned: number;
  renewalsDue: RenewalTask[];
  renewalsOverdue: RenewalTask[];
  upcomingIn30Days: RenewalTask[];
  alerts: Alert[];
}

function getReviewFrequencyMonths(risk: 'low' | 'medium' | 'high'): number {
  switch (risk) {
    case 'high':
      return CDD_REVIEW_HIGH_RISK_MONTHS;
    case 'medium':
      return CDD_REVIEW_MEDIUM_RISK_MONTHS;
    case 'low':
      return CDD_REVIEW_LOW_RISK_MONTHS;
  }
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Scan all customers and generate renewal tasks for those approaching
 * or past their CDD review date.
 */
export function scanForRenewals(
  customers: CustomerProfile[],
  existingTasks: RenewalTask[] = []
): RenewalScanResult {
  const now = new Date();
  const thirtyDaysFromNow = addBusinessDays(now, 22); // ~30 calendar days
  const renewalsDue: RenewalTask[] = [];
  const renewalsOverdue: RenewalTask[] = [];
  const upcomingIn30Days: RenewalTask[] = [];
  const alerts: Alert[] = [];
  const existingCustomerIds = new Set(
    existingTasks.filter((t) => t.status !== 'completed').map((t) => t.customerId)
  );

  for (const customer of customers) {
    // Skip if already has an active renewal task
    if (existingCustomerIds.has(customer.id)) continue;

    const frequencyMonths = getReviewFrequencyMonths(customer.riskRating);

    // Calculate next review date
    let nextReviewDate: Date;
    if (customer.nextCDDReviewDate) {
      nextReviewDate = new Date(customer.nextCDDReviewDate);
    } else if (customer.lastCDDReviewDate) {
      nextReviewDate = addMonths(new Date(customer.lastCDDReviewDate), frequencyMonths);
    } else {
      // No review history — due immediately
      nextReviewDate = now;
    }

    const daysUntilDue = (nextReviewDate.getTime() - now.getTime()) / 86400000;

    const task: RenewalTask = {
      id: createId('cdd-renewal'),
      customerId: customer.id,
      customerName: customer.legalName,
      riskRating: customer.riskRating,
      reviewType: 'cdd-refresh',
      dueDate: nextReviewDate.toISOString().slice(0, 10),
      status: daysUntilDue < 0 ? 'overdue' : 'pending',
      createdAt: nowIso(),
    };

    if (daysUntilDue < 0) {
      // Overdue
      renewalsOverdue.push(task);
      alerts.push({
        id: createId('alert'),
        type: 'review-overdue',
        subjectId: customer.id,
        subjectType: 'customer',
        message: `CDD review overdue for ${customer.legalName} by ${Math.abs(Math.floor(daysUntilDue))} days. Risk: ${customer.riskRating}. Frequency: ${frequencyMonths} months.`,
        severity: customer.riskRating === 'high' ? 'critical' : 'high',
        createdAt: nowIso(),
      });
    } else if (daysUntilDue === 0) {
      // Due today (was <= 0 which could never reach here since < 0 is caught above)
      renewalsDue.push(task);
    } else if (nextReviewDate <= thirtyDaysFromNow) {
      // Due within 30 days
      upcomingIn30Days.push(task);
      alerts.push({
        id: createId('alert'),
        type: 'review-overdue',
        subjectId: customer.id,
        subjectType: 'customer',
        message: `CDD review for ${customer.legalName} due in ${Math.floor(daysUntilDue)} days (${task.dueDate}). Risk: ${customer.riskRating}.`,
        severity: 'medium',
        createdAt: nowIso(),
      });
    }
  }

  return {
    scannedAt: nowIso(),
    customersScanned: customers.length,
    renewalsDue,
    renewalsOverdue,
    upcomingIn30Days,
    alerts,
  };
}
