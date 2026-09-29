# P2.2 — Condition hard-code audit

Goal: decide which condition-specific rules (cervicogenic headache, broad
knee, patellofemoral) are still needed now that the general engine exists
(PICO parser, clinicalMatch tiers, evidence confidence, sufficiency, safety,
adaptive layout and gap follow-ups).

Runs: `cases-p2-2.json` (13 cases, 20 operations), local stack, cold caches.
BEFORE = `main` (3fe7ca1) run twice to measure run-to-run noise; AFTER = this
branch. Seven P0 cases (4 comparisons, 3 red flags) were also run on both.

## Inventory and decision

| Rule | Where | Affected | Class | Decision |
|---|---|---|---|---|
| Chat cervicogenic guard (`applyCervicogenicHeadacheGuard`) | chatFinalRefinement | answer text, citations | D: fired on "cefalea"+"cervical" and "headache"+"neck", so tension-type headache and "neck pain without headache" got fixed cervicogenic text; claimed a neck guideline framework even when no guideline was cited | removed |
| Chat referral text for every neck question | routes/chat | Research referral | D: cervicogenic query for neck pain without headache | removed (generic PICO text) |
| Broad-knee and patellofemoral templates | chatContinuationGuidance | answer text | C/D: canned text replaced the answer (an explicit PFP question got the "stairs/squats pattern" text) | removed; underspecified confidence, adaptive layout and gap follow-ups cover it |
| Region follow-ups, cervicogenic confidence cap, template confidence | chatContinuationGuidance, chatFinalRefinement | follow-ups, confidence | C: dead, overridden by the P1.5 follow-ups and the final confidence | removed |
| Broad-knee Library filter (`eligibleLibraryGuides`) | routes/chat, routes/research | selection | B: knee-only | replaced by a general rule: a Library guide joins the evidence only when its clinical match is not tangential |
| Research cervicogenic reordering, fixed scores, caps, answer filtering | cervicogenicHeadacheRefinement, cervicogenicHeadacheFinalPass | ranking, selection, answer | B/C: superseded by `rankByClinicalMatch` (runs after) and the final confidence | removed; the single-study hedge became a general prompt rule |
| Targeted cervicogenic PubMed query | cervicogenicHeadacheRefinement | retrieval | B: without it the CGH top 5 stays direct CGH reviews (4/5 identical) | removed |
| `component_framework` Library wording | libraryEvidenceIntegration, libraryRecommendationPolicy | wording | E: only produced by the cervicogenic module | removed |
| JOSPT neck guideline kept for neck questions whose condition it does not name (`isRelatedJosptGuidelineForIntent`) | sourcePriority, evidenceSelectionGuard, evidenceSearchEngine | retrieval, selection, wording | A: the guideline covers neck pain subgroups (headache, radiating pain, whiplash) | kept; notes made condition-neutral |
| Unrequested competing headache etiologies filter | evidenceSelectionGuard | selection | A/B: clinicalMatch would tier them tangential, but the filter keeps them off the Research list | kept |
| Headache concept guideline terms put "cervicogenic headache" first | preferredGuidelineSearch | retrieval (guideline queries) | D: migraine/tension-type guideline searches query cervicogenic headache | kept: a fix changes `ranking.js` competing-condition detection (frozen); needs a condition hierarchy |

## Missing general capability

A **condition hierarchy / guideline scope model** shared by retrieval,
ranking and Library matching: "cervicogenic headache and tension-type
headache are subtypes of headache", "the JOSPT Neck Pain guideline covers
neck pain with headache, with radiating pain and whiplash". Today this is
encoded as the neck-guideline rule and the flat headache concept. With it, the
last two rows could become data instead of code.

## Result (BEFORE vs AFTER)

- Tension-type headache and neck pain without headache no longer receive
  cervicogenic text; answers are written from their own sources.
- Explicit PFP gets a PFP answer from its sources, not the anterior-knee
  pattern template.
- Patellar tendinopathy, lateral knee pain and knee OA: no patellofemoral
  source at the top; lateral knee states a tangential PFP study does not
  generalize.
- Broad knee: no Library guide for a specific diagnosis (general rule),
  confidence moderate with the "underspecified" rationale, differentiate
  follow-up present.
- Cervicogenic headache: Chat and Research still retrieve direct CGH
  reviews without the targeted query.
- Confidence: no category rises from a code change. Differences between
  runs (e.g. neck pain, PFP) come from different cited sources after
  DeepSeek's `search_terms` vary; the same variation appears between the
  two BEFORE runs and between two isolated runs of the same code.
- Red flags (3/3) take the safety route; comparisons (4/4) keep the same
  direct/no-direct verdicts.
- Ranking benchmark identical (PASS, MRR 1.0, nDCG@3 0.9595).

Condition-specific rule code: about 2,200 lines in 11 files → about 150
lines in 3 files (vocabulary dictionaries unchanged).
