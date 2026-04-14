/**
 * Regulatory drift watchdog tests.
 *
 * Covers:
 *   - captureRegulatoryBaseline produces an immutable snapshot
 *   - selfCheck against its own snapshot is always clean
 *   - checkRegulatoryDrift detects numeric constant drift
 *   - checkRegulatoryDrift detects boolean constant drift
 *   - checkRegulatoryDrift detects a version-only bump
 *   - Top severity reflects the worst finding
 *   - Missing baseline values report as "new constant"
 *   - Findings are sorted by severity desc
 */
import { describe, it, expect } from "vitest";
import {
  captureRegulatoryBaseline,
  checkRegulatoryDrift,
  selfCheck,
  getTrackedConstants,
  type RegulatoryBaseline,
} from "../src/services/regulatoryDriftWatchdog";

describe("getTrackedConstants", () => {
  it("returns a non-empty list with every key, regulatory, severity", () => {
    const list = getTrackedConstants();
    expect(list.length).toBeGreaterThanOrEqual(9);
    for (const c of list) {
      expect(c.key.length).toBeGreaterThan(0);
      expect(c.regulatory.length).toBeGreaterThan(0);
      expect(["low", "medium", "high", "critical"]).toContain(c.severity);
    }
  });

  it("has no duplicate keys", () => {
    const keys = getTrackedConstants().map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("captureRegulatoryBaseline", () => {
  it("produces a snapshot with version + values + iso timestamp", () => {
    const baseline = captureRegulatoryBaseline();
    expect(baseline.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(baseline.capturedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(baseline.values).length).toBeGreaterThanOrEqual(9);
  });

  it("values map contains every tracked key", () => {
    const baseline = captureRegulatoryBaseline();
    for (const c of getTrackedConstants()) {
      expect(baseline.values).toHaveProperty(c.key);
    }
  });
});

describe("selfCheck", () => {
  it("is always clean against its own baseline", () => {
    const report = selfCheck();
    expect(report.clean).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.topSeverity).toBe("none");
    expect(report.versionDrifted).toBe(false);
    expect(report.summary).toMatch(/clean/i);
  });
});

describe("checkRegulatoryDrift — numeric drift", () => {
  it("detects a single numeric constant drift", () => {
    const baseline = captureRegulatoryBaseline();
    // Simulate the MLRO having signed off on the OLD value by mutating
    // the baseline (the watchdog does not mutate the baseline itself).
    const forged: RegulatoryBaseline = {
      ...baseline,
      values: {
        ...baseline.values,
        DPMS_CASH_THRESHOLD_AED: 50_000, // old
      },
    };
    const report = checkRegulatoryDrift(forged);
    expect(report.clean).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].key).toBe("DPMS_CASH_THRESHOLD_AED");
    expect(report.findings[0].previous).toBe(50_000);
    expect(report.findings[0].current).toBe(55_000);
    expect(report.findings[0].delta).toBe(5_000);
    expect(report.findings[0].severity).toBe("critical");
    expect(report.topSeverity).toBe("critical");
  });

  it("detects multiple constants drifting at once", () => {
    const baseline = captureRegulatoryBaseline();
    const forged: RegulatoryBaseline = {
      ...baseline,
      values: {
        ...baseline.values,
        DPMS_CASH_THRESHOLD_AED: 10_000,
        UBO_OWNERSHIP_THRESHOLD_PCT: 0.1,
        STR_FILING_DEADLINE_BUSINESS_DAYS: 999,
      },
    };
    const report = checkRegulatoryDrift(forged);
    expect(report.findings.length).toBeGreaterThanOrEqual(3);
    const keys = report.findings.map((f) => f.key);
    expect(keys).toContain("DPMS_CASH_THRESHOLD_AED");
    expect(keys).toContain("UBO_OWNERSHIP_THRESHOLD_PCT");
    expect(keys).toContain("STR_FILING_DEADLINE_BUSINESS_DAYS");
    // Critical-severity finding must be first after sorting.
    expect(report.findings[0].severity).toBe("critical");
  });
});

describe("checkRegulatoryDrift — boolean drift", () => {
  it("detects EOCN_FREEZE_IMMEDIATELY flipping from false to true", () => {
    const baseline = captureRegulatoryBaseline();
    const forged: RegulatoryBaseline = {
      ...baseline,
      values: {
        ...baseline.values,
        EOCN_FREEZE_IMMEDIATELY: false, // old
      },
    };
    const report = checkRegulatoryDrift(forged);
    const finding = report.findings.find((f) => f.key === "EOCN_FREEZE_IMMEDIATELY");
    expect(finding).toBeDefined();
    expect(finding!.previous).toBe(false);
    expect(finding!.current).toBe(true);
    expect(finding!.delta).toBeNull();
    expect(finding!.severity).toBe("critical");
  });
});

describe("checkRegulatoryDrift — version-only bump", () => {
  it("reports a low-severity finding when only the version string changed", () => {
    const baseline = captureRegulatoryBaseline();
    const forged: RegulatoryBaseline = {
      ...baseline,
      version: "1900-01-01",
    };
    const report = checkRegulatoryDrift(forged);
    expect(report.versionDrifted).toBe(true);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].key).toBe("REGULATORY_CONSTANTS_VERSION");
    expect(report.findings[0].severity).toBe("low");
  });
});

describe("checkRegulatoryDrift — new tracked constant", () => {
  it("reports a missing baseline key as a new constant", () => {
    const baseline = captureRegulatoryBaseline();
    const forged: RegulatoryBaseline = {
      ...baseline,
      values: {
        // Drop DPMS_CASH_THRESHOLD_AED entirely to simulate a brand-new
        // tracked constant that didn't exist in the baseline.
        ...Object.fromEntries(
          Object.entries(baseline.values).filter(
            ([k]) => k !== "DPMS_CASH_THRESHOLD_AED"
          )
        ),
      },
    };
    const report = checkRegulatoryDrift(forged);
    const finding = report.findings.find(
      (f) => f.key === "DPMS_CASH_THRESHOLD_AED"
    );
    expect(finding).toBeDefined();
    expect(finding!.previous).toBeNull();
    expect(finding!.description).toMatch(/new tracked constant/i);
    expect(finding!.severity).toBe("low");
  });
});

describe("checkRegulatoryDrift — sorting", () => {
  it("sorts findings by severity descending", () => {
    const baseline = captureRegulatoryBaseline();
    const forged: RegulatoryBaseline = {
      ...baseline,
      values: {
        ...baseline.values,
        UBO_REVERIFICATION_WORKING_DAYS: 99, // medium
        DPMS_CASH_THRESHOLD_AED: 1, // critical
        STR_FILING_DEADLINE_BUSINESS_DAYS: 100, // high
      },
    };
    const report = checkRegulatoryDrift(forged);
    expect(report.findings[0].severity).toBe("critical");
    expect(report.topSeverity).toBe("critical");
    // The next should be high, then medium.
    const severities = report.findings.map((f) => f.severity);
    const criticalIdx = severities.indexOf("critical");
    const highIdx = severities.indexOf("high");
    const mediumIdx = severities.indexOf("medium");
    expect(criticalIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(mediumIdx);
  });
});

describe("checkRegulatoryDrift — summary", () => {
  it("cites number of findings and version delta when drift detected", () => {
    const baseline = captureRegulatoryBaseline();
    const forged: RegulatoryBaseline = {
      ...baseline,
      version: "1999-01-01",
      values: {
        ...baseline.values,
        DPMS_CASH_THRESHOLD_AED: 1,
      },
    };
    const report = checkRegulatoryDrift(forged);
    expect(report.summary).toMatch(/Regulatory drift/i);
    expect(report.summary).toMatch(/1999-01-01/);
    expect(report.summary).toMatch(/critical/);
  });
});
