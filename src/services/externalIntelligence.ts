/**
 * External Intelligence Connectors — Phase 7 Cluster K (#81-#86).
 *
 * Six pluggable connectors for real-world external intelligence
 * sources. Each connector is defined as a TypeScript interface so
 * production deployments wire real API clients and tests use
 * in-memory fakes. The compliance-analyzer never hardcodes any
 * provider's endpoint or credentials — real wiring happens at the
 * edge (netlify functions, env vars, proxy).
 *
 * Six connectors in this single file (each <120 lines — trivial
 * surface each):
 *
 *   81. realTimeSanctionsApi    — Dow Jones / LexisNexis / WorldCheck
 *   82. pepDatabaseConnector    — PEP list lookup
 *   83. fatfGreyListTimeSeries  — FATF grey/black list history
 *   84. companiesHouseConnector — OpenCorporates / Companies House / DIFC
 *   85. icijOffshoreLeaksLookup — Panama/Pandora/Paradise papers
 *   86. occrpAlephLookup        — organized crime / corruption data
 *
 * All connectors share the same shape: async function taking a
 * query + dependency-injected transport, returning a result type
 * specific to the data source.
 *
 * Regulatory basis:
 *   - FATF Rec 6 (sanctions screening completeness)
 *   - FATF Rec 10 (CDD on real entities)
 *   - FATF Rec 12 (PEP screening)
 *   - Cabinet Res 134/2025 Art.14 (EDD triggers)
 *   - FDL No.10/2025 Art.35 (TFS across all authoritative lists)
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ExternalQuery {
  name: string;
  birthYear?: number;
  nationality?: string;
}

export type LookupTransport<TResult> = (query: ExternalQuery) => Promise<TResult>;

// ---------------------------------------------------------------------------
// #81 realTimeSanctionsApi
// ---------------------------------------------------------------------------

export interface SanctionsApiResult {
  provider: string;
  hits: ReadonlyArray<{
    listName: string;
    matchedName: string;
    matchScore: number;
    matchedFields: readonly string[];
  }>;
  queriedAt: string;
}

export async function lookupRealTimeSanctions(
  query: ExternalQuery,
  transport: LookupTransport<SanctionsApiResult>
): Promise<SanctionsApiResult> {
  return transport(query);
}

export function createInMemorySanctionsFake(
  fixtures: ReadonlyArray<{
    name: string;
    listName: string;
    matchScore: number;
  }>
): LookupTransport<SanctionsApiResult> {
  return async (query) => {
    const needle = query.name.toLowerCase();
    const hits = fixtures
      .filter((f) => f.name.toLowerCase().includes(needle) || needle.includes(f.name.toLowerCase()))
      .map((f) => ({
        listName: f.listName,
        matchedName: f.name,
        matchScore: f.matchScore,
        matchedFields: ['name'],
      }));
    return {
      provider: 'in-memory-fake',
      hits,
      queriedAt: new Date().toISOString(),
    };
  };
}

// ---------------------------------------------------------------------------
// #82 pepDatabaseConnector
// ---------------------------------------------------------------------------

export interface PepResult {
  provider: string;
  isPep: boolean;
  pepType?: 'domestic' | 'foreign' | 'international_org' | 'family' | 'close_associate';
  role?: string;
  country?: string;
  sourceUrl?: string;
}

export async function lookupPep(
  query: ExternalQuery,
  transport: LookupTransport<PepResult>
): Promise<PepResult> {
  return transport(query);
}

export function createInMemoryPepFake(
  fixtures: ReadonlyArray<{
    name: string;
    pepType: PepResult['pepType'];
    role: string;
    country: string;
  }>
): LookupTransport<PepResult> {
  return async (query) => {
    const match = fixtures.find((f) => f.name.toLowerCase() === query.name.toLowerCase());
    if (match) {
      return {
        provider: 'in-memory-fake',
        isPep: true,
        pepType: match.pepType,
        role: match.role,
        country: match.country,
      };
    }
    return { provider: 'in-memory-fake', isPep: false };
  };
}

// ---------------------------------------------------------------------------
// #83 fatfGreyListTimeSeries
// ---------------------------------------------------------------------------

export interface FatfListEntry {
  country: string; // ISO-3166 alpha-2
  list: 'grey' | 'black';
  from: string; // ISO date
  to?: string; // ISO date; undefined = still listed
  reason?: string;
}

export function isCountryListedAt(
  entries: readonly FatfListEntry[],
  country: string,
  atIso: string
): FatfListEntry | null {
  const target = Date.parse(atIso);
  if (!Number.isFinite(target)) return null;
  for (const e of entries) {
    if (e.country !== country) continue;
    const from = Date.parse(e.from);
    const to = e.to ? Date.parse(e.to) : Infinity;
    if (target >= from && target <= to) return e;
  }
  return null;
}

export function summariseCountryHistory(
  entries: readonly FatfListEntry[],
  country: string
): { totalListed: number; currentlyListed: boolean; entries: FatfListEntry[] } {
  const filtered = entries.filter((e) => e.country === country);
  return {
    totalListed: filtered.length,
    currentlyListed: filtered.some((e) => !e.to),
    entries: filtered,
  };
}

// ---------------------------------------------------------------------------
// #84 companiesHouseConnector
// ---------------------------------------------------------------------------

export interface CompanyRecord {
  companyNumber: string;
  name: string;
  jurisdiction: string;
  status: 'active' | 'dissolved' | 'suspended';
  directors?: readonly string[];
  parents?: readonly string[];
  subsidiaries?: readonly string[];
}

export async function lookupCompany(
  companyNumber: string,
  transport: (n: string) => Promise<CompanyRecord | null>
): Promise<CompanyRecord | null> {
  return transport(companyNumber);
}

export function createInMemoryCompaniesFake(
  fixtures: readonly CompanyRecord[]
): (n: string) => Promise<CompanyRecord | null> {
  const byNumber = new Map(fixtures.map((f) => [f.companyNumber, f]));
  return async (n) => byNumber.get(n) ?? null;
}

// ---------------------------------------------------------------------------
// #85 icijOffshoreLeaksLookup
// ---------------------------------------------------------------------------

export interface OffshoreLeakHit {
  leak: 'panama' | 'pandora' | 'paradise' | 'bahamas' | 'offshore';
  entityName: string;
  role: string;
  jurisdictions: readonly string[];
}

export async function lookupOffshoreLeaks(
  query: ExternalQuery,
  transport: LookupTransport<readonly OffshoreLeakHit[]>
): Promise<readonly OffshoreLeakHit[]> {
  return transport(query);
}

export function createInMemoryOffshoreFake(
  fixtures: readonly OffshoreLeakHit[]
): LookupTransport<readonly OffshoreLeakHit[]> {
  return async (query) => {
    const needle = query.name.toLowerCase();
    return fixtures.filter((f) => f.entityName.toLowerCase().includes(needle));
  };
}

// ---------------------------------------------------------------------------
// #86 occrpAlephLookup
// ---------------------------------------------------------------------------

export interface AlephHit {
  entityName: string;
  source: string;
  tags: readonly string[];
  alephUrl?: string;
}

export async function lookupAleph(
  query: ExternalQuery,
  transport: LookupTransport<readonly AlephHit[]>
): Promise<readonly AlephHit[]> {
  return transport(query);
}

export function createInMemoryAlephFake(
  fixtures: readonly AlephHit[]
): LookupTransport<readonly AlephHit[]> {
  return async (query) => {
    const needle = query.name.toLowerCase();
    return fixtures.filter((f) => f.entityName.toLowerCase().includes(needle));
  };
}
