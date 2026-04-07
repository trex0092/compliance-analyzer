import { describe, it, expect } from "vitest";
import { createChainedEvent, verifyChain, appendToChain } from "../src/utils/auditChain";

describe("auditChain", () => {
  it("creates a genesis event with zero previous hash", async () => {
    const event = await createChainedEvent({
      id: "evt-1", at: "2026-04-07T10:00:00Z", by: "admin", action: "created",
    });
    expect(event.previousHash).toBe("0000000000000000000000000000000000000000000000000000000000000000");
    expect(event.hash).toHaveLength(64);
  });

  it("verifies a valid chain", async () => {
    let chain = await appendToChain([], {
      id: "evt-1", at: "2026-04-07T10:00:00Z", by: "admin", action: "created",
    });
    chain = await appendToChain(chain, {
      id: "evt-2", at: "2026-04-07T11:00:00Z", by: "analyst", action: "screening-completed",
    });
    chain = await appendToChain(chain, {
      id: "evt-3", at: "2026-04-07T12:00:00Z", by: "co", action: "approved",
    });

    const result = await verifyChain(chain);
    expect(result.valid).toBe(true);
    expect(result.checkedCount).toBe(3);
  });

  it("detects tampered event", async () => {
    let chain = await appendToChain([], {
      id: "evt-1", at: "2026-04-07T10:00:00Z", by: "admin", action: "created",
    });
    chain = await appendToChain(chain, {
      id: "evt-2", at: "2026-04-07T11:00:00Z", by: "analyst", action: "approved",
    });

    // Tamper with the first event
    chain[0] = { ...chain[0], by: "hacker" };

    const result = await verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it("detects broken chain link", async () => {
    let chain = await appendToChain([], {
      id: "evt-1", at: "2026-04-07T10:00:00Z", by: "admin", action: "created",
    });
    chain = await appendToChain(chain, {
      id: "evt-2", at: "2026-04-07T11:00:00Z", by: "analyst", action: "updated",
    });

    // Break the chain by changing previousHash
    chain[1] = { ...chain[1], previousHash: "0000000000000000000000000000000000000000000000000000000000000000" };

    const result = await verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("verifies empty chain", async () => {
    const result = await verifyChain([]);
    expect(result.valid).toBe(true);
    expect(result.checkedCount).toBe(0);
  });
});
