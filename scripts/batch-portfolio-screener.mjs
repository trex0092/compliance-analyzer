/**
 * Batch Portfolio Screener
 * Re-screens entire counterparty portfolio against all sanctions lists.
 * Detects new matches, clears resolved false positives.
 * Conforms to: FDL No.10/2025 Art.12-14, FATF Rec 22/23
 */
import { load, save } from './lib/store.mjs';

/**
 * Run full portfolio screen against all configured sanctions lists.
 * @returns {{ screened: number, newMatches: number, cleared: number, results: object[] }}
 */
export async function runPortfolioScreen() {
  const portfolio = await load('counterparty-portfolio', []);
  const previousMatches = await load('screening-matches', []);
  const sanctionsData = await load('sanctions-snapshot-current', { entries: [] });

  const prevMatchIds = new Set(previousMatches.map(m => m.entityId));
  const newMatches = [];
  const currentMatches = [];
  const results = [];

  for (const entity of portfolio) {
    const matches = screenEntity(entity, sanctionsData.entries);

    if (matches.length > 0) {
      const bestMatch = matches.reduce((a, b) => a.confidence > b.confidence ? a : b);
      currentMatches.push({
        entityId: entity.id,
        entityName: entity.name,
        matchedName: bestMatch.name,
        list: bestMatch.list,
        confidence: bestMatch.confidence,
        screenedAt: new Date().toISOString(),
      });

      if (!prevMatchIds.has(entity.id)) {
        newMatches.push({
          entityId: entity.id,
          entityName: entity.name,
          matchedName: bestMatch.name,
          list: bestMatch.list,
          confidence: bestMatch.confidence,
        });
      }

      results.push({ entity: entity.name, status: 'MATCH', matches });
    } else {
      results.push({ entity: entity.name, status: 'CLEAR' });
    }
  }

  // Identify cleared entities (were matches, now clear)
  const currentMatchIds = new Set(currentMatches.map(m => m.entityId));
  const cleared = previousMatches.filter(m => !currentMatchIds.has(m.entityId)).length;

  await save('screening-matches', currentMatches);
  await save(`screening-run-${new Date().toISOString().split('T')[0]}`, {
    screened: portfolio.length,
    newMatches: newMatches.length,
    cleared,
    timestamp: new Date().toISOString(),
  });

  return {
    screened: portfolio.length,
    newMatches: newMatches.length,
    cleared,
    results,
  };
}

function screenEntity(entity, sanctionsEntries) {
  const matches = [];
  const entityName = (entity.name || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();

  for (const sanction of sanctionsEntries) {
    const sanctionName = (sanction.name || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    if (!entityName || !sanctionName) continue;

    let confidence = 0;
    if (entityName === sanctionName) {
      confidence = 1.0;
    } else if (entityName.includes(sanctionName) || sanctionName.includes(entityName)) {
      confidence = 0.85;
    } else {
      // Token overlap scoring
      const entityTokens = new Set(entityName.split(' ').filter(t => t.length > 2));
      const sanctionTokens = new Set(sanctionName.split(' ').filter(t => t.length > 2));
      const overlap = [...entityTokens].filter(t => sanctionTokens.has(t)).length;
      const maxTokens = Math.max(entityTokens.size, sanctionTokens.size);
      if (maxTokens > 0) confidence = Math.round((overlap / maxTokens) * 100) / 100;
    }

    if (confidence >= 0.5) {
      matches.push({ name: sanction.name, list: sanction.list, id: sanction.id, confidence });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}
