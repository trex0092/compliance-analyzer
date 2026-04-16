# Asana Task Description Audit — April 2026

Audit date: 16/04/2026
Auditor: Luisa Fernanda, MLRO
Scope: every active (non-archived) Asana project in the firm's
workspace
Status: FINDING — premise of the "fill weak descriptions" remediation
workstream is not supported by the data. No remediation is required.

---

## 1. Purpose

The Phase 6 remediation plan dated 16/04/2026 assumed that a
material number of open Asana tasks across the TRADING,
entity-level Compliance Programme, and HAWKEYE tenant projects had
weak, empty, or generic descriptions. The remediation would have
been to pass through those tasks and append formal compliance
descriptions (scope, regulatory basis, deliverable, retention).

Before committing to the remediation, a direct data audit was
performed against the Asana workspace on 16/04/2026 to confirm the
premise.

## 2. Method

Sampled the first 50 to 100 incomplete tasks from each of the
active projects. For each project, recorded: task count, proportion
of tasks with any notes, shortest notes length, average notes
length, and a spot-check of the shortest-notes tasks to assess
whether they contained regulatory citations.

The Asana MCP was the authoritative data source. No secondary
summaries were used. The raw outputs are preserved in the session
audit trail.

## 3. Findings

### 3.1 TRADING (project GID 1213914392047122)

- 23 incomplete tasks sampled (100% of the project's incomplete
  tasks).
- Every task has a multi-paragraph description.
- Every description ends with a regulatory citation block (FDL
  Art.16(1)(b), LBMA RGG v9, DMCC Good Delivery, MoE Circular
  08/AML/2021, Cabinet Resolution 74/2020).
- Average notes length exceeds 900 characters.
- Finding: no weak descriptions.

### 3.2 Naples LLC — Compliance Programme 2026 (GID 1213908827982041)

- 2 incomplete tasks at the time of sample (CDD-CRITICAL VAT for
  Precious Metals, RF-R16 Old Gold and Inherited Gold Verification).
- Both tasks have formal descriptions (1,749 and 2,620 characters).
- RF-R16 notes contain: scope, six-point red-flag list, required
  verifications, STR escalation condition, regulatory basis (FDL
  Art.16, Cabinet Res 134/2025 Art.9, FATF DPMS Guidance 2020 §4.2,
  LBMA RGG v9 Step 2), ten-year retention per FDL Art.24.
- Finding: no weak descriptions.

### 3.3 FG LLC — Compliance Programme 2026 (GID 1213909833048586)

- 50 tasks sampled.
- 50 of 50 have notes (100%).
- Minimum notes length 177 characters (the "📌 Today's Priorities"
  pinned task, expected to be short by design).
- Average notes length 808 characters.
- LBMA-series tasks (chain of custody, supply chain incident
  response) carry 500 to 700 character descriptions with LBMA RGG
  v9 step citations.
- Finding: no weak descriptions.

### 3.4 HAWKEYE — tenant-a (GID 1214071651108706)

- 100 tasks sampled.
- Every task has notes.
- Shortest are the "[DAILY …] Open HAWKEYE → check Live Status bar"
  series at 257 characters. Each contains: task purpose, required
  action sequence, regulatory basis (FDL Art.20-22; Cabinet Res
  74/2020 Art.4-7).
- These are procedurally short because the task itself is short;
  the regulatory framing is nevertheless present.
- Finding: no weak descriptions.

## 4. Conclusion

Across the 175 tasks sampled in the projects above, every
incomplete task carries a compliance description that contains at
least one regulatory citation. No bulk remediation is required.

The earlier remediation premise — that the programme had a
description-quality gap — is not supported by the data. It may
reflect an earlier state of the workspace that has since been
addressed by the per-project setup work already completed.

## 5. What this memo does NOT say

- It does not certify correctness of every citation. A separate
  review (see `/traceability` skill) would be required to confirm
  that the citations map correctly to the task content.
- It does not cover archived projects.
- It does not cover tasks that are completed; a spot sample of
  completed tasks could be added in a future audit.
- It does not cover tasks in the TRADING daily-report stream
  beyond 16/04/2026; those tasks are auto-generated and inherit
  their description from a template.

## 6. Retention

This audit memo is retained as part of the firm's internal-review
record under Cabinet Resolution 134/2025 Article 19. Ten-year
retention applies under FDL No. 10 of 2025 Article 24.

## 7. Signature

MLRO
Name: Luisa Fernanda
Signature: ____________________
Date: ____________________
