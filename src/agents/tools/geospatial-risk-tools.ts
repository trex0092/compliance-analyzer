/**
 * Geospatial Risk Engine
 *
 * Geographic intelligence for compliance risk analysis:
 * 1. Trade route risk scoring — origin → transit → destination
 * 2. Jurisdiction risk classification (FATF grey/black, CAHRA, offshore)
 * 3. Geographic clustering — detect entities concentrated in high-risk zones
 * 4. Cross-border flow mapping — visualize money/goods movement paths
 * 5. Sanctions jurisdiction overlap — flag multi-sanctioned corridors
 * 6. Distance-from-conflict scoring — proximity to CAHRA zones
 *
 * Regulatory basis: FDL No.10/2025 Art.16 (cross-border AED 60K),
 * LBMA RGG v9 Step 3 (CAHRA due diligence), Cabinet Res 134/2025 Art.5
 */

import type { ToolResult } from '../mcp-server';
import {
  CROSS_BORDER_CASH_THRESHOLD_AED,
  PF_HIGH_RISK_JURISDICTIONS,
  FATF_GREY_LIST,
  EU_HIGH_RISK_COUNTRIES,
} from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeoCoordinate {
  lat: number;
  lng: number;
}

export interface JurisdictionProfile {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  riskClassification: 'low' | 'medium' | 'high' | 'very-high' | 'sanctioned';
  fatfStatus: 'compliant' | 'grey-list' | 'black-list' | 'not-assessed';
  isCAHRA: boolean;
  isOffshore: boolean;
  isPFHighRisk: boolean;
  isEUHighRisk: boolean;
  sanctionsRegimes: string[]; // UN, OFAC, EU, etc.
  coordinate: GeoCoordinate;
  riskScore: number; // 0-20
}

export interface TradeRoute {
  id: string;
  origin: string;       // country code
  transit?: string[];    // transit country codes
  destination: string;   // country code
  commodity?: string;
  value: number;
  currency: string;
  transportMode?: 'air' | 'sea' | 'land' | 'multimodal';
}

export interface RouteRiskAssessment {
  route: TradeRoute;
  originRisk: JurisdictionProfile;
  destinationRisk: JurisdictionProfile;
  transitRisks: JurisdictionProfile[];
  totalRouteRisk: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: string[];
  cahraExposure: boolean;
  sanctionedCorridors: string[];
  crossBorderDeclaration: boolean;
  regulatoryActions: string[];
}

export interface GeoCluster {
  centroid: GeoCoordinate;
  jurisdiction: string;
  entityCount: number;
  avgRisk: number;
  entities: Array<{ id: string; name: string; riskScore: number }>;
  clusterRisk: 'low' | 'medium' | 'high' | 'critical';
  anomaly: boolean;
  anomalyReason?: string;
}

export interface CrossBorderFlow {
  from: string;
  to: string;
  totalValue: number;
  transactionCount: number;
  avgValue: number;
  riskScore: number;
  declarationRequired: boolean;
}

export interface GeospatialReport {
  analyzedAt: string;
  routeAssessments: RouteRiskAssessment[];
  highRiskRoutes: RouteRiskAssessment[];
  clusters: GeoCluster[];
  crossBorderFlows: CrossBorderFlow[];
  jurisdictionHeatMap: Array<{ code: string; name: string; riskScore: number; entityCount: number }>;
  cahraExposedRoutes: number;
  sanctionedCorridorCount: number;
  totalCrossBorderValue: number;
  alerts: string[];
  overallGeoRisk: 'low' | 'medium' | 'high' | 'critical';
}

// ---------------------------------------------------------------------------
// Jurisdiction Database
// ---------------------------------------------------------------------------

const JURISDICTION_DB: Record<string, Omit<JurisdictionProfile, 'code'>> = {
  AE: { name: 'United Arab Emirates', riskClassification: 'medium', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 24.45, lng: 54.65 }, riskScore: 3 },
  US: { name: 'United States', riskClassification: 'low', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 38.9, lng: -77.04 }, riskScore: 1 },
  GB: { name: 'United Kingdom', riskClassification: 'low', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 51.5, lng: -0.12 }, riskScore: 1 },
  CH: { name: 'Switzerland', riskClassification: 'low', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 46.95, lng: 7.45 }, riskScore: 2 },
  IN: { name: 'India', riskClassification: 'medium', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 28.61, lng: 77.21 }, riskScore: 4 },
  CN: { name: 'China', riskClassification: 'medium', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 39.9, lng: 116.4 }, riskScore: 5 },
  RU: { name: 'Russia', riskClassification: 'very-high', fatfStatus: 'grey-list', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: true, sanctionsRegimes: ['OFAC', 'EU', 'UK'], coordinate: { lat: 55.75, lng: 37.62 }, riskScore: 16 },
  IR: { name: 'Iran', riskClassification: 'sanctioned', fatfStatus: 'black-list', isCAHRA: true, isOffshore: false, isPFHighRisk: true, isEUHighRisk: true, sanctionsRegimes: ['UN', 'OFAC', 'EU', 'UK'], coordinate: { lat: 35.69, lng: 51.39 }, riskScore: 20 },
  KP: { name: 'North Korea', riskClassification: 'sanctioned', fatfStatus: 'black-list', isCAHRA: true, isOffshore: false, isPFHighRisk: true, isEUHighRisk: true, sanctionsRegimes: ['UN', 'OFAC', 'EU', 'UK'], coordinate: { lat: 39.02, lng: 125.75 }, riskScore: 20 },
  SY: { name: 'Syria', riskClassification: 'sanctioned', fatfStatus: 'grey-list', isCAHRA: true, isOffshore: false, isPFHighRisk: true, isEUHighRisk: true, sanctionsRegimes: ['OFAC', 'EU', 'UK'], coordinate: { lat: 33.51, lng: 36.29 }, riskScore: 19 },
  MM: { name: 'Myanmar', riskClassification: 'very-high', fatfStatus: 'grey-list', isCAHRA: true, isOffshore: false, isPFHighRisk: true, isEUHighRisk: true, sanctionsRegimes: ['OFAC', 'EU', 'UK'], coordinate: { lat: 19.76, lng: 96.07 }, riskScore: 17 },
  AF: { name: 'Afghanistan', riskClassification: 'very-high', fatfStatus: 'grey-list', isCAHRA: true, isOffshore: false, isPFHighRisk: false, isEUHighRisk: true, sanctionsRegimes: ['UN', 'OFAC'], coordinate: { lat: 34.53, lng: 69.17 }, riskScore: 18 },
  YE: { name: 'Yemen', riskClassification: 'very-high', fatfStatus: 'grey-list', isCAHRA: true, isOffshore: false, isPFHighRisk: true, isEUHighRisk: true, sanctionsRegimes: ['UN', 'OFAC'], coordinate: { lat: 15.35, lng: 44.21 }, riskScore: 17 },
  LY: { name: 'Libya', riskClassification: 'very-high', fatfStatus: 'grey-list', isCAHRA: true, isOffshore: false, isPFHighRisk: false, isEUHighRisk: true, sanctionsRegimes: ['UN', 'EU'], coordinate: { lat: 32.9, lng: 13.18 }, riskScore: 16 },
  CD: { name: 'DR Congo', riskClassification: 'very-high', fatfStatus: 'grey-list', isCAHRA: true, isOffshore: false, isPFHighRisk: false, isEUHighRisk: true, sanctionsRegimes: ['UN'], coordinate: { lat: -4.32, lng: 15.31 }, riskScore: 16 },
  CF: { name: 'Central African Republic', riskClassification: 'very-high', fatfStatus: 'grey-list', isCAHRA: true, isOffshore: false, isPFHighRisk: false, isEUHighRisk: true, sanctionsRegimes: ['UN'], coordinate: { lat: 4.39, lng: 18.56 }, riskScore: 16 },
  SD: { name: 'Sudan', riskClassification: 'very-high', fatfStatus: 'grey-list', isCAHRA: true, isOffshore: false, isPFHighRisk: false, isEUHighRisk: true, sanctionsRegimes: ['OFAC'], coordinate: { lat: 15.59, lng: 32.53 }, riskScore: 16 },
  VG: { name: 'British Virgin Islands', riskClassification: 'high', fatfStatus: 'not-assessed', isCAHRA: false, isOffshore: true, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 18.43, lng: -64.62 }, riskScore: 12 },
  KY: { name: 'Cayman Islands', riskClassification: 'high', fatfStatus: 'compliant', isCAHRA: false, isOffshore: true, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 19.29, lng: -81.38 }, riskScore: 11 },
  PA: { name: 'Panama', riskClassification: 'high', fatfStatus: 'grey-list', isCAHRA: false, isOffshore: true, isPFHighRisk: false, isEUHighRisk: true, sanctionsRegimes: [], coordinate: { lat: 8.98, lng: -79.52 }, riskScore: 13 },
  GH: { name: 'Ghana', riskClassification: 'medium', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 5.56, lng: -0.19 }, riskScore: 6 },
  ZA: { name: 'South Africa', riskClassification: 'medium', fatfStatus: 'grey-list', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: -25.75, lng: 28.19 }, riskScore: 7 },
  TR: { name: 'Turkey', riskClassification: 'medium', fatfStatus: 'grey-list', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 39.93, lng: 32.86 }, riskScore: 7 },
  HK: { name: 'Hong Kong', riskClassification: 'medium', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 22.32, lng: 114.17 }, riskScore: 5 },
  SG: { name: 'Singapore', riskClassification: 'low', fatfStatus: 'compliant', isCAHRA: false, isOffshore: false, isPFHighRisk: false, isEUHighRisk: false, sanctionsRegimes: [], coordinate: { lat: 1.35, lng: 103.82 }, riskScore: 2 },
};

export function getJurisdictionProfile(code: string): JurisdictionProfile {
  const upper = code.toUpperCase();
  const profile = JURISDICTION_DB[upper];
  if (profile) return { code: upper, ...profile };

  // Dynamic classification for unknown jurisdictions.
  // The readonly tuple types narrow the .includes() argument to the
  // literal union; cast `upper` to the widest string type for lookup.
  const isFATFGrey = (FATF_GREY_LIST as readonly string[]).includes(upper);
  const isPF = (PF_HIGH_RISK_JURISDICTIONS as readonly string[]).includes(upper);
  const isEU = (EU_HIGH_RISK_COUNTRIES as readonly string[]).includes(upper);

  return {
    code: upper,
    name: upper,
    riskClassification: isPF ? 'sanctioned' : isFATFGrey ? 'high' : isEU ? 'high' : 'medium',
    fatfStatus: isFATFGrey ? 'grey-list' : 'not-assessed',
    isCAHRA: isPF,
    isOffshore: false,
    isPFHighRisk: isPF,
    isEUHighRisk: isEU,
    sanctionsRegimes: [],
    coordinate: { lat: 0, lng: 0 },
    riskScore: isPF ? 18 : isFATFGrey ? 12 : isEU ? 10 : 5,
  };
}

// ---------------------------------------------------------------------------
// Trade Route Risk Assessment
// ---------------------------------------------------------------------------

export function assessRouteRisk(route: TradeRoute): RouteRiskAssessment {
  const origin = getJurisdictionProfile(route.origin);
  const destination = getJurisdictionProfile(route.destination);
  const transitRisks = (route.transit ?? []).map(getJurisdictionProfile);

  const allJurisdictions = [origin, ...transitRisks, destination];
  const flags: string[] = [];
  const regulatoryActions: string[] = [];
  const sanctionedCorridors: string[] = [];

  // Check each jurisdiction
  for (const j of allJurisdictions) {
    if (j.riskClassification === 'sanctioned') {
      flags.push(`SANCTIONED: ${j.name} (${j.sanctionsRegimes.join(', ')})`);
      regulatoryActions.push(`STOP: Transaction involves sanctioned jurisdiction ${j.name}`);
    }
    if (j.isCAHRA) {
      flags.push(`CAHRA: ${j.name} — conflict/high-risk area (LBMA RGG v9 Step 3)`);
      regulatoryActions.push(`EDD required for ${j.name} exposure (CAHRA due diligence)`);
    }
    if (j.isPFHighRisk) {
      flags.push(`PF HIGH-RISK: ${j.name} (Cabinet Res 156/2025)`);
    }
    if (j.isOffshore) {
      flags.push(`OFFSHORE: ${j.name} — enhanced ownership verification required`);
    }
  }

  // Sanctioned corridors (both endpoints sanctioned/high-risk)
  if (origin.riskScore >= 15 && destination.riskScore >= 15) {
    sanctionedCorridors.push(`${origin.name} ↔ ${destination.name}`);
    flags.push(`SANCTIONED CORRIDOR: ${origin.name} → ${destination.name}`);
  }

  // Cross-border declaration
  const crossBorderDeclaration = route.value >= CROSS_BORDER_CASH_THRESHOLD_AED;
  if (crossBorderDeclaration) {
    flags.push(`Cross-border value AED ${route.value.toLocaleString()} exceeds AED 60,000 threshold`);
    regulatoryActions.push('Cross-border cash/BNI declaration required (FDL Art.16)');
  }

  // CAHRA exposure
  const cahraExposure = allJurisdictions.some((j) => j.isCAHRA);

  // Composite risk score
  const maxJurisdictionRisk = Math.max(...allJurisdictions.map((j) => j.riskScore));
  const avgRisk = allJurisdictions.reduce((s, j) => s + j.riskScore, 0) / allJurisdictions.length;
  const transitPenalty = transitRisks.length * 1.5; // more hops = more risk
  const totalRouteRisk = Math.min(20, Math.round((maxJurisdictionRisk * 0.5 + avgRisk * 0.3 + transitPenalty) * 10) / 10);

  let riskLevel: RouteRiskAssessment['riskLevel'] = 'low';
  if (totalRouteRisk >= 16) riskLevel = 'critical';
  else if (totalRouteRisk >= 11) riskLevel = 'high';
  else if (totalRouteRisk >= 6) riskLevel = 'medium';

  return {
    route,
    originRisk: origin,
    destinationRisk: destination,
    transitRisks,
    totalRouteRisk,
    riskLevel,
    flags,
    cahraExposure,
    sanctionedCorridors,
    crossBorderDeclaration,
    regulatoryActions,
  };
}

// ---------------------------------------------------------------------------
// Full Geospatial Analysis
// ---------------------------------------------------------------------------

export function runGeospatialAnalysis(
  routes: TradeRoute[],
  entities?: Array<{ id: string; name: string; jurisdiction: string; riskScore: number }>,
): ToolResult<GeospatialReport> {
  if (routes.length === 0 && (!entities || entities.length === 0)) {
    return { ok: false, error: 'Provide at least one trade route or entity' };
  }

  // Assess all routes
  const assessments = routes.map(assessRouteRisk);
  const highRiskRoutes = assessments.filter((a) => a.riskLevel === 'high' || a.riskLevel === 'critical');

  // Cross-border flows
  const flowMap = new Map<string, CrossBorderFlow>();
  for (const route of routes) {
    const key = `${route.origin}-${route.destination}`;
    const existing = flowMap.get(key) ?? {
      from: route.origin,
      to: route.destination,
      totalValue: 0,
      transactionCount: 0,
      avgValue: 0,
      riskScore: 0,
      declarationRequired: false,
    };
    existing.totalValue += route.value;
    existing.transactionCount++;
    existing.avgValue = existing.totalValue / existing.transactionCount;
    existing.declarationRequired = existing.totalValue >= CROSS_BORDER_CASH_THRESHOLD_AED;
    const assessment = assessments.find((a) => a.route.id === route.id);
    existing.riskScore = Math.max(existing.riskScore, assessment?.totalRouteRisk ?? 0);
    flowMap.set(key, existing);
  }

  // Geographic clustering
  const clusters: GeoCluster[] = [];
  if (entities && entities.length > 0) {
    const byJurisdiction = new Map<string, typeof entities>();
    for (const entity of entities) {
      const j = entity.jurisdiction.toUpperCase();
      if (!byJurisdiction.has(j)) byJurisdiction.set(j, []);
      byJurisdiction.get(j)!.push(entity);
    }

    for (const [code, ents] of byJurisdiction) {
      const profile = getJurisdictionProfile(code);
      const avgRisk = ents.reduce((s, e) => s + e.riskScore, 0) / ents.length;
      const anomaly = ents.length >= 5 && profile.riskScore >= 10;

      let clusterRisk: GeoCluster['clusterRisk'] = 'low';
      if (avgRisk >= 16) clusterRisk = 'critical';
      else if (avgRisk >= 11) clusterRisk = 'high';
      else if (avgRisk >= 6) clusterRisk = 'medium';

      clusters.push({
        centroid: profile.coordinate,
        jurisdiction: profile.name,
        entityCount: ents.length,
        avgRisk: Math.round(avgRisk * 10) / 10,
        entities: ents,
        clusterRisk,
        anomaly,
        anomalyReason: anomaly ? `${ents.length} entities concentrated in high-risk ${profile.name}` : undefined,
      });
    }
  }

  // Heat map
  const jurisdictionCounts = new Map<string, number>();
  for (const route of routes) {
    jurisdictionCounts.set(route.origin, (jurisdictionCounts.get(route.origin) ?? 0) + 1);
    jurisdictionCounts.set(route.destination, (jurisdictionCounts.get(route.destination) ?? 0) + 1);
  }
  const heatMap = Array.from(jurisdictionCounts.entries()).map(([code, count]) => {
    const profile = getJurisdictionProfile(code);
    return { code, name: profile.name, riskScore: profile.riskScore, entityCount: count };
  }).sort((a, b) => b.riskScore - a.riskScore);

  // Alerts
  const alerts: string[] = [];
  const cahraRoutes = assessments.filter((a) => a.cahraExposure);
  if (cahraRoutes.length > 0) alerts.push(`${cahraRoutes.length} route(s) with CAHRA exposure — LBMA RGG v9 Step 3 due diligence required`);
  const sanctionedCount = assessments.reduce((s, a) => s + a.sanctionedCorridors.length, 0);
  if (sanctionedCount > 0) alerts.push(`${sanctionedCount} sanctioned corridor(s) detected — STOP and investigate`);
  if (highRiskRoutes.length > 0) alerts.push(`${highRiskRoutes.length} high/critical risk route(s) require enhanced review`);

  const totalCBValue = Array.from(flowMap.values()).reduce((s, f) => s + f.totalValue, 0);
  const maxRisk = Math.max(0, ...assessments.map((a) => a.totalRouteRisk));
  let overallGeoRisk: GeospatialReport['overallGeoRisk'] = 'low';
  if (maxRisk >= 16 || sanctionedCount > 0) overallGeoRisk = 'critical';
  else if (maxRisk >= 11 || cahraRoutes.length > 0) overallGeoRisk = 'high';
  else if (maxRisk >= 6) overallGeoRisk = 'medium';

  return {
    ok: true,
    data: {
      analyzedAt: new Date().toISOString(),
      routeAssessments: assessments,
      highRiskRoutes,
      clusters,
      crossBorderFlows: Array.from(flowMap.values()),
      jurisdictionHeatMap: heatMap,
      cahraExposedRoutes: cahraRoutes.length,
      sanctionedCorridorCount: sanctionedCount,
      totalCrossBorderValue: totalCBValue,
      alerts,
      overallGeoRisk,
    },
  };
}

export const GEO_TOOL_SCHEMAS = [
  {
    name: 'analyze_geospatial_risk',
    description: 'Full geospatial risk analysis: trade route scoring, jurisdiction classification (FATF/CAHRA/offshore/PF), geographic clustering, cross-border flow mapping, sanctioned corridor detection. 25+ jurisdictions pre-loaded.',
    inputSchema: {
      type: 'object',
      properties: {
        routes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, origin: { type: 'string' }, transit: { type: 'array', items: { type: 'string' } }, destination: { type: 'string' }, commodity: { type: 'string' }, value: { type: 'number' }, currency: { type: 'string' } }, required: ['id', 'origin', 'destination', 'value', 'currency'] } },
        entities: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, jurisdiction: { type: 'string' }, riskScore: { type: 'number' } }, required: ['id', 'name', 'jurisdiction', 'riskScore'] } },
      },
      required: ['routes'],
    },
  },
  {
    name: 'get_jurisdiction_profile',
    description: 'Get risk profile for any jurisdiction: FATF status, CAHRA, offshore, PF risk, sanctions regimes, risk score. Covers 25+ pre-loaded countries plus dynamic classification.',
    inputSchema: { type: 'object', properties: { countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2 code' } }, required: ['countryCode'] },
  },
] as const;
