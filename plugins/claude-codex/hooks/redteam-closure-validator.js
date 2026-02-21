#!/usr/bin/env bun
/**
 * Red-Team Closure Validator Hook
 *
 * Validates Gate E: All HIGH/MED issues must be CLOSED before final gate.
 * Runs when redteam-verifier agent completes.
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

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { readAndNormalizeJson } from './normalize.js';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');

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
    blind_audit_sc: {
      require_regression_tests: true,
      gate_strictness: 'high'
    }
  };

  const config = readAndNormalizeJson(configPath);
  if (config?.blind_audit_sc) {
    return { ...defaults.blind_audit_sc, ...config.blind_audit_sc };
  }
  return defaults.blind_audit_sc;
}

/**
 * Parse issue log to extract issues and their statuses
 */
function parseIssueLog(content) {
  const issues = [];

  // Match issue blocks: ## RT-001 ... Status: OPEN|FIXED_PENDING_VERIFY|CLOSED
  const issueBlockRegex = /##\s*(RT-\d+)[\s\S]*?(?=##\s*RT-\d+|$)/g;
  const blocks = [...content.matchAll(issueBlockRegex)];

  for (const block of blocks) {
    const id = block[1];
    const blockContent = block[0];

    // Extract severity
    const severityMatch = blockContent.match(/Severity:\s*(HIGH|MED|LOW)/i);
    const severity = severityMatch ? severityMatch[1].toUpperCase() : 'UNKNOWN';

    // Extract status
    const statusMatch = blockContent.match(/Status:\s*(OPEN|FIXED_PENDING_VERIFY|CLOSED)/i);
    const status = statusMatch ? statusMatch[1].toUpperCase() : 'UNKNOWN';

    // Extract title
    const titleMatch = blockContent.match(/Title:\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Unknown';

    // Extract regression test
    const testMatch = blockContent.match(/Regression Test Required:\s*(.+)/i);
    const regressionTest = testMatch ? testMatch[1].trim() : null;

    // Check if test verified
    const testVerifiedMatch = blockContent.match(/Test Verified:\s*(Yes|No)/i);
    const testVerified = testVerifiedMatch ? testVerifiedMatch[1].toLowerCase() === 'yes' : false;

    issues.push({
      id,
      severity,
      status,
      title,
      regressionTest,
      testVerified
    });
  }

  return issues;
}

/**
 * Check ALL detection sources (Stage 4 + adversarial) for HIGH/MED findings.
 * Sources: exploit-hunt-review.md, opus-attack-plan.md, codex-deep-exploit-review.md,
 *          dispute-resolution.md, and consolidated-findings.json.
 */
function checkAnySourceHasHighMed() {
  const highMedPattern = /Severity:\s*(HIGH|MED)/i;
  const tablePattern = /\|\s*(HIGH|MED)\s*\|/;

  // Check consolidated-findings.json first (Stage 4.5 output)
  // Must filter to HIGH/MED only — not just any findings existence
  const consolidatedPath = join(TASK_DIR, 'consolidated-findings.json');
  const consolidated = readAndNormalizeJson(consolidatedPath);
  if (consolidated?.findings?.some(f => /^(HIGH|MED)$/i.test(f.severity))) {
    return true;
  }
  // Also check run-scoped consolidated findings
  try {
    const taskFiles = existsSync(TASK_DIR) ? readdirSync(TASK_DIR, { withFileTypes: true }) : [];
    for (const entry of taskFiles) {
      if (!entry.isDirectory()) continue;
      const runConsolidated = join(TASK_DIR, entry.name, 'consolidated-findings.json');
      const data = readAndNormalizeJson(runConsolidated);
      if (data?.findings?.some(f => /^(HIGH|MED)$/i.test(f.severity))) return true;
    }
  } catch { /* ignore — fail open for file system errors, markdown checks below provide backup */ }

  // Check all markdown review sources
  const reviewFiles = [
    join(DOCS_DIR, 'reviews', 'exploit-hunt-review.md'),
    join(DOCS_DIR, 'reviews', 'opus-attack-plan.md'),
    join(DOCS_DIR, 'reviews', 'codex-deep-exploit-review.md'),
    join(DOCS_DIR, 'reviews', 'dispute-resolution.md'),
  ];

  for (const filePath of reviewFiles) {
    const content = readFile(filePath);
    if (content && (highMedPattern.test(content) || tablePattern.test(content))) {
      return true;
    }
  }

  return false;
}

/**
 * Validate Gate E: Red-Team Closure
 */
function validateGateE() {
  const config = loadConfig();
  const issueLogPath = join(DOCS_DIR, 'reviews', 'red-team-issue-log.md');
  const artifactPath = join(TASK_DIR, 'red-team-issues.json');

  // Check issue log exists
  const issueLog = readFile(issueLogPath);
  if (!issueLog) {
    // No issue log might mean no issues found - check ALL detection sources
    // (exploit hunt + adversarial stages + consolidated findings)
    const hasHighMed = checkAnySourceHasHighMed();
    if (hasHighMed) {
      return {
        decision: 'block',
        reason: 'GATE E FAILED: Detection stages found HIGH/MED issues but no red-team-issue-log.md exists.'
      };
    }

    // No issues found, gate passes
    return null;
  }

  // Parse issues
  const issues = parseIssueLog(issueLog);

  // Filter HIGH and MED issues
  const highMedIssues = issues.filter(i => ['HIGH', 'MED'].includes(i.severity));

  if (highMedIssues.length === 0) {
    // No HIGH/MED issues, gate passes
    return null;
  }

  // Check all HIGH/MED are CLOSED
  const openIssues = highMedIssues.filter(i => i.status !== 'CLOSED');

  if (openIssues.length > 0) {
    const openList = openIssues.map(i => `${i.id} (${i.severity}): ${i.title} - ${i.status}`).join('\n  ');
    return {
      decision: 'block',
      reason: `GATE E FAILED: ${openIssues.length} HIGH/MED issues not CLOSED:\n  ${openList}`
    };
  }

  // Check regression tests if required
  if (config.require_regression_tests) {
    const missingTests = highMedIssues.filter(i =>
      !i.regressionTest || i.regressionTest === '-' || i.regressionTest.toLowerCase() === 'pending'
    );

    if (missingTests.length > 0) {
      const missingList = missingTests.map(i => `${i.id}: ${i.title}`).join(', ');
      return {
        decision: 'block',
        reason: `GATE E FAILED: Missing regression tests for: ${missingList}`
      };
    }

    // Check tests are verified
    const unverifiedTests = highMedIssues.filter(i => !i.testVerified);
    if (unverifiedTests.length > 0) {
      const unverifiedList = unverifiedTests.map(i => `${i.id}: ${i.title}`).join(', ');
      return {
        decision: 'block',
        reason: `GATE E FAILED: Unverified regression tests for: ${unverifiedList}`
      };
    }
  }

  // Validate red-team-issues.json artifact if present (written by redteam-verifier agent)
  const artifact = readAndNormalizeJson(artifactPath);
  if (artifact && artifact.ready_for_final_gate === false) {
    return {
      decision: 'block',
      reason: 'GATE E FAILED: red-team-issues.json shows ready_for_final_gate=false'
    };
  }

  return null; // All validations passed
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

  // Only validate for redteam-verifier and final-gate-codex
  const relevantAgents = [
    'claude-codex:redteam-verifier',
    'claude-codex:final-gate-codex'
  ];

  if (!agentType || !relevantAgents.includes(agentType)) {
    process.exit(0); // Not our agent
  }

  const config = loadConfig();
  const isStrict = config.gate_strictness === 'high';

  const error = validateGateE();

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
  validateGateE,
  parseIssueLog,
  loadConfig
};
