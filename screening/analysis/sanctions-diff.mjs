/**
 * Sanctions Diff Analysis
 * Compares current sanctions lists against previous snapshots to identify
 * new designations, removals, and impacted counterparties.
 * Conforms to: Cabinet Res 74/2020 Art.4-7, FDL No.10/2025 Art.35
 */
import { load, save } from '../../scripts/lib/store.mjs';

/**
 * Generate a diff of sanctions list changes and cross-reference against portfolio.
 * @returns {{ added: number, removed: number, modified: number, impacted: number, details: object[] }}
 */
export async function generateDiff() {
  const currentSnapshot = await load('sanctions-snapshot-current', { entries: [] });
  const previousSnapshot = await load('sanctions-snapshot-previous', { entries: [] });
  const portfolio = await load('counterparty-portfolio', []);

  const prevMap = new Map(previousSnapshot.entries.map(e => [e.id, e]));
  const currMap = new Map(currentSnapshot.entries.map(e => [e.id, e]));

  const added = [];
  const removed = [];
  const modified = [];

  // Detect additions and modifications
  for (const [id, entry] of currMap) {
    if (!prevMap.has(id)) {
      added.push(entry);
    } else {
      const prev = prevMap.get(id);
      if (JSON.stringify(prev) !== JSON.stringify(entry)) {
        modified.push({ previous: prev, current: entry });
      }
    }
  }

  // Detect removals
  for (const [id, entry] of prevMap) {
    if (!currMap.has(id)) {
      removed.push(entry);
    }
  }

  // Cross-reference new designations against portfolio
  const impactedEntities = [];
  for (const designation of added) {
    for (const entity of portfolio) {
      const nameMatch = fuzzyMatch(entity.name, designation.name);
      if (nameMatch >= 0.8) {
        impactedEntities.push({
          entity: entity.name,
          entityId: entity.id,
          designation: designation.name,
          designationId: designation.id,
          confidence: nameMatch,
          list: designation.list,
        });
      }
    }
  }

  const result = {
    added: added.length,
    removed: removed.length,
    modified: modified.length,
    impacted: impactedEntities.length,
    details: impactedEntities,
    generatedAt: new Date().toISOString(),
  };

  // Archive the diff
  await save(`sanctions-diff-${new Date().toISOString().split('T')[0]}`, result);

  // Rotate snapshots
  if (currentSnapshot.entries.length > 0) {
    await save('sanctions-snapshot-previous', currentSnapshot);
  }

  return result;
}

/**
 * Simple fuzzy name matching using normalized Levenshtein distance.
 */
function fuzzyMatch(a, b) {
  if (!a || !b) return 0;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const distance = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1.0 : Math.round((1 - distance / maxLen) * 100) / 100;
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
