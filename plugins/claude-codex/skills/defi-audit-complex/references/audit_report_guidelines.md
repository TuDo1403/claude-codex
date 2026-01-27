# Audit Report Guidelines

Use this when producing the final report or sharing findings.

## Report structure
- **Scope**: contracts, commit hash, excluded areas.
- **Threat model**: assumptions, trusted roles, external dependencies.
- **Max loss bounds**: per asset/path limits and caps.
- **Methodology**: tools, test suite coverage, manual review.
- **Findings**: grouped by severity with clear exploit paths.
- **Exploit chains**: when multiple findings compose, document the full chain and pattern match.
- **Recommendations**: prioritized fixes and follow‑up tests.
- **Evidence bundle**: links to tests, invariants, and assumptions registry.

## Finding template (concise)
- **Title**: short, descriptive.
- **Severity**: Critical/High/Medium/Low/Info.
- **Impact**: what can be lost or compromised.
- **Likelihood**: conditions required to exploit.
- **Root cause**: precise code path and state transition.
- **Exploit sketch**: minimal steps to reproduce.
- **Exploit chain**: link to adjacent issues if this finding is a step in a multi-issue chain.
- **Fix guidance**: safe change list, tradeoffs.
- **Regression test**: concrete test case that fails before fix and passes after.

## Regression test requirement
- Every risk above Low must include a concrete regression test.
- The test should encode the exploit path (not a generic invariant).
- Name tests to reflect the issue and expected behavior.

## Evidence bundle checklist
- Assumptions registry and trust model.
- Privilege graph with role tests.
- Max loss bounds worksheet.
- Invariants/property tests list.
