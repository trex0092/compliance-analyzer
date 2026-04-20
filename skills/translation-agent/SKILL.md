# /translation-agent — 24-language adverse-media + document translation

Specialist supporting agent that translates adverse-media hits and
foreign-language KYC documents across 24 languages with source
preservation. Machine-translation output is marked so the MLRO sees
what was auto-translated vs human-verified.

## Usage

```
/translation-agent <text> [--source=auto|<lang>] [--target=en]
```

## Inputs
- `sourceText` · `sourceLang` (auto-detect by default) · `targetLang`

## Outputs
- `translatedText`
- `confidence` (per sentence)
- `sourcePreservation` (original text verbatim for evidence bundle)

## Asana target
`screening_and_watchlist` board.

## Guards
- Subject data in cleartext only to translation providers hosted on
  UAE-resident infrastructure (PDPL residency).
- Every translation marked with model provenance.
- Original text preserved verbatim in the evidence bundle.
- No-tipping-off guard: translated queries never include phrasing
  that reveals the screening context (FDL Art.29).

## Regulatory basis
- FATF Rec 10 — ongoing CDD across language barriers
- FDL No.10/2025 Art.29 — no tipping off in translation target
- UAE PDPL Art.6(1)(c)

## Related agents
- `/research-agent` — translates foreign hits before scoring
- `/life-story-agent` — translates non-English adverse media in
  Section 4
- `/document-agent` — translates document content after OCR
