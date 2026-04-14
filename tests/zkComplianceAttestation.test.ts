/**
 * Zero-knowledge compliance attestation tests — closes deep-review C2.
 *
 * Verifies:
 *   - Commit → reveal round-trip succeeds.
 *   - Tampered commit hash is rejected.
 *   - Tampered subject / timestamp / list is rejected.
 *   - Salt randomness: two commits to the same event produce different
 *     commit hashes (hiding property).
 *   - Selective disclosure only returns matching priors.
 *
 * Regulatory basis: FDL Art.24, FDL Art.29, FATF Rec 40.
 */
import { describe, it, expect } from "vitest";
import {
  commitScreening,
  verifyScreeningReveal,
  selectiveDisclosure,
  type ScreeningEvent,
  type ScreeningReveal,
} from "../src/services/zkComplianceAttestation";

function makeEvent(overrides: Partial<ScreeningEvent> = {}): ScreeningEvent {
  return {
    subjectId: "customer-42",
    screenedAtIso: "2026-04-14T10:00:00.000Z",
    listName: "OFAC",
    matchScore: 0,
    ...overrides,
  };
}

describe("commitScreening", () => {
  it("produces a commitment and a reveal", () => {
    const event = makeEvent();
    const { commitment, reveal } = commitScreening(event);

    expect(commitment.commitHash).toMatch(/^[0-9a-f]{128}$/);
    expect(commitment.listName).toBe("OFAC");
    expect(commitment.screenedAtIso).toBe(event.screenedAtIso);
    expect(commitment.attestationPublishedAtIso).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );

    expect(reveal.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(reveal.subjectId).toBe("customer-42");
    expect(reveal.listName).toBe("OFAC");
  });

  it("two commits to the same event produce different hashes (salt randomness)", () => {
    const event = makeEvent();
    const c1 = commitScreening(event);
    const c2 = commitScreening(event);
    expect(c1.commitment.commitHash).not.toBe(c2.commitment.commitHash);
    expect(c1.reveal.salt).not.toBe(c2.reveal.salt);
  });
});

describe("verifyScreeningReveal — happy path", () => {
  it("accepts a matching reveal", () => {
    const { commitment, reveal } = commitScreening(makeEvent());
    const result = verifyScreeningReveal(commitment, reveal);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("accepts reveals across all six list names", () => {
    const lists = ["UN", "OFAC", "EU", "UK", "UAE", "EOCN"] as const;
    for (const listName of lists) {
      const { commitment, reveal } = commitScreening(makeEvent({ listName }));
      expect(verifyScreeningReveal(commitment, reveal).valid).toBe(true);
    }
  });
});

describe("verifyScreeningReveal — rejection paths", () => {
  it("rejects listName mismatch", () => {
    const { commitment, reveal } = commitScreening(
      makeEvent({ listName: "OFAC" })
    );
    const forged: ScreeningReveal = { ...reveal, listName: "UN" };
    const result = verifyScreeningReveal(commitment, forged);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/listName/);
  });

  it("rejects screenedAtIso mismatch", () => {
    const { commitment, reveal } = commitScreening(makeEvent());
    const forged: ScreeningReveal = {
      ...reveal,
      screenedAtIso: "2099-01-01T00:00:00.000Z",
    };
    const result = verifyScreeningReveal(commitment, forged);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/screenedAtIso/);
  });

  it("rejects tampered subject (subject swap attack)", () => {
    // Two different subjects screened at exactly the same moment.
    const e1 = makeEvent({ subjectId: "alice" });
    const e2 = makeEvent({ subjectId: "bob" });
    const { commitment: c1 } = commitScreening(e1);
    const { reveal: r2 } = commitScreening(e2);

    // Attempt: claim alice's commitment came from bob's reveal.
    const attack: ScreeningReveal = {
      salt: r2.salt,
      subjectId: "alice",
      screenedAtIso: r2.screenedAtIso,
      listName: r2.listName,
    };
    const result = verifyScreeningReveal(c1, attack);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/hash|mismatch/i);
  });

  it("rejects tampered salt", () => {
    const { commitment, reveal } = commitScreening(makeEvent());
    const forged: ScreeningReveal = {
      ...reveal,
      salt: "0".repeat(64),
    };
    const result = verifyScreeningReveal(commitment, forged);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/hash/);
  });
});

describe("selectiveDisclosure", () => {
  it("returns zero matches when subject is not in priors", () => {
    const priors: ScreeningReveal[] = [
      commitScreening(makeEvent({ subjectId: "alice" })).reveal,
      commitScreening(makeEvent({ subjectId: "bob" })).reveal,
    ];
    const result = selectiveDisclosure({ subjectId: "charlie" }, priors);
    expect(result.matchCount).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  it("returns only the matching priors for the suspect", () => {
    const priors: ScreeningReveal[] = [
      commitScreening(makeEvent({ subjectId: "alice" })).reveal,
      commitScreening(makeEvent({ subjectId: "bob", listName: "UN" })).reveal,
      commitScreening(makeEvent({ subjectId: "bob", listName: "EU" })).reveal,
      commitScreening(makeEvent({ subjectId: "charlie" })).reveal,
    ];
    const result = selectiveDisclosure({ subjectId: "bob" }, priors);
    expect(result.matchCount).toBe(2);
    expect(result.matches.every((m) => m.subjectId === "bob")).toBe(true);
  });

  it("does not leak non-matching priors in the returned payload", () => {
    const priors: ScreeningReveal[] = [
      commitScreening(makeEvent({ subjectId: "alice" })).reveal,
      commitScreening(makeEvent({ subjectId: "bob" })).reveal,
    ];
    const result = selectiveDisclosure({ subjectId: "alice" }, priors);
    const leaked = result.matches.find((m) => m.subjectId === "bob");
    expect(leaked).toBeUndefined();
  });
});
