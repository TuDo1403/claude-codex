# Adversarial Codex ↔ Opus Mode

## Overview

Adversarial Mode increases audit rigor by forcing Codex and Opus to:
1. **Work independently** - Neither sees the other's output during analysis
2. **Disagree explicitly** - Disputes are formally tracked and resolved
3. **Prove claims** - All findings require reproduction tests or invariant evidence

## Pipeline Architecture

```
                    ┌─────────────────────────────────────────┐
                    │     ADVERSARIAL MODE (Stages 4A-4C)     │
                    └─────────────────────────────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
              ▼                         │                         ▼
    ┌─────────────────┐                 │           ┌─────────────────┐
    │  BUNDLE-STAGE4A │                 │           │  BUNDLE-STAGE4B │
    │  (NO spec prose)│                 │           │  (NO spec prose)│
    │  (NO Codex out) │                 │           │  (NO Opus out)  │
    └────────┬────────┘                 │           └────────┬────────┘
             │                          │                    │
             ▼                          │                    ▼
    ┌─────────────────┐                 │           ┌─────────────────┐
    │    STAGE 4A     │                 │           │    STAGE 4B     │
    │ Opus Attack Plan│                 │           │Codex Deep Exploit│
    │   (Contrarian)  │                 │           │  (+ Refutations) │
    └────────┬────────┘                 │           └────────┬────────┘
             │                          │                    │
             └──────────────┬───────────┘                    │
                            │                                │
                            ▼                                │
                  ┌─────────────────┐                        │
                  │  BUNDLE-STAGE4C │◄───────────────────────┘
                  │  (Both reviews) │
                  │  (NO spec prose)│
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │    STAGE 4C     │
                  │ Dispute Resolver│
                  │ Opus=PROSECUTOR │
                  │ Codex=DEFENDER  │
                  └────────┬────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
    ┌─────────┐      ┌───────────┐     ┌─────────┐
    │CONFIRMED│      │ DISPROVEN │     │ UNCLEAR │
    │         │      │           │     │         │
    └────┬────┘      └─────┬─────┘     └────┬────┘
         │                 │                │
         ▼                 ▼                ▼
    Create RT Issue   Document        Add Test Task
         │            Evidence              │
         │                 │                │
         ▼                 │                ▼
    STAGE 5               Done        Rerun 4A+4B+4C
    Red-Team Loop                    (max 3 rounds)
```

## Task Graph

```
T8a: bundle_generate_stage4a    (blockedBy: [T4])
     Output: .task/<run_id>/bundle-stage4a/

T8b: bundle_generate_stage4b    (blockedBy: [T4])
     Output: .task/<run_id>/bundle-stage4b/
     NOTE: T8b MUST be isolated from T8a

T8c: opus_attack_plan           (blockedBy: [T8a])
     Agent: opus-attack-planner (opus)
     Output: docs/reviews/opus-attack-plan.md

T8d: codex_deep_exploit         (blockedBy: [T8b])
     Agent: codex-deep-exploit-hunter (codex)
     Output: docs/reviews/codex-deep-exploit-review.md
     NOTE: MUST NOT see T8c output

T8e: bundle_generate_stage4c    (blockedBy: [T8c, T8d])
     Output: .task/<run_id>/bundle-stage4c/
     NOTE: Includes BOTH reviews

T8f: dispute_resolution         (blockedBy: [T8e])
     Agent: dispute-resolver (opus)
     Output: docs/reviews/dispute-resolution.md
     ACTIONS:
       - CONFIRMED → Create RT issue, proceed to Stage 5
       - UNCLEAR → Create add-test task, rerun T8a-T8f
       - DISPROVEN → Document refutation, proceed
```

## Bundle Contents

### bundle-stage4a (Opus Attack Plan)

| Included | Excluded |
|----------|----------|
| invariants-list.md | threat-model.md prose |
| public-api.md | design.md narrative |
| src/**/*.sol | test-plan.md |
| test/**/*.sol | **codex-deep-exploit-review.md** |
| slither-summary.md | **codex-deep-exploit-review.json** |

### bundle-stage4b (Codex Deep Exploit)

| Included | Excluded |
|----------|----------|
| invariants-list.md | threat-model.md prose |
| public-api.md | design.md narrative |
| src/**/*.sol | test-plan.md |
| test/**/*.sol | **opus-attack-plan.md** |
| slither-summary.md | **opus-attack-plan.json** |

### bundle-stage4c (Dispute Resolution)

| Included | Excluded |
|----------|----------|
| invariants-list.md | threat-model.md prose |
| public-api.md | design.md narrative |
| src/**/*.sol | test-plan.md |
| test/**/*.sol | (spec prose still blind) |
| **opus-attack-plan.md** | |
| **codex-deep-exploit-review.md** | |
| slither-summary.md | |

## Validation Requirements

### Stage 4A: Opus Attack Plan

| Requirement | Configurable | Default |
|-------------|--------------|---------|
| Minimum total hypotheses | `min_attack_hypotheses` | 8 |
| Minimum Economic/MEV | `min_economic_hypotheses` | 2 |
| Minimum DoS/Gas Grief | `min_dos_hypotheses` | 2 |
| Each hypothesis has preconditions | N/A | Required |
| Each hypothesis has attack steps | N/A | Required |
| Each hypothesis maps to invariant | N/A | Required |
| Each hypothesis has demo test | N/A | Required |
| Top 5 priority ranking | N/A | Required |

### Stage 4B: Codex Deep Exploit

| Requirement | Configurable | Default |
|-------------|--------------|---------|
| Minimum refuted hypotheses | `min_refuted_hypotheses` | 1 |
| Minimum false positives invalidated | `min_false_positives_invalidated` | 3 |
| Refutations have evidence | N/A | Required |
| Refutations have code refs | N/A | Required |
| Isolation from Opus verified | N/A | Required |

### Stage 4C: Dispute Resolution

| Requirement | Default |
|-------------|---------|
| Every dispute has verdict | Required |
| CONFIRMED has reproduction test | Required |
| CONFIRMED creates RT issue | Required |
| DISPROVEN has refutation evidence | Required |
| UNCLEAR creates add-test task | Required |
| Prosecutor/defender arguments | Required |

## Configuration

```json
{
  "blind_audit_sc": {
    "adversarial": {
      "adversarial_mode": true,
      "min_attack_hypotheses": 8,
      "min_economic_hypotheses": 2,
      "min_dos_hypotheses": 2,
      "min_refuted_hypotheses": 1,
      "min_false_positives_invalidated": 3,
      "dispute_max_rounds": 3,
      "codex_timeout_ms": 1200000,
      "require_reproduction_artifacts": true,
      "auto_create_rt_issues": true
    }
  }
}
```

## Dispute Resolution Loop

```
Round 0: Initial run
  4A: Opus generates hypotheses
  4B: Codex hunts exploits
  4C: Resolve disputes
       ├── CONFIRMED → RT issue (proceed)
       ├── DISPROVEN → Document (done)
       └── UNCLEAR → Add test task

Round 1-3: Rerun on UNCLEAR
  - Implementer adds required tests
  - Rerun 4A with new test evidence
  - Rerun 4B with new test evidence
  - Rerun 4C to re-evaluate

Round 3+: Escalation
  - Max rounds exceeded
  - Escalate to user for manual resolution
```

## Output Artifacts

| Stage | Markdown | JSON |
|-------|----------|------|
| 4A | `docs/reviews/opus-attack-plan.md` | `.task/<run_id>/opus-attack-plan.json` |
| 4B | `docs/reviews/codex-deep-exploit-review.md` | `.task/<run_id>/codex-deep-exploit-review.json` |
| 4C | `docs/reviews/dispute-resolution.md` | `.task/<run_id>/dispute-resolution.json` |

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `opus-attack-planner` | opus | Contrarian attack hypotheses |
| `codex-deep-exploit-hunter` | codex | Deep exploit + refutations |
| `dispute-resolver` | opus | Resolve disagreements |

## Hook Validators

| Hook | Validates |
|------|-----------|
| `bundle-validator.js` | Bundle blindness + isolation |
| `adversarial-validator.js` | Output schema compliance |

## Scripts

| Script | Purpose |
|--------|---------|
| `generate-bundle-stage4a.js` | Create Opus bundle (isolated) |
| `generate-bundle-stage4b.js` | Create Codex bundle (isolated) |
| `generate-bundle-stage4c.js` | Create dispute bundle (both) |
| `codex-deep-exploit.js` | Invoke Codex CLI |

## Files Added

```
plugins/claude-codex/
├── agents/
│   ├── opus-attack-planner.md      (NEW)
│   ├── codex-deep-exploit-hunter.md (NEW)
│   └── dispute-resolver.md         (NEW)
├── docs/
│   ├── ADVERSARIAL-MODE.md         (NEW)
│   └── schemas/
│       ├── opus-attack-plan.schema.json      (NEW)
│       ├── codex-deep-exploit-review.schema.json (NEW)
│       └── dispute-resolution.schema.json    (NEW)
├── hooks/
│   ├── bundle-validator.js         (UPDATED)
│   └── adversarial-validator.js    (NEW)
├── scripts/
│   ├── generate-bundle-stage4a.js  (NEW)
│   ├── generate-bundle-stage4b.js  (NEW)
│   ├── generate-bundle-stage4c.js  (NEW)
│   └── codex-deep-exploit.js       (NEW)
├── skills/blind-audit-sc/
│   └── SKILL.md                    (UPDATED)
└── templates/
    ├── .claude-codex.json          (UPDATED)
    ├── opus-attack-plan.template.md (NEW)
    ├── codex-deep-exploit-review.template.md (NEW)
    └── dispute-resolution.template.md (NEW)
```

## Verification

### Bundle Isolation Test

1. Generate Stage 4A bundle:
   ```bash
   bun scripts/generate-bundle-stage4a.js --run-id test-123
   ```

2. Verify no Codex output in manifest:
   ```bash
   cat .task/test-123/bundle-stage4a/MANIFEST.json | grep codex
   # Should return nothing
   ```

3. Generate Stage 4B bundle:
   ```bash
   bun scripts/generate-bundle-stage4b.js --run-id test-123
   ```

4. Verify no Opus output in manifest:
   ```bash
   cat .task/test-123/bundle-stage4b/MANIFEST.json | grep opus
   # Should return nothing
   ```

### Dispute Loop Test

1. Create UNCLEAR dispute
2. Verify add-test task created
3. Add test file
4. Verify rerun triggered
5. Verify max rounds enforced (3)

### RT Issue Creation Test

1. Create CONFIRMED dispute (HIGH)
2. Verify RT issue in red-team-issue-log.md
3. Verify RT issue enters Stage 5 loop
