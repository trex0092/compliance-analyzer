/**
 * World Monitor Intelligence Feed
 * Aggregates geopolitical and sanctions intelligence signals for risk lift calculation.
 * Sources: FATF statements, OFAC actions, UN designations, news feeds.
 */
import { load, save } from '../../scripts/lib/store.mjs';

const SIGNAL_WEIGHTS = {
  sanctions_designation: 0.15,
  fatf_statement: 0.10,
  un_resolution: 0.12,
  ofac_action: 0.10,
  eu_listing: 0.08,
  pf_alert: 0.15,
  cahra_update: 0.07,
  adverse_media: 0.05,
  regulatory_change: 0.06,
  geopolitical_event: 0.04,
};

/**
 * Fetch intelligence signals from configured sources.
 * @param {{ hours?: number, limit?: number }} options
 * @returns {Promise<object[]>} Array of intelligence events
 */
export async function fetchIntelligence({ hours = 24, limit = 20 } = {}) {
  const stored = await load('intelligence-feed', []);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  // Return events within the time window
  const recent = stored
    .filter(e => new Date(e.timestamp).getTime() > cutoff)
    .slice(0, limit);

  return recent;
}

/**
 * Score intelligence events to determine overall risk lift.
 * Risk lift is a multiplier adjustment applied to baseline risk scores.
 * @param {object[]} events
 * @returns {{ lift: number, breakdown: object }}
 */
export function scoreIntelligence(events) {
  if (!events || events.length === 0) return { lift: 0, breakdown: {} };

  const breakdown = {};
  let totalLift = 0;

  for (const event of events) {
    const weight = SIGNAL_WEIGHTS[event.type] || 0.03;
    const severity = event.severity || 1;
    const contribution = weight * severity;
    totalLift += contribution;

    if (!breakdown[event.type]) breakdown[event.type] = 0;
    breakdown[event.type] += contribution;
  }

  // Cap lift at 0.5 (50% risk increase)
  const lift = Math.min(Math.round(totalLift * 100) / 100, 0.5);

  return { lift, breakdown };
}

/**
 * Ingest a new intelligence event.
 * @param {object} event
 */
export async function ingestEvent(event) {
  const feed = await load('intelligence-feed', []);
  feed.unshift({
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
    id: `INT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });

  // Keep last 500 events
  if (feed.length > 500) feed.length = 500;
  await save('intelligence-feed', feed);
}
