import { nowIso, addMonths, isValidDate } from '../utils/dates';
import { createId } from '../utils/id';

export type ReviewFrequency = 3 | 6 | 12;

export interface PeriodicReviewSchedule {
  id: string;
  customerId: string;
  customerName: string;
  riskRating: 'low' | 'medium' | 'high';
  reviewType: 'cdd-refresh' | 'screening' | 'ewra' | 'training' | 'policy';
  frequencyMonths: ReviewFrequency;
  lastReviewDate: string;
  nextReviewDate: string;
  status: 'scheduled' | 'due' | 'overdue' | 'completed';
  assignedTo?: string;
  completedAt?: string;
}

export function getFrequencyForRisk(riskRating: 'low' | 'medium' | 'high'): ReviewFrequency {
  if (riskRating === 'high') return 3;
  if (riskRating === 'medium') return 6;
  return 12;
}

export function createReviewSchedule(
  customerId: string,
  customerName: string,
  riskRating: 'low' | 'medium' | 'high',
  reviewType: PeriodicReviewSchedule['reviewType'],
  lastReviewDate?: string
): PeriodicReviewSchedule {
  const freq = getFrequencyForRisk(riskRating);
  const lastDate = lastReviewDate && isValidDate(lastReviewDate) ? lastReviewDate : nowIso();
  const nextDate = addMonths(lastDate, freq);
  const now = new Date();
  const next = new Date(nextDate);
  let status: PeriodicReviewSchedule['status'] = 'scheduled';
  if (isNaN(next.getTime())) {
    status = 'scheduled';
  } else if (next < now) {
    status = 'overdue';
  } else if (next.getTime() - now.getTime() < 30 * 86400000) {
    status = 'due';
  }

  return {
    id: createId('review'),
    customerId,
    customerName,
    riskRating,
    reviewType,
    frequencyMonths: freq,
    lastReviewDate: lastDate,
    nextReviewDate: nextDate,
    status,
  };
}

/**
 * Derive the live status of a review schedule against the wall-clock.
 *
 * Accepts an optional `now` so callers that already hold an authoritative
 * report clock (weekly CDD rollup, audit snapshots, MLRO timeline replay)
 * can thread it through instead of re-reading the system clock. Without
 * this, a test that pins NOW via its own fixture and a production call
 * that happens at real-time diverge mid-run — which is exactly the
 * failure mode the CDD weekly-report test hit when fixture-now and
 * real-now fell on opposite sides of a scheduled date.
 */
export function checkReviewStatus(
  schedule: PeriodicReviewSchedule,
  now: Date = new Date()
): PeriodicReviewSchedule {
  if (schedule.status === 'completed') return schedule;
  const next = new Date(schedule.nextReviewDate);
  if (isNaN(next.getTime())) return { ...schedule, status: 'scheduled' };
  if (next < now) return { ...schedule, status: 'overdue' };
  if (next.getTime() - now.getTime() < 30 * 86400000) return { ...schedule, status: 'due' };
  return { ...schedule, status: 'scheduled' };
}
