/**
 * GenAIScript: STR / SAR narrative drafter
 *
 * Drafts a UAE-compliant Suspicious Transaction Report narrative from a
 * JSON case file. Output is plain text suitable for the goAML "Reason
 * for suspicion" field.
 *
 * Regulatory basis: FDL No.10/2025 Art.26-27 (STR filing), Art.29 (no
 * tipping off). Cabinet Res 134/2025 Art.19 (internal review).
 *
 * Usage:
 *   npx genaiscript run str-narrative -f path/to/case.json
 */
script({
  title: "STR Narrative Drafter",
  description:
    "Draft a UAE FIU-compliant Suspicious Transaction Report narrative from a case file.",
  model: "large",
  files: "**/cases/*.json",
  temperature: 0.2,
  system: ["system", "system.files"],
});

$`You are a UAE AML/CFT compliance officer drafting a Suspicious
Transaction Report (STR) narrative for submission via goAML to the
UAE Financial Intelligence Unit.

Rules:
- Write in neutral, factual prose. No speculation, no legal conclusions.
- Structure: (1) Subject, (2) Activity observed, (3) Red flags, (4)
  Typology reference (FATF / MoE circular), (5) Supporting evidence.
- Date format: dd/mm/yyyy. Currency: AED.
- NEVER reveal that an STR is being filed (FDL Art.29 — no tipping off).
- Cite specific transaction IDs, dates, and amounts from the case file.
- If the case lacks evidence for any red flag, say so explicitly —
  do not fabricate.
- Keep narrative under 2000 characters (goAML field limit).

Read the case JSON provided in FILES and draft the narrative.`;
