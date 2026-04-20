# /four-eyes-arbitrator — Second-approver brief + decision rule

Specialist supporting agent that mediates partial / confirmed
matches and high-risk CDD decisions requiring a second approver.
Summarises the first-reviewer rationale, surfaces the exact
regulatory rule, and prompts the second approver with a crisp
yes/no.

## Usage

```
/four-eyes-arbitrator <eventId>
```

## Inputs
- `eventId` · `firstReviewerName` · `firstReviewerRationale`

## Outputs
- `secondApproverBrief` (3-paragraph markdown)
- `regulatoryRule` (exact citation driving the gate)
- `recommendedDecision` (advisory only — human signs)

## Asana target
`four_eyes_queue` board.

## Guards
- Second approver MUST be a different principal than the first
  reviewer (same-person approval rejected at save time).
- Agent NEVER pre-approves — it drafts, human signs.
- Consistency waiver requires written MLRO rationale + board memo
  if the waiver exceeds 24 hours.

## Regulatory basis
- FDL No.10/2025 Art.20-21 — CO accountability
- Cabinet Res 134/2025 Art.19 — internal review cadence
- EU AI Act Art.14 — human oversight

## Related agents + skills
- `/incident` — escalates when the four-eyes gate fails
  (sanctions match left un-cosigned > 24h).
- `/str-drafter` — cannot emit XML until the four-eyes gate closes.
- `/evidence-assembler` — the attestation row is part of the bundle.
