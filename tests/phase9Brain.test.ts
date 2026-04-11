/**
 * Tests for Phase 9 brain ultrathink subsystems.
 */
import { describe, it, expect } from 'vitest';

import {
  verifyInvariants,
  CANONICAL_INVARIANTS,
  type Transition,
  type Invariant,
  type BrainStateForVerification,
} from '@/services/formalInvariantVerifier';
import {
  commitScreening,
  verifyScreeningReveal,
  selectiveDisclosure,
} from '@/services/zkComplianceAttestation';
import {
  NeuroSymbolicReasoner,
  atomKey,
  CANONICAL_CLAUSES,
} from '@/services/neuroSymbolicReasoner';
import { detectAdversarial } from '@/services/adversarialMlDetector';
import { checkKycConsistency } from '@/services/semanticKycConsistencyChecker';
import { analyseOwnershipMotifs } from '@/services/graphMotifUboAnalyzer';
import {
  scheduleObligations,
  CANONICAL_OBLIGATIONS,
} from '@/services/regulatoryObligationScheduler';
import { detectDeepfakeDocument } from '@/services/deepfakeDocumentDetector';

// ---------------------------------------------------------------------------
// #95 formalInvariantVerifier
// ---------------------------------------------------------------------------

describe('formalInvariantVerifier', () => {
  type SimpleState = { x: number };
  const increment: Transition<SimpleState> = {
    name: 'inc',
    apply: (s) => (s.x < 5 ? [{ x: s.x + 1 }] : []),
  };
  const nonNegative: Invariant<SimpleState> = {
    id: 'INV-NN',
    name: 'x >= 0',
    citation: 'test',
    check: (s) => s.x >= 0,
  };
  const bounded: Invariant<SimpleState> = {
    id: 'INV-BD',
    name: 'x <= 5',
    citation: 'test',
    check: (s) => s.x <= 5,
  };

  it('proves both invariants exhaustively', () => {
    const report = verifyInvariants({
      initial: { x: 0 },
      transitions: [increment],
      invariants: [nonNegative, bounded],
    });
    expect(report.passed).toBe(true);
    expect(report.mode).toBe('exhaustive');
    expect(report.statesExplored).toBe(6); // 0..5
  });

  it('reports violation with trace', () => {
    const violating: Invariant<SimpleState> = {
      id: 'INV-V',
      name: 'x < 3',
      citation: 'test',
      check: (s) => s.x < 3,
    };
    const report = verifyInvariants({
      initial: { x: 0 },
      transitions: [increment],
      invariants: [violating],
    });
    expect(report.passed).toBe(false);
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it('canonical invariants schema is intact', () => {
    expect(CANONICAL_INVARIANTS.length).toBe(4);
    for (const inv of CANONICAL_INVARIANTS) {
      expect(inv.citation.length).toBeGreaterThan(0);
    }
  });

  it('verdict monotonicity invariant catches downgrades', () => {
    const monotonicity = CANONICAL_INVARIANTS.find((i) => i.id === 'I1')!;
    const violating: BrainStateForVerification & {
      previousVerdict?: 'pass' | 'flag' | 'escalate' | 'freeze';
    } = {
      verdict: 'pass',
      previousVerdict: 'freeze',
      requiresHumanReview: true,
      auditLogLength: 5,
      outboundMessageContainsTippingOff: false,
    };
    expect(monotonicity.check(violating)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #96 zkComplianceAttestation
// ---------------------------------------------------------------------------

describe('zkComplianceAttestation', () => {
  it('commit hides subject until reveal', () => {
    const { commitment } = commitScreening({
      subjectId: 'SECRET-123',
      screenedAtIso: '2026-04-11T09:00:00Z',
      listName: 'OFAC',
    });
    expect(commitment.commitHash).not.toContain('SECRET-123');
    expect(commitment.commitHash.length).toBe(128); // SHA-3-512 hex
  });

  it('reveal verifies against commitment', () => {
    const { commitment, reveal } = commitScreening({
      subjectId: 'SUBJ-1',
      screenedAtIso: '2026-04-11T09:00:00Z',
      listName: 'UN',
    });
    const result = verifyScreeningReveal(commitment, reveal);
    expect(result.valid).toBe(true);
  });

  it('altered subjectId fails verification', () => {
    const { commitment, reveal } = commitScreening({
      subjectId: 'SUBJ-1',
      screenedAtIso: '2026-04-11T09:00:00Z',
      listName: 'UN',
    });
    const tamperedReveal = { ...reveal, subjectId: 'SUBJ-2' };
    const result = verifyScreeningReveal(commitment, tamperedReveal);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('different salts produce different commits for same subject', () => {
    const a = commitScreening({
      subjectId: 'X',
      screenedAtIso: '2026-04-11T09:00:00Z',
      listName: 'UN',
    });
    const b = commitScreening({
      subjectId: 'X',
      screenedAtIso: '2026-04-11T09:00:00Z',
      listName: 'UN',
    });
    expect(a.commitment.commitHash).not.toBe(b.commitment.commitHash);
  });

  it('selectiveDisclosure finds matches', () => {
    const r1 = commitScreening({
      subjectId: 'Alice',
      screenedAtIso: '2026-04-11T09:00:00Z',
      listName: 'UN',
    }).reveal;
    const r2 = commitScreening({
      subjectId: 'Bob',
      screenedAtIso: '2026-04-11T09:00:00Z',
      listName: 'UN',
    }).reveal;
    const disc = selectiveDisclosure({ subjectId: 'Alice' }, [r1, r2]);
    expect(disc.matchCount).toBe(1);
    expect(disc.matches[0].subjectId).toBe('Alice');
  });
});

// ---------------------------------------------------------------------------
// #97 neuroSymbolicReasoner
// ---------------------------------------------------------------------------

describe('neuroSymbolicReasoner', () => {
  it('proves a simple fact directly', () => {
    const r = new NeuroSymbolicReasoner();
    r.addFact({ predicate: 'sanctioned', args: ['Alice'] });
    const q = r.query({ predicate: 'sanctioned', args: ['Alice'] });
    expect(q.proven).toBe(true);
    expect(q.proof?.tree.derivedBy).toBe('fact');
  });

  it('derives from a Horn clause', () => {
    const r = new NeuroSymbolicReasoner();
    r.addFact({ predicate: 'sanctioned', args: ['Alice'] });
    r.addFact({ predicate: 'ubo_of', args: ['Alice', 'AcmeCo'] });
    r.addClause({
      id: 'R1',
      head: { predicate: 'requires_freeze', args: ['AcmeCo'] },
      body: [
        { predicate: 'sanctioned', args: ['Alice'] },
        { predicate: 'ubo_of', args: ['Alice', 'AcmeCo'] },
      ],
    });
    const q = r.query({ predicate: 'requires_freeze', args: ['AcmeCo'] });
    expect(q.proven).toBe(true);
    expect(q.proof?.clauseChain).toContain('R1');
  });

  it('returns proven=false for unprovable query', () => {
    const r = new NeuroSymbolicReasoner();
    const q = r.query({ predicate: 'nothing', args: ['X'] });
    expect(q.proven).toBe(false);
  });

  it('atomKey produces canonical form', () => {
    expect(atomKey({ predicate: 'foo', args: ['a', 'b'] })).toBe('foo(a,b)');
  });

  it('canonical clauses have citations', () => {
    expect(CANONICAL_CLAUSES.length).toBeGreaterThan(0);
    for (const c of CANONICAL_CLAUSES) {
      expect(c.citation).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// #98 adversarialMlDetector
// ---------------------------------------------------------------------------

describe('adversarialMlDetector', () => {
  it('flags zero-width unicode as critical', () => {
    const r = detectAdversarial('Normal\u200btext\u200cwith\u200dinvisible');
    expect(r.clean).toBe(false);
    expect(r.topSeverity).toBe('critical');
  });

  it('flags Cyrillic-Latin homoglyphs', () => {
    // Latin "John" with Cyrillic 'o' (U+043E)
    const r = detectAdversarial('J\u043Ehn Smith');
    expect(r.findings.some((f) => f.id === 'ADV-02')).toBe(true);
  });

  it('clean Latin text passes', () => {
    const r = detectAdversarial('John Smith sent AED 5000 to Alice');
    expect(r.clean).toBe(true);
  });

  it('flags mixed-script words', () => {
    // Latin "Alice" + Cyrillic "ице" in one token (should match mixed word pattern)
    const r = detectAdversarial('Al\u0438\u0446\u0435');
    expect(r.findings.some((f) => f.id === 'ADV-03')).toBe(true);
  });

  it('sanitises homoglyphs to Latin', () => {
    const r = detectAdversarial('J\u043Ehn');
    expect(r.sanitised).toBe('John');
  });
});

// ---------------------------------------------------------------------------
// #99 semanticKycConsistencyChecker
// ---------------------------------------------------------------------------

describe('semanticKycConsistencyChecker', () => {
  it('clean documents pass', () => {
    const r = checkKycConsistency([
      {
        docId: 'D1',
        docType: 'passport',
        fields: { legalName: 'Alice Smith', dateOfBirth: '1985-06-15', issuingCountry: 'US' },
      },
      {
        docId: 'D2',
        docType: 'ubo_declaration',
        fields: { legalName: 'Alice Smith', dateOfBirth: '1985-06-15', nationality: 'US' },
      },
    ]);
    expect(r.clean).toBe(true);
  });

  it('flags name mismatch as critical', () => {
    const r = checkKycConsistency([
      { docId: 'D1', docType: 'passport', fields: { legalName: 'Alice Smith' } },
      { docId: 'D2', docType: 'ubo_declaration', fields: { legalName: 'Bob Johnson' } },
    ]);
    expect(r.clean).toBe(false);
    expect(r.topSeverity).toBe('critical');
  });

  it('flags DoB mismatch', () => {
    const r = checkKycConsistency([
      { docId: 'D1', docType: 'passport', fields: { dateOfBirth: '1985-06-15' } },
      { docId: 'D2', docType: 'ubo_declaration', fields: { dateOfBirth: '1990-01-01' } },
    ]);
    expect(r.findings.some((f) => f.field === 'dateOfBirth')).toBe(true);
  });

  it('flags nationality vs issuing country mismatch', () => {
    const r = checkKycConsistency([
      { docId: 'D1', docType: 'passport', fields: { issuingCountry: 'IR' } },
      { docId: 'D2', docType: 'ubo_declaration', fields: { nationality: 'AE' } },
    ]);
    expect(r.findings.some((f) => f.field === 'nationality')).toBe(true);
  });

  it('flags income/volume mismatch', () => {
    const r = checkKycConsistency([
      {
        docId: 'D1',
        docType: 'source_of_funds',
        fields: { annualIncomeAed: 100_000 },
      },
      {
        docId: 'D2',
        docType: 'bank_statement',
        fields: { monthlyTransactionVolumeAed: 50_000 },
      },
    ]);
    // Annual volume 600k vs 100k income → 6× → flagged
    expect(r.findings.some((f) => f.field === 'incomeVsVolume')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #100 graphMotifUboAnalyzer
// ---------------------------------------------------------------------------

describe('graphMotifUboAnalyzer', () => {
  it('detects cumulative threshold crossing', () => {
    const r = analyseOwnershipMotifs([
      { ownerId: 'A', targetId: 'T', percentage: 20 },
      { ownerId: 'B', targetId: 'T', percentage: 20 },
      { ownerId: 'C', targetId: 'T', percentage: 20 },
    ]);
    expect(r.findings.some((f) => f.motifType === 'cumulative_threshold')).toBe(true);
  });

  it('detects K-star pattern', () => {
    const r = analyseOwnershipMotifs([
      { ownerId: 'A', targetId: 'T1', percentage: 10 },
      { ownerId: 'A', targetId: 'T2', percentage: 10 },
      { ownerId: 'A', targetId: 'T3', percentage: 10 },
      { ownerId: 'A', targetId: 'T4', percentage: 10 },
    ]);
    expect(r.findings.some((f) => f.motifType === 'k_star')).toBe(true);
  });

  it('detects daisy chain', () => {
    const r = analyseOwnershipMotifs([
      { ownerId: 'A', targetId: 'B', percentage: 60 },
      { ownerId: 'B', targetId: 'C', percentage: 60 },
      { ownerId: 'C', targetId: 'D', percentage: 60 },
    ]);
    expect(r.findings.some((f) => f.motifType === 'daisy_chain')).toBe(true);
  });

  it('clean ownership has no findings', () => {
    const r = analyseOwnershipMotifs([{ ownerId: 'A', targetId: 'T', percentage: 100 }]);
    expect(r.findings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #101 regulatoryObligationScheduler
// ---------------------------------------------------------------------------

describe('regulatoryObligationScheduler', () => {
  it('ships at least 10 canonical obligations', () => {
    expect(CANONICAL_OBLIGATIONS.length).toBeGreaterThanOrEqual(10);
  });

  it('schedules with empty history → everything overdue', () => {
    const scheduled = scheduleObligations({
      lastCompletedAt: {},
      now: new Date('2026-04-11T00:00:00Z'),
    });
    expect(scheduled.every((s) => s.status === 'overdue')).toBe(true);
  });

  it('ready obligations have dueAt in future', () => {
    const now = new Date('2026-04-11T00:00:00Z');
    const lastCompletedAt: Record<string, string> = {};
    for (const ob of CANONICAL_OBLIGATIONS) {
      lastCompletedAt[ob.id] = '2026-04-10T00:00:00Z';
    }
    const scheduled = scheduleObligations({ lastCompletedAt, now });
    expect(scheduled.every((s) => Date.parse(s.dueAt) > now.getTime())).toBe(true);
  });

  it('every obligation has a citation', () => {
    for (const ob of CANONICAL_OBLIGATIONS) {
      expect(ob.citation.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// #102 deepfakeDocumentDetector
// ---------------------------------------------------------------------------

describe('deepfakeDocumentDetector', () => {
  it('flags passport missing MRZ as critical', () => {
    const r = detectDeepfakeDocument({
      docType: 'passport',
      extractedText: 'JOHN SMITH, USA, DOB 1985',
      metadata: { hasMrzLines: false },
    });
    expect(r.findings.some((f) => f.id === 'DF-04')).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(35);
  });

  it('flags Emirates ID without 784 prefix', () => {
    const r = detectDeepfakeDocument({
      docType: 'emirates_id',
      extractedText: 'ID: 123-4567-8901234-5',
    });
    expect(r.findings.some((f) => f.id === 'DF-05')).toBe(true);
  });

  it('LLM filler phrases boost score', () => {
    const r = detectDeepfakeDocument({
      docType: 'proof_of_address',
      extractedText:
        'To whom it may concern, I hereby certify that in accordance with the regulations, rest assured the information is accurate. Please find attached.',
    });
    expect(r.findings.some((f) => f.id === 'DF-01')).toBe(true);
  });

  it('clean document is likely_genuine', () => {
    const r = detectDeepfakeDocument({
      docType: 'proof_of_address',
      extractedText: 'Electricity bill Apt 4B Building 2 Dubai Marina total 532.47',
      metadata: { hasScanArtefacts: true, fontVariability: 0.5 },
    });
    expect(r.verdict).toBe('likely_genuine');
  });

  it('passport with MRZ + natural text is likely_genuine', () => {
    const r = detectDeepfakeDocument({
      docType: 'passport',
      extractedText: 'Smith John Born 1985 Nationality USA Passport 123456789',
      metadata: { hasMrzLines: true, hasScanArtefacts: true, fontVariability: 0.4 },
    });
    expect(r.verdict).toBe('likely_genuine');
  });
});
