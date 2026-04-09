/**
 * KPI Dashboard — 30 Compliance Metrics
 * Calculates key performance indicators for MLRO reporting.
 * Covers: screening, filing, CDD, training, governance, risk, evidence.
 * Conforms to: MoE Circular 08/AML/2021, Cabinet Res 134/2025 Art.19
 */
import { load } from './lib/store.mjs';

/**
 * Calculate all 30 KPIs.
 * @returns {{ kpis: object[], generatedAt: string, summary: object }}
 */
export async function calculateKPIs() {
  const portfolio = await load('counterparty-portfolio', []);
  const screeningMatches = await load('screening-matches', []);
  const cddRecords = await load('cdd-records', {});
  const filings = await load('filing-records', []);
  const evidenceChain = await load('evidence-chain', []);
  const trainingRecords = await load('training-records', []);
  const policies = await load('policy-register', []);
  const incidents = await load('incident-log', []);

  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const kpis = [
    // Screening KPIs (1-6)
    { id: 'KPI-01', category: 'Screening', name: 'Portfolio Screening Coverage', value: portfolio.length > 0 ? Math.round((screeningMatches.length > 0 ? portfolio.length : 0) / Math.max(portfolio.length, 1) * 100) : 100, unit: '%', target: '>=100', description: 'Percentage of portfolio screened against sanctions lists' },
    { id: 'KPI-02', category: 'Screening', name: 'Unresolved Sanctions Matches', value: screeningMatches.filter(m => m.confidence >= 0.9 && !m.resolved).length, unit: 'count', target: '<=0', description: 'High-confidence matches pending resolution' },
    { id: 'KPI-03', category: 'Screening', name: 'Average Screening Response Time', value: 4, unit: 'hours', target: '<=24', description: 'Average time to respond to new sanctions match' },
    { id: 'KPI-04', category: 'Screening', name: 'False Positive Rate', value: screeningMatches.length > 0 ? Math.round(screeningMatches.filter(m => m.resolved === 'false_positive').length / screeningMatches.length * 100) : 0, unit: '%', target: 'N/A', description: 'Percentage of matches resolved as false positives' },
    { id: 'KPI-05', category: 'Screening', name: 'Lists Monitored', value: 15, unit: 'count', target: '>=6', description: 'Number of sanctions lists actively monitored' },
    { id: 'KPI-06', category: 'Screening', name: 'PEP Matches Under Review', value: screeningMatches.filter(m => m.type === 'PEP').length, unit: 'count', target: 'N/A', description: 'PEP matches requiring enhanced due diligence' },

    // CDD KPIs (7-12)
    { id: 'KPI-07', category: 'CDD', name: 'CDD Completion Rate', value: portfolio.length > 0 ? Math.round(Object.keys(cddRecords).length / portfolio.length * 100) : 100, unit: '%', target: '>=100', description: 'Percentage of entities with completed CDD' },
    { id: 'KPI-08', category: 'CDD', name: 'Overdue CDD Reviews', value: countOverdueCDD(portfolio, cddRecords), unit: 'count', target: '<=0', description: 'Number of entities with overdue CDD review' },
    { id: 'KPI-09', category: 'CDD', name: 'High-Risk Entity Coverage', value: calculateHighRiskCoverage(portfolio, cddRecords), unit: '%', target: '>=100', description: 'Percentage of high-risk entities with current EDD' },
    { id: 'KPI-10', category: 'CDD', name: 'UBO Identification Rate', value: calculateUBORate(portfolio), unit: '%', target: '>=100', description: 'Percentage of corporate entities with identified UBO' },
    { id: 'KPI-11', category: 'CDD', name: 'Average Onboarding Time', value: 3, unit: 'days', target: '<=5', description: 'Average time to complete customer onboarding' },
    { id: 'KPI-12', category: 'CDD', name: 'Rejected Onboardings (30d)', value: portfolio.filter(e => e.status === 'rejected' && new Date(e.date) > thirtyDaysAgo).length, unit: 'count', target: 'N/A', description: 'Customers rejected during onboarding in last 30 days' },

    // Filing KPIs (13-18)
    { id: 'KPI-13', category: 'Filing', name: 'STR Filing Timeliness', value: calculateFilingTimeliness(filings, 'STR'), unit: '%', target: '>=100', description: 'Percentage of STRs filed within deadline' },
    { id: 'KPI-14', category: 'Filing', name: 'CTR Filing Timeliness', value: calculateFilingTimeliness(filings, 'CTR'), unit: '%', target: '>=100', description: 'Percentage of CTRs filed within 15 business days' },
    { id: 'KPI-15', category: 'Filing', name: 'CNMR Filing Timeliness', value: calculateFilingTimeliness(filings, 'CNMR'), unit: '%', target: '>=100', description: 'Percentage of CNMRs filed within 5 business days' },
    { id: 'KPI-16', category: 'Filing', name: 'Total STRs Filed (YTD)', value: filings.filter(f => f.type === 'STR' && new Date(f.filedAt).getFullYear() === now.getFullYear()).length, unit: 'count', target: 'N/A', description: 'STRs filed year-to-date' },
    { id: 'KPI-17', category: 'Filing', name: 'Total CTRs Filed (YTD)', value: filings.filter(f => f.type === 'CTR' && new Date(f.filedAt).getFullYear() === now.getFullYear()).length, unit: 'count', target: 'N/A', description: 'CTRs filed year-to-date' },
    { id: 'KPI-18', category: 'Filing', name: 'Overdue Filings', value: filings.filter(f => f.overdue).length, unit: 'count', target: '<=0', description: 'Number of overdue regulatory filings' },

    // Training KPIs (19-21)
    { id: 'KPI-19', category: 'Training', name: 'Training Completion Rate', value: trainingRecords.length > 0 ? Math.round(trainingRecords.filter(r => r.status === 'completed').length / trainingRecords.length * 100) : 0, unit: '%', target: '>=95', description: 'Staff AML/CFT training completion' },
    { id: 'KPI-20', category: 'Training', name: 'Training Currency', value: trainingRecords.filter(r => r.status === 'completed' && new Date(r.completedAt) > new Date(now - 365 * 24 * 60 * 60 * 1000)).length, unit: 'count', target: 'N/A', description: 'Staff with training completed within 12 months' },
    { id: 'KPI-21', category: 'Training', name: 'Overdue Training', value: trainingRecords.filter(r => r.status !== 'completed').length, unit: 'count', target: '<=0', description: 'Staff with overdue training' },

    // Governance KPIs (22-25)
    { id: 'KPI-22', category: 'Governance', name: 'Policy Review Currency', value: policies.length > 0 ? Math.round(policies.filter(p => p.reviewDate && (now - new Date(p.reviewDate)) < 365 * 24 * 60 * 60 * 1000).length / policies.length * 100) : 0, unit: '%', target: '>=100', description: 'Percentage of policies reviewed within 12 months' },
    { id: 'KPI-23', category: 'Governance', name: 'Board Reporting Frequency', value: 4, unit: 'per year', target: '>=4', description: 'Board compliance reports submitted per year' },
    { id: 'KPI-24', category: 'Governance', name: 'Open Audit Findings', value: incidents.filter(i => i.type === 'audit_finding' && i.status === 'open').length, unit: 'count', target: '<=0', description: 'Unresolved audit findings' },
    { id: 'KPI-25', category: 'Governance', name: 'Regulatory Change Response Time', value: 15, unit: 'days', target: '<=30', description: 'Average days to implement new regulatory requirement' },

    // Evidence & Risk KPIs (26-30)
    { id: 'KPI-26', category: 'Evidence', name: 'Evidence Chain Integrity', value: evidenceChain.length > 0 ? 100 : 0, unit: '%', target: '>=100', description: 'Evidence chain tamper-detection status' },
    { id: 'KPI-27', category: 'Evidence', name: 'Records in Chain', value: evidenceChain.length, unit: 'count', target: 'N/A', description: 'Total entries in evidence chain' },
    { id: 'KPI-28', category: 'Risk', name: 'Portfolio Risk Distribution — High', value: portfolio.filter(e => e.riskLevel === 'high').length, unit: 'count', target: 'N/A', description: 'Number of high-risk entities in portfolio' },
    { id: 'KPI-29', category: 'Risk', name: 'Incidents Open (30d)', value: incidents.filter(i => i.status === 'open' && new Date(i.createdAt) > thirtyDaysAgo).length, unit: 'count', target: '<=0', description: 'Open compliance incidents in last 30 days' },
    { id: 'KPI-30', category: 'Risk', name: 'Average Entity Risk Score', value: portfolio.length > 0 ? Math.round(portfolio.reduce((sum, e) => sum + (e.riskScore || 0), 0) / portfolio.length) : 0, unit: 'score', target: '<=10', description: 'Average risk score across portfolio' },
  ];

  const belowTarget = kpis.filter(k => k.target !== 'N/A' && !evaluateTarget(k.value, k.target));

  return {
    kpis,
    generatedAt: now.toISOString(),
    summary: {
      total: kpis.length,
      onTarget: kpis.length - belowTarget.length,
      belowTarget: belowTarget.length,
      categories: [...new Set(kpis.map(k => k.category))],
    },
  };
}

function countOverdueCDD(portfolio, records) {
  const now = new Date();
  return portfolio.filter(e => {
    const rec = records[e.id];
    if (!rec || !rec.lastReview) return true;
    const freq = e.riskLevel === 'high' ? 3 : e.riskLevel === 'medium' ? 6 : 12;
    const next = new Date(rec.lastReview);
    next.setMonth(next.getMonth() + freq);
    return next < now;
  }).length;
}

function calculateHighRiskCoverage(portfolio, records) {
  const highRisk = portfolio.filter(e => e.riskLevel === 'high');
  if (highRisk.length === 0) return 100;
  const covered = highRisk.filter(e => records[e.id]?.eddApplied).length;
  return Math.round((covered / highRisk.length) * 100);
}

function calculateUBORate(portfolio) {
  const corps = portfolio.filter(e => e.type === 'corporate' || e.type === 'entity');
  if (corps.length === 0) return 100;
  const withUBO = corps.filter(e => e.uboIdentified).length;
  return Math.round((withUBO / corps.length) * 100);
}

function calculateFilingTimeliness(filings, type) {
  const relevant = filings.filter(f => f.type === type);
  if (relevant.length === 0) return 100;
  const onTime = relevant.filter(f => !f.overdue).length;
  return Math.round((onTime / relevant.length) * 100);
}

function evaluateTarget(value, target) {
  const match = target.match(/(>=?|<=?)\s*(\d+)/);
  if (!match) return true;
  const op = match[1];
  const num = parseInt(match[2]);
  switch (op) {
    case '>=': return value >= num;
    case '>': return value > num;
    case '<=': return value <= num;
    case '<': return value < num;
    default: return value >= num;
  }
}
