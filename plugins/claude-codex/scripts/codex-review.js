#!/usr/bin/env node
/**
 * Codex Review Wrapper Script
 *
 * Cross-platform script that invokes Codex CLI for plan/code reviews.
 * Handles platform detection, timeout, session management, validation, and structured output.
 *
 * Usage:
 *   node codex-review.js --type plan --plugin-root /path/to/plugin
 *   node codex-review.js --type code --plugin-root /path/to/plugin
 *   node codex-review.js --type plan --plugin-root /path/to/plugin --resume
 *
 * The script automatically checks for .task/.codex-session-active to determine
 * if this is a first review or subsequent review (resume).
 *
 * Exit codes:
 *   0 - Success (review completed)
 *   1 - Validation error (missing files, invalid output)
 *   2 - Codex CLI error (not installed, auth failure)
 *   3 - Timeout
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ================== CONFIGURATION ==================

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const TASK_DIR = '.task';
const STDERR_FILE = path.join(TASK_DIR, 'codex_stderr.log');

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

const TIMEOUT_MS = loadTimeoutFromConfig('review', DEFAULT_TIMEOUT_MS);

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

// Output file depends on review type (plan vs code)
function getOutputFile(reviewType) {
  // Plan reviews: review-codex.json
  // Code reviews: code-review-codex.json (to match pipeline conventions)
  return reviewType === 'code'
    ? path.join(TASK_DIR, 'code-review-codex.json')
    : path.join(TASK_DIR, 'review-codex.json');
}

// Session markers are scoped by review type to prevent cross-contamination
function getSessionMarker(reviewType) {
  return path.join(TASK_DIR, `.codex-session-${reviewType}`);
}

// ================== ARGUMENT PARSING ==================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { type: null, pluginRoot: null, forceResume: false, changesSummary: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) {
      result.type = args[i + 1];
      i++;
    } else if (args[i] === '--plugin-root' && args[i + 1]) {
      result.pluginRoot = args[i + 1];
      i++;
    } else if (args[i] === '--resume') {
      result.forceResume = true;
    } else if (args[i] === '--changes-summary' && args[i + 1]) {
      result.changesSummary = args[i + 1];
      i++;
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

function writeError(error, phase, reviewType) {
  const outputFile = getOutputFile(reviewType || 'plan');
  writeJson(outputFile, {
    status: 'error',
    error: error,
    phase: phase,
    timestamp: new Date().toISOString()
  });
}

// ================== SESSION MANAGEMENT ==================

function hasActiveSession(reviewType) {
  return fileExists(getSessionMarker(reviewType));
}

function createSessionMarker(reviewType) {
  try {
    fs.writeFileSync(getSessionMarker(reviewType), new Date().toISOString());
  } catch (err) {
    console.error(`Warning: Could not create session marker: ${err.message}`);
  }
}

function removeSessionMarker(reviewType) {
  try {
    const marker = getSessionMarker(reviewType);
    if (fileExists(marker)) {
      fs.unlinkSync(marker);
    }
  } catch (err) {
    console.error(`Warning: Could not remove session marker: ${err.message}`);
  }
}

// ================== INPUT VALIDATION ==================

function validateInputs(args) {
  const errors = [];

  // Check review type
  if (!args.type || !['plan', 'code'].includes(args.type)) {
    errors.push('Invalid or missing --type (must be "plan" or "code")');
  }

  // Check plugin root
  if (!args.pluginRoot) {
    errors.push('Missing --plugin-root');
  } else if (!fileExists(args.pluginRoot)) {
    errors.push(`Plugin root not found: ${args.pluginRoot}`);
  }

  // Check task directory
  if (!fileExists(TASK_DIR)) {
    errors.push('.task directory not found');
  }

  // Check review-specific input files
  if (args.type === 'plan') {
    if (!fileExists(path.join(TASK_DIR, 'plan-refined.json'))) {
      errors.push('Missing .task/plan-refined.json for plan review');
    }
  } else if (args.type === 'code') {
    if (!fileExists(path.join(TASK_DIR, 'impl-result.json'))) {
      errors.push('Missing .task/impl-result.json for code review');
    }
  }

  // Check schema files
  if (args.pluginRoot) {
    const schemaFile = args.type === 'plan'
      ? 'plan-review.schema.json'
      : 'review-result.schema.json';
    const schemaPath = path.join(args.pluginRoot, 'docs', 'schemas', schemaFile);
    if (!fileExists(schemaPath)) {
      errors.push(`Missing schema file: ${schemaPath}`);
    }

    const standardsPath = path.join(args.pluginRoot, 'docs', 'standards.md');
    if (!fileExists(standardsPath)) {
      errors.push(`Missing standards file: ${standardsPath}`);
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
  const schemaFile = args.type === 'plan'
    ? 'plan-review.schema.json'
    : 'review-result.schema.json';
  const schemaPath = path.join(args.pluginRoot, 'docs', 'schemas', schemaFile);
  const standardsPath = path.join(args.pluginRoot, 'docs', 'standards.md');

  const inputFile = args.type === 'plan'
    ? '.task/plan-refined.json'
    : '.task/impl-result.json';

  // Build the review prompt
  let reviewPrompt;

  if (isResume && args.changesSummary) {
    // Resume with changes summary - focused re-review
    reviewPrompt = `Re-review after fixes. Changes made:\n${args.changesSummary}\n\nVerify fixes address previous concerns. Check against ${standardsPath}.`;
  } else if (isResume) {
    // Resume without summary - general re-review
    reviewPrompt = `Re-review ${inputFile}. Previous concerns should be addressed. Verify against ${standardsPath}.`;
  } else {
    // Initial review - point to files, criteria in standards.md
    reviewPrompt = `Review ${inputFile} against ${standardsPath}. Final gate review for ${args.type === 'plan' ? 'plan approval' : 'code quality'}. If unclear, set needs_clarification: true.`;
  }

  // Build command args - output file depends on review type
  const stageConfig = loadCodexStageConfig('review');
  const outputFile = getOutputFile(args.type);
  const cmdArgs = [
    'exec',
    '--full-auto',
    '--skip-git-repo-check',
    '--output-schema', schemaPath,
    '-o', outputFile
  ];

  if (stageConfig?.model) {
    cmdArgs.push('-m', stageConfig.model);
  }
  if (stageConfig?.reasoning) {
    cmdArgs.push('-c', `model_reasoning_effort="${stageConfig.reasoning}"`);
  }

  // Add resume flag if resuming
  if (isResume) {
    cmdArgs.push('resume', '--last');
  }

  // Add the prompt
  cmdArgs.push(reviewPrompt);

  return {
    command: 'codex',
    args: cmdArgs
  };
}

/**
 * Escape argument for Windows shell
 */
function escapeWinArg(arg) {
  // If arg contains spaces or special chars, wrap in double quotes
  // Escape any existing double quotes
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
      // On Windows, npm global commands are .cmd files that require shell
      // Build command string with properly escaped args to avoid DEP0190 warning
      const escapedArgs = cmdConfig.args.map(escapeWinArg);
      const fullCommand = `${cmdConfig.command} ${escapedArgs.join(' ')}`;
      proc = spawn(fullCommand, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });
    } else {
      // On Unix, shell: false is safer and works directly
      proc = spawn(cmdConfig.command, cmdConfig.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });
    }

    proc.stderr.pipe(stderrStream);

    // Set timeout
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
        resolve({ success: true, code: 0 });
      } else {
        // Check stderr for specific errors
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

function validateOutput(reviewType) {
  const outputFile = getOutputFile(reviewType);
  if (!fileExists(outputFile)) {
    return { valid: false, error: 'Output file not created' };
  }

  const output = readJson(outputFile);
  if (!output) {
    return { valid: false, error: 'Output is not valid JSON' };
  }

  if (!output.status) {
    return { valid: false, error: 'Output missing "status" field' };
  }

  // Valid statuses (per updated schemas - both support all four)
  const validStatuses = ['approved', 'needs_changes', 'needs_clarification', 'rejected'];

  if (!validStatuses.includes(output.status)) {
    return { valid: false, error: `Invalid status "${output.status}". Must be one of: ${validStatuses.join(', ')}` };
  }

  // Fix: Properly check summary is a string (not just truthy)
  if (typeof output.summary !== 'string') {
    return { valid: false, error: 'Output missing "summary" field or summary is not a string' };
  }

  return { valid: true, output: output };
}

// ================== MAIN ==================

// Captured for error handling in catch block
let currentReviewType = null;

async function main() {
  const startTime = Date.now();
  const args = parseArgs();
  currentReviewType = args.type; // Capture early for catch block
  const platform = getPlatform();

  // Determine if this is a resume (session active or --resume flag)
  // Session markers are scoped by review type to prevent cross-contamination
  const sessionActive = args.type ? hasActiveSession(args.type) : false;
  const isResume = args.forceResume || sessionActive;

  console.log(JSON.stringify({
    event: 'start',
    type: args.type,
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
    writeError(errorMsg, 'input_validation', args.type);
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

  // Handle session expired - retry without resume
  if (!result.success && result.error === 'session_expired' && isResume) {
    console.log(JSON.stringify({
      event: 'session_expired',
      action: 'retrying_without_resume'
    }));

    // Remove stale session marker (scoped by type)
    removeSessionMarker(args.type);

    // Retry without resume
    const freshCmdConfig = buildCodexCommand(args, false);
    result = await runCodex(freshCmdConfig);
  }

  if (!result.success) {
    let errorMsg;
    let exitCode = 2;

    switch (result.error) {
      case 'timeout':
        errorMsg = `Codex review timed out after ${TIMEOUT_MS / 1000} seconds`;
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
        removeSessionMarker(args.type);
        break;
      default:
        errorMsg = `Codex execution failed with exit code ${result.code}`;
    }

    writeError(errorMsg, 'codex_execution', args.type);
    console.log(JSON.stringify({
      event: 'error',
      phase: 'codex_execution',
      error: result.error,
      code: result.code,
      message: errorMsg
    }));
    process.exit(exitCode);
  }

  // Validate output (pass review type for correct status validation)
  const validation = validateOutput(args.type);
  if (!validation.valid) {
    writeError(validation.error, 'output_validation', args.type);
    console.log(JSON.stringify({
      event: 'error',
      phase: 'output_validation',
      error: validation.error
    }));
    // Do NOT create session marker on validation failure
    process.exit(1);
  }

  // Success - create session marker for future resume (scoped by type)
  createSessionMarker(args.type);

  const durationMs = Date.now() - startTime;
  const reviewStageConfig = loadCodexStageConfig('review');
  const tokenUsage = parseTokenUsage(result.stdout);
  const logData = {
    start_time: new Date(startTime).toISOString(),
    model: reviewStageConfig?.model || 'default',
    reasoning: reviewStageConfig?.reasoning || 'default',
    timeout_ms: TIMEOUT_MS,
    exit_code: 0,
    duration_ms: durationMs,
    status: validation.output.status
  };
  if (tokenUsage) {
    logData.input_tokens = tokenUsage.input_tokens;
    logData.output_tokens = tokenUsage.output_tokens;
    logData.total_tokens = tokenUsage.total_tokens;
  }
  writeExecutionLog(`review-${args.type}`, logData);

  console.log(JSON.stringify({
    event: 'complete',
    status: validation.output.status,
    summary: validation.output.summary,
    needs_clarification: validation.output.needs_clarification || false,
    output_file: getOutputFile(args.type),
    session_marker_created: true
  }));

  process.exit(0);
}

main().catch((err) => {
  writeError(err.message, 'unexpected_error', currentReviewType);
  console.log(JSON.stringify({
    event: 'error',
    phase: 'unexpected_error',
    error: err.message
  }));
  process.exit(1);
});
