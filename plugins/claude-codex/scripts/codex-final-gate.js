#!/usr/bin/env node
/**
 * Codex Final Gate Script
 *
 * Cross-platform script that invokes Codex CLI for final gate review.
 * Used by final-gate-codex agent in blind-audit-sc pipeline.
 *
 * Usage:
 *   node codex-final-gate.js --run-id <run_id> --plugin-root /path/to/plugin
 *   node codex-final-gate.js --run-id <run_id> --plugin-root /path/to/plugin --resume
 *
 * Exit codes:
 *   0 - Success (review completed, APPROVED)
 *   1 - Validation error or NEEDS_CHANGES/NEEDS_CLARIFICATION
 *   2 - Codex CLI error (not installed, auth failure)
 *   3 - Timeout
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ================== CONFIGURATION ==================

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes for comprehensive review
const TASK_DIR = '.task';
const DOCS_DIR = 'docs';
const REVIEWS_DIR = path.join(DOCS_DIR, 'reviews');
const STDERR_FILE = path.join(TASK_DIR, 'codex_final_gate_stderr.log');

function loadTimeoutFromConfig(stageKey, defaultMs) {
  try {
    const configPath = path.join(process.cwd(), '.claude-codex.json');
    if (!fs.existsSync(configPath)) return defaultMs;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config?.stage_timeout_ms?.[stageKey] ?? defaultMs;
  } catch {
    return defaultMs;
  }
}

const TIMEOUT_MS = loadTimeoutFromConfig('final_gate', DEFAULT_TIMEOUT_MS);

function loadCodexStageConfig(stageKey) {
  try {
    const configPath = path.join(process.cwd(), '.claude-codex.json');
    if (!fs.existsSync(configPath)) return null;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config?.codex_stages?.[stageKey] ?? null;
  } catch {
    return null;
  }
}

function writeExecutionLog(stage, data) {
  try {
    const logsDir = path.join('reports', 'execution-logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `${stage}-${timestamp}.log`);
    const content = Object.entries(data)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') + '\n';
    fs.writeFileSync(logFile, content);
  } catch {
    // Non-critical, don't fail
  }
}

/**
 * Parse token usage from Codex CLI output (G9)
 */
function parseTokenUsage(output) {
  if (!output) return null;
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let found = false;
  const nestedPattern = /"usage"\s*:\s*\{([^}]+)\}/g;
  let match;
  while ((match = nestedPattern.exec(output)) !== null) {
    try {
      const usageObj = JSON.parse(`{${match[1]}}`);
      usage.input_tokens += usageObj.input_tokens || usageObj.prompt_tokens || 0;
      usage.output_tokens += usageObj.output_tokens || usageObj.completion_tokens || 0;
      found = true;
    } catch { /* skip */ }
  }
  const totalMatch = output.match(/total[_ ]tokens?\s*[:=]\s*(\d+)/i);
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

const OUTPUT_FILE = path.join(REVIEWS_DIR, 'final-codex-gate.md');
const ARTIFACT_FILE = path.join(TASK_DIR, 'final-gate.json');
const SESSION_MARKER = path.join(TASK_DIR, '.codex-session-final-gate');

// ================== ARGUMENT PARSING ==================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { runId: null, pluginRoot: null, forceResume: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run-id' && args[i + 1]) {
      result.runId = args[i + 1];
      i++;
    } else if (args[i] === '--plugin-root' && args[i + 1]) {
      result.pluginRoot = args[i + 1];
      i++;
    } else if (args[i] === '--resume') {
      result.forceResume = true;
    }
  }

  return result;
}

// ================== PLATFORM DETECTION ==================

function getPlatform() {
  const platform = os.platform();
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

function isCodexInstalled() {
  try {
    execSync('codex --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ================== FILE HELPERS ==================

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeError(error, phase) {
  writeJson(ARTIFACT_FILE, {
    status: 'error',
    error: error,
    phase: phase,
    timestamp: new Date().toISOString()
  });
}

// ================== SESSION MANAGEMENT ==================

function hasActiveSession() {
  return fileExists(SESSION_MARKER);
}

function createSessionMarker() {
  try {
    fs.writeFileSync(SESSION_MARKER, new Date().toISOString());
  } catch (err) {
    console.error(`Warning: Could not create session marker: ${err.message}`);
  }
}

function removeSessionMarker() {
  try {
    if (fileExists(SESSION_MARKER)) {
      fs.unlinkSync(SESSION_MARKER);
    }
  } catch (err) {
    console.error(`Warning: Could not remove session marker: ${err.message}`);
  }
}

// ================== INPUT VALIDATION ==================

function validateInputs(args) {
  const errors = [];

  // Check run ID
  if (!args.runId) {
    errors.push('Missing --run-id');
  }

  // Check plugin root
  if (!args.pluginRoot) {
    errors.push('Missing --plugin-root');
  } else if (!fileExists(args.pluginRoot)) {
    errors.push(`Plugin root not found: ${args.pluginRoot}`);
  }

  // Check bundle-final exists
  if (args.runId) {
    const bundleFinalDir = path.join(TASK_DIR, args.runId, 'bundle-final');
    if (!fileExists(bundleFinalDir)) {
      errors.push(`bundle-final directory not found: ${bundleFinalDir}`);
    }

    // Check gate-status.md exists
    const gateStatusPath = path.join(bundleFinalDir, 'gate-status.md');
    if (!fileExists(gateStatusPath)) {
      errors.push(`gate-status.md not found in bundle-final`);
    }
  }

  // Check required review files exist
  const requiredReviews = [
    'docs/reviews/spec-compliance-review.md',
    'docs/reviews/exploit-hunt-review.md'
  ];
  for (const review of requiredReviews) {
    if (!fileExists(review)) {
      errors.push(`Required review not found: ${review}`);
    }
  }

  // Ensure reviews directory exists
  if (!fileExists(REVIEWS_DIR)) {
    try {
      fs.mkdirSync(REVIEWS_DIR, { recursive: true });
    } catch (e) {
      errors.push(`Cannot create reviews directory: ${e.message}`);
    }
  }

  // Check schema file
  if (args.pluginRoot) {
    const schemaPath = path.join(args.pluginRoot, 'docs', 'schemas', 'final-gate.schema.json');
    if (!fileExists(schemaPath)) {
      errors.push(`Final gate schema not found: ${schemaPath}`);
    }
  }

  // Check Codex CLI
  if (!isCodexInstalled()) {
    errors.push('Codex CLI not installed. Install from: https://codex.openai.com');
  }

  return errors;
}

// ================== CODEX EXECUTION ==================

function buildCodexCommand(args, isResume) {
  const bundleFinalDir = path.join(TASK_DIR, args.runId, 'bundle-final');
  const schemaPath = path.join(args.pluginRoot, 'docs', 'schemas', 'final-gate.schema.json');
  const agentPath = path.join(args.pluginRoot, 'agents', 'final-gate-codex.md');
  const templatePath = path.join(args.pluginRoot, 'templates', 'final-codex-gate.template.md');

  let reviewPrompt;

  if (isResume) {
    reviewPrompt = `Continue the final gate review. Complete any remaining checks and output the final decision.
Write review to: ${OUTPUT_FILE}
Write artifact to: ${ARTIFACT_FILE}`;
  } else {
    reviewPrompt = `You are the final gate reviewer for a blind-audit smart contract pipeline.

Follow the agent instructions in: ${agentPath}
Use the review template from: ${templatePath}

The complete bundle is at: ${bundleFinalDir}

Key files to review:
- ${bundleFinalDir}/gate-status.md - Pre-computed gate checklist
- ${bundleFinalDir}/audit-trail.md - Pipeline history
- docs/reviews/spec-compliance-review.md - Stage 3 blind review
- docs/reviews/exploit-hunt-review.md - Stage 4 blind review
- docs/reviews/red-team-issue-log.md - Stage 5 issue closure (if exists)

Gate Checklist to verify:
A. Spec Completeness - invariants numbered, tests mapped, AC measurable
B. Evidence Presence - test logs, gas snapshots exist
C. Static Analysis - Slither findings addressed or suppressed
D. Blind Review Compliance - bundles validated
E. Red-Team Issues Closed - ALL HIGH/MED must be CLOSED
F. Gas Evidence Present - before/after snapshots

Decision criteria:
- APPROVED: All gates PASS, all HIGH/MED closed, only LOW risks remain
- NEEDS_CHANGES: Any gate FAIL, HIGH/MED issues open, implementation drift
- NEEDS_CLARIFICATION: Missing information, conflicting findings

Write your review to: ${OUTPUT_FILE}
Write the artifact JSON to: ${ARTIFACT_FILE}

The artifact must conform to schema at: ${schemaPath}`;
  }

  const stageConfig = loadCodexStageConfig('final_gate');

  const cmdArgs = [
    'exec',
    '--full-auto',
    '--skip-git-repo-check'
  ];

  if (stageConfig?.model) {
    cmdArgs.push('-m', stageConfig.model);
  }
  if (stageConfig?.reasoning) {
    cmdArgs.push('-c', `model_reasoning_effort="${stageConfig.reasoning}"`);
  }

  if (isResume) {
    cmdArgs.push('resume', '--last');
  }

  cmdArgs.push(reviewPrompt);

  return {
    command: 'codex',
    args: cmdArgs
  };
}

function escapeWinArg(arg) {
  if (/[\s"&|<>^]/.test(arg)) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

function runCodex(cmdConfig) {
  return new Promise((resolve) => {
    const stderrStream = fs.createWriteStream(STDERR_FILE);
    let timedOut = false;

    const isWindows = os.platform() === 'win32';
    let proc;

    if (isWindows) {
      const escapedArgs = cmdConfig.args.map(escapeWinArg);
      const fullCommand = `${cmdConfig.command} ${escapedArgs.join(' ')}`;
      proc = spawn(fullCommand, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });
    } else {
      proc = spawn(cmdConfig.command, cmdConfig.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });
    }

    proc.stderr.pipe(stderrStream);

    let stdoutData = '';
    proc.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      stderrStream.end();

      if (timedOut) {
        resolve({ success: false, error: 'timeout', code: 124 });
      } else if (code === 0) {
        resolve({ success: true, code: 0, stdout: stdoutData });
      } else {
        let errorType = 'execution_failed';
        try {
          const stderr = fs.readFileSync(STDERR_FILE, 'utf8');
          if (stderr.includes('authentication') || stderr.includes('auth')) {
            errorType = 'auth_required';
          } else if (stderr.includes('not found') || stderr.includes('command not found')) {
            errorType = 'not_installed';
          } else if (stderr.includes('session') || stderr.includes('expired')) {
            errorType = 'session_expired';
          }
        } catch {}

        resolve({ success: false, error: errorType, code: code });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      stderrStream.end();

      if (err.code === 'ENOENT') {
        resolve({ success: false, error: 'not_installed', code: 127 });
      } else {
        resolve({ success: false, error: 'spawn_error', code: 1, message: err.message });
      }
    });
  });
}

// ================== OUTPUT VALIDATION ==================

function validateOutput() {
  const errors = [];
  const warnings = [];

  // Check review file exists
  if (!fileExists(OUTPUT_FILE)) {
    errors.push('final-codex-gate.md not created');
  } else {
    const review = readFile(OUTPUT_FILE);

    // Check for decision
    const decisionMatch = review.match(/Decision:\s*(APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION)/i);
    if (!decisionMatch) {
      errors.push('final-codex-gate.md missing Decision field');
    }

    // Check for gate checklist
    if (!/Gate Checklist/i.test(review)) {
      warnings.push('final-codex-gate.md may be missing Gate Checklist section');
    }
  }

  // Check artifact file
  if (!fileExists(ARTIFACT_FILE)) {
    warnings.push('final-gate.json artifact not created');
  } else {
    const artifact = readJson(ARTIFACT_FILE);
    if (!artifact) {
      errors.push('final-gate.json is not valid JSON');
    } else if (!artifact.decision) {
      errors.push('final-gate.json missing decision field');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function getDecision() {
  // Try to get decision from artifact first
  const artifact = readJson(ARTIFACT_FILE);
  if (artifact?.decision) {
    return artifact.decision;
  }

  // Fall back to parsing markdown
  const review = readFile(OUTPUT_FILE);
  if (review) {
    const match = review.match(/Decision:\s*(APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION)/i);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return 'UNKNOWN';
}

// ================== MAIN ==================

async function main() {
  const startTime = Date.now();
  const args = parseArgs();
  const platform = getPlatform();

  const sessionActive = hasActiveSession();
  const isResume = args.forceResume || sessionActive;

  console.log(JSON.stringify({
    event: 'start',
    runId: args.runId,
    pluginRoot: args.pluginRoot,
    platform: platform,
    isResume: isResume,
    sessionActive: sessionActive,
    timestamp: new Date().toISOString()
  }));

  // Validate inputs
  const validationErrors = validateInputs(args);
  if (validationErrors.length > 0) {
    const errorMsg = validationErrors.join('; ');
    writeError(errorMsg, 'input_validation');
    console.log(JSON.stringify({
      event: 'error',
      phase: 'input_validation',
      errors: validationErrors
    }));
    process.exit(1);
  }

  // Build and run Codex command
  const cmdConfig = buildCodexCommand(args, isResume);
  console.log(JSON.stringify({
    event: 'invoking_codex',
    command: cmdConfig.command,
    isResume: isResume,
    timeout_ms: TIMEOUT_MS
  }));

  let result = await runCodex(cmdConfig);

  // Handle session expired
  if (!result.success && result.error === 'session_expired' && isResume) {
    console.log(JSON.stringify({
      event: 'session_expired',
      action: 'retrying_without_resume'
    }));

    removeSessionMarker();
    const freshCmdConfig = buildCodexCommand(args, false);
    result = await runCodex(freshCmdConfig);
  }

  if (!result.success) {
    let errorMsg;
    let exitCode = 2;

    switch (result.error) {
      case 'timeout':
        errorMsg = `Codex final gate timed out after ${TIMEOUT_MS / 1000} seconds`;
        exitCode = 3;
        break;
      case 'auth_required':
        errorMsg = 'Codex authentication required. Run: codex auth';
        break;
      case 'not_installed':
        errorMsg = 'Codex CLI not installed. Install from: https://codex.openai.com';
        break;
      case 'session_expired':
        errorMsg = 'Codex session expired and retry failed';
        removeSessionMarker();
        break;
      default:
        errorMsg = `Codex execution failed with exit code ${result.code}`;
    }

    writeError(errorMsg, 'codex_execution');
    console.log(JSON.stringify({
      event: 'error',
      phase: 'codex_execution',
      error: result.error,
      code: result.code,
      message: errorMsg
    }));
    process.exit(exitCode);
  }

  // Validate output
  const validation = validateOutput();

  if (!validation.valid) {
    writeError(validation.errors.join('; '), 'output_validation');
    console.log(JSON.stringify({
      event: 'error',
      phase: 'output_validation',
      errors: validation.errors,
      warnings: validation.warnings
    }));
    process.exit(1);
  }

  // Get decision
  const decision = getDecision();

  // Success - create session marker
  createSessionMarker();

  const exitCode = decision === 'APPROVED' ? 0 : 1;
  const durationMs = Date.now() - startTime;
  const gateStageConfig = loadCodexStageConfig('final_gate');
  const tokenUsage = parseTokenUsage(result.stdout);
  const logData = {
    start_time: new Date(startTime).toISOString(),
    model: gateStageConfig?.model || 'default',
    reasoning: gateStageConfig?.reasoning || 'default',
    timeout_ms: TIMEOUT_MS,
    exit_code: exitCode,
    duration_ms: durationMs,
    decision: decision
  };
  if (tokenUsage) {
    logData.input_tokens = tokenUsage.input_tokens;
    logData.output_tokens = tokenUsage.output_tokens;
    logData.total_tokens = tokenUsage.total_tokens;
  }
  writeExecutionLog('final-gate', logData);

  console.log(JSON.stringify({
    event: 'complete',
    decision: decision,
    output_file: OUTPUT_FILE,
    artifact_file: ARTIFACT_FILE,
    warnings: validation.warnings,
    session_marker_created: true
  }));

  // Exit with code 0 only if APPROVED
  process.exit(exitCode);
}

main().catch((err) => {
  writeError(err.message, 'unexpected_error');
  console.log(JSON.stringify({
    event: 'error',
    phase: 'unexpected_error',
    error: err.message
  }));
  process.exit(1);
});
