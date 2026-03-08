---
name: defi-audit-complex
description: Audit complex DeFi contracts with a trust‑model‑first workflow, risk matrix, and known attack-pattern checklist. Use when reviewing high-value financial protocols, upgrades, liquidation/settlement logic, or cross‑module flows with large fund exposure.
plugin-scoped: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion, Skill, mcp__slither-mcp__*, mcp__serena__*
---

# Complex DeFi Audit

## Overview

Perform deep security reviews for sensitive, high‑value DeFi protocols using a trust model, risk matrix, privilege graph, and adversarial testing mindset.

---

## Hard Rule: serena + slither-mcp Usage (MANDATORY)

> **For Solidity projects, you MUST use serena MCP and slither-mcp MCP tools throughout the audit. Raw Read/Edit/Grep are fallbacks only.**

### Audit Initialization (before any review work)
1. Call `mcp__serena__check_onboarding_performed()` → if not done, call `mcp__serena__onboarding()` + `mcp__serena__initial_instructions()`
2. Call `mcp__serena__list_memories()` → read any relevant project memories
3. Call `mcp__slither-mcp__get_project_overview(path: ".")` → project-wide stats
4. Call `mcp__slither-mcp__list_contracts(path: ".", exclude_paths: ["lib/", "test/", "node_modules/"])` → discover in-scope contracts

### serena MCP Tools (code navigation)
- `mcp__serena__get_symbols_overview` — Understand file structure
- `mcp__serena__find_symbol` — Find classes, functions, variables by name
- `mcp__serena__find_referencing_symbols` — Find all references (impact analysis)
- `mcp__serena__replace_symbol_body` — Update functions/contracts (PREFERRED over Edit)
- `mcp__serena__insert_after_symbol` / `mcp__serena__insert_before_symbol` — Add code at precise locations
- `mcp__serena__rename_symbol` — Rename across entire codebase
- `mcp__serena__search_for_pattern` — Regex search with context
- `mcp__serena__write_memory` — Persist audit findings across sessions

### slither-mcp Tools (security analysis)
- `mcp__slither-mcp__get_contract` / `mcp__slither-mcp__get_contract_source` — Contract metadata + source
- `mcp__slither-mcp__list_functions` / `mcp__slither-mcp__search_functions` — Function discovery
- `mcp__slither-mcp__get_function_source` — Read function implementation
- `mcp__slither-mcp__get_function_callees` / `mcp__slither-mcp__get_function_callers` — Call graph
- `mcp__slither-mcp__get_inherited_contracts` / `mcp__slither-mcp__get_derived_contracts` — Inheritance
- `mcp__slither-mcp__get_storage_layout` — Storage slot analysis
- `mcp__slither-mcp__run_detectors` — Security detectors (filter by severity/confidence)
- `mcp__slither-mcp__analyze_modifiers` — Access control patterns
- `mcp__slither-mcp__analyze_low_level_calls` — call/delegatecall/staticcall/assembly
- `mcp__slither-mcp__analyze_state_variables` — State variable audit
- `mcp__slither-mcp__analyze_events` — Event definitions
- `mcp__slither-mcp__get_contract_dependencies` — Dependency map + circular detection
- `mcp__slither-mcp__export_call_graph` — Visual call graph (Mermaid/DOT)
- `mcp__slither-mcp__find_dead_code` — Dead code detection

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
   - Static analysis: use `mcp__slither-mcp__run_detectors()` for Slither findings, plus Semgrep/SARIF if available
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
- **If starting a new audit: run FAST SCAN first** (step 2 in the workflow) to pre-seed targets.
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
   - Use `mcp__slither-mcp__analyze_modifiers(path: ".")` to discover all access control patterns.
   - Use `mcp__serena__find_symbol(name_path_pattern: "onlyOwner", substring_matching: true)` to find all role-gated functions.
   - List external dependencies (oracles, bridges, keepers).
   - Record assumptions in the registry.
   - Use `mcp__serena__write_memory(memory_name: "audit/trust_model", content: "...")` to persist.

2) **FAST SCAN (community auditor skills)**
   Run all three community auditor skills in parallel for rapid vulnerability pre-seeding:
   - `/solidity-auditor` — parallelized multi-agent vector scan (reentrancy, access control, oracle, flash loan, etc.)
   - `/nemesis-auditor` — iterative dual-pass using Feynman first-principles + state inconsistency detection
   - `/feynman-auditor` and `/state-inconsistency-auditor` — available as standalone sub-components

   **Execution:**
   1. Run `/solidity-auditor` on all in-scope contracts
   2. Run `/nemesis-auditor` on all in-scope contracts (runs `/feynman-auditor` + `/state-inconsistency-auditor` internally)
   3. Merge outputs into `docs/reviews/fast-scan-summary.md` and `.task/fast-scan-summary.json`

   **Output feeds into:** Steps 3–7 (risk matrix, attack surface mapping, invariant writing, high-risk review, adversarial testing). All fast scan findings become initial investigation targets for deeper manual analysis.

3) **Build the risk matrix**
   - Rank components by impact and likelihood.
   - Use `mcp__slither-mcp__run_detectors(path: ".", impact: ["High", "Medium"])` to seed the matrix with automated findings.
   - Focus on cross‑module and cross‑contract flows.
   - Use `mcp__slither-mcp__get_contract_dependencies(path: ".", detect_circular: true)` to map cross-contract dependencies.
   - **Incorporate fast scan findings** — any HIGH/MED from fast scan auto-seeds the matrix.

4) **Map the attack surface**
    - Use `mcp__slither-mcp__list_functions(path: ".", visibility: ["external", "public"])` to enumerate entrypoints.
    - Use `mcp__slither-mcp__analyze_low_level_calls(path: ".")` to find callbacks, hooks, and external calls.
    - Use `mcp__slither-mcp__export_call_graph(path: ".", format: "mermaid")` to visualize call graph.
    - Use `mcp__slither-mcp__get_storage_layout(path: ".", contract_key: ...)` to identify shared storage.
    - Use `mcp__slither-mcp__get_function_callees(path: ".", function_key: ...)` for critical state transitions.
    - Build a privilege graph for all role‑gated paths (use `mcp__slither-mcp__analyze_modifiers`).
    - Quantify max loss bounds per fund‑moving path.
    - When consulting Local Attack Pattern Repos, read at least one concrete PoC/attack/test file per repo (not just README/templates).

5) **Write invariants**
   - Total value conservation and accounting consistency.
   - Position and collateral constraints.
   - Use `mcp__serena__find_symbol(name_path_pattern: "totalSupply", include_body: true)` to trace accounting variables.
   - Use `mcp__slither-mcp__analyze_state_variables(path: ".")` to audit all state variables.

6) **Review high‑risk paths**
   - Use `mcp__slither-mcp__get_function_source(path: ".", function_key: ...)` to read each high-risk function.
   - Use `mcp__slither-mcp__get_function_callers(path: ".", function_key: ...)` to trace who calls each path.
   - Use `mcp__serena__find_referencing_symbols(name_path: "...", relative_path: "...")` for cross-reference analysis.
   - Liquidation, settlement, fee accounting, pricing updates.
   - Admin/upgrade and emergency flows.
   - **Prioritize locations flagged by fast scan** — these are pre-validated targets.

7) **Adversarial testing**
   - Reentrancy, oracle manipulation, MEV ordering.
   - Extreme values, partial fills, and timing races.
   - Use `mcp__slither-mcp__run_detectors(path: ".", detector_names: ["reentrancy-eth", "reentrancy-no-eth", "reentrancy-benign"])` for reentrancy-specific analysis.
   - Use `mcp__slither-mcp__analyze_low_level_calls(path: ".")` to find delegatecall/assembly risks.

8) **Report and mitigate**
   - Provide severity, exploit path, and fixes.
   - If N>1 issues exist, reason into a chained exploit and map it to known patterns.
   - Add a concrete regression test for each risk above Low.
   - Use serena symbolic ops (`replace_symbol_body`, `insert_after_symbol`) to apply fixes.
   - Re-run `mcp__slither-mcp__run_detectors(path: ".")` after each fix to verify resolution.
   - Document assumptions and operational controls.
   - Record max loss bounds for critical asset paths.
   - Use `mcp__serena__write_memory(memory_name: "audit/findings", content: "...")` to persist findings.

## Required Deliverables

- Fast scan summary (`docs/reviews/fast-scan-summary.md` + `.task/fast-scan-summary.json`).
- Trust model + assumptions registry.
- Risk matrix with severity/likelihood ranking (incorporating fast scan findings).
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
- **Use serena + slither-mcp for ALL code operations** — serena for code navigation/editing, slither-mcp for security analysis. Raw Read/Edit/Grep are fallbacks only.

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
