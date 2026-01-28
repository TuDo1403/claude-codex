#!/usr/bin/env bun
/**
 * Blind-Audit Gate Validator Hook
 *
 * Validates gate artifacts for blind-audit-sc pipeline.
 * Runs when subagents complete to check gate criteria.
 *
 * Gates validated:
 * - Gate A: Spec Completeness (invariants, test mapping, AC measurable)
 * - Gate B: Evidence Presence (test logs, gas snapshots)
 * - Gate D: Review Schema (required sections in reviews)
 * - Gate F: Final Gate (all gates green, decision)
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

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');
const REPORTS_DIR = join(PROJECT_DIR, 'reports');

// Agent types for blind-audit pipeline
const BLIND_AUDIT_AGENTS = [
  'claude-codex:strategist-codex',
  'claude-codex:spec-compliance-reviewer',
  'claude-codex:exploit-hunter',
  'claude-codex:redteam-verifier',
  'claude-codex:final-gate-codex',
  'claude-codex:sc-implementer'
];

function readFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
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
    blind_audit_sc: {
      enable_invariants: true,
      require_slither: true,
      min_fuzz_runs: 5000,
      gate_strictness: 'high'
    }
  };

  const config = readJson(configPath);
  if (config?.blind_audit_sc) {
    return { ...defaults.blind_audit_sc, ...config.blind_audit_sc };
  }
  return defaults.blind_audit_sc;
}

/**
 * Gate A: Spec Completeness Validation
 * Validates strategist-codex output
 */
function validateGateA() {
  const threatModelPath = join(DOCS_DIR, 'security', 'threat-model.md');
  const designPath = join(DOCS_DIR, 'architecture', 'design.md');
  const testPlanPath = join(DOCS_DIR, 'testing', 'test-plan.md');
  const artifactPath = join(TASK_DIR, 'codex-spec.json');

  // Check all three files exist
  const threatModel = readFile(threatModelPath);
  if (!threatModel) {
    return {
      decision: 'block',
      reason: 'GATE A FAILED: docs/security/threat-model.md is missing.'
    };
  }

  const design = readFile(designPath);
  if (!design) {
    return {
      decision: 'block',
      reason: 'GATE A FAILED: docs/architecture/design.md is missing.'
    };
  }

  const testPlan = readFile(testPlanPath);
  if (!testPlan) {
    return {
      decision: 'block',
      reason: 'GATE A FAILED: docs/testing/test-plan.md is missing.'
    };
  }

  // Check for invariants (numbered IC-*, IS-*, IA-*, IT-*, IB-*)
  const invariantCategories = ['IC', 'IS', 'IA', 'IT', 'IB'];
  const foundCategories = [];
  for (const cat of invariantCategories) {
    if (new RegExp(`${cat}-\\d+`).test(threatModel)) {
      foundCategories.push(cat);
    }
  }

  if (foundCategories.length === 0) {
    return {
      decision: 'block',
      reason: 'GATE A FAILED: No numbered invariants found (IC-*, IS-*, IA-*, IT-*, IB-*).'
    };
  }

  // Check for acceptance criteria
  const hasAC = /AC-(SEC|FUNC)-\d+/.test(threatModel);
  if (!hasAC) {
    return {
      decision: 'block',
      reason: 'GATE A FAILED: No acceptance criteria found (AC-SEC-*, AC-FUNC-*).'
    };
  }

  // Check for invariant-test mapping in test plan
  const hasMapping = /Invariant.*Test.*Mapping/i.test(testPlan) ||
                     /\|\s*(IC|IS|IA|IT|IB)-\d+\s*\|/.test(testPlan);
  if (!hasMapping) {
    return {
      decision: 'block',
      reason: 'GATE A FAILED: No invariant-test mapping table in test-plan.md.'
    };
  }

  // Check artifact
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE A FAILED: .task/codex-spec.json artifact missing.'
    };
  }

  if (artifact.unmapped_invariants && artifact.unmapped_invariants.length > 0) {
    return {
      decision: 'block',
      reason: `GATE A FAILED: Unmapped invariants: ${artifact.unmapped_invariants.join(', ')}`
    };
  }

  return null; // Valid
}

/**
 * Gate B: Evidence Presence Validation
 * Validates implementation outputs
 */
function validateGateB() {
  const config = loadConfig();

  // Check forge test log
  const testLogPath = join(REPORTS_DIR, 'forge-test.log');
  if (!existsSync(testLogPath)) {
    return {
      decision: 'block',
      reason: 'GATE B FAILED: reports/forge-test.log missing.'
    };
  }

  const testLog = readFile(testLogPath);
  if (testLog && /FAILED|Error:.*fail/i.test(testLog) && !/All tests passed/i.test(testLog)) {
    // Check more carefully - look for actual test failures
    const failCount = (testLog.match(/\[FAIL/g) || []).length;
    const passCount = (testLog.match(/\[PASS/g) || []).length;
    if (failCount > 0 && passCount === 0) {
      return {
        decision: 'block',
        reason: 'GATE B FAILED: forge tests have failures.'
      };
    }
  }

  // Check invariant tests if enabled
  if (config.enable_invariants) {
    const invariantLogPath = join(REPORTS_DIR, 'invariant-test.log');
    // Invariant log is optional but if present, must not have violations
    if (existsSync(invariantLogPath)) {
      const invariantLog = readFile(invariantLogPath);
      if (invariantLog && /violated|FAILED/i.test(invariantLog)) {
        return {
          decision: 'block',
          reason: 'GATE B FAILED: Invariant test violations detected.'
        };
      }
    }
  }

  // Check gas snapshots
  const hasGasSnapshot = existsSync(join(REPORTS_DIR, '.gas-snapshot')) ||
                         existsSync(join(REPORTS_DIR, '.gas-snapshot-after')) ||
                         existsSync(join(REPORTS_DIR, 'gas-snapshots.md'));
  if (!hasGasSnapshot) {
    return {
      decision: 'block',
      reason: 'GATE B FAILED: No gas snapshot evidence found.'
    };
  }

  return null; // Valid
}

/**
 * Gate D: Review Schema Validation
 * Validates review outputs have required sections
 */
function validateGateD_SpecCompliance() {
  const reviewPath = join(DOCS_DIR, 'reviews', 'spec-compliance-review.md');
  const artifactPath = join(TASK_DIR, 'spec-compliance-review.json');

  const review = readFile(reviewPath);
  if (!review) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: spec-compliance-review.md missing.'
    };
  }

  // Check required sections
  const hasDecision = /Decision:\s*(APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION)/.test(review);
  if (!hasDecision) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: spec-compliance-review.md missing Decision field.'
    };
  }

  const hasInvariantAudit = /Invariant.*Test.*Mapping.*Audit/i.test(review) ||
                            /\|\s*Invariant\s*\|.*\|\s*Verdict\s*\|/i.test(review);
  if (!hasInvariantAudit) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: spec-compliance-review.md missing Invariant-Test Mapping Audit section.'
    };
  }

  const hasACaudit = /Acceptance Criteria Audit/i.test(review);
  if (!hasACaudit) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: spec-compliance-review.md missing Acceptance Criteria Audit section.'
    };
  }

  // Check artifact
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: .task/spec-compliance-review.json missing.'
    };
  }

  return null; // Valid
}

function validateGateD_ExploitHunt() {
  const reviewPath = join(DOCS_DIR, 'reviews', 'exploit-hunt-review.md');
  const artifactPath = join(TASK_DIR, 'exploit-hunt-review.json');

  const review = readFile(reviewPath);
  if (!review) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: exploit-hunt-review.md missing.'
    };
  }

  // Check required sections
  const hasDecision = /Decision:\s*(APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION)/.test(review);
  if (!hasDecision) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: exploit-hunt-review.md missing Decision field.'
    };
  }

  const hasHypotheses = /Attempted Exploit Hypotheses/i.test(review) ||
                        /Hypothesis \d+:/i.test(review);
  if (!hasHypotheses) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: exploit-hunt-review.md missing Attempted Exploit Hypotheses section.'
    };
  }

  const hasInvariantCoverage = /Invariant Coverage/i.test(review);
  if (!hasInvariantCoverage) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: exploit-hunt-review.md missing Invariant Coverage section.'
    };
  }

  // Check artifact
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE D FAILED: .task/exploit-hunt-review.json missing.'
    };
  }

  return null; // Valid
}

/**
 * Gate F: Final Gate Validation
 */
function validateGateF() {
  const reviewPath = join(DOCS_DIR, 'reviews', 'final-codex-gate.md');
  const artifactPath = join(TASK_DIR, 'final-gate.json');

  const review = readFile(reviewPath);
  if (!review) {
    return {
      decision: 'block',
      reason: 'GATE F FAILED: final-codex-gate.md missing.'
    };
  }

  // Check decision
  const decisionMatch = review.match(/Decision:\s*(APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION)/);
  if (!decisionMatch) {
    return {
      decision: 'block',
      reason: 'GATE F FAILED: final-codex-gate.md missing Decision field.'
    };
  }

  const decision = decisionMatch[1];
  if (decision !== 'APPROVED') {
    return {
      decision: 'block',
      reason: `GATE F FAILED: Final gate decision is ${decision}, not APPROVED.`
    };
  }

  // Check gate checklist
  const hasChecklist = /Gate Checklist/i.test(review);
  if (!hasChecklist) {
    return {
      decision: 'block',
      reason: 'GATE F FAILED: final-codex-gate.md missing Gate Checklist section.'
    };
  }

  // Check artifact
  const artifact = readJson(artifactPath);
  if (!artifact) {
    return {
      decision: 'block',
      reason: 'GATE F FAILED: .task/final-gate.json missing.'
    };
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

  // Determine agent type
  const agentType = getAgentTypeFromTranscript(transcriptPath);

  // Only validate blind-audit pipeline agents
  if (!agentType || !BLIND_AUDIT_AGENTS.includes(agentType)) {
    process.exit(0); // Not our agent
  }

  const config = loadConfig();
  const isStrict = config.gate_strictness === 'high';

  let error = null;

  switch (agentType) {
    case 'claude-codex:strategist-codex':
      error = validateGateA();
      break;
    case 'claude-codex:sc-implementer':
      error = validateGateB();
      break;
    case 'claude-codex:spec-compliance-reviewer':
      error = validateGateD_SpecCompliance();
      break;
    case 'claude-codex:exploit-hunter':
      error = validateGateD_ExploitHunt();
      break;
    case 'claude-codex:final-gate-codex':
      error = validateGateF();
      break;
    default:
      process.exit(0);
  }

  if (error) {
    if (isStrict) {
      console.log(JSON.stringify(error));
    } else {
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
  validateGateA,
  validateGateB,
  validateGateD_SpecCompliance,
  validateGateD_ExploitHunt,
  validateGateF,
  loadConfig
};
