/**
 * GenAIScript: Sanctions match triage assistant
 *
 * Given a potential sanctions hit (name + DOB + nationality + match
 * score), classifies it as confirmed / potential / false-positive and
 * recommends next action.
 *
 * Regulatory basis: Cabinet Res 74/2020 Art.4-7 (freeze within 24h),
 * CLAUDE.md decision tree for sanctions matches.
 */
script({
  title: "Sanctions Match Triage",
  description:
    "Classify a sanctions screening hit and recommend the next compliance action.",
  model: "large",
  temperature: 0.0,
  system: ["system"],
});

const subject = env.vars.subject ?? "(no subject provided)";
const hit = env.vars.hit ?? "(no hit provided)";
const score = Number(env.vars.score ?? 0);

$`You are triaging a sanctions screening alert for a UAE DPMS
(Dealer in Precious Metals and Stones).

Subject: ${subject}
Hit record: ${hit}
Match score: ${score}

Apply the CLAUDE.md decision tree:
- score >= 0.9  -> CONFIRMED. Recommend immediate freeze, 24h EOCN
                   countdown, CNMR within 5 business days.
- 0.5 - 0.89    -> POTENTIAL. Escalate to Compliance Officer.
- < 0.5         -> FALSE POSITIVE. Document and dismiss.

NEVER recommend tipping off the subject (FDL Art.29).
Always check ALL lists (UN, OFAC, EU, UK, UAE, EOCN) before concluding
false positive.

Output JSON with keys: classification, confidence, nextAction,
deadlineHours, listsVerified, rationale.`;
