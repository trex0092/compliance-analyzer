/**
 * SOE (State-Owned Enterprise) Registry.
 *
 * Critical for Cabinet Res 156/2025 (dual-use / PF controls) — any
 * counterparty with >=50% state ownership from a sanctioned or high-
 * risk jurisdiction is itself treated as higher-risk even when not
 * directly listed.
 *
 * Data is pluggable: US-OFAC 50% Rule, UK OFSI 50% Rule, OpenSanctions
 * state-ownership dataset, OECD PSEA list.
 */

export interface SoeEntry {
  id: string;
  name: string;
  aliases?: string[];
  jurisdiction: string;
  /** State ownership %, 0..100. */
  statePct: number;
  /** Whether the state itself is on a sanctions / grey list. */
  stateRisk: 'low' | 'medium' | 'high' | 'sanctioned';
  sector?: string;
  source: string;
}

export interface SoeMatch {
  entry: SoeEntry;
  nameScore: number;
  /** Final risk weight: statePct × stateRisk × nameScore. 0..1. */
  weight: number;
  /** Applicable rule (e.g. "OFAC 50% Rule"). */
  ruleTriggered: string | null;
}

export function matchSoe(
  subject: { name: string; jurisdiction?: string },
  entries: SoeEntry[],
  nameThreshold = 0.85
): SoeMatch[] {
  const out: SoeMatch[] = [];
  const subjectNorm = normalize(subject.name);
  for (const e of entries) {
    const candidates = [e.name, ...(e.aliases ?? [])].map(normalize);
    let best = 0;
    for (const c of candidates) {
      const s = jaro(subjectNorm, c);
      if (s > best) best = s;
    }
    if (best < nameThreshold) continue;
    const riskFactor =
      e.stateRisk === 'sanctioned'
        ? 1
        : e.stateRisk === 'high'
          ? 0.7
          : e.stateRisk === 'medium'
            ? 0.4
            : 0.1;
    const weight = (e.statePct / 100) * riskFactor * best;
    const ruleTriggered =
      e.statePct >= 50
        ? 'OFAC/UK OFSI 50% Rule'
        : e.statePct >= 25
          ? 'Cabinet Decision 109/2023 >25%'
          : null;
    out.push({ entry: e, nameScore: best, weight, ruleTriggered });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const d = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aM: boolean[] = new Array(a.length).fill(false);
  const bM: boolean[] = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = Math.max(0, i - d); j < Math.min(i + d + 1, b.length); j += 1) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = true;
      bM[j] = true;
      m += 1;
      break;
    }
  }
  if (m === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aM[i]) continue;
    while (!bM[k]) k += 1;
    if (a[i] !== b[k]) t += 1;
    k += 1;
  }
  return (m / a.length + m / b.length + (m - t / 2) / m) / 3;
}
