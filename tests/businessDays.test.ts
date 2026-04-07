import { describe, it, expect } from "vitest";
import {
  isBusinessDay,
  addBusinessDays,
  countBusinessDays,
  checkDeadline,
  checkEOCNDeadline,
} from "../src/utils/businessDays";

describe("isBusinessDay", () => {
  it("Monday is a business day", () => {
    expect(isBusinessDay(new Date("2026-04-06"))).toBe(true); // Monday
  });

  it("Friday is a business day", () => {
    expect(isBusinessDay(new Date("2026-04-10"))).toBe(true); // Friday
  });

  it("Saturday is NOT a business day", () => {
    expect(isBusinessDay(new Date("2026-04-11"))).toBe(false); // Saturday
  });

  it("Sunday is NOT a business day", () => {
    expect(isBusinessDay(new Date("2026-04-12"))).toBe(false); // Sunday
  });

  it("UAE National Day is NOT a business day", () => {
    expect(isBusinessDay(new Date("2026-12-02"))).toBe(false);
  });

  it("New Year's Day is NOT a business day", () => {
    expect(isBusinessDay(new Date("2026-01-01"))).toBe(false);
  });
});

describe("addBusinessDays", () => {
  it("adds 5 business days (Mon → Mon, skipping weekend)", () => {
    const start = new Date("2026-04-06"); // Monday
    const result = addBusinessDays(start, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-13"); // Next Monday
  });

  it("adds 10 business days for STR deadline", () => {
    const start = new Date("2026-04-06"); // Monday
    const result = addBusinessDays(start, 10);
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-20"); // Two Mondays later
  });

  it("adds 1 business day from Friday → Monday", () => {
    const start = new Date("2026-04-10"); // Friday
    const result = addBusinessDays(start, 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-13"); // Monday
  });
});

describe("countBusinessDays", () => {
  it("counts 5 business days in a week (Mon-Fri)", () => {
    const start = new Date("2026-04-06"); // Monday
    const end = new Date("2026-04-10"); // Friday
    expect(countBusinessDays(start, end)).toBe(4); // Tue, Wed, Thu, Fri
  });

  it("counts 0 business days over a weekend", () => {
    const start = new Date("2026-04-10"); // Friday
    const end = new Date("2026-04-12"); // Sunday
    expect(countBusinessDays(start, end)).toBe(0);
  });
});

describe("checkDeadline — STR filing (10 business days)", () => {
  it("not breached within deadline", () => {
    const event = new Date("2026-04-06"); // Monday
    const now = new Date("2026-04-13");   // Next Monday (5 biz days)
    const result = checkDeadline(event, 10, now);
    expect(result.breached).toBe(false);
    expect(result.businessDaysRemaining).toBeGreaterThan(0);
  });

  it("breached after deadline", () => {
    const event = new Date("2026-04-06"); // Monday
    const now = new Date("2026-04-21");   // 3rd Monday (11 biz days later)
    const result = checkDeadline(event, 10, now);
    expect(result.breached).toBe(true);
    expect(result.businessDaysRemaining).toBe(0);
  });
});

describe("checkEOCNDeadline — 24-hour asset freeze", () => {
  it("not breached within 24 hours", () => {
    const confirmed = new Date("2026-04-07T10:00:00Z");
    const now = new Date("2026-04-07T20:00:00Z"); // 10h later
    const result = checkEOCNDeadline(confirmed, now);
    expect(result.breached).toBe(false);
    expect(result.hoursRemaining).toBeGreaterThan(0);
    expect(result.hoursElapsed).toBeCloseTo(10, 0);
  });

  it("breached after 24 hours", () => {
    const confirmed = new Date("2026-04-07T10:00:00Z");
    const now = new Date("2026-04-08T11:00:00Z"); // 25h later
    const result = checkEOCNDeadline(confirmed, now);
    expect(result.breached).toBe(true);
    expect(result.hoursRemaining).toBe(0);
  });

  it("exactly at 24h boundary is breached", () => {
    const confirmed = new Date("2026-04-07T10:00:00Z");
    const now = new Date("2026-04-08T10:00:00Z"); // Exactly 24h
    const result = checkEOCNDeadline(confirmed, now);
    expect(result.breached).toBe(true);
  });
});
