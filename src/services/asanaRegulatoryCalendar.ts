/**
 * Asana Regulatory Calendar — F8.
 *
 * Sync regulatory deadline events into a dedicated Asana project so
 * non-technical executives see compliance deadlines on their existing
 * Asana timeline alongside their own work.
 *
 * Sources of events:
 *   - FATF plenary meeting dates (3 per year, fixed)
 *   - MoE circular publication windows
 *   - CBUAE FX rate publication days (weekdays)
 *   - Internal review schedule (monthly + quarterly)
 *
 * Pure compute. The orchestrator persists each event as an Asana
 * task with `due_on` set.
 *
 * Regulatory basis:
 *   FATF plenary calendar
 *   Cabinet Res 134/2025 Art.5 (dynamic risk rating)
 *   FDL Art.19 (internal review)
 */

export interface CalendarEvent {
  /** Stable id so re-runs are idempotent. */
  id: string;
  /** Display name. */
  name: string;
  /** Long-form description. */
  notes: string;
  /** Calendar date (yyyy-mm-dd) the event lands on. */
  dueOn: string;
  /** Asana section to file the event under. */
  section: 'FATF' | 'MoE' | 'CBUAE' | 'Internal Review';
  /** Optional regulatory citation. */
  regulatory?: string;
}

export interface CalendarSeed {
  /** Calendar year to generate. */
  year: number;
}

/**
 * Generate the canonical regulatory calendar for a given year.
 * Hard-coded for 2026; extend as the year changes.
 */
export function buildRegulatoryCalendar(seed: CalendarSeed): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const y = seed.year;

  // FATF Plenary — three plenaries per year (Feb, June, Oct).
  events.push(
    {
      id: `fatf-plenary-feb-${y}`,
      name: `FATF Plenary — February ${y}`,
      notes: 'FATF plenary meeting. Watch for jurisdictional list updates (high-risk + grey list).',
      dueOn: `${y}-02-23`,
      section: 'FATF',
      regulatory: 'FATF Methodology 2022',
    },
    {
      id: `fatf-plenary-jun-${y}`,
      name: `FATF Plenary — June ${y}`,
      notes: 'FATF plenary meeting. Watch for jurisdictional list updates and methodology updates.',
      dueOn: `${y}-06-22`,
      section: 'FATF',
      regulatory: 'FATF Methodology 2022',
    },
    {
      id: `fatf-plenary-oct-${y}`,
      name: `FATF Plenary — October ${y}`,
      notes: 'FATF plenary meeting. Watch for jurisdictional list updates.',
      dueOn: `${y}-10-19`,
      section: 'FATF',
      regulatory: 'FATF Methodology 2022',
    }
  );

  // Quarterly DPMS reporting (MoE) — end of each quarter.
  const quarters = [
    { name: 'Q1', dueOn: `${y}-04-30` },
    { name: 'Q2', dueOn: `${y}-07-31` },
    { name: 'Q3', dueOn: `${y}-10-31` },
    { name: 'Q4', dueOn: `${y + 1}-01-31` },
  ];
  for (const q of quarters) {
    events.push({
      id: `moe-dpms-${y}-${q.name.toLowerCase()}`,
      name: `MoE DPMS Report — ${q.name} ${y}`,
      notes: 'Quarterly DPMS sector report submission to UAE MoE via goAML portal.',
      dueOn: q.dueOn,
      section: 'MoE',
      regulatory: 'MoE Circular 08/AML/2021',
    });
  }

  // Monthly internal review (Cabinet Res 134/2025 Art.19).
  for (let m = 1; m <= 12; m++) {
    const month = String(m).padStart(2, '0');
    events.push({
      id: `internal-review-${y}-${month}`,
      name: `Internal compliance review — ${month}/${y}`,
      notes:
        'Monthly internal review. Check policy versioning, drift report, four-eyes statistics.',
      dueOn: `${y}-${month}-28`,
      section: 'Internal Review',
      regulatory: 'Cabinet Res 134/2025 Art.19',
    });
  }

  // CBUAE FX rate weekdays — too noisy to spawn 250 tasks; emit one
  // per quarter as a roll-up reminder.
  for (const q of quarters) {
    events.push({
      id: `cbuae-fx-rollup-${y}-${q.name.toLowerCase()}`,
      name: `CBUAE FX rates ${q.name} ${y} reconciliation`,
      notes:
        'Reconcile the cbuae-fx-cron snapshots with the manual archive. Confirm peg-fallback flag was clear all quarter.',
      dueOn: q.dueOn,
      section: 'CBUAE',
    });
  }

  return events;
}
