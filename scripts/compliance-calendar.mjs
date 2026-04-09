/**
 * Compliance Calendar
 * Tracks all regulatory deadlines, filing dates, review cycles.
 * Alerts on overdue and upcoming deadlines.
 * Conforms to: FDL No.10/2025, Cabinet Res 134/2025, MoE Circular 08/AML/2021
 */
import { load } from './lib/store.mjs';

const RECURRING_DEADLINES = [
  { id: 'DPMSR-Q1', name: 'DPMS Quarterly Report — Q1', type: 'DPMSR', dueMonth: 3, dueDay: 31, frequency: 'quarterly' },
  { id: 'DPMSR-Q2', name: 'DPMS Quarterly Report — Q2', type: 'DPMSR', dueMonth: 6, dueDay: 30, frequency: 'quarterly' },
  { id: 'DPMSR-Q3', name: 'DPMS Quarterly Report — Q3', type: 'DPMSR', dueMonth: 9, dueDay: 30, frequency: 'quarterly' },
  { id: 'DPMSR-Q4', name: 'DPMS Quarterly Report — Q4', type: 'DPMSR', dueMonth: 12, dueDay: 31, frequency: 'quarterly' },
  { id: 'ANNUAL-AUDIT', name: 'Annual Independent AML/CFT Audit', type: 'audit', dueMonth: 12, dueDay: 31, frequency: 'annual' },
  { id: 'ANNUAL-TRAINING', name: 'Annual AML/CFT Staff Training', type: 'training', dueMonth: 12, dueDay: 31, frequency: 'annual' },
  { id: 'EWRA-REVIEW', name: 'Enterprise-Wide Risk Assessment Review', type: 'risk_assessment', dueMonth: 6, dueDay: 30, frequency: 'annual' },
  { id: 'BWRA-REVIEW', name: 'Business-Wide Risk Assessment Review', type: 'risk_assessment', dueMonth: 12, dueDay: 31, frequency: 'annual' },
  { id: 'POLICY-REVIEW', name: 'Annual Policy Review & Update', type: 'governance', dueMonth: 3, dueDay: 31, frequency: 'annual' },
  { id: 'BOARD-Q1', name: 'Board Compliance Report — Q1', type: 'governance', dueMonth: 3, dueDay: 31, frequency: 'quarterly' },
  { id: 'BOARD-Q2', name: 'Board Compliance Report — Q2', type: 'governance', dueMonth: 6, dueDay: 30, frequency: 'quarterly' },
  { id: 'BOARD-Q3', name: 'Board Compliance Report — Q3', type: 'governance', dueMonth: 9, dueDay: 30, frequency: 'quarterly' },
  { id: 'BOARD-Q4', name: 'Board Compliance Report — Q4', type: 'governance', dueMonth: 12, dueDay: 31, frequency: 'quarterly' },
  { id: 'LBMA-AUDIT', name: 'LBMA Responsible Gold Annual Audit', type: 'audit', dueMonth: 3, dueDay: 31, frequency: 'annual' },
];

/**
 * Get compliance calendar status.
 * @returns {{ overdue: number, upcoming: number, current: number, deadlines: object[] }}
 */
export function getCalendar() {
  const now = new Date();
  const currentYear = now.getFullYear();
  let overdue = 0;
  let upcoming = 0;
  let current = 0;
  const deadlines = [];

  for (const deadline of RECURRING_DEADLINES) {
    const dueDate = new Date(currentYear, deadline.dueMonth - 1, deadline.dueDay);
    const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

    let status;
    if (daysUntilDue < 0) {
      status = 'overdue';
      overdue++;
    } else if (daysUntilDue <= 30) {
      status = 'upcoming';
      upcoming++;
    } else {
      status = 'current';
      current++;
    }

    deadlines.push({
      ...deadline,
      dueDate: dueDate.toISOString().split('T')[0],
      daysUntilDue,
      status,
    });
  }

  return { overdue, upcoming, current, deadlines };
}
