#!/usr/bin/env bun
/**
 * Bundle Validator Hook
 *
 * Validates blindness constraints for blind-audit pipeline bundles.
 * - Stage 3 bundle must NOT contain code
 * - Stage 4 bundle must NOT contain spec prose
 *
 * Runs as SubagentStop hook when bundle generation agents complete.
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

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');

// Patterns that indicate code content
const CODE_PATTERNS = [
  /pragma\s+solidity/i,
  /contract\s+\w+\s*\{/,
  /function\s+\w+\s*\([^)]*\)\s*(external|public|internal|private)/,
  /mapping\s*\([^)]+\)/,
  /event\s+\w+\s*\([^)]*\)\s*;/,
  /error\s+\w+\s*\([^)]*\)\s*;/,
  /import\s+["'][^"']+\.sol["']/,
  /interface\s+\w+\s*\{[\s\S]*?function/
];

// Patterns that indicate spec prose content
const SPEC_PROSE_PATTERNS = [
  /##\s*(Trust Assumptions|Attacker Classes)/i,
  /##\s*(Attack Surface|Attack Vectors)/i,
  /##\s*(Assets at Risk)/i,
  /##\s*(Motivation|Why|Rationale)/i,
  /\|\s*Role\s*\|\s*Powers\s*\|/i,  // Trust assumptions table
  /\|\s*Class\s*\|\s*Capabilities\s*\|/i,  // Attacker classes table
  /\|\s*Entry Point\s*\|\s*Risk Level\s*\|/i  // Attack surface table
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

/**
 * Find the most recent run directory
 */
function findLatestRunDir() {
  if (!existsSync(TASK_DIR)) return null;

  const entries = readdirSync(TASK_DIR, { withFileTypes: true });
  const runDirs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('blind-audit-'))
    .map(e => ({
      name: e.name,
      path: join(TASK_DIR, e.name),
      timestamp: parseInt(e.name.replace('blind-audit-', '')) || 0
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  return runDirs[0]?.path || null;
}

/**
 * Check if content contains code patterns
 */
function containsCode(content) {
  for (const pattern of CODE_PATTERNS) {
    if (pattern.test(content)) {
      return { hasCode: true, pattern: pattern.toString() };
    }
  }
  return { hasCode: false };
}

/**
 * Check if content contains spec prose patterns
 */
function containsSpecProse(content) {
  for (const pattern of SPEC_PROSE_PATTERNS) {
    if (pattern.test(content)) {
      return { hasProse: true, pattern: pattern.toString() };
    }
  }
  return { hasProse: false };
}

/**
 * Validate Stage 3 bundle (NO CODE)
 */
function validateStage3Bundle(bundleDir) {
  const violations = [];

  function checkDir(dir) {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        checkDir(fullPath);
      } else if (entry.isFile()) {
        // Check for .sol files
        if (entry.name.endsWith('.sol')) {
          violations.push({
            type: 'SOLIDITY_FILE',
            file: fullPath,
            message: `Stage 3 bundle contains Solidity file: ${entry.name}`
          });
          continue;
        }

        // Check file content for code patterns
        const content = readFile(fullPath);
        if (content) {
          const result = containsCode(content);
          if (result.hasCode) {
            // Allow code patterns in design.md for interface specs
            if (!fullPath.includes('design') && !fullPath.includes('MANIFEST')) {
              violations.push({
                type: 'CODE_CONTENT',
                file: fullPath,
                pattern: result.pattern,
                message: `Stage 3 file contains code pattern: ${entry.name}`
              });
            }
          }
        }
      }
    }
  }

  checkDir(bundleDir);
  return violations;
}

/**
 * Validate Stage 4 bundle (NO SPEC PROSE)
 */
function validateStage4Bundle(bundleDir) {
  const violations = [];

  function checkDir(dir) {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip src/ and test/ directories - code is allowed
        if (['src', 'test'].includes(entry.name)) {
          continue;
        }
        checkDir(fullPath);
      } else if (entry.isFile()) {
        // Check for forbidden spec files
        const forbiddenFiles = ['threat-model.md', 'design.md', 'test-plan.md'];
        if (forbiddenFiles.includes(entry.name)) {
          violations.push({
            type: 'SPEC_FILE',
            file: fullPath,
            message: `Stage 4 bundle contains spec file: ${entry.name}`
          });
          continue;
        }

        // Check file content for spec prose patterns (skip code files)
        if (!fullPath.includes('/src/') && !fullPath.includes('/test/')) {
          const content = readFile(fullPath);
          if (content) {
            const result = containsSpecProse(content);
            if (result.hasProse) {
              violations.push({
                type: 'SPEC_PROSE',
                file: fullPath,
                pattern: result.pattern,
                message: `Stage 4 file contains spec prose: ${entry.name}`
              });
            }
          }
        }
      }
    }
  }

  checkDir(bundleDir);
  return violations;
}

/**
 * Load blind-audit config
 */
function loadConfig() {
  const configPath = join(PROJECT_DIR, '.claude-codex.json');
  const defaults = {
    blind_audit_sc: {
      blind_enforcement: 'strict'
    }
  };

  const config = readJson(configPath);
  if (config?.blind_audit_sc) {
    return { ...defaults.blind_audit_sc, ...config.blind_audit_sc };
  }
  return defaults.blind_audit_sc;
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

  // Only validate for blind-audit pipeline
  const agentType = getAgentTypeFromTranscript(transcriptPath);

  // Check if this is a bundle generation or related agent
  const bundleAgents = [
    'claude-codex:strategist-codex',
    'claude-codex:spec-compliance-reviewer',
    'claude-codex:exploit-hunter',
    'claude-codex:sc-implementer'
  ];

  if (!agentType || !bundleAgents.includes(agentType)) {
    process.exit(0); // Not a bundle-related agent
  }

  // Find the latest run directory
  const runDir = findLatestRunDir();
  if (!runDir) {
    process.exit(0); // No run directory yet
  }

  const config = loadConfig();
  const isStrict = config.blind_enforcement === 'strict';

  let allViolations = [];

  // Validate Stage 3 bundle if it exists
  const stage3Dir = join(runDir, 'bundle-stage3');
  if (existsSync(stage3Dir)) {
    const stage3Violations = validateStage3Bundle(stage3Dir);
    allViolations.push(...stage3Violations);
  }

  // Validate Stage 4 bundle if it exists
  const stage4Dir = join(runDir, 'bundle-stage4');
  if (existsSync(stage4Dir)) {
    const stage4Violations = validateStage4Bundle(stage4Dir);
    allViolations.push(...stage4Violations);
  }

  if (allViolations.length > 0) {
    const errorMsg = `BLINDNESS VIOLATION (Gate C): ${allViolations.length} violations found:\n` +
      allViolations.map(v => `  - ${v.message}`).join('\n');

    if (isStrict) {
      console.log(JSON.stringify({
        decision: 'block',
        reason: errorMsg
      }));
    } else {
      // In non-strict mode, warn but don't block
      console.error(`WARNING: ${errorMsg}`);
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
  validateStage3Bundle,
  validateStage4Bundle,
  containsCode,
  containsSpecProse,
  CODE_PATTERNS,
  SPEC_PROSE_PATTERNS
};
