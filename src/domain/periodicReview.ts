import { nowIso, addMonths } from "../utils/dates";
import { createId } from "../utils/id";

export type ReviewFrequency = 3 | 6 | 12;

export interface PeriodicReviewSchedule {
  id: string;
  customerId: string;
  customerName: string;
  riskRating: "low" | "medium" | "high";
  reviewType: "cdd-refresh" | "screening" | "ewra" | "training" | "policy";
  frequencyMonths: ReviewFrequency;
  lastReviewDate: string;
  nextReviewDate: string;
  status: "scheduled" | "due" | "overdue" | "completed";
  assignedTo?: string;
  completedAt?: string;
}

export function getFrequencyForRisk(
  riskRating: "low" | "medium" | "high"
): ReviewFrequency {
  if (riskRating === "high") return 3;
  if (riskRating === "medium") return 6;
  return 12;
}

export function createReviewSchedule(
  customerId: string,
  customerName: string,
  riskRating: "low" | "medium" | "high",
  reviewType: PeriodicReviewSchedule["reviewType"],
  lastReviewDate?: string
): PeriodicReviewSchedule {
  const freq = getFrequencyForRisk(riskRating);
  const lastDate = lastReviewDate ?? nowIso();
  const nextDate = addMonths(lastDate, freq);
  const now = new Date();
  const next = new Date(nextDate);
  let status: PeriodicReviewSchedule["status"] = "scheduled";
  if (next < now) status = "overdue";
  else if (next.getTime() - now.getTime() < 30 * 86400000) status = "due";

  return {
    id: createId("review"),
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

export function checkReviewStatus(
  schedule: PeriodicReviewSchedule
): PeriodicReviewSchedule {
  if (schedule.status === "completed") return schedule;
  const now = new Date();
  const next = new Date(schedule.nextReviewDate);
  if (next < now) return { ...schedule, status: "overdue" };
  if (next.getTime() - now.getTime() < 30 * 86400000)
    return { ...schedule, status: "due" };
  return { ...schedule, status: "scheduled" };
}
