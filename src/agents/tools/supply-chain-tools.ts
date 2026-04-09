/**
 * Supply Chain Traceability MCP Tools
 *
 * Mine-to-market chain verification for DPMS gold:
 * Mine -> Refiner -> Dealer -> Customer
 *
 * Implements LBMA RGG v9 five-step framework, CAHRA due diligence,
 * ASM compliance, DGD standard validation, UAE MoE RSG Framework.
 *
 * Regulatory basis: LBMA RGG v9, UAE MoE RSG Framework, Dubai Good Delivery,
 * FATF Rec 22/23, MoE Circular 08/AML/2021
 */

import type { ToolResult } from '../mcp-server';
import { SUPPLY_CHAIN_RISK_POINTS } from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChainNodeType = 'mine' | 'refiner' | 'dealer' | 'customer';
export type CAHRALevel = 'critical' | 'high' | 'medium' | 'none';
export type AuditStatus = 'passed' | 'in-progress' | 'failed' | 'not-available';
export type DGDStatus = 'accredited' | 'pending' | 'revoked' | 'not-applicable';

export interface ChainNode {
  id: string;
  type: ChainNodeType;
  name: string;
  country: string;
  licenses?: string[];
  dgdStatus?: DGDStatus;
  auditStatus?: AuditStatus;
  lastAuditDate?: string;
  kycComplete?: boolean;
  asmSource?: boolean;
  cahraLevel?: CAHRALevel;
}

export interface SupplyChainInput {
  chain: ChainNode[];
  goldWeightGrams: number;
  consignmentId?: string;
  declaredOriginCountry: string;
}

export interface LBMAStep {
  step: number;
  title: string;
  status: 'pass' | 'fail' | 'warning';
  details: string;
}

export interface SupplyChainReport {
  reportId: string;
  consignmentId: string;
  generatedAt: string;
  chain: ChainNode[];
  chainIntegrity: 'intact' | 'broken' | 'incomplete';
  missingNodeTypes: ChainNodeType[];
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskBreakdown: Array<{ factor: string; points: number; detail: string }>;
  lbmaSteps: LBMAStep[];
  dgdCompliance: { status: DGDStatus; refinerName: string | null; details: string };
  asmFindings: { detected: boolean; compliant: boolean; details: string };
  cahraExposure: { level: CAHRALevel; countries: string[]; details: string };
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// CAHRA jurisdictions (Conflict-Affected and High-Risk Areas)
// Source: LBMA RGG v9 Annex, EU conflict minerals regulation
// ---------------------------------------------------------------------------

const CAHRA_CRITICAL = ['CD', 'CF', 'SS', 'SD', 'LY', 'SO', 'YE', 'MM'];
const CAHRA_HIGH = ['ML', 'BF', 'NE', 'NG', 'MZ', 'ET', 'TD', 'CM'];
const CAHRA_MEDIUM = ['UG', 'RW', 'BI', 'TZ', 'KE', 'ZW', 'VE', 'CO'];
const FATF_GREY_JURISDICTIONS = ['DZ', 'AO', 'BG', 'BF', 'CM', 'HR', 'CD', 'EG', 'HT', 'KE'];
const EU_HIGH_RISK = ['AF', 'MM', 'SY', 'YE', 'KP', 'IR', 'PK'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyCAHRA(country: string): CAHRALevel {
  if (CAHRA_CRITICAL.includes(country)) return 'critical';
  if (CAHRA_HIGH.includes(country)) return 'high';
  if (CAHRA_MEDIUM.includes(country)) return 'medium';
  return 'none';
}

function formatDateUAE(date: Date): string {
  return date.toLocaleDateString('en-GB'); // dd/mm/yyyy
}

function evaluateLBMASteps(chain: ChainNode[], originCountry: string): LBMAStep[] {
  const steps: LBMAStep[] = [];

  // Step 1: Establish strong management systems
  const hasCompleteDocs = chain.every((n) => n.kycComplete !== false);
  steps.push({
    step: 1,
    title: 'Management systems',
    status: hasCompleteDocs ? 'pass' : 'fail',
    details: hasCompleteDocs
      ? 'All chain participants have documented KYC and management procedures.'
      : 'One or more chain participants lack complete KYC documentation.',
  });

  // Step 2: Identify and assess risks in the supply chain
  const cahraNodes = chain.filter((n) => classifyCAHRA(n.country) !== 'none');
  const hasCAHRA = cahraNodes.length > 0;
  steps.push({
    step: 2,
    title: 'Risk identification and assessment',
    status: hasCAHRA ? (cahraNodes.some((n) => classifyCAHRA(n.country) === 'critical') ? 'fail' : 'warning') : 'pass',
    details: hasCAHRA
      ? `CAHRA exposure detected: ${cahraNodes.map((n) => `${n.name} (${n.country})`).join(', ')}.`
      : 'No CAHRA exposure identified in the supply chain.',
  });

  // Step 3: Design and implement a strategy to respond to identified risks
  const refiner = chain.find((n) => n.type === 'refiner');
  const refinerAudited = refiner?.auditStatus === 'passed';
  steps.push({
    step: 3,
    title: 'Risk mitigation strategy',
    status: refinerAudited ? 'pass' : hasCAHRA ? 'fail' : 'warning',
    details: refinerAudited
      ? `Refiner ${refiner!.name} has passed independent audit.`
      : `Refiner audit status: ${refiner?.auditStatus ?? 'no refiner in chain'}. ${hasCAHRA ? 'CAHRA mitigation strategy required.' : ''}`,
  });

  // Step 4: Independent third-party audit
  const auditedNodes = chain.filter((n) => n.auditStatus === 'passed');
  const auditRatio = chain.length > 0 ? auditedNodes.length / chain.length : 0;
  steps.push({
    step: 4,
    title: 'Third-party audit',
    status: auditRatio >= 0.75 ? 'pass' : auditRatio >= 0.5 ? 'warning' : 'fail',
    details: `${auditedNodes.length}/${chain.length} chain participants have passed independent audit (${Math.round(auditRatio * 100)}%).`,
  });

  // Step 5: Report on supply chain due diligence
  const originCAHRA = classifyCAHRA(originCountry);
  steps.push({
    step: 5,
    title: 'Annual reporting and disclosure',
    status: originCAHRA === 'none' ? 'pass' : 'warning',
    details: originCAHRA === 'none'
      ? 'Origin country not in CAHRA list. Standard annual disclosure required.'
      : `Origin country ${originCountry} is CAHRA (${originCAHRA}). Enhanced annual disclosure with mitigation report required.`,
  });

  return steps;
}

// ---------------------------------------------------------------------------
// Main function: verifySupplyChain
// ---------------------------------------------------------------------------

export function verifySupplyChain(input: SupplyChainInput): ToolResult<SupplyChainReport> {
  if (!input.chain || input.chain.length === 0) {
    return { ok: false, error: 'Supply chain must contain at least one node.' };
  }

  if (input.goldWeightGrams <= 0) {
    return { ok: false, error: 'Gold weight must be a positive number.' };
  }

  const reportId = crypto.randomUUID();
  const consignmentId = input.consignmentId ?? crypto.randomUUID();
  const generatedAt = formatDateUAE(new Date());

  // Check chain completeness: mine -> refiner -> dealer -> customer
  const expectedTypes: ChainNodeType[] = ['mine', 'refiner', 'dealer', 'customer'];
  const presentTypes = new Set(input.chain.map((n) => n.type));
  const missingNodeTypes = expectedTypes.filter((t) => !presentTypes.has(t));
  const chainIntegrity = missingNodeTypes.length === 0 ? 'intact' : missingNodeTypes.length <= 1 ? 'incomplete' : 'broken';

  // Risk scoring
  const riskBreakdown: Array<{ factor: string; points: number; detail: string }> = [];
  let totalRisk = 0;

  // CAHRA assessment
  const cahraCountries: string[] = [];
  let worstCAHRA: CAHRALevel = 'none';
  for (const node of input.chain) {
    const level = classifyCAHRA(node.country);
    if (level !== 'none') {
      cahraCountries.push(node.country);
      if (level === 'critical' || (level === 'high' && worstCAHRA !== 'critical') || (level === 'medium' && worstCAHRA === 'none')) {
        worstCAHRA = level;
      }
    }
    if (FATF_GREY_JURISDICTIONS.includes(node.country)) {
      riskBreakdown.push({ factor: 'FATF Grey List', points: SUPPLY_CHAIN_RISK_POINTS.fatfGrey, detail: `${node.name} in FATF Grey List jurisdiction (${node.country}).` });
      totalRisk += SUPPLY_CHAIN_RISK_POINTS.fatfGrey;
    }
    if (EU_HIGH_RISK.includes(node.country)) {
      riskBreakdown.push({ factor: 'EU High Risk', points: SUPPLY_CHAIN_RISK_POINTS.euHighRisk, detail: `${node.name} in EU High Risk jurisdiction (${node.country}).` });
      totalRisk += SUPPLY_CHAIN_RISK_POINTS.euHighRisk;
    }
  }

  if (worstCAHRA === 'critical') {
    riskBreakdown.push({ factor: 'CAHRA Critical', points: SUPPLY_CHAIN_RISK_POINTS.cahraCritical, detail: `Critical CAHRA exposure: ${[...new Set(cahraCountries)].join(', ')}.` });
    totalRisk += SUPPLY_CHAIN_RISK_POINTS.cahraCritical;
  } else if (worstCAHRA === 'high') {
    riskBreakdown.push({ factor: 'CAHRA High', points: SUPPLY_CHAIN_RISK_POINTS.cahraHigh, detail: `High CAHRA exposure: ${[...new Set(cahraCountries)].join(', ')}.` });
    totalRisk += SUPPLY_CHAIN_RISK_POINTS.cahraHigh;
  } else if (worstCAHRA === 'medium') {
    riskBreakdown.push({ factor: 'CAHRA Medium', points: SUPPLY_CHAIN_RISK_POINTS.cahraMedium, detail: `Medium CAHRA exposure: ${[...new Set(cahraCountries)].join(', ')}.` });
    totalRisk += SUPPLY_CHAIN_RISK_POINTS.cahraMedium;
  }

  // Mine origin check
  const mine = input.chain.find((n) => n.type === 'mine');
  if (!mine) {
    riskBreakdown.push({ factor: 'Missing mine origin', points: SUPPLY_CHAIN_RISK_POINTS.missingMineOrigin, detail: 'No mine node in the supply chain. Origin traceability broken.' });
    totalRisk += SUPPLY_CHAIN_RISK_POINTS.missingMineOrigin;
  }

  // Refiner checks
  const refiner = input.chain.find((n) => n.type === 'refiner');
  if (!refiner) {
    riskBreakdown.push({ factor: 'No refiner', points: SUPPLY_CHAIN_RISK_POINTS.noRefiner, detail: 'No refiner in the supply chain. DGD compliance cannot be verified.' });
    totalRisk += SUPPLY_CHAIN_RISK_POINTS.noRefiner;
  }

  // Audit checks
  for (const node of input.chain) {
    if (node.auditStatus === 'failed' || node.auditStatus === 'not-available') {
      const pts = node.auditStatus === 'not-available' ? SUPPLY_CHAIN_RISK_POINTS.auditNA : SUPPLY_CHAIN_RISK_POINTS.noAudit;
      riskBreakdown.push({ factor: `Audit: ${node.auditStatus}`, points: pts, detail: `${node.name} audit status: ${node.auditStatus}.` });
      totalRisk += pts;
    } else if (node.auditStatus === 'in-progress') {
      riskBreakdown.push({ factor: 'Audit in progress', points: SUPPLY_CHAIN_RISK_POINTS.auditInProgress, detail: `${node.name} audit in progress.` });
      totalRisk += SUPPLY_CHAIN_RISK_POINTS.auditInProgress;
    }
  }

  // ASM checks
  const asmNodes = input.chain.filter((n) => n.asmSource === true);
  const asmDetected = asmNodes.length > 0;
  const asmCompliant = asmDetected ? asmNodes.every((n) => n.auditStatus === 'passed' && n.kycComplete === true) : true;
  if (asmDetected && !asmCompliant) {
    riskBreakdown.push({ factor: 'ASM non-compliant', points: SUPPLY_CHAIN_RISK_POINTS.asmSource, detail: `ASM source(s) without audit/KYC: ${asmNodes.filter((n) => n.auditStatus !== 'passed' || !n.kycComplete).map((n) => n.name).join(', ')}.` });
    totalRisk += SUPPLY_CHAIN_RISK_POINTS.asmSource;
  }

  // KYC completeness
  const kycIncomplete = input.chain.filter((n) => n.kycComplete === false);
  if (kycIncomplete.length > 0) {
    riskBreakdown.push({ factor: 'KYC incomplete', points: SUPPLY_CHAIN_RISK_POINTS.kycIncomplete, detail: `Incomplete KYC: ${kycIncomplete.map((n) => n.name).join(', ')}.` });
    totalRisk += SUPPLY_CHAIN_RISK_POINTS.kycIncomplete;
  }

  // Cap at max
  totalRisk = Math.min(totalRisk, SUPPLY_CHAIN_RISK_POINTS.maxScore);

  const riskLevel: 'low' | 'medium' | 'high' | 'critical' =
    totalRisk >= SUPPLY_CHAIN_RISK_POINTS.highThreshold + 25
      ? 'critical'
      : totalRisk >= SUPPLY_CHAIN_RISK_POINTS.highThreshold
        ? 'high'
        : totalRisk >= SUPPLY_CHAIN_RISK_POINTS.mediumThreshold
          ? 'medium'
          : 'low';

  // LBMA RGG v9 five-step evaluation
  const lbmaSteps = evaluateLBMASteps(input.chain, input.declaredOriginCountry);

  // DGD compliance
  const dgdCompliance = refiner
    ? {
        status: refiner.dgdStatus ?? ('not-applicable' as DGDStatus),
        refinerName: refiner.name,
        details: refiner.dgdStatus === 'accredited'
          ? `${refiner.name} holds Dubai Good Delivery accreditation.`
          : refiner.dgdStatus === 'revoked'
            ? `${refiner.name} DGD accreditation REVOKED. Do not proceed.`
            : `${refiner.name} DGD status: ${refiner.dgdStatus ?? 'unknown'}.`,
      }
    : { status: 'not-applicable' as DGDStatus, refinerName: null, details: 'No refiner in chain to evaluate DGD compliance.' };

  // Recommendations
  const recommendations: string[] = [];
  if (missingNodeTypes.length > 0) recommendations.push(`Complete chain by adding: ${missingNodeTypes.join(', ')}.`);
  if (worstCAHRA !== 'none') recommendations.push(`Conduct enhanced due diligence for CAHRA exposure (${worstCAHRA} level).`);
  if (kycIncomplete.length > 0) recommendations.push(`Complete KYC for: ${kycIncomplete.map((n) => n.name).join(', ')}.`);
  if (asmDetected && !asmCompliant) recommendations.push('Ensure all ASM sources have passed audit and complete KYC per LBMA RGG v9.');
  if (refiner && refiner.dgdStatus !== 'accredited') recommendations.push('Obtain or verify DGD accreditation for the refiner.');
  if (lbmaSteps.some((s) => s.status === 'fail')) recommendations.push('Address failing LBMA RGG v9 steps before proceeding with shipment.');

  const report: SupplyChainReport = {
    reportId,
    consignmentId,
    generatedAt,
    chain: input.chain,
    chainIntegrity,
    missingNodeTypes,
    riskScore: totalRisk,
    riskLevel,
    riskBreakdown,
    lbmaSteps,
    dgdCompliance,
    asmFindings: {
      detected: asmDetected,
      compliant: asmCompliant,
      details: asmDetected
        ? asmCompliant
          ? 'All ASM sources are compliant with LBMA RGG v9 ASM requirements.'
          : 'ASM non-compliance detected. Enhanced due diligence required.'
        : 'No artisanal/small-scale mining sources detected in chain.',
    },
    cahraExposure: {
      level: worstCAHRA,
      countries: [...new Set(cahraCountries)],
      details: worstCAHRA === 'none'
        ? 'No CAHRA exposure in supply chain.'
        : `${worstCAHRA.toUpperCase()} CAHRA exposure. Countries: ${[...new Set(cahraCountries)].join(', ')}.`,
    },
    recommendations,
  };

  return { ok: true, data: report };
}

// ---------------------------------------------------------------------------
// Tool: checkLBMACompliance (standalone)
// ---------------------------------------------------------------------------

export interface LBMAComplianceInput {
  chain: ChainNode[];
  declaredOriginCountry: string;
}

export interface LBMAComplianceReport {
  reportId: string;
  generatedAt: string;
  overallCompliant: boolean;
  steps: LBMAStep[];
  failingSteps: number[];
  warningSteps: number[];
  cahraExposure: CAHRALevel;
  recommendations: string[];
}

/**
 * Standalone LBMA RGG v9 five-step framework compliance check.
 * Returns per-step status with detailed findings and remediation guidance.
 *
 * @regulatory LBMA RGG v9, OECD Due Diligence Guidance Annex II
 */
export function checkLBMACompliance(
  input: LBMAComplianceInput,
): ToolResult<LBMAComplianceReport> {
  if (!input.chain || input.chain.length === 0) {
    return { ok: false, error: 'Supply chain must contain at least one node for LBMA assessment.' };
  }
  if (!input.declaredOriginCountry || input.declaredOriginCountry.length !== 2) {
    return { ok: false, error: 'Declared origin country must be a valid ISO 3166-1 alpha-2 code.' };
  }

  const steps = evaluateLBMASteps(input.chain, input.declaredOriginCountry);
  const failingSteps = steps.filter((s) => s.status === 'fail').map((s) => s.step);
  const warningSteps = steps.filter((s) => s.status === 'warning').map((s) => s.step);
  const overallCompliant = failingSteps.length === 0;
  const cahraExposure = classifyCAHRA(input.declaredOriginCountry);

  const recommendations: string[] = [];
  if (failingSteps.includes(1)) {
    recommendations.push('Step 1: Complete KYC documentation for all chain participants. Establish AML/CFT management systems per LBMA RGG v9 Section 1.');
  }
  if (failingSteps.includes(2)) {
    recommendations.push('Step 2: Conduct full CAHRA risk assessment. Document all conflict-affected area exposures per OECD Annex II.');
  }
  if (failingSteps.includes(3)) {
    recommendations.push('Step 3: Develop and implement a written risk mitigation strategy. For critical CAHRA, consider immediate disengagement or enhanced monitoring.');
  }
  if (failingSteps.includes(4)) {
    recommendations.push('Step 4: Engage an independent third-party auditor. Ensure all chain participants undergo annual audit per LBMA requirements.');
  }
  if (warningSteps.includes(5)) {
    recommendations.push('Step 5: Prepare enhanced annual disclosure report addressing CAHRA exposure and mitigation measures.');
  }
  if (cahraExposure === 'critical') {
    recommendations.push('CRITICAL: Origin country is in a CAHRA-critical zone. LBMA requires immediate risk mitigation or disengagement.');
  }
  if (recommendations.length === 0) {
    recommendations.push('All LBMA RGG v9 steps are compliant. Maintain current due diligence practices and annual audit schedule.');
  }

  return {
    ok: true,
    data: {
      reportId: crypto.randomUUID(),
      generatedAt: formatDateUAE(new Date()),
      overallCompliant,
      steps,
      failingSteps,
      warningSteps,
      cahraExposure,
      recommendations,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

export const SUPPLY_CHAIN_TOOL_SCHEMAS = [
  {
    name: 'verify_supply_chain',
    description:
      'Verify mine-to-market gold supply chain traceability. Evaluates LBMA RGG v9 five-step framework, CAHRA exposure, ASM compliance, DGD standard, and origin traceability. Returns risk score, chain integrity status, and regulatory recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['mine', 'refiner', 'dealer', 'customer'] },
              name: { type: 'string' },
              country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
              licenses: { type: 'array', items: { type: 'string' } },
              dgdStatus: { type: 'string', enum: ['accredited', 'pending', 'revoked', 'not-applicable'] },
              auditStatus: { type: 'string', enum: ['passed', 'in-progress', 'failed', 'not-available'] },
              lastAuditDate: { type: 'string', description: 'dd/mm/yyyy format' },
              kycComplete: { type: 'boolean' },
              asmSource: { type: 'boolean' },
              cahraLevel: { type: 'string', enum: ['critical', 'high', 'medium', 'none'] },
            },
            required: ['id', 'type', 'name', 'country'],
          },
          description: 'Ordered supply chain nodes: mine -> refiner -> dealer -> customer',
        },
        goldWeightGrams: { type: 'number', description: 'Gold weight in grams' },
        consignmentId: { type: 'string', description: 'Optional consignment tracking ID' },
        declaredOriginCountry: { type: 'string', description: 'Declared country of gold origin (ISO alpha-2)' },
      },
      required: ['chain', 'goldWeightGrams', 'declaredOriginCountry'],
    },
  },
  {
    name: 'check_lbma_compliance',
    description:
      'Standalone LBMA RGG v9 five-step framework compliance check. Returns per-step pass/fail/warning status with detailed findings, failing step numbers, CAHRA exposure level, and remediation recommendations. Regulatory: LBMA RGG v9, OECD Due Diligence Guidance Annex II.',
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['mine', 'refiner', 'dealer', 'customer'] },
              name: { type: 'string' },
              country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
              auditStatus: { type: 'string', enum: ['passed', 'in-progress', 'failed', 'not-available'] },
              kycComplete: { type: 'boolean' },
              asmSource: { type: 'boolean' },
            },
            required: ['id', 'type', 'name', 'country'],
          },
          description: 'Supply chain nodes to evaluate',
        },
        declaredOriginCountry: { type: 'string', description: 'Declared country of gold origin (ISO alpha-2)' },
      },
      required: ['chain', 'declaredOriginCountry'],
    },
  },
];
