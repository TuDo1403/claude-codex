---
name: defi-audit-complex
description: Audit complex DeFi contracts with a trust‑model‑first workflow, risk matrix, and known attack-pattern checklist. Use when reviewing high-value financial protocols, upgrades, liquidation/settlement logic, or cross‑module flows with large fund exposure.
---

# Complex DeFi Audit

## Overview

Perform deep security reviews for sensitive, high‑value DeFi protocols using a trust model, risk matrix, privilege graph, and adversarial testing mindset.

## Required Inputs (to maximize audit quality)

Provide these up front to drive the deepest bug coverage and best audit quality:

1) **Repo + build context (must have)**
   - Full source repo, including submodules/vendor deps pinned
   - Build toolchain versions: `foundry.toml`, `hardhat.config.ts`, `remappings.txt`, `package.json`, lockfiles
   - Compiler settings: solc version, optimizer runs, via-IR, libraries
   - Deployment config files (chain IDs, parameters, oracle feeds)

2) **ABI + deployment data (must have for live systems)**
   - ABI JSONs for each core contract
   - Deployed addresses by chain, including proxy/implementation mapping
   - Constructor args / initialize calldata per deployment
   - Verified bytecode checksums or `metadata.json`

3) **Tests and automation inputs**
   - Unit tests for each module (edge values, revert paths)
   - Integration tests for cross-module flows
   - Upgrade tests (proxy admin, migration)
   - Fuzz/property tests with invariants (TVL conservation, accounting equality)
   - Regression tests for past issues
   - Adversarial tests: reentrancy, oracle manipulation, MEV ordering, timing races
   - Static analysis outputs (Slither, Semgrep, SARIF) and coverage reports
   - Echidna/Medusa config files if used

4) **Specs, invariants, and assumptions**
   - Written invariants and testable spec for accounting equations
   - Trust model: roles, upgrade paths, emergency controls
   - Assumption registry for external dependencies
   - Max loss bounds per fund-moving path

5) **Operational and on-chain context**
   - Oracle list, update frequency, fallback rules
   - Keeper/relayer logic and failure modes
   - L2 or cross-chain assumptions (sequencer status, bridges)
   - Prior incidents or known edge cases

## Workflow Decision Tree

- If auditing a complex protocol or big‑fund exposure: follow the Complex DeFi Audit Workflow.
- If prioritizing findings: build the Risk Matrix first.
- If modeling assumptions: start with the Trust Model.
- If searching for exploit classes: use the Attack Patterns checklist.
- If looking for real‑world exploit mechanics: consult the Local Attack Pattern Repos reference.
- If funds at risk are high: read Fund-Sensitive Audit Guidance.
- If ensuring broad industry coverage: use the Industry-Standard Checklist.
- If strengthening tests or tooling: use Tooling & Test Expectations.
- If reviewing incentives or economic safety: use Economic & Mechanism Security.
- If reviewing operational safety: use Ops & Monitoring guidance.
- If mapping privileged paths: use Privilege Graph.
- If quantifying worst‑case loss: use Max Loss Bound Worksheet.
- If documenting assumptions: use Assumption Registry.
- If preparing for sign‑off: use Proof Obligations.
- If protocol is on L2/cross‑chain: use Chain‑Specific Risks.
- If preparing for external audit: use Internal Pre‑Audit Checklist.

## Complex DeFi Audit Workflow

1) **Define the trust model**
   - Enumerate roles, powers, and upgrade paths.
   - List external dependencies (oracles, bridges, keepers).
   - Record assumptions in the registry.

2) **Build the risk matrix**
   - Rank components by impact and likelihood.
   - Focus on cross‑module and cross‑contract flows.

3) **Map the attack surface**
    - Enumerate entrypoints, callbacks, hooks, and external calls.
    - Identify critical state transitions and shared storage.
    - Build a privilege graph for all role‑gated paths.
    - Quantify max loss bounds per fund‑moving path.
    - When consulting Local Attack Pattern Repos, read at least one concrete PoC/attack/test file per repo (not just README/templates).

4) **Write invariants**
   - Total value conservation and accounting consistency.
   - Position and collateral constraints.

5) **Review high‑risk paths**
   - Liquidation, settlement, fee accounting, pricing updates.
   - Admin/upgrade and emergency flows.

6) **Adversarial testing**
   - Reentrancy, oracle manipulation, MEV ordering.
   - Extreme values, partial fills, and timing races.

7) **Report and mitigate**
   - Provide severity, exploit path, and fixes.
   - If N>1 issues exist, reason into a chained exploit and map it to known patterns.
   - Add a concrete regression test for each risk above Low.
   - Document assumptions and operational controls.
   - Record max loss bounds for critical asset paths.

## Required Deliverables

- Trust model + assumptions registry.
- Risk matrix with severity/likelihood ranking.
- Privilege graph and role tests.
- Max loss bounds worksheet.
- Invariant list and property tests.
- Regression tests for issues above Low.
- Audit report with evidence bundle.

## Guardrails (must keep)

- Do not assume external dependencies are honest unless documented.
- Treat upgrade/admin powers as critical risks.
- Require invariant coverage for any refactor or optimization.
- Emphasize exploitability and real‑world attack conditions.

## References

- Read `references/audit_workflow.md` for a step‑by‑step audit flow.
- Read `references/risk_matrix.md` to rank severity/likelihood.
- Read `references/trust_model.md` to document assumptions.
- Read `references/attack_patterns.md` for exploit checklists.
- Read `references/audit_report_guidelines.md` for report and regression test requirements.
- Read `references/local_attack_repos.md` to consult local exploit pattern repos during audits.
- Read `references/fund_sensitive_guidance.md` for drain‑path discovery and mitigations.
- Read `references/industry_standard_checklist.md` for broad coverage of common risks.
- Read `references/tooling_and_tests.md` for test and analysis expectations.
- Read `references/economic_security.md` for incentive and mechanism reviews.
- Read `references/ops_and_monitoring.md` for operational safety checks.
- Read `references/privilege_graph.md` for privileged path mapping.
- Read `references/max_loss_bound.md` to quantify worst‑case loss.
- Read `references/assumption_registry.md` to track audit assumptions.
- Read `references/proof_obligations.md` for pre‑signoff evidence.
- Read `references/chain_specific_risks.md` for L2/cross‑chain risks.
- Read `references/internal_audit_checklist.md` for internal pre‑audit coverage.
