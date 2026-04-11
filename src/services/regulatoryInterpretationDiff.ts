/**
 * Regulatory Interpretation Diff — subsystem #80 (Phase 7 Cluster J).
 *
 * When a new circular drops (MoE, EOCN, CBUAE, LBMA), this module
 * diffs it against the prior interpretation and flags which
 * subsystems + clamps + thresholds are affected. Powers the
 * `/regulatory-update` skill.
 *
 * The diff is token-level on the section-by-section text of the
 * circular plus a mapping from keywords → affected subsystems.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review before change)
 *   - MoE Circular 08/AML/2021 (quarterly updates)
 *   - FDL No.10/2025 Art.20-21 (CO duty of care to stay current)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InterpretationSection {
  heading: string;
  body: string;
}

export interface Interpretation {
  circular: string; // e.g. 'MoE Circular 08/AML/2021'
  publishedAt: string;
  sections: readonly InterpretationSection[];
}

export interface AffectedSubsystem {
  subsystem: string;
  keyword: string;
  section: string;
  changeType: 'added' | 'removed' | 'modified';
}

export interface InterpretationDiffReport {
  circular: string;
  oldVersion: string;
  newVersion: string;
  addedSections: string[];
  removedSections: string[];
  modifiedSections: string[];
  affectedSubsystems: AffectedSubsystem[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Keyword → subsystem map
// ---------------------------------------------------------------------------

const KEYWORD_MAP: ReadonlyArray<{ keyword: RegExp; subsystem: string }> = [
  { keyword: /structur(ing|ed)/i, subsystem: 'transactionAnomaly/structuring' },
  { keyword: /\bUBO\b|beneficial\s+owner/i, subsystem: 'uboGraph' },
  { keyword: /sanctions?/i, subsystem: 'crossListSanctionsDedupe' },
  { keyword: /PEP|politically\s+exposed/i, subsystem: 'pepDatabaseConnector' },
  { keyword: /STR|SAR|suspicious\s+transaction/i, subsystem: 'strNarrativeGrader' },
  { keyword: /threshold/i, subsystem: 'clampPolicy' },
  { keyword: /gold|bullion|refiner|LBMA/i, subsystem: 'goldOriginTracer' },
  { keyword: /crypto|VASP|virtual\s+asset/i, subsystem: 'vaspWalletScoring' },
  { keyword: /freeze|EOCN/i, subsystem: 'weaponizedBrain/freeze-clamp' },
  { keyword: /four[- ]?eyes?/i, subsystem: 'fourEyesSubtasks' },
  { keyword: /tipping[- ]off/i, subsystem: 'tippingOffLinter' },
  { keyword: /CDD|customer\s+due\s+diligence/i, subsystem: 'continuousCddScheduler' },
  { keyword: /adverse\s+media/i, subsystem: 'adverseMediaRanker' },
];

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function diffInterpretations(
  prev: Interpretation,
  next: Interpretation
): InterpretationDiffReport {
  const prevHeadings = new Set(prev.sections.map((s) => s.heading));
  const nextHeadings = new Set(next.sections.map((s) => s.heading));

  const addedSections: string[] = [];
  const removedSections: string[] = [];
  const modifiedSections: string[] = [];

  for (const h of nextHeadings) {
    if (!prevHeadings.has(h)) addedSections.push(h);
  }
  for (const h of prevHeadings) {
    if (!nextHeadings.has(h)) removedSections.push(h);
  }
  for (const nextSection of next.sections) {
    const prevSection = prev.sections.find((p) => p.heading === nextSection.heading);
    if (prevSection && normalise(prevSection.body) !== normalise(nextSection.body)) {
      modifiedSections.push(nextSection.heading);
    }
  }

  const affectedSubsystems: AffectedSubsystem[] = [];
  const checkSection = (
    section: InterpretationSection,
    changeType: AffectedSubsystem['changeType']
  ) => {
    for (const entry of KEYWORD_MAP) {
      if (entry.keyword.test(section.body) || entry.keyword.test(section.heading)) {
        affectedSubsystems.push({
          subsystem: entry.subsystem,
          keyword: entry.keyword.source,
          section: section.heading,
          changeType,
        });
      }
    }
  };

  for (const h of addedSections) {
    const sec = next.sections.find((s) => s.heading === h);
    if (sec) checkSection(sec, 'added');
  }
  for (const h of removedSections) {
    const sec = prev.sections.find((s) => s.heading === h);
    if (sec) checkSection(sec, 'removed');
  }
  for (const h of modifiedSections) {
    const sec = next.sections.find((s) => s.heading === h);
    if (sec) checkSection(sec, 'modified');
  }

  const narrative =
    addedSections.length + removedSections.length + modifiedSections.length === 0
      ? `Regulatory interpretation diff: no changes detected between versions.`
      : `Regulatory interpretation diff: ${addedSections.length} added, ` +
        `${removedSections.length} removed, ${modifiedSections.length} modified. ` +
        `${affectedSubsystems.length} subsystem reference(s) affected.`;

  return {
    circular: next.circular,
    oldVersion: prev.publishedAt,
    newVersion: next.publishedAt,
    addedSections,
    removedSections,
    modifiedSections,
    affectedSubsystems,
    narrative,
  };
}
