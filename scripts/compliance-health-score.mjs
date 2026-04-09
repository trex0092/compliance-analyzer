/**
 * Compliance Health Score Calculator
 * Calculates a composite 0-100 score across 8 compliance dimensions.
 * Used by MLRO for executive reporting and board updates.
 * Conforms to: Cabinet Res 134/2025 Art.5, Art.19
 */
import { load } from './lib/store.mjs';

const DIMENSIONS = [
  { id: 'sanctions_screening', name: 'Sanctions Screening', weight: 0.20 },
  { id: 'cdd_compliance', name: 'CDD Compliance', weight: 0.15 },
  { id: 'str_filing', name: 'STR/SAR Filing', weight: 0.15 },
  { id: 'record_keeping', name: 'Record Keeping', weight: 0.10 },
  { id: 'training', name: 'Training & Awareness', weight: 0.10 },
  { id: 'risk_assessment', name: 'Risk Assessment', weight: 0.10 },
  { id: 'tfs_compliance', name: 'TFS Compliance', weight: 0.10 },
  { id: 'governance', name: 'Governance & Policies', weight: 0.10 },
];

/**
 * Calculate composite health score.
 * @returns {{ composite: number, grade: string, dimensions: object[], weakest: string }}
 */
export async function calculateHealthScore() {
  const screeningMatches = await load('screening-matches', []);
  const cddRecords = await load('cdd-records', {});
  const filings = await load('filing-records', []);
  const evidenceChain = await load('evidence-chain', []);
  const trainingRecords = await load('training-records', []);
  const portfolio = await load('counterparty-portfolio', []);
  const policies = await load('policy-register', []);

  const scores = {};

  // 1. Sanctions Screening — based on screening coverage and recency
  scores.sanctions_screening = calculateScreeningScore(screeningMatches, portfolio);

  // 2. CDD Compliance — based on overdue reviews
  scores.cdd_compliance = calculateCDDScore(cddRecords, portfolio);

  // 3. STR/SAR Filing — based on timely filing
  scores.str_filing = calculateFilingScore(filings);

  // 4. Record Keeping — based on evidence chain integrity
  scores.record_keeping = calculateRecordScore(evidenceChain);

  // 5. Training — based on training completion
  scores.training = calculateTrainingScore(trainingRecords);

  // 6. Risk Assessment — based on assessment coverage
  scores.risk_assessment = calculateRiskAssessmentScore(portfolio);

  // 7. TFS Compliance — based on screening results
  scores.tfs_compliance = calculateTFSScore(screeningMatches);

  // 8. Governance — based on policy currency
  scores.governance = calculateGovernanceScore(policies);

  // Calculate composite
  let composite = 0;
  const dimensionResults = [];
  let weakest = { id: '', score: 100 };

  for (const dim of DIMENSIONS) {
    const score = scores[dim.id] || 0;
    composite += score * dim.weight;
    dimensionResults.push({ ...dim, score });
    if (score < weakest.score) weakest = { id: dim.name, score };
  }

  composite = Math.round(composite);
  const grade = getGrade(composite);

  return { composite, grade, dimensions: dimensionResults, weakest: weakest.id };
}

function calculateScreeningScore(matches, portfolio) {
  if (portfolio.length === 0) return 85; // No portfolio = baseline
  const unresolvedMatches = matches.filter(m => m.confidence >= 0.9 && !m.resolved);
  if (unresolvedMatches.length > 0) return Math.max(20, 100 - unresolvedMatches.length * 20);
  return 95;
}

function calculateCDDScore(records, portfolio) {
  if (portfolio.length === 0) return 85;
  const now = new Date();
  let overdueCount = 0;
  for (const entity of portfolio) {
    const record = records[entity.id];
    if (!record || !record.lastReview) { overdueCount++; continue; }
    const freq = entity.riskLevel === 'high' ? 3 : entity.riskLevel === 'medium' ? 6 : 12;
    const next = new Date(record.lastReview);
    next.setMonth(next.getMonth() + freq);
    if (next < now) overdueCount++;
  }
  const overdueRate = portfolio.length > 0 ? overdueCount / portfolio.length : 0;
  return Math.round(Math.max(0, 100 - overdueRate * 100));
}

function calculateFilingScore(filings) {
  if (filings.length === 0) return 90; // No filings needed = good
  const late = filings.filter(f => f.status === 'late' || f.overdue).length;
  return Math.round(Math.max(0, 100 - (late / filings.length) * 100));
}

function calculateRecordScore(chain) {
  if (chain.length === 0) return 70;
  // Score based on chain completeness and recent activity
  const recentEntries = chain.filter(e => {
    const d = new Date(e.timestamp);
    return (Date.now() - d.getTime()) < 30 * 24 * 60 * 60 * 1000;
  });
  return recentEntries.length >= 10 ? 95 : Math.round(70 + (recentEntries.length / 10) * 25);
}

function calculateTrainingScore(records) {
  if (!records || records.length === 0) return 60;
  const completed = records.filter(r => r.status === 'completed').length;
  return Math.round((completed / records.length) * 100);
}

function calculateRiskAssessmentScore(portfolio) {
  if (portfolio.length === 0) return 85;
  const assessed = portfolio.filter(e => e.riskLevel && e.riskScore !== undefined).length;
  return Math.round((assessed / portfolio.length) * 100);
}

function calculateTFSScore(matches) {
  const unresolved = matches.filter(m => m.confidence >= 0.9 && !m.resolved);
  if (unresolved.length > 0) return 30;
  return 95;
}

function calculateGovernanceScore(policies) {
  if (!policies || policies.length === 0) return 65;
  const now = new Date();
  const current = policies.filter(p => {
    if (!p.reviewDate) return false;
    const review = new Date(p.reviewDate);
    return (now - review) < 365 * 24 * 60 * 60 * 1000;
  }).length;
  return Math.round((current / policies.length) * 100);
}

function getGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
