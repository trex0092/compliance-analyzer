/**
 * UK OFSI + UAE EOCN sanctions parser tests — closes deep-review gap C1
 * (FDL No.10/2025 Art.35 — must screen against ALL lists).
 *
 * Prior to commit 4 the UK and UAE fetchers returned [] silently; any
 * UK- or UAE-designated entity passed screening undetected, a direct
 * Art.35 violation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseUKOfsiCsv,
  seedUaeSanctionsList,
  fetchUAESanctionsList,
  __clearUaeSanctionsCacheForTests,
  __test__,
} from "../src/services/sanctionsApi";

const { parseCsvRows } = __test__;

describe("parseCsvRows — internal CSV parser", () => {
  it("parses a simple CSV", () => {
    const rows = parseCsvRows("a,b,c\n1,2,3\n");
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    const rows = parseCsvRows('name,addr\n"Smith, John","London, UK"\n');
    expect(rows).toEqual([
      ["name", "addr"],
      ["Smith, John", "London, UK"],
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const rows = parseCsvRows('name\n"He said ""hi"""\n');
    expect(rows).toEqual([["name"], ['He said "hi"']]);
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsvRows("a,b\r\n1,2\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves empty cells", () => {
    const rows = parseCsvRows("a,,c\n");
    expect(rows).toEqual([["a", "", "c"]]);
  });
});

describe("parseUKOfsiCsv — happy paths", () => {
  it("returns [] for empty input", () => {
    expect(parseUKOfsiCsv("")).toEqual([]);
  });

  it("returns [] when the header lacks 'Name 1' column", () => {
    const csv = "Foo,Bar\n1,2\n";
    expect(parseUKOfsiCsv(csv)).toEqual([]);
  });

  it("parses a single primary-only row into an individual", () => {
    const csv = [
      "Name 1,Name 2,Name 3,Name 4,Name 5,Name 6,Group Type,Alias Type,Group ID,Regime,Listed On,Nationality",
      '"Jane","Q","","Smith","","","Individual","Primary Name","G001","Libya","2022-01-15","British"',
    ].join("\n");
    const entries = parseUKOfsiCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("UK-OFSI-G001");
    expect(entries[0].name).toBe("Jane Q Smith");
    expect(entries[0].type).toBe("individual");
    expect(entries[0].listSource).toBe("UK OFSI");
    expect(entries[0].designationRef).toBe("Libya");
    expect(entries[0].listDate).toBe("2022-01-15");
    expect(entries[0].nationality).toBe("British");
  });

  it("groups aliases under the same Group ID", () => {
    const csv = [
      "Name 1,Name 2,Name 3,Name 4,Name 5,Name 6,Group Type,Alias Type,Group ID,Regime,Listed On,Nationality",
      '"Alpha","","","","","","Entity","Primary Name","G007","Syria","2020-01-01",""',
      '"Alpha","Corp","","","","","Entity","AKA","G007","Syria","2020-01-01",""',
      '"A","Ltd","","","","","Entity","AKA","G007","Syria","2020-01-01",""',
    ].join("\n");
    const entries = parseUKOfsiCsv(csv);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.name).toBe("Alpha");
    expect(e.type).toBe("entity");
    expect(e.aliases).toHaveLength(2);
    expect(e.aliases).toContain("Alpha Corp");
    expect(e.aliases).toContain("A Ltd");
  });

  it("separates distinct Group IDs", () => {
    const csv = [
      "Name 1,Name 2,Name 3,Name 4,Name 5,Name 6,Group Type,Alias Type,Group ID,Regime,Listed On,Nationality",
      '"A","","","","","","Individual","Primary Name","G1","Russia","","Russian"',
      '"B","","","","","","Individual","Primary Name","G2","Russia","","Russian"',
    ].join("\n");
    const entries = parseUKOfsiCsv(csv);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id).sort()).toEqual([
      "UK-OFSI-G1",
      "UK-OFSI-G2",
    ]);
  });

  it("tolerates a preamble row before the header (real OFSI format)", () => {
    const csv = [
      "UK OFSI Consolidated List — 2022 format",
      "Name 1,Name 2,Name 3,Name 4,Name 5,Name 6,Group Type,Alias Type,Group ID",
      '"X","","","","","","Entity","Primary Name","GX"',
    ].join("\n");
    const entries = parseUKOfsiCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("UK-OFSI-GX");
  });

  it("skips rows with no name at all", () => {
    const csv = [
      "Name 1,Name 2,Name 3,Name 4,Name 5,Name 6,Group Type,Alias Type,Group ID",
      '"","","","","","","Individual","","G1"',
      '"Named","","","","","","Individual","Primary Name","G2"',
    ].join("\n");
    const entries = parseUKOfsiCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("UK-OFSI-G2");
  });

  it("handles quoted commas inside names", () => {
    const csv = [
      "Name 1,Name 2,Name 3,Name 4,Name 5,Name 6,Group Type,Alias Type,Group ID",
      '"Smith, John","","","","","","Individual","Primary Name","G9"',
    ].join("\n");
    const entries = parseUKOfsiCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Smith, John");
  });
});

describe("UAE EOCN cache — seed / fetch", () => {
  beforeEach(() => {
    __clearUaeSanctionsCacheForTests();
  });

  it("throws when the cache is empty (no silent zero)", async () => {
    await expect(fetchUAESanctionsList()).rejects.toThrow(
      /UAE EOCN sanctions cache is empty/
    );
  });

  it("throws with a regulatory citation so MLRO sees the gap", async () => {
    try {
      await fetchUAESanctionsList();
      throw new Error("should not reach");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/Art\.?35/);
      expect(msg).toMatch(/Cabinet Res 74\/2020/);
    }
  });

  it("returns the seeded entries after seedUaeSanctionsList", async () => {
    const count = seedUaeSanctionsList([
      {
        name: "Test Designated Entity LLC",
        type: "entity",
        designationRef: "UAE-TFS-2025-0001",
      },
      {
        name: "Sanctioned Individual",
        type: "individual",
        aliases: ["Aliased Name"],
      },
    ]);
    expect(count).toBe(2);

    const entries = await fetchUAESanctionsList();
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.listSource === "UAE EOCN")).toBe(true);
    expect(entries[0].id).toMatch(/^UAE-EOCN-/);
    expect(entries[1].aliases).toEqual(["Aliased Name"]);
  });

  it("drops malformed rows during seeding", () => {
    const count = seedUaeSanctionsList([
      { name: "", type: "entity" },
      { name: "Good", type: "entity" },
      // @ts-expect-error intentional bad type for runtime test
      { name: "Bad Type", type: "alien" },
      { name: "Also Good", type: "individual" },
    ]);
    expect(count).toBe(2);
  });

  it("produces immutable cached entries (caller cannot mutate cache)", async () => {
    seedUaeSanctionsList([{ name: "Frozen", type: "entity" }]);
    const first = await fetchUAESanctionsList();
    // Each entry is Object.freeze'd at seed time; mutation throws in
    // strict mode and is a no-op otherwise.
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(() => {
      (first[0] as { name: string }).name = "MUTATED";
    }).toThrow(TypeError);
    const second = await fetchUAESanctionsList();
    expect(second[0].name).toBe("Frozen");
  });

  it("reseeding replaces the prior cache", async () => {
    seedUaeSanctionsList([{ name: "Old", type: "entity" }]);
    seedUaeSanctionsList([
      { name: "New 1", type: "entity" },
      { name: "New 2", type: "individual" },
    ]);
    const entries = await fetchUAESanctionsList();
    expect(entries.map((e) => e.name).sort()).toEqual(["New 1", "New 2"]);
  });
});
