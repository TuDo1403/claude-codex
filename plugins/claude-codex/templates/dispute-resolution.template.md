# Dispute Resolution Report

**Stage:** 4C - Adversarial Dispute Resolution
**Date:** {{DATE}}
**Bundle:** bundle-stage4c (NO SPEC PROSE)

## Dispute Set Summary

| ID | Title | Opus | Codex | Verdict |
|----|-------|------|-------|---------|
| D-1 | {{TITLE}} | {{OPUS_SEVERITY}} | {{CODEX_SEVERITY}} | {{VERDICT}} |
| D-2 | ... | ... | ... | ... |

**Totals:**
- CONFIRMED: {{CONFIRMED_COUNT}} (HIGH: {{HIGH_COUNT}}, MED: {{MED_COUNT}})
- DISPROVEN: {{DISPROVEN_COUNT}}
- UNCLEAR: {{UNCLEAR_COUNT}}

---

## Dispute Details

### D-1: {{DISPUTE_TITLE}}

**Source:**
- Opus: {{OPUS_ID}} ({{OPUS_SEVERITY}}) - {{OPUS_SUMMARY}}
- Codex: {{CODEX_ID}} ({{CODEX_SEVERITY}}) - {{CODEX_SUMMARY}}

**Disagreement:**
{{WHAT_THEY_DISAGREE_ON}}

**Reproduction Artifact:**
```solidity
// test/disputes/D1_{{name}}.t.sol
function test_D1_{{testName}}() public {
    // Setup as per attack hypothesis
    // Execute attack steps
    // Assert: either exploit succeeds (CONFIRMED) or fails (DISPROVEN)
}
```

**Prosecutor (Opus) Argument:**
1. Point 1
2. Point 2
3. Point 3

**Defender (Codex) Argument:**
1. Point 1
2. Point 2
3. Point 3

**Evidence Evaluation:**
- Opus evidence: {{OPUS_EVIDENCE}}
- Codex evidence: {{CODEX_EVIDENCE}}

**VERDICT: {{VERDICT}}**

**Justification:**
{{JUSTIFICATION}}

**Required Action:**
- [For CONFIRMED] Create RT-{{N}} in red-team-issue-log.md
- [For DISPROVEN] Document refutation evidence
- [For UNCLEAR] Create add-test task T-D1-test

---

## Red-Team Issues Created

From CONFIRMED disputes:

| RT-ID | Dispute | Severity | Title |
|-------|---------|----------|-------|
| RT-001 | D-1 | HIGH | {{TITLE}} |
| RT-002 | D-5 | MED | {{TITLE}} |

These issues are added to `docs/reviews/red-team-issue-log.md` for Stage 5 resolution.

---

## UNCLEAR Resolution Tasks

From UNCLEAR disputes:

| Task | Dispute | Required Test | Rerun After |
|------|---------|---------------|-------------|
| T-D3-test | D-3 | test/disputes/D3_{{name}}.t.sol | 4A, 4B |
| T-D7-test | D-7 | test/disputes/D7_{{name}}.t.sol | 4A, 4B |

**Process:**
1. Implementer adds required tests
2. Rerun Stage 4A (Opus Attack Plan) with new evidence
3. Rerun Stage 4B (Codex Deep Exploit) with new evidence
4. Return to Stage 4C for final resolution

---

## Dispute Statistics

- **Total Disputes:** {{TOTAL}}
- **CONFIRMED (HIGH):** {{CONFIRMED_HIGH}} -> RT issues
- **CONFIRMED (MED):** {{CONFIRMED_MED}} -> RT issues
- **DISPROVEN:** {{DISPROVEN}} -> Documented
- **UNCLEAR:** {{UNCLEAR}} -> Add-test tasks

**Adversarial Mode Effectiveness:**
- Opus-only findings: {{OPUS_ONLY}}
- Codex-only findings: {{CODEX_ONLY}}
- Both identified (agreed): {{BOTH_AGREED}}
- Disagreements resolved: {{DISAGREEMENTS_RESOLVED}}
