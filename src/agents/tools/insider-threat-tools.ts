/**
 * Behavioral Insider Threat Detection Tools
 *
 * Monitor compliance officer and staff behavior for indicators of
 * insider threats: unusual access patterns, selective screening,
 * alert override abuse, data exfiltration, and privilege escalation.
 *
 * Regulatory basis:
 * - FDL No.10/2025 Art.20-21 (Compliance Officer duties)
 * - FDL No.10/2025 Art.29 (no tipping off — insider could tip off)
 * - Cabinet Res 134/2025 Art.18 (CO change notification)
 * - Cabinet Res 134/2025 Art.19 (internal review)
 * - Cabinet Res 71/2024 (administrative penalties for compliance failures)
 * - FATF Rec 18 (internal controls and compliance)
 */

import type { ToolResult } from '../mcp-server';
import { RECORD_RETENTION_YEARS, MAX_FAILED_LOGIN_ATTEMPTS } from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThreatIndicatorCategory =
  | 'access-pattern'
  | 'selective-screening'
  | 'override-abuse'
  | 'data-exfiltration'
  | 'privilege-escalation'
  | 'tipping-off'
  | 'policy-circumvention';

export type Severity = 'info' | 'warning' | 'alert' | 'critical';

export interface UserActivityRecord {
  userId: string;
  userName: string;
  role: 'compliance-officer' | 'analyst' | 'admin' | 'manager' | 'viewer';
  timestamp: string; // ISO 8601
  action: string; // e.g. 'screening-completed', 'alert-dismissed', 'export-data'
  resource?: string; // entity or record accessed
  ipAddress?: string;
  userAgent?: string;
  afterHours?: boolean; // true if outside 08:00-18:00 local time
  weekend?: boolean; // true if Sat/Sun
  outcome?: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
}

export interface ThreatIndicator {
  code: string;
  category: ThreatIndicatorCategory;
  severity: Severity;
  description: string;
  evidence: string[];
  regulatoryRef: string;
  mitigationAction: string;
}

export interface UserBehaviorAnalysis {
  id: string;
  analyzedAt: string; // dd/mm/yyyy
  userId: string;
  userName: string;
  role: string;
  periodStart: string; // dd/mm/yyyy
  periodEnd: string; // dd/mm/yyyy
  activityCount: number;
  threatScore: number; // 0-100
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
  indicators: ThreatIndicator[];
  behaviorSummary: BehaviorSummary;
  recommendation: string;
  retentionExpiry: string; // dd/mm/yyyy
}

export interface BehaviorSummary {
  totalActions: number;
  afterHoursActions: number;
  weekendActions: number;
  afterHoursPercent: number;
  screeningsPerformed: number;
  alertsDismissed: number;
  alertsEscalated: number;
  dismissalRate: number; // ratio dismissed / total alerts handled
  dataExports: number;
  bulkExports: number; // exports > 100 records
  failedAccessAttempts: number;
  privilegeEscalations: number;
  uniqueIPAddresses: number;
  distinctEntitySearches: number;
}

export interface SelectiveScreeningResult {
  id: string;
  analyzedAt: string;
  userId: string;
  totalEntitiesAssigned: number;
  totalEntitiesScreened: number;
  screeningCoverage: number; // 0-1
  skippedEntities: SkippedEntity[];
  patternDetected: boolean;
  patternType:
    | 'none'
    | 'jurisdiction-bias'
    | 'entity-type-bias'
    | 'risk-level-bias'
    | 'relationship-bias';
  severity: Severity;
  findings: string[];
  regulatoryRef: string;
}

export interface SkippedEntity {
  entityName: string;
  entityType: 'individual' | 'entity';
  country?: string;
  riskLevel?: string;
  assignedDate: string; // dd/mm/yyyy
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateUAE(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function isAfterHours(timestamp: string): boolean {
  const date = new Date(timestamp);
  const hour = date.getHours();
  return hour < 8 || hour >= 18;
}

function isWeekend(timestamp: string): boolean {
  const day = new Date(timestamp).getDay();
  return day === 0 || day === 6; // Sat (6) + Sun (0) — UAE government weekend since 1 Jan 2022
}

// ---------------------------------------------------------------------------
// Tool: analyzeUserBehavior
// ---------------------------------------------------------------------------

/**
 * Analyze a user's activity history for insider threat indicators.
 * Scores behavior across multiple dimensions: access timing, alert handling,
 * data exports, screening patterns, and privilege usage.
 *
 * @regulatory FDL No.10/2025 Art.20-21 (CO duties), Cabinet Res 134/2025 Art.19 (internal review)
 */
export function analyzeUserBehavior(input: {
  activities: UserActivityRecord[];
  periodStartISO: string;
  periodEndISO: string;
}): ToolResult<UserBehaviorAnalysis> {
  const { activities, periodStartISO, periodEndISO } = input;

  if (!activities || activities.length === 0) {
    return { ok: false, error: 'At least one activity record is required for analysis.' };
  }

  const userId = activities[0].userId;
  const userName = activities[0].userName;
  const role = activities[0].role;

  const indicators: ThreatIndicator[] = [];
  let threatScore = 0;

  // --- Compute summary statistics ---
  const afterHoursActions = activities.filter((a) => a.afterHours ?? isAfterHours(a.timestamp));
  const weekendActions = activities.filter((a) => a.weekend ?? isWeekend(a.timestamp));
  const screenings = activities.filter((a) => a.action.includes('screening'));
  const dismissals = activities.filter(
    (a) => a.action === 'alert-dismissed' || a.action === 'alert-override'
  );
  const escalations = activities.filter((a) => a.action === 'alert-escalated');
  const dataExports = activities.filter((a) => a.action.includes('export'));
  const bulkExports = dataExports.filter((a) => {
    const count = (a.metadata?.recordCount as number) ?? 0;
    return count > 100;
  });
  const failedAccess = activities.filter((a) => a.outcome === 'failure' || a.outcome === 'denied');
  const privEscalation = activities.filter(
    (a) => a.action.includes('privilege') || a.action.includes('role-change')
  );
  const uniqueIPs = new Set(activities.map((a) => a.ipAddress).filter(Boolean));
  const uniqueEntitySearches = new Set(activities.filter((a) => a.resource).map((a) => a.resource));

  const totalAlertsHandled = dismissals.length + escalations.length;
  const dismissalRate = totalAlertsHandled > 0 ? dismissals.length / totalAlertsHandled : 0;

  const summary: BehaviorSummary = {
    totalActions: activities.length,
    afterHoursActions: afterHoursActions.length,
    weekendActions: weekendActions.length,
    afterHoursPercent: activities.length > 0 ? afterHoursActions.length / activities.length : 0,
    screeningsPerformed: screenings.length,
    alertsDismissed: dismissals.length,
    alertsEscalated: escalations.length,
    dismissalRate,
    dataExports: dataExports.length,
    bulkExports: bulkExports.length,
    failedAccessAttempts: failedAccess.length,
    privilegeEscalations: privEscalation.length,
    uniqueIPAddresses: uniqueIPs.size,
    distinctEntitySearches: uniqueEntitySearches.size,
  };

  // --- 1. After-hours access pattern ---
  const afterHoursPct = summary.afterHoursPercent;
  if (afterHoursPct > 0.5 && afterHoursActions.length >= 10) {
    indicators.push({
      code: 'IT-ACCESS-001',
      category: 'access-pattern',
      severity: 'alert',
      description: `${(afterHoursPct * 100).toFixed(1)}% of activity occurs after hours (${afterHoursActions.length} actions). Potential unauthorized access pattern.`,
      evidence: afterHoursActions
        .slice(0, 5)
        .map((a) => `${a.timestamp}: ${a.action} on ${a.resource ?? 'N/A'}`),
      regulatoryRef: 'Cabinet Res 134/2025 Art.19 (internal review)',
      mitigationAction:
        'Review after-hours access justification. Consider restricting system access outside business hours.',
    });
    threatScore += 15;
  } else if (afterHoursPct > 0.3 && afterHoursActions.length >= 5) {
    indicators.push({
      code: 'IT-ACCESS-002',
      category: 'access-pattern',
      severity: 'warning',
      description: `${(afterHoursPct * 100).toFixed(1)}% of activity occurs after hours. Monitor for escalation.`,
      evidence: afterHoursActions.slice(0, 3).map((a) => `${a.timestamp}: ${a.action}`),
      regulatoryRef: 'Cabinet Res 134/2025 Art.19',
      mitigationAction: 'Add to behavioral watchlist for continued monitoring.',
    });
    threatScore += 8;
  }

  // --- 2. Weekend activity ---
  if (weekendActions.length >= 5) {
    indicators.push({
      code: 'IT-ACCESS-003',
      category: 'access-pattern',
      severity: weekendActions.length >= 15 ? 'alert' : 'warning',
      description: `${weekendActions.length} actions on weekends during the analysis period.`,
      evidence: weekendActions.slice(0, 3).map((a) => `${a.timestamp}: ${a.action}`),
      regulatoryRef: 'FATF Rec 18 (internal controls)',
      mitigationAction: 'Verify weekend access is authorized and logged appropriately.',
    });
    threatScore += weekendActions.length >= 15 ? 12 : 5;
  }

  // --- 3. Override/dismissal abuse ---
  if (dismissalRate > 0.85 && totalAlertsHandled >= 10) {
    indicators.push({
      code: 'IT-OVERRIDE-001',
      category: 'override-abuse',
      severity: 'critical',
      description: `Alert dismissal rate is ${(dismissalRate * 100).toFixed(1)}% (${dismissals.length}/${totalAlertsHandled}). User dismisses nearly all compliance alerts — potential obstruction or facilitation.`,
      evidence: dismissals
        .slice(0, 5)
        .map((a) => `${a.timestamp}: dismissed ${a.resource ?? 'unknown alert'}`),
      regulatoryRef: 'FDL No.10/2025 Art.20-21 (CO duties), Cabinet Res 71/2024 (penalties)',
      mitigationAction:
        'Immediately escalate to Senior Management. Conduct four-eyes review of all dismissed alerts. Consider temporary suspension of override privileges.',
    });
    threatScore += 25;
  } else if (dismissalRate > 0.7 && totalAlertsHandled >= 5) {
    indicators.push({
      code: 'IT-OVERRIDE-002',
      category: 'override-abuse',
      severity: 'alert',
      description: `Alert dismissal rate is ${(dismissalRate * 100).toFixed(1)}%. Higher than expected — review reasoning.`,
      evidence: dismissals
        .slice(0, 3)
        .map((a) => `${a.timestamp}: dismissed ${a.resource ?? 'unknown alert'}`),
      regulatoryRef: 'FDL No.10/2025 Art.20-21',
      mitigationAction:
        'Conduct sample review of dismissed alerts. Require documented justification for each dismissal.',
    });
    threatScore += 15;
  }

  // --- 4. Data exfiltration indicators ---
  if (bulkExports.length >= 3) {
    indicators.push({
      code: 'IT-EXFIL-001',
      category: 'data-exfiltration',
      severity: 'critical',
      description: `${bulkExports.length} bulk data exports (>100 records each). Potential data exfiltration.`,
      evidence: bulkExports
        .slice(0, 5)
        .map(
          (a) =>
            `${a.timestamp}: exported ${a.metadata?.recordCount ?? 'unknown'} records from ${a.resource ?? 'unknown'}`
        ),
      regulatoryRef: 'FDL No.10/2025 Art.24 (record protection), FATF Rec 18',
      mitigationAction:
        'Immediately restrict export privileges. Investigate business justification for each bulk export. Check for data transfers to external systems.',
    });
    threatScore += 25;
  } else if (dataExports.length >= 10) {
    indicators.push({
      code: 'IT-EXFIL-002',
      category: 'data-exfiltration',
      severity: 'alert',
      description: `${dataExports.length} data export actions in period. Review for legitimate business need.`,
      evidence: dataExports
        .slice(0, 3)
        .map((a) => `${a.timestamp}: export from ${a.resource ?? 'unknown'}`),
      regulatoryRef: 'FDL No.10/2025 Art.24',
      mitigationAction:
        'Verify export activity is within job responsibilities. Add export logging alerts.',
    });
    threatScore += 12;
  }

  // --- 5. Privilege escalation ---
  if (privEscalation.length >= 2) {
    indicators.push({
      code: 'IT-PRIV-001',
      category: 'privilege-escalation',
      severity: 'alert',
      description: `${privEscalation.length} privilege escalation or role change events detected.`,
      evidence: privEscalation.slice(0, 3).map((a) => `${a.timestamp}: ${a.action}`),
      regulatoryRef: 'FATF Rec 18, Cabinet Res 134/2025 Art.18 (CO change notification)',
      mitigationAction:
        'Audit all privilege changes. Ensure dual-approval for role modifications per four-eyes principle.',
    });
    threatScore += 15;
  }

  // --- 6. Failed access attempts ---
  if (failedAccess.length >= MAX_FAILED_LOGIN_ATTEMPTS) {
    indicators.push({
      code: 'IT-ACCESS-004',
      category: 'access-pattern',
      severity: failedAccess.length >= MAX_FAILED_LOGIN_ATTEMPTS * 3 ? 'critical' : 'alert',
      description: `${failedAccess.length} failed access/denied attempts — potential unauthorized access probing.`,
      evidence: failedAccess
        .slice(0, 5)
        .map((a) => `${a.timestamp}: ${a.action} → ${a.outcome} (${a.resource ?? 'N/A'})`),
      regulatoryRef: 'FATF Rec 18 (internal controls)',
      mitigationAction:
        'Review failed access targets. Check for credential compromise. Consider account lockout.',
    });
    threatScore += failedAccess.length >= MAX_FAILED_LOGIN_ATTEMPTS * 3 ? 20 : 10;
  }

  // --- 7. Multiple IP addresses (session hijacking / shared credentials) ---
  if (uniqueIPs.size >= 5) {
    indicators.push({
      code: 'IT-ACCESS-005',
      category: 'access-pattern',
      severity: 'warning',
      description: `${uniqueIPs.size} distinct IP addresses used during period. Possible credential sharing or VPN hopping.`,
      evidence: [...uniqueIPs].slice(0, 5).map((ip) => `IP: ${ip}`),
      regulatoryRef: 'FATF Rec 18',
      mitigationAction: 'Verify IP addresses correspond to authorized locations. Enforce MFA.',
    });
    threatScore += 8;
  }

  // --- 8. Potential tipping off (accessing STR/SAR records + contacting subject) ---
  const strAccesses = activities.filter(
    (a) => a.resource?.includes('STR') || a.resource?.includes('SAR')
  );
  const communicationActions = activities.filter(
    (a) => a.action.includes('email') || a.action.includes('call') || a.action.includes('message')
  );
  if (strAccesses.length > 0 && communicationActions.length > 0) {
    // Check for temporal proximity: STR access followed by communication within 1 hour
    for (const strAccess of strAccesses) {
      const strTime = new Date(strAccess.timestamp).getTime();
      const proxCommActions = communicationActions.filter((c) => {
        const commTime = new Date(c.timestamp).getTime();
        return commTime > strTime && commTime - strTime < 3600000; // 1 hour
      });
      if (proxCommActions.length > 0) {
        indicators.push({
          code: 'IT-TIPOFF-001',
          category: 'tipping-off',
          severity: 'critical',
          description:
            'STR/SAR record accessed followed by outbound communication within 1 hour. Potential tipping off violation (FDL Art.29).',
          evidence: [
            `STR access: ${strAccess.timestamp} — ${strAccess.resource}`,
            ...proxCommActions
              .slice(0, 2)
              .map(
                (c) => `Communication: ${c.timestamp} — ${c.action} to ${c.resource ?? 'unknown'}`
              ),
          ],
          regulatoryRef: 'FDL No.10/2025 Art.29 (no tipping off)',
          mitigationAction:
            'CRITICAL: Escalate to MLRO immediately. Investigate communication content. Consider suspending access pending investigation.',
        });
        threatScore += 30;
        break; // One tipping-off indicator is enough to flag
      }
    }
  }

  // --- Cap and classify ---
  threatScore = Math.min(threatScore, 100);

  let threatLevel: 'low' | 'medium' | 'high' | 'critical';
  if (threatScore >= 70) threatLevel = 'critical';
  else if (threatScore >= 45) threatLevel = 'high';
  else if (threatScore >= 20) threatLevel = 'medium';
  else threatLevel = 'low';

  let recommendation: string;
  if (threatLevel === 'critical') {
    recommendation =
      'IMMEDIATE ACTION REQUIRED: Suspend user access pending investigation. Notify Senior Management and MLRO. Conduct forensic review of all user actions. Document per Cabinet Res 134/2025 Art.19.';
  } else if (threatLevel === 'high') {
    recommendation =
      'Escalate to Compliance Officer for enhanced monitoring. Restrict sensitive data access. Schedule formal behavioral review within 5 business days.';
  } else if (threatLevel === 'medium') {
    recommendation =
      'Add user to enhanced monitoring watchlist. Review override and export patterns monthly. Ensure four-eyes principle on high-risk decisions.';
  } else {
    recommendation = 'No significant threat indicators detected. Continue standard monitoring.';
  }

  const now = new Date();
  const periodStart = new Date(periodStartISO);
  const periodEnd = new Date(periodEndISO);

  return {
    ok: true,
    data: {
      id: crypto.randomUUID(),
      analyzedAt: formatDateUAE(now),
      userId,
      userName,
      role,
      periodStart: formatDateUAE(periodStart),
      periodEnd: formatDateUAE(periodEnd),
      activityCount: activities.length,
      threatScore,
      threatLevel,
      indicators,
      behaviorSummary: summary,
      recommendation,
      retentionExpiry: formatDateUAE(addYears(now, RECORD_RETENTION_YEARS)),
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: detectSelectiveScreening
// ---------------------------------------------------------------------------

/**
 * Detect whether a user is selectively screening entities — screening
 * some but consistently skipping others. This is a key indicator of
 * facilitation or corruption within the compliance function.
 *
 * @regulatory FDL No.10/2025 Art.20-21 (CO duties), Art.35 (TFS — must screen ALL)
 */
export function detectSelectiveScreening(input: {
  userId: string;
  assignedEntities: Array<{
    entityName: string;
    entityType: 'individual' | 'entity';
    country?: string;
    riskLevel?: string;
    assignedDate: string; // ISO date
  }>;
  screenedEntities: string[]; // entity names that were actually screened
}): ToolResult<SelectiveScreeningResult> {
  const { userId, assignedEntities, screenedEntities } = input;

  if (!assignedEntities || assignedEntities.length === 0) {
    return { ok: false, error: 'At least one assigned entity is required.' };
  }

  const screenedSet = new Set(screenedEntities.map((n) => n.toLowerCase()));
  const totalAssigned = assignedEntities.length;
  const totalScreened = assignedEntities.filter((e) =>
    screenedSet.has(e.entityName.toLowerCase())
  ).length;
  const coverage = totalAssigned > 0 ? totalScreened / totalAssigned : 0;

  const skippedEntities: SkippedEntity[] = assignedEntities
    .filter((e) => !screenedSet.has(e.entityName.toLowerCase()))
    .map((e) => ({
      entityName: e.entityName,
      entityType: e.entityType,
      country: e.country,
      riskLevel: e.riskLevel,
      assignedDate: formatDateUAE(new Date(e.assignedDate)),
    }));

  // --- Pattern detection ---
  let patternType: SelectiveScreeningResult['patternType'] = 'none';
  const findings: string[] = [];

  if (skippedEntities.length === 0) {
    findings.push('All assigned entities have been screened. No selective screening detected.');
  } else {
    // Jurisdiction bias: skipped entities disproportionately from same country
    const skippedCountries = skippedEntities.map((e) => e.country).filter(Boolean) as string[];
    if (skippedCountries.length > 0) {
      const countryFreq: Record<string, number> = {};
      for (const c of skippedCountries) {
        countryFreq[c] = (countryFreq[c] ?? 0) + 1;
      }
      const topCountry = Object.entries(countryFreq).sort((a, b) => b[1] - a[1])[0];
      if (topCountry && topCountry[1] / skippedCountries.length > 0.6 && topCountry[1] >= 3) {
        patternType = 'jurisdiction-bias';
        findings.push(
          `Jurisdiction bias detected: ${topCountry[1]}/${skippedCountries.length} skipped entities are from ${topCountry[0]}. User may be intentionally avoiding screening entities from this jurisdiction.`
        );
      }
    }

    // Entity type bias
    const skippedIndividuals = skippedEntities.filter((e) => e.entityType === 'individual').length;
    const skippedEntitiesCount = skippedEntities.filter((e) => e.entityType === 'entity').length;
    if (skippedEntities.length >= 3) {
      if (skippedIndividuals / skippedEntities.length > 0.8) {
        patternType = patternType === 'none' ? 'entity-type-bias' : patternType;
        findings.push(
          `Entity type bias: ${skippedIndividuals}/${skippedEntities.length} skipped entities are individuals.`
        );
      } else if (skippedEntitiesCount / skippedEntities.length > 0.8) {
        patternType = patternType === 'none' ? 'entity-type-bias' : patternType;
        findings.push(
          `Entity type bias: ${skippedEntitiesCount}/${skippedEntities.length} skipped entities are corporate entities.`
        );
      }
    }

    // Risk-level bias: skipping high-risk entities
    const skippedHighRisk = skippedEntities.filter((e) => e.riskLevel === 'high').length;
    if (skippedHighRisk >= 2 && skippedHighRisk / skippedEntities.length > 0.5) {
      patternType = patternType === 'none' ? 'risk-level-bias' : patternType;
      findings.push(
        `Risk-level bias: ${skippedHighRisk}/${skippedEntities.length} skipped entities are high-risk. This is a serious compliance gap — high-risk entities MUST be screened per FDL Art.35.`
      );
    }

    if (patternType === 'none' && skippedEntities.length >= 2) {
      findings.push(
        `${skippedEntities.length} entities not screened. No clear pattern detected but coverage is below 100%.`
      );
    }
  }

  const patternDetected = patternType !== 'none';
  let severity: Severity;
  if (coverage < 0.5 || patternType === 'risk-level-bias') severity = 'critical';
  else if (coverage < 0.75 || patternDetected) severity = 'alert';
  else if (coverage < 0.95) severity = 'warning';
  else severity = 'info';

  return {
    ok: true,
    data: {
      id: crypto.randomUUID(),
      analyzedAt: formatDateUAE(new Date()),
      userId,
      totalEntitiesAssigned: totalAssigned,
      totalEntitiesScreened: totalScreened,
      screeningCoverage: Math.round(coverage * 10000) / 10000,
      skippedEntities,
      patternDetected,
      patternType,
      severity,
      findings,
      regulatoryRef: 'FDL No.10/2025 Art.20-21, Art.35 (TFS), Cabinet Res 134/2025 Art.19',
    },
  };
}

// ---------------------------------------------------------------------------
// Schema exports for MCP registration
// ---------------------------------------------------------------------------

export const INSIDER_THREAT_TOOL_SCHEMAS = [
  {
    name: 'analyze_user_behavior',
    description:
      "Analyze a compliance staff member's activity history for insider threat indicators. Scores behavior across: after-hours access, alert dismissal patterns, data exfiltration, privilege escalation, tipping-off proximity. Returns threat score 0-100 with categorized indicators. Regulatory: FDL Art.20-21 (CO duties), Art.29 (no tipping off), Cabinet Res 134/2025 Art.19 (internal review).",
    inputSchema: {
      type: 'object',
      properties: {
        activities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              userName: { type: 'string' },
              role: {
                type: 'string',
                enum: ['compliance-officer', 'analyst', 'admin', 'manager', 'viewer'],
              },
              timestamp: { type: 'string', description: 'ISO 8601 datetime' },
              action: {
                type: 'string',
                description:
                  'Action performed (e.g. screening-completed, alert-dismissed, export-data)',
              },
              resource: { type: 'string', description: 'Entity or record accessed' },
              ipAddress: { type: 'string' },
              afterHours: { type: 'boolean' },
              weekend: { type: 'boolean' },
              outcome: { type: 'string', enum: ['success', 'failure', 'denied'] },
              metadata: { type: 'object' },
            },
            required: ['userId', 'userName', 'role', 'timestamp', 'action'],
          },
          description: 'Array of user activity records to analyze',
        },
        periodStartISO: { type: 'string', description: 'Analysis period start (ISO date)' },
        periodEndISO: { type: 'string', description: 'Analysis period end (ISO date)' },
      },
      required: ['activities', 'periodStartISO', 'periodEndISO'],
    },
  },
  {
    name: 'detect_selective_screening',
    description:
      'Detect whether a user is selectively screening entities — screening some but skipping others. Identifies bias patterns: jurisdiction, entity type, risk level. Key indicator of insider facilitation. Regulatory: FDL Art.20-21, Art.35 (must screen ALL entities).',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User ID to investigate' },
        assignedEntities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entityName: { type: 'string' },
              entityType: { type: 'string', enum: ['individual', 'entity'] },
              country: { type: 'string' },
              riskLevel: { type: 'string' },
              assignedDate: { type: 'string', description: 'ISO date' },
            },
            required: ['entityName', 'entityType', 'assignedDate'],
          },
          description: 'All entities assigned to this user for screening',
        },
        screenedEntities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Entity names that were actually screened (subset of assigned)',
        },
      },
      required: ['userId', 'assignedEntities', 'screenedEntities'],
    },
  },
] as const;
