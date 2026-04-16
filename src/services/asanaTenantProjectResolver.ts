/**
 * Asana Tenant Project Resolver — Phase 19 W-B (pure compute).
 *
 * Resolves a tenantId → Asana project GID at dispatch time on the
 * server. Replaces the browser-side hardcoded `CUSTOMER_PROJECTS`
 * map in `asana-project-resolver.js` for server-side call paths.
 *
 * The resolver is intentionally free of I/O. Callers provide the
 * three lookup sources (registry, legacy map, default) and this
 * module picks the first hit and returns a typed result.
 * Surface-level wiring into `asana-dispatch.mts` and the
 * orchestrator is a deliberate follow-on so each step is reviewed
 * independently.
 *
 * Design:
 *   - Three tiers of truth:
 *       1. Runtime tenant registry (Netlify Blobs) — the long-term
 *          canonical source, populated by tenant bootstrap.
 *       2. Compiled-in legacy map — mirrors the six tenants shipped
 *          in `asana-project-resolver.js`. Used for tenants
 *          bootstrapped before Phase 19 W-B rolled out.
 *       3. `ASANA_DEFAULT_PROJECT_GID` env var — last-resort safety
 *          net. Never silently routes a known-tenant dispatch to
 *          the default; the default is only returned for explicit
 *          unknown-tenant requests.
 *   - Hard-fail when a known tenant has no registry entry AND no
 *     legacy entry AND no default is provided. A silent route to
 *     a wrong project would cross tenant boundaries, which is
 *     non-negotiable under FDL Art.20 (MLRO visibility — the MLRO
 *     for tenant A cannot see tenant B's queue).
 *   - Two project "kinds" per tenant: `compliance` and `workflow`.
 *     Mirrors the browser-side shape.
 *
 * Regulatory anchor:
 *   FDL No. 10 of 2025 Art.20 — MLRO visibility; no cross-tenant
 *     dispatch.
 *   FDL No. 10 of 2025 Art.29 — no tipping off; cross-tenant
 *     dispatch would expose one tenant's matter to another.
 *   Cabinet Resolution 134/2025 Art.18 — tenant bootstrap produces
 *     the registry rows this resolver consumes.
 */

export type AsanaProjectKind = 'compliance' | 'workflow';

export interface TenantProjectEntry {
  tenantId: string;
  compliance: string;
  workflow: string;
  /** Human-readable name for logs / audit trail. */
  name?: string;
}

/**
 * Source of the resolution. Useful in audit rows so an inspector
 * can see whether the GID came from the authoritative registry,
 * from the legacy hardcoded map, or from the default fallback.
 */
export type ResolutionSource = 'registry' | 'legacy' | 'default';

export interface ResolveSuccess {
  ok: true;
  tenantId: string;
  kind: AsanaProjectKind;
  projectGid: string;
  source: ResolutionSource;
  /** Resolved entity name when available. */
  name?: string;
}

export interface ResolveFailure {
  ok: false;
  tenantId: string;
  kind: AsanaProjectKind;
  reason:
    | 'tenant_not_in_registry_and_no_legacy_entry'
    | 'invalid_tenant_id'
    | 'invalid_project_kind'
    | 'registry_entry_missing_kind';
}

export type ResolveResult = ResolveSuccess | ResolveFailure;

export interface ResolveOptions {
  /** Registry row for the tenant, if one exists. */
  registryEntry?: TenantProjectEntry | null;
  /** Legacy compiled-in map. */
  legacyMap?: Readonly<Record<string, TenantProjectEntry>>;
  /** Default project GID from env — last-resort fallback. */
  defaultProjectGid?: string | null;
  /**
   * Callers may set this to true for an explicit unknown-tenant
   * lookup (for example, a firm-level broadcast task). When true,
   * the resolver returns the default if none of the other sources
   * hit. When false or unset, an unknown tenant is a failure even
   * if a default is configured — the default is never used to
   * mask a missing registry row.
   */
  allowDefaultFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Legacy map (mirrors asana-project-resolver.js)
// ---------------------------------------------------------------------------

/**
 * Six-tenant legacy map, imported from the browser-side file so
 * server-side code does not need the browser file in its module
 * graph. Tenants bootstrapped before Phase 19 W-B rolled out are
 * resolved through this map until they are migrated into the
 * runtime registry.
 *
 * Source of the GID values: `asana-project-resolver.js` at commit
 * where this module was introduced. Any update to that file should
 * be mirrored here in the same PR.
 */
export const LEGACY_TENANT_PROJECTS: Readonly<Record<string, TenantProjectEntry>> = Object.freeze({
  'company-1': {
    tenantId: 'company-1',
    name: 'MADISON JEWELLERY TRADING L.L.C',
    compliance: '1213825539896477',
    workflow: '1213825580399850',
  },
  'company-2': {
    tenantId: 'company-2',
    name: 'NAPLES JEWELLERY TRADING L.L.C',
    compliance: '1213825365472836',
    workflow: '1213825542010518',
  },
  'company-3': {
    tenantId: 'company-3',
    name: 'GRAMALTIN KIYMETLI MADENLER RAFINERI SANAYI VE TICARET ANONIM SIRKETI',
    compliance: '1213838252710765',
    workflow: '1213825541970651',
  },
  'company-4': {
    tenantId: 'company-4',
    name: 'ZOE Precious Metals and Jewelery (FZE)',
    compliance: '1213825578259027',
    workflow: '1213825580398407',
  },
  'company-5': {
    tenantId: 'company-5',
    name: 'FINE GOLD LLC',
    compliance: '1213900474912902',
    workflow: '1213759768596515',
  },
  'company-6': {
    tenantId: 'company-6',
    name: 'FINE GOLD (BRANCH)',
    compliance: '1213900370769721',
    workflow: '1213899469870046',
  },
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidTenantId(id: string | undefined | null): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > 64) return false;
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

function isValidKind(kind: string | undefined): kind is AsanaProjectKind {
  return kind === 'compliance' || kind === 'workflow';
}

function pickFromEntry(entry: TenantProjectEntry, kind: AsanaProjectKind): string {
  return kind === 'compliance' ? entry.compliance : entry.workflow;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a (tenantId, kind) pair to an Asana project GID using the
 * three-tier source chain. Pure compute — no I/O. Callers provide
 * the registry entry (via Netlify Blobs read) before calling.
 */
export function resolveTenantProject(
  tenantId: string,
  kind: AsanaProjectKind,
  options: ResolveOptions = {}
): ResolveResult {
  if (!isValidTenantId(tenantId)) {
    return {
      ok: false,
      tenantId: typeof tenantId === 'string' ? tenantId : '',
      kind,
      reason: 'invalid_tenant_id',
    };
  }
  if (!isValidKind(kind)) {
    return { ok: false, tenantId, kind, reason: 'invalid_project_kind' };
  }

  // Tier 1 — runtime registry (authoritative).
  if (options.registryEntry) {
    const gid = pickFromEntry(options.registryEntry, kind);
    if (!gid) {
      return { ok: false, tenantId, kind, reason: 'registry_entry_missing_kind' };
    }
    return {
      ok: true,
      tenantId,
      kind,
      projectGid: gid,
      source: 'registry',
      name: options.registryEntry.name,
    };
  }

  // Tier 2 — compiled-in legacy map.
  const legacy = options.legacyMap ?? LEGACY_TENANT_PROJECTS;
  const legacyEntry = legacy[tenantId];
  if (legacyEntry) {
    const gid = pickFromEntry(legacyEntry, kind);
    if (gid) {
      return {
        ok: true,
        tenantId,
        kind,
        projectGid: gid,
        source: 'legacy',
        name: legacyEntry.name,
      };
    }
  }

  // Tier 3 — default fallback, only for explicit unknown-tenant
  // calls. Silently routing a known tenant to the default would
  // cross tenant boundaries and is rejected.
  if (options.allowDefaultFallback && options.defaultProjectGid) {
    return {
      ok: true,
      tenantId,
      kind,
      projectGid: options.defaultProjectGid,
      source: 'default',
    };
  }

  return { ok: false, tenantId, kind, reason: 'tenant_not_in_registry_and_no_legacy_entry' };
}
