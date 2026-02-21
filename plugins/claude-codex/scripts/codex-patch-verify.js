#!/usr/bin/env bun
/**
 * Codex Patch Verification Script
 *
 * After Sonnet fixes HIGH/MED findings, Codex independently verifies
 * that patches address the root cause (not just symptoms).
 *
 * EVMbench evidence: Codex scores 41.5% on Patch (highest of all models).
 *
 * Usage:
 *   bun codex-patch-verify.js --run-id <run_id> [--timeout 600000]
 *
 * Environment:
 *   CLAUDE_PROJECT_DIR - Project directory
 *   CLAUDE_PLUGIN_ROOT - Plugin installation directory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { parseArgs } from 'util';
import { execSync, spawn } from 'child_process';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(import.meta.path));
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');

function loadCodexStageConfig(stageKey) {
  try {
    const configPath = join(PROJECT_DIR, '.claude-codex.json');
    if (!existsSync(configPath)) return null;
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return config?.codex_stages?.[stageKey] ?? null;
  } catch {
    return null;
  }
}

function writeExecutionLog(stage, data) {
  try {
    const logsDir = join(PROJECT_DIR, 'reports', 'execution-logs');
    mkdirSync(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = join(logsDir, `${stage}-${timestamp}.log`);
    const content = Object.entries(data)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') + '\n';
    writeFileSync(logFile, content);
  } catch {
    // Non-critical, don't fail
  }
}

/**
 * Parse token usage from Codex CLI output (G9)
 */
function parseTokenUsage(stdout, stderr) {
  const combined = (stdout || '') + '\n' + (stderr || '');
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let found = false;
  const nestedPattern = /"usage"\s*:\s*\{([^}]+)\}/g;
  let match;
  while ((match = nestedPattern.exec(combined)) !== null) {
    try {
      const usageObj = JSON.parse(`{${match[1]}}`);
      usage.input_tokens += usageObj.input_tokens || usageObj.prompt_tokens || 0;
      usage.output_tokens += usageObj.output_tokens || usageObj.completion_tokens || 0;
      found = true;
    } catch { /* skip */ }
  }
  const totalMatch = combined.match(/total[_ ]tokens?\s*[:=]\s*(\d+)/i);
  if (totalMatch && !found) {
    usage.total_tokens = parseInt(totalMatch[1]);
    found = true;
  }
  if (found) {
    usage.total_tokens = usage.total_tokens || (usage.input_tokens + usage.output_tokens);
    return usage;
  }
  return null;
}

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      'findings-path': { type: 'string' },
      'timeout': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: codex-patch-verify.js --run-id <run_id> [options]

Codex Patch Verification: independently verifies fixes address root cause.

Options:
  --run-id          Run ID for this pipeline execution
  --findings-path   Path to findings JSON (default: auto-detect from .task/<run_id>)
  --timeout         Timeout in milliseconds (default: 600000 = 10 minutes)
  -h, --help        Show this help message
    `);
    process.exit(0);
  }

  return values;
}

function readFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Find findings JSON from various possible locations
 */
function findFindings(runId, explicitPath) {
  if (explicitPath && existsSync(explicitPath)) {
    return JSON.parse(readFileSync(explicitPath, 'utf-8'));
  }

  const candidates = [
    join(TASK_DIR, runId, 'redteam-issue-log.json'),
    join(TASK_DIR, runId, 'codex-detect-findings.json'),
    join(TASK_DIR, runId, 'opus-detect-findings.json'),
    join(TASK_DIR, 'redteam-issue-log.json'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const data = JSON.parse(readFileSync(candidate, 'utf-8'));
        console.log(`Found findings at: ${candidate}`);
        return data;
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Extract HIGH/MED findings that need patch verification
 */
function extractVerifiableFindings(findingsData) {
  const findings = findingsData?.findings || findingsData?.issues || [];
  return findings.filter(f => {
    const severity = (f.severity || '').toUpperCase();
    const status = (f.status || '').toUpperCase();
    // Only verify findings that have been fixed (CLOSED or FIXED status)
    // or all HIGH/MED if no status tracking
    return (severity === 'HIGH' || severity === 'MEDIUM' || severity === 'MED') &&
      (status === '' || status === 'CLOSED' || status === 'FIXED' || status === 'PATCHED');
  });
}

/**
 * Get git diff for recent changes (patches)
 */
function getGitDiff(runId) {
  // Try to get diff from stored patches
  const patchDir = join(TASK_DIR, runId, 'patches');
  if (existsSync(patchDir)) {
    try {
      const files = readdirSync(patchDir).filter(f => f.endsWith('.diff') || f.endsWith('.patch'));
      if (files.length > 0) {
        return files.map(f => {
          const content = readFileSync(join(patchDir, f), 'utf-8');
          return `### ${f}\n\`\`\`diff\n${content}\n\`\`\``;
        }).join('\n\n');
      }
    } catch { /* fall through */ }
  }

  // Try git diff
  try {
    const diff = execSync('git diff HEAD~5..HEAD -- "*.sol"', {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 10000
    });
    if (diff.trim()) return diff;
  } catch { /* fall through */ }

  return '(No patch diffs available - Codex should examine current code state)';
}

/**
 * Reset test files to their committed state before running tests.
 * EVMbench Section 3.2.2: "before running the test suite we reset any test files
 * that the agent was not allowed to modify."
 * Returns list of files that were reset.
 */
function resetTestFiles() {
  const resetFiles = [];
  try {
    // Check if we're in a git repo
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 5000
    });

    // Find modified test files (test/**/*.sol, test/**/*.t.sol)
    const modified = execSync('git diff --name-only HEAD -- "test/" 2>/dev/null || true', {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 10000
    }).trim();

    if (modified) {
      const testFiles = modified.split('\n').filter(f => f.endsWith('.sol'));
      for (const file of testFiles) {
        try {
          execSync(`git checkout HEAD -- "${file}"`, {
            cwd: PROJECT_DIR,
            encoding: 'utf-8',
            timeout: 5000
          });
          resetFiles.push(file);
        } catch { /* skip files that can't be reset */ }
      }
      if (resetFiles.length > 0) {
        console.log(`Reset ${resetFiles.length} test file(s) to committed state (EVMbench 3.2.2):`);
        resetFiles.forEach(f => console.log(`  - ${f}`));
      }
    }
  } catch {
    // Not in a git repo or git not available — skip reset
  }
  return resetFiles;
}

/**
 * Get test results summary
 */
function getTestResults() {
  // Reset test files before running tests (EVMbench Section 3.2.2)
  resetTestFiles();

  try {
    const output = execSync('forge test --summary 2>&1 || true', {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 120000
    });
    return output.trim() || '(No test output)';
  } catch {
    return '(Could not run forge test)';
  }
}

/**
 * Write INSTRUCTIONS.md, findings.json, patches.md, and test-results.txt to workspace for exec mode (G6).
 * Returns the workspace path.
 */
function writeWorkspace(findings, diff, testResults, runId) {
  const workspace = join(TASK_DIR, runId, 'patch-verify-workspace');
  ensureDir(workspace);

  // Write findings.json to workspace
  writeFileSync(join(workspace, 'findings.json'), JSON.stringify(findings, null, 2));

  // Write patches.md to workspace
  writeFileSync(join(workspace, 'patches.md'), diff);

  // Write test-results.txt to workspace
  writeFileSync(join(workspace, 'test-results.txt'), testResults);

  const instructions = `# Codex Patch Verification — INSTRUCTIONS

You are a Codex Patch Verifier for a fund-sensitive smart contract audit.

## YOUR MISSION

For each HIGH/MED finding, independently verify that the applied patch addresses the ROOT CAUSE, not just a symptom.

## INPUT FILES

- \`${join(workspace, 'findings.json')}\` — Findings to verify (HIGH/MED severity)
- \`${join(workspace, 'patches.md')}\` — Patch diffs applied to fix findings
- \`${join(workspace, 'test-results.txt')}\` — Current test suite results

## VERIFICATION PROCESS

For each finding:
1. Read the root cause description from findings.json
2. Read the patch diff from patches.md
3. Read the current source code in the project
4. Verify the fix addresses the fundamental issue
5. Check for regression risks (new attack vectors introduced by the fix)
6. Check edge cases (zero values, max values, empty arrays)
7. Verify test coverage exists for the fix
8. Issue verdict: PATCH_VALID or PATCH_INSUFFICIENT

## OUTPUT FILES

Write both files to the workspace directory:

1. **\`${join(workspace, 'codex-patch-verify.md')}\`** — Human-readable verification report
2. **\`${join(workspace, 'codex-patch-verify.json')}\`** — Machine-readable artifact

The JSON artifact MUST follow this schema:
\`\`\`json
{
  "id": "codex-patch-verify-{timestamp}",
  "reviewer": "codex-patch-verifier",
  "model": "codex",
  "patches_verified": [
    {
      "finding_id": "VULN-1",
      "severity": "HIGH",
      "verdict": "PATCH_VALID",
      "root_cause_addressed": true,
      "regression_risk": "LOW",
      "test_coverage": "ADEQUATE",
      "confidence": "HIGH",
      "reasoning": "The fix adds a reentrancy guard that prevents the callback exploit..."
    }
  ],
  "overall_verdict": "ALL_PATCHES_VALID",
  "insufficient_patches": [],
  "generated_at": "..."
}
\`\`\`

## QUALITY CRITERIA

- Every verdict MUST have detailed reasoning with code references
- PATCH_INSUFFICIENT MUST explain what the fix missed
- PATCH_VALID MUST explain why the root cause is resolved
- Regression analysis is REQUIRED for each patch

## BEGIN

Read the source code, understand each finding and its patch, then verify.
`;

  writeFileSync(join(workspace, 'INSTRUCTIONS.md'), instructions);
  return workspace;
}

/**
 * Invoke Codex CLI in exec mode (G6).
 * cwd is PROJECT_DIR (needs source + forge). Workspace INSTRUCTIONS.md referenced by absolute path.
 */
async function invokeCodex(workspace, timeout) {
  return new Promise((resolve, reject) => {
    const codexPath = process.env.CODEX_PATH || 'codex';

    console.log('Invoking Codex CLI (exec mode) for patch verification...');
    console.log(`Timeout: ${timeout}ms (${Math.round(timeout / 60000)} minutes)`);

    const stageConfig = loadCodexStageConfig('patch_verify');

    const args = [
      'exec',
      '--full-auto',
      '--skip-git-repo-check'
    ];

    if (stageConfig?.model) {
      args.push('-m', stageConfig.model);
    }
    if (stageConfig?.reasoning) {
      args.push('-c', `model_reasoning_effort="${stageConfig.reasoning}"`);
    }

    const instructionsPath = join(workspace, 'INSTRUCTIONS.md');
    args.push(`Read ${instructionsPath} and perform patch verification. Write results to the workspace directory specified in INSTRUCTIONS.md.`);

    const child = spawn(codexPath, args, {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: PROJECT_DIR
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Codex timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Codex exited with code ${code}\n${stderr}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Create fallback output if Codex fails
 */
function createFallbackOutput(runId, error) {
  const reviewsDir = join(DOCS_DIR, 'reviews');
  ensureDir(reviewsDir);

  const timestamp = new Date().toISOString();

  writeFileSync(join(reviewsDir, 'codex-patch-verify.md'), `# Codex Patch Verification

**Status:** FAILED
**Date:** ${timestamp}
**Error:** ${error.message}

Run manually: \`bun "${PLUGIN_ROOT}/scripts/codex-patch-verify.js" --run-id ${runId}\`
`);

  const runDir = join(TASK_DIR, runId);
  ensureDir(runDir);
  writeFileSync(join(runDir, 'codex-patch-verify.json'), JSON.stringify({
    id: `codex-patch-verify-${timestamp.replace(/[-:]/g, '').split('.')[0].replace('T', '-')}`,
    reviewer: 'codex-patch-verifier',
    model: 'codex',
    error: error.message,
    status: 'FAILED',
    patches_verified: [],
    overall_verdict: 'FAILED',
    insufficient_patches: [],
    generated_at: timestamp
  }, null, 2));
}

async function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `patch-verify-${Date.now()}`;
  const timeout = parseInt(args.timeout || '600000'); // 10 minutes default

  console.log(`\n=== Codex Patch Verification ===`);
  console.log(`Run ID: ${runId}`);
  console.log(`Timeout: ${timeout}ms`);

  // Find findings
  const findingsData = findFindings(runId, args['findings-path']);
  if (!findingsData) {
    console.error('No findings found. Nothing to verify.');
    console.log(JSON.stringify({ success: true, run_id: runId, findings_count: 0, message: 'No findings to verify' }));
    process.exit(0);
  }

  const verifiableFindings = extractVerifiableFindings(findingsData);
  console.log(`Findings to verify: ${verifiableFindings.length}`);

  if (verifiableFindings.length === 0) {
    console.log('No findings to verify. Patch verification passed by default.');
    console.log(JSON.stringify({ success: true, run_id: runId, findings_count: 0, verdict: 'ALL_PATCHES_VALID' }));
    process.exit(0);
  }

  // Collect context
  const diff = getGitDiff(runId);
  const testResults = getTestResults();

  // Write workspace with INSTRUCTIONS.md, findings.json, patches.md, test-results.txt (G6: exec mode)
  const workspace = writeWorkspace(verifiableFindings, diff, testResults, runId);

  const startTime = Date.now();

  try {
    const result = await invokeCodex(workspace, timeout);
    console.log('\nCodex patch verification completed successfully');

    // Copy outputs from workspace to canonical locations
    const wsJsonPath = join(workspace, 'codex-patch-verify.json');
    const wsMdPath = join(workspace, 'codex-patch-verify.md');
    const jsonPath = join(TASK_DIR, runId, 'codex-patch-verify.json');
    const mdPath = join(DOCS_DIR, 'reviews', 'codex-patch-verify.md');

    if (existsSync(wsJsonPath)) {
      writeFileSync(jsonPath, readFileSync(wsJsonPath, 'utf-8'));
    }
    if (existsSync(wsMdPath)) {
      ensureDir(join(DOCS_DIR, 'reviews'));
      writeFileSync(mdPath, readFileSync(wsMdPath, 'utf-8'));
    }

    if (existsSync(jsonPath)) {
      console.log(`JSON artifact: ${jsonPath}`);
      try {
        const verifyResult = JSON.parse(readFileSync(jsonPath, 'utf-8'));
        console.log(`Overall verdict: ${verifyResult.overall_verdict || 'UNKNOWN'}`);

        // Write patch-closure.json for hook validator (validatePatchClosure)
        const patches = (verifyResult.findings || verifyResult.patches || []).map(f => ({
          finding_id: f.id || f.finding_id || 'unknown',
          status: f.verdict === 'VERIFIED' || f.patch_status === 'applied' ? 'patched' : (f.verdict || f.patch_status || 'unknown'),
          test: f.regression_test || f.test || null
        }));
        if (patches.length > 0) {
          writeFileSync(join(TASK_DIR, 'patch-closure.json'), JSON.stringify({ patches }, null, 2));
          console.log(`Patch closure artifact: ${join(TASK_DIR, 'patch-closure.json')}`);
        }
      } catch { /* ignore */ }
    }

    if (existsSync(mdPath)) {
      console.log(`MD report: ${mdPath}`);
    }

    const durationMs = Date.now() - startTime;
    const patchStageConfig = loadCodexStageConfig('patch_verify');
    const tokenUsage = parseTokenUsage(result.stdout, result.stderr);
    const logData = {
      start_time: new Date(startTime).toISOString(),
      model: patchStageConfig?.model || 'default',
      reasoning: patchStageConfig?.reasoning || 'default',
      timeout_ms: timeout,
      exit_code: 0,
      duration_ms: durationMs,
      run_id: runId,
      findings_count: verifiableFindings.length
    };
    if (tokenUsage) {
      logData.input_tokens = tokenUsage.input_tokens;
      logData.output_tokens = tokenUsage.output_tokens;
      logData.total_tokens = tokenUsage.total_tokens;
    }
    writeExecutionLog('codex-patch-verify', logData);

    console.log(JSON.stringify({
      success: true,
      run_id: runId,
      json_path: jsonPath,
      md_path: mdPath
    }));
  } catch (error) {
    console.error('\nCodex patch verification failed:', error.message);
    createFallbackOutput(runId, error);

    const durationMs = Date.now() - startTime;
    const patchStageConfig = loadCodexStageConfig('patch_verify');
    writeExecutionLog('codex-patch-verify', {
      start_time: new Date(startTime).toISOString(),
      model: patchStageConfig?.model || 'default',
      reasoning: patchStageConfig?.reasoning || 'default',
      timeout_ms: timeout,
      exit_code: 1,
      duration_ms: durationMs,
      run_id: runId,
      error: error.message
    });

    console.log(JSON.stringify({ success: false, run_id: runId, error: error.message }));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
