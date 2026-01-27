#!/usr/bin/env bun
/**
 * SubagentStop hook that validates gate artifacts for smart-contract-secure pipeline.
 * Runs when ANY subagent finishes, filters to validate gate agents.
 *
 * Input (via stdin JSON):
 * {
 *   "agent_id": "def456",
 *   "agent_transcript_path": "~/.claude/projects/.../subagents/agent-def456.jsonl"
 * }
 *
 * Output (to block):
 * {"decision": "block", "reason": "explanation"}
 *
 * Validates gates 0-5 artifact requirements:
 * - Gate 0: threat-model.md exists with invariants & acceptance criteria
 * - Gate 1: design.md exists with storage layout & external call policy
 * - Gate 2: test-plan.md exists, all invariants mapped
 * - Gate 3: forge test passes, reports/forge-test.log exists
 * - Gate 4: slither.json exists (if enabled), no unsuppressed high findings
 * - Gate 5: gas-snapshots.md exists with before/after evidence
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');
const REPORTS_DIR = join(PROJECT_DIR, 'reports');

// Agent types for smart contract secure pipeline
const SC_AGENTS = [
  'claude-codex:threat-modeler',
  'claude-codex:architect',
  'claude-codex:test-planner',
  'claude-codex:sc-implementer',
  'claude-codex:security-auditor',
  'claude-codex:perf-optimizer',
  'claude-codex:sc-code-reviewer'
];

function readJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function getAgentTypeFromTranscript(transcriptPath) {
  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const match = content.match(/subagent_type['":\s]+['"]?(claude-codex:[^'"}\s,]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function loadConfig() {
  const configPath = join(PROJECT_DIR, '.claude-codex.json');
  const defaults = {
    smart_contract_secure: {
      enable_invariants: true,
      enable_slither: true,
      enable_semgrep: false,
      fuzz_runs: 5000,
      gate_strictness: 'high'
    }
  };

  const config = readJson(configPath);
  if (config?.smart_contract_secure) {
    return { ...defaults.smart_contract_secure, ...config.smart_contract_secure };
  }
  return defaults.smart_contract_secure;
}

/**
 * Gate 0: Threat Model Validation
 */
function validateGate0() {
  const threatModelPath = join(DOCS_DIR, 'security', 'threat-model.md');
  const artifactPath = join(TASK_DIR, 'threat-model.json');

  // Check threat model file exists
  const threatModel = readFile(threatModelPath);
  if (!threatModel) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/security/threat-model.md is missing. Create threat model with invariants and acceptance criteria.'
    };
  }

  // Check for invariants section
  const hasInvariants = /##\s*(Invariants|Conservation Invariants|Consistency Invariants)/i.test(threatModel) ||
                        /\b(IC-\d+|IS-\d+|IA-\d+|IT-\d+|IB-\d+)\b/.test(threatModel);
  if (!hasInvariants) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/security/threat-model.md missing invariants section. Must include enumerated invariants (IC-*, IS-*, IA-*, IT-*, IB-*).'
    };
  }

  // Check for acceptance criteria section
  const hasAcceptanceCriteria = /##\s*Acceptance Criteria/i.test(threatModel) ||
                                /\bAC-SEC-\d+\b/.test(threatModel) ||
                                /\bAC-FUNC-\d+\b/.test(threatModel);
  if (!hasAcceptanceCriteria) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/security/threat-model.md missing acceptance criteria section. Must include measurable acceptance criteria.'
    };
  }

  // Check artifact file
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: .task/threat-model.json artifact is missing. Agent must write artifact file.'
    };
  }

  if (!artifact.invariants || artifact.invariants.length === 0) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: .task/threat-model.json has no invariants. Must enumerate all invariants.'
    };
  }

  return null; // Valid
}

/**
 * Gate 1: Architecture Validation
 */
function validateGate1() {
  const designPath = join(DOCS_DIR, 'architecture', 'design.md');
  const artifactPath = join(TASK_DIR, 'architecture.json');

  // Check design file exists
  const design = readFile(designPath);
  if (!design) {
    return {
      decision: 'block',
      reason: 'GATE 1 FAILED: docs/architecture/design.md is missing. Create architecture design document.'
    };
  }

  // Check for storage layout section
  const hasStorageLayout = /##\s*Storage Layout/i.test(design) ||
                           /Slot\s*\|\s*Name/i.test(design);
  if (!hasStorageLayout) {
    return {
      decision: 'block',
      reason: 'GATE 1 FAILED: docs/architecture/design.md missing "## Storage Layout" section. Must document storage slot assignments.'
    };
  }

  // Check for external call policy section
  const hasExternalCallPolicy = /##\s*External Call Policy/i.test(design) ||
                                 /Allowed External Calls/i.test(design);
  if (!hasExternalCallPolicy) {
    return {
      decision: 'block',
      reason: 'GATE 1 FAILED: docs/architecture/design.md missing "## External Call Policy" section. Must document allowed external calls.'
    };
  }

  // Check artifact file
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 1 FAILED: .task/architecture.json artifact is missing. Agent must write artifact file.'
    };
  }

  return null; // Valid
}

/**
 * Gate 2: Test Plan Validation
 */
function validateGate2() {
  const testPlanPath = join(DOCS_DIR, 'testing', 'test-plan.md');
  const artifactPath = join(TASK_DIR, 'test-plan.json');
  const threatModelPath = join(TASK_DIR, 'threat-model.json');

  // Check test plan file exists
  const testPlan = readFile(testPlanPath);
  if (!testPlan) {
    return {
      decision: 'block',
      reason: 'GATE 2 FAILED: docs/testing/test-plan.md is missing. Create test plan with invariant mapping.'
    };
  }

  // Check artifact file
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 2 FAILED: .task/test-plan.json artifact is missing. Agent must write artifact file.'
    };
  }

  // Check all invariants are mapped
  const threatModel = readJson(threatModelPath);
  if (threatModel?.invariants) {
    const invariantIds = threatModel.invariants.map(i => i.id);
    const mappedIds = (artifact.invariant_mapping || []).map(m => m.invariant_id);
    const unmapped = invariantIds.filter(id => !mappedIds.includes(id));

    if (unmapped.length > 0) {
      return {
        decision: 'block',
        reason: `GATE 2 FAILED: These invariants have no mapped tests: ${unmapped.join(', ')}. All invariants must have corresponding tests.`
      };
    }
  }

  // Check for attack simulations
  const hasAttackSimulations = /##\s*(Attack Simulations|Reentrancy Tests)/i.test(testPlan) ||
                               (artifact.attack_simulations && artifact.attack_simulations.length > 0);
  if (!hasAttackSimulations) {
    return {
      decision: 'block',
      reason: 'GATE 2 FAILED: docs/testing/test-plan.md missing attack simulations section. Must include attack simulation tests.'
    };
  }

  return null; // Valid
}

/**
 * Gate 3: Implementation Validation
 */
function validateGate3() {
  const artifactPath = join(TASK_DIR, 'impl-result.json');
  const testLogPath = join(REPORTS_DIR, 'forge-test.log');
  const config = loadConfig();

  // Check artifact file
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 3 FAILED: .task/impl-result.json artifact is missing. Agent must write artifact file.'
    };
  }

  // Check status
  if (artifact.status !== 'complete') {
    return {
      decision: 'block',
      reason: `GATE 3 FAILED: Implementation status is "${artifact.status}". Must be "complete" to proceed.`
    };
  }

  // Check test log exists
  if (!existsSync(testLogPath)) {
    return {
      decision: 'block',
      reason: 'GATE 3 FAILED: reports/forge-test.log is missing. Must run forge test and save output.'
    };
  }

  // Check test results
  const testLog = readFile(testLogPath);
  if (testLog && /FAILED|Error:/i.test(testLog) && !/PASSED/i.test(testLog)) {
    return {
      decision: 'block',
      reason: 'GATE 3 FAILED: forge test has failures. All tests must pass before proceeding.'
    };
  }

  // Check invariant tests if enabled
  if (config.enable_invariants) {
    const invariantLogPath = join(REPORTS_DIR, 'invariant-test.log');
    if (!existsSync(invariantLogPath)) {
      return {
        decision: 'block',
        reason: 'GATE 3 FAILED: reports/invariant-test.log is missing. Must run invariant tests (enable_invariants=true).'
      };
    }

    const invariantLog = readFile(invariantLogPath);
    if (invariantLog && /FAILED|Error:|violated/i.test(invariantLog)) {
      return {
        decision: 'block',
        reason: 'GATE 3 FAILED: Invariant tests have failures. All invariants must hold.'
      };
    }
  }

  return null; // Valid
}

/**
 * Gate 4: Static Analysis Validation
 */
function validateGate4() {
  const artifactPath = join(TASK_DIR, 'static-analysis.json');
  const slitherPath = join(REPORTS_DIR, 'slither.json');
  const suppressionsPath = join(DOCS_DIR, 'security', 'suppressions.md');
  const config = loadConfig();

  // Check artifact file
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 4 FAILED: .task/static-analysis.json artifact is missing. Agent must write artifact file.'
    };
  }

  // Check Slither if enabled
  if (config.enable_slither) {
    if (!existsSync(slitherPath)) {
      return {
        decision: 'block',
        reason: 'GATE 4 FAILED: reports/slither.json is missing. Must run Slither (enable_slither=true).'
      };
    }

    // Check for unsuppressed high findings
    if (artifact.unsuppressed_high_findings && artifact.unsuppressed_high_findings.length > 0) {
      const findingIds = artifact.unsuppressed_high_findings.map(f => f.id || f.detector).join(', ');
      return {
        decision: 'block',
        reason: `GATE 4 FAILED: High severity findings without suppression: ${findingIds}. Fix or add justified suppression in docs/security/suppressions.md.`
      };
    }

    // Check suppression file exists if there are suppressions
    if (artifact.suppressions && artifact.suppressions.length > 0) {
      if (!existsSync(suppressionsPath)) {
        return {
          decision: 'block',
          reason: 'GATE 4 FAILED: docs/security/suppressions.md is missing but suppressions claimed. Document all suppressions.'
        };
      }
    }
  }

  return null; // Valid
}

/**
 * Gate 5: Gas/Performance Validation
 */
function validateGate5() {
  const artifactPath = join(TASK_DIR, 'perf-result.json');
  const gasSnapshotsPath = join(REPORTS_DIR, 'gas-snapshots.md');
  const perfReportPath = join(DOCS_DIR, 'performance', 'perf-report.md');
  const snapshotBeforePath = join(REPORTS_DIR, '.gas-snapshot-before');
  const snapshotAfterPath = join(REPORTS_DIR, '.gas-snapshot-after');

  // Check artifact file
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 5 FAILED: .task/perf-result.json artifact is missing. Agent must write artifact file.'
    };
  }

  // Check gas snapshots file
  if (!existsSync(gasSnapshotsPath)) {
    return {
      decision: 'block',
      reason: 'GATE 5 FAILED: reports/gas-snapshots.md is missing. Must document gas optimization results.'
    };
  }

  // Check before/after evidence
  if (!existsSync(snapshotBeforePath) && !existsSync(snapshotAfterPath)) {
    return {
      decision: 'block',
      reason: 'GATE 5 FAILED: No before/after gas snapshots found. Must capture baseline and after measurements.'
    };
  }

  // Check performance report
  if (!existsSync(perfReportPath)) {
    return {
      decision: 'block',
      reason: 'GATE 5 FAILED: docs/performance/perf-report.md is missing. Must document performance analysis.'
    };
  }

  // Check verification status
  if (artifact.verification) {
    if (!artifact.verification.all_tests_pass) {
      return {
        decision: 'block',
        reason: 'GATE 5 FAILED: Tests failed after optimization. Revert changes or fix issues.'
      };
    }
    if (!artifact.verification.all_invariants_pass) {
      return {
        decision: 'block',
        reason: 'GATE 5 FAILED: Invariants failed after optimization. Revert changes or fix issues.'
      };
    }
  }

  return null; // Valid
}

async function main() {
  // Read input from stdin
  let input;
  try {
    const stdin = readFileSync(0, 'utf-8');
    input = JSON.parse(stdin);
  } catch {
    process.exit(0); // No valid input, allow
  }

  const transcriptPath = input.agent_transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    process.exit(0); // No transcript, allow
  }

  // Determine agent type from transcript
  const agentType = getAgentTypeFromTranscript(transcriptPath);

  // Only validate smart contract secure pipeline agents
  if (!agentType || !SC_AGENTS.includes(agentType)) {
    process.exit(0); // Not our agent, allow (will be handled by review-validator if reviewer)
  }

  // Load config for strictness
  const config = loadConfig();
  const isStrict = config.gate_strictness === 'high';

  // Validate based on agent type
  let error = null;

  switch (agentType) {
    case 'claude-codex:threat-modeler':
      error = validateGate0();
      break;
    case 'claude-codex:architect':
      error = validateGate1();
      break;
    case 'claude-codex:test-planner':
      error = validateGate2();
      break;
    case 'claude-codex:sc-implementer':
      error = validateGate3();
      break;
    case 'claude-codex:security-auditor':
      error = validateGate4();
      break;
    case 'claude-codex:perf-optimizer':
      error = validateGate5();
      break;
    case 'claude-codex:sc-code-reviewer':
      // Reviewers are validated by review-validator.js
      process.exit(0);
    default:
      process.exit(0);
  }

  if (error) {
    if (isStrict) {
      console.log(JSON.stringify(error));
    } else {
      // In non-strict mode, warn but don't block
      console.error(`WARNING: ${error.reason}`);
    }
  }

  process.exit(0);
}

// Only run main when executed directly
if (import.meta.main) {
  main().catch(() => {
    process.exit(0); // Fail open on errors
  });
}

// Export for testing
export {
  validateGate0,
  validateGate1,
  validateGate2,
  validateGate3,
  validateGate4,
  validateGate5,
  loadConfig
};
