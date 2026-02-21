#!/usr/bin/env bun
/**
 * SubagentStop hook that validates gate artifacts for smart-contract-secure pipeline.
 * Runs when ANY subagent finishes, filters to validate gate agents.
 *
 * NEW GATE STRUCTURE:
 * - Gate 0: Codex Design (threat-model, design, test-plan)
 * - Gate 1: Opus Design Review (design-review-opus.md)
 * - Gate 2: Claude Implementation (forge-test.log)
 * - Gate 3: Static Analysis (slither.json)
 * - Gate 4: Gas/Perf (gas-snapshots.md)
 * - Final: Multi-review (Sonnet → Opus → Codex)
 *
 * Input (via stdin JSON):
 * {
 *   "agent_id": "def456",
 *   "agent_transcript_path": "~/.claude/projects/.../subagents/agent-def456.jsonl"
 * }
 *
 * Output (to block):
 * {"decision": "block", "reason": "explanation"}
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { readAndNormalizeJson, validateArtifactExists } from './normalize.js';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');
const REPORTS_DIR = join(PROJECT_DIR, 'reports');

// Agent types for smart contract secure pipeline
const SC_AGENTS = [
  'claude-codex:codex-designer',
  'claude-codex:opus-design-reviewer',
  'claude-codex:sc-implementer',
  'claude-codex:security-auditor',
  'claude-codex:perf-optimizer',
  'claude-codex:sc-code-reviewer',
  // Legacy agents (in case used)
  'claude-codex:threat-modeler',
  'claude-codex:architect',
  'claude-codex:test-planner'
];

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

  const config = readAndNormalizeJson(configPath);
  if (config?.smart_contract_secure) {
    return { ...defaults.smart_contract_secure, ...config.smart_contract_secure };
  }
  return defaults.smart_contract_secure;
}

/**
 * Gate 0: Codex Design Validation
 * Validates threat-model.md, design.md, test-plan.md
 */
function validateGate0() {
  const threatModelPath = join(DOCS_DIR, 'security', 'threat-model.md');
  const designPath = join(DOCS_DIR, 'architecture', 'design.md');
  const testPlanPath = join(DOCS_DIR, 'testing', 'test-plan.md');
  const artifactPath = join(TASK_DIR, 'codex-design.json');

  // Check all three files exist
  const threatModel = readFile(threatModelPath);
  if (!threatModel) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/security/threat-model.md is missing. Codex must create threat model.'
    };
  }

  const design = readFile(designPath);
  if (!design) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/architecture/design.md is missing. Codex must create architecture design.'
    };
  }

  const testPlan = readFile(testPlanPath);
  if (!testPlan) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/testing/test-plan.md is missing. Codex must create test plan.'
    };
  }

  // Check for invariants section in threat model
  const hasInvariants = /##\s*(Invariants|Conservation Invariants|Consistency Invariants)/i.test(threatModel) ||
                        /\b(IC-\d+|IS-\d+|IA-\d+|IT-\d+|IB-\d+)\b/.test(threatModel);
  if (!hasInvariants) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/security/threat-model.md missing invariants. Must include enumerated invariants (IC-*, IS-*, IA-*, IT-*, IB-*).'
    };
  }

  // Check for acceptance criteria
  const hasAcceptanceCriteria = /##\s*Acceptance Criteria/i.test(threatModel) ||
                                /\bAC-SEC-\d+\b/.test(threatModel) ||
                                /\bAC-FUNC-\d+\b/.test(threatModel);
  if (!hasAcceptanceCriteria) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/security/threat-model.md missing acceptance criteria. Must include measurable criteria (AC-SEC-*, AC-FUNC-*).'
    };
  }

  // Check for storage layout in design
  const hasStorageLayout = /##\s*Storage Layout/i.test(design) ||
                           /Slot\s*\|\s*Name/i.test(design);
  if (!hasStorageLayout) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/architecture/design.md missing "## Storage Layout" section.'
    };
  }

  // Check for external call policy in design
  const hasExternalCallPolicy = /##\s*External Call Policy/i.test(design) ||
                                 /Allowed External Calls/i.test(design);
  if (!hasExternalCallPolicy) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/architecture/design.md missing "## External Call Policy" section.'
    };
  }

  // Check test plan has invariant mapping
  const hasInvariantMapping = /Invariant.*Test.*Mapping/i.test(testPlan) ||
                              /\|\s*(IC-\d+|IS-\d+|IA-\d+|IT-\d+|IB-\d+)\s*\|/.test(testPlan);
  if (!hasInvariantMapping) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: docs/testing/test-plan.md missing invariant-to-test mapping table.'
    };
  }

  // Check artifact file
  const artifact = readAndNormalizeJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 0 FAILED: .task/codex-design.json artifact is missing.'
    };
  }

  // Check for unmapped invariants
  if (artifact.unmapped_invariants && artifact.unmapped_invariants.length > 0) {
    return {
      decision: 'block',
      reason: `GATE 0 FAILED: These invariants have no mapped tests: ${artifact.unmapped_invariants.join(', ')}`
    };
  }

  return null; // Valid
}

/**
 * Gate 1: Opus Design Review Validation
 */
function validateGate1() {
  const reviewPath = join(DOCS_DIR, 'reviews', 'design-review-opus.md');
  const artifactPath = join(TASK_DIR, 'design-review-opus.json');

  // Check review file exists
  const review = readFile(reviewPath);
  if (!review) {
    return {
      decision: 'block',
      reason: 'GATE 1 FAILED: docs/reviews/design-review-opus.md is missing.'
    };
  }

  // Check artifact file
  const artifact = readAndNormalizeJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 1 FAILED: .task/design-review-opus.json artifact is missing.'
    };
  }

  // Check status is present
  if (!artifact.status) {
    return {
      decision: 'block',
      reason: 'GATE 1 FAILED: design-review-opus.json missing "status" field.'
    };
  }

  // Valid statuses (normalized to lowercase by readAndNormalizeJson)
  const validStatuses = ['approved', 'needs_changes', 'needs_clarification'];
  if (!validStatuses.includes(artifact.status)) {
    return {
      decision: 'block',
      reason: `GATE 1 FAILED: Invalid status "${artifact.status}". Must be one of: ${validStatuses.join(', ')}`
    };
  }

  // If NEEDS_CHANGES or NEEDS_CLARIFICATION, this is valid but signals loop-back
  // The orchestrator will handle creating fix tasks
  // We don't block here - we let it through so orchestrator can process

  return null; // Valid (orchestrator handles loop-back based on status)
}

/**
 * Gate 2: Implementation Validation
 */
function validateGate2() {
  const artifactPath = join(TASK_DIR, 'impl-result.json');
  const testLogPath = join(REPORTS_DIR, 'forge-test.log');
  const config = loadConfig();

  // Check artifact file
  const artifact = readAndNormalizeJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 2 FAILED: .task/impl-result.json artifact is missing.'
    };
  }

  // Check status
  if (artifact.status !== 'complete') {
    return {
      decision: 'block',
      reason: `GATE 2 FAILED: Implementation status is "${artifact.status}". Must be "complete".`
    };
  }

  // Check test log exists
  if (!existsSync(testLogPath)) {
    return {
      decision: 'block',
      reason: 'GATE 2 FAILED: reports/forge-test.log is missing. Must run forge test.'
    };
  }

  // Check test results
  const testLog = readFile(testLogPath);
  if (testLog && /FAILED|Error:/i.test(testLog) && !/PASSED/i.test(testLog)) {
    return {
      decision: 'block',
      reason: 'GATE 2 FAILED: forge test has failures. All tests must pass.'
    };
  }

  // Check invariant tests if enabled
  if (config.enable_invariants) {
    const invariantLogPath = join(REPORTS_DIR, 'invariant-test.log');
    if (!existsSync(invariantLogPath)) {
      return {
        decision: 'block',
        reason: 'GATE 2 FAILED: reports/invariant-test.log is missing (enable_invariants=true).'
      };
    }

    const invariantLog = readFile(invariantLogPath);
    if (invariantLog && /FAILED|Error:|violated/i.test(invariantLog)) {
      return {
        decision: 'block',
        reason: 'GATE 2 FAILED: Invariant tests have failures.'
      };
    }
  }

  return null; // Valid
}

/**
 * Gate 3: Static Analysis Validation
 */
function validateGate3() {
  const artifactPath = join(TASK_DIR, 'static-analysis.json');
  const slitherPath = join(REPORTS_DIR, 'slither.json');
  const suppressionsPath = join(DOCS_DIR, 'security', 'suppressions.md');
  const config = loadConfig();

  // Check artifact file
  const artifact = readAndNormalizeJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 3 FAILED: .task/static-analysis.json artifact is missing.'
    };
  }

  // Check Slither if enabled
  if (config.enable_slither) {
    if (!existsSync(slitherPath)) {
      return {
        decision: 'block',
        reason: 'GATE 3 FAILED: reports/slither.json is missing (enable_slither=true).'
      };
    }

    // Check for unsuppressed high findings
    if (artifact.unsuppressed_high_findings && artifact.unsuppressed_high_findings.length > 0) {
      const findingIds = artifact.unsuppressed_high_findings.map(f => f.id || f.detector).join(', ');
      return {
        decision: 'block',
        reason: `GATE 3 FAILED: High severity findings without suppression: ${findingIds}. Fix or add justified suppression.`
      };
    }
  }

  return null; // Valid
}

/**
 * Gate 4: Gas/Performance Validation
 */
function validateGate4() {
  const artifactPath = join(TASK_DIR, 'perf-result.json');
  const gasSnapshotsPath = join(REPORTS_DIR, 'gas-snapshots.md');
  const perfReportPath = join(DOCS_DIR, 'performance', 'perf-report.md');
  const snapshotBeforePath = join(REPORTS_DIR, '.gas-snapshot-before');
  const snapshotAfterPath = join(REPORTS_DIR, '.gas-snapshot-after');

  // Check artifact file
  const artifact = readAndNormalizeJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE 4 FAILED: .task/perf-result.json artifact is missing.'
    };
  }

  // Check gas snapshots
  if (!existsSync(gasSnapshotsPath)) {
    return {
      decision: 'block',
      reason: 'GATE 4 FAILED: reports/gas-snapshots.md is missing.'
    };
  }

  // Check before/after evidence
  if (!existsSync(snapshotBeforePath) && !existsSync(snapshotAfterPath)) {
    return {
      decision: 'block',
      reason: 'GATE 4 FAILED: No before/after gas snapshots found.'
    };
  }

  // Check perf report
  if (!existsSync(perfReportPath)) {
    return {
      decision: 'block',
      reason: 'GATE 4 FAILED: docs/performance/perf-report.md is missing.'
    };
  }

  // Check verification status
  if (artifact.verification) {
    if (!artifact.verification.all_tests_pass) {
      return {
        decision: 'block',
        reason: 'GATE 4 FAILED: Tests failed after optimization.'
      };
    }
    if (!artifact.verification.all_invariants_pass) {
      return {
        decision: 'block',
        reason: 'GATE 4 FAILED: Invariants failed after optimization.'
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
    process.exit(0); // Not our agent, allow (may be handled by review-validator)
  }

  // Load config for strictness
  const config = loadConfig();
  const isStrict = config.gate_strictness === 'high';

  // Validate based on agent type
  let error = null;

  switch (agentType) {
    case 'claude-codex:codex-designer':
    case 'claude-codex:threat-modeler': // Legacy
    case 'claude-codex:architect': // Legacy
    case 'claude-codex:test-planner': // Legacy
      error = validateGate0();
      break;
    case 'claude-codex:opus-design-reviewer':
      error = validateGate1();
      break;
    case 'claude-codex:sc-implementer':
      error = validateGate2();
      break;
    case 'claude-codex:security-auditor':
      error = validateGate3();
      break;
    case 'claude-codex:perf-optimizer':
      error = validateGate4();
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
  loadConfig
};
