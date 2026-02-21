#!/usr/bin/env node
/**
 * Codex Requirements Gathering Script
 *
 * Cross-platform script that invokes Codex CLI for requirements elicitation.
 * Used by requirements-gatherer-codex agent.
 *
 * Usage:
 *   node codex-requirements.js --plugin-root /path/to/plugin --task "description"
 *   node codex-requirements.js --plugin-root /path/to/plugin --resume
 *
 * Exit codes:
 *   0 - Success (requirements gathered)
 *   1 - Validation error (missing fields, invalid output)
 *   2 - Codex CLI error (not installed, auth failure)
 *   3 - Timeout
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ================== CONFIGURATION ==================

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes for interactive requirements
const TASK_DIR = '.task';
const STDERR_FILE = path.join(TASK_DIR, 'codex_requirements_stderr.log');

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

const TIMEOUT_MS = loadTimeoutFromConfig('requirements', DEFAULT_TIMEOUT_MS);

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

const OUTPUT_FILE = path.join(TASK_DIR, 'user-story.json');
const SESSION_MARKER = path.join(TASK_DIR, '.codex-session-requirements');

// ================== ARGUMENT PARSING ==================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { pluginRoot: null, forceResume: false, task: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--plugin-root' && args[i + 1]) {
      result.pluginRoot = args[i + 1];
      i++;
    } else if (args[i] === '--resume') {
      result.forceResume = true;
    } else if (args[i] === '--task' && args[i + 1]) {
      result.task = args[i + 1];
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
  writeJson(OUTPUT_FILE, {
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

  // Check plugin root
  if (!args.pluginRoot) {
    errors.push('Missing --plugin-root');
  } else if (!fileExists(args.pluginRoot)) {
    errors.push(`Plugin root not found: ${args.pluginRoot}`);
  }

  // Check task directory exists (create if not)
  if (!fileExists(TASK_DIR)) {
    try {
      fs.mkdirSync(TASK_DIR, { recursive: true });
    } catch (e) {
      errors.push(`Cannot create .task directory: ${e.message}`);
    }
  }

  // Task description required for fresh run (not resume)
  if (!args.forceResume && !hasActiveSession() && !args.task) {
    errors.push('Missing --task for initial requirements (required for fresh runs)');
  }

  // Check agent template exists
  if (args.pluginRoot) {
    const agentPath = path.join(args.pluginRoot, 'agents', 'requirements-gatherer-codex.md');
    if (!fileExists(agentPath)) {
      errors.push(`Agent template not found: ${agentPath}`);
    }
  }

  // Check schema exists
  if (args.pluginRoot) {
    const schemaPath = path.join(args.pluginRoot, 'docs', 'schemas', 'user-story.schema.json');
    if (!fileExists(schemaPath)) {
      errors.push(`Schema not found: ${schemaPath}`);
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
  const agentPath = path.join(args.pluginRoot, 'agents', 'requirements-gatherer-codex.md');
  const schemaPath = path.join(args.pluginRoot, 'docs', 'schemas', 'user-story.schema.json');

  let requirementsPrompt;

  if (isResume) {
    requirementsPrompt = `Continue the requirements gathering session.
Check current state in ${OUTPUT_FILE} if it exists.
Complete any remaining elicitation and finalize the user story.
Ensure all acceptance criteria are measurable and testable.
Write final output to: ${OUTPUT_FILE}`;
  } else {
    requirementsPrompt = `You are an expert requirements analyst. Your task:

${args.task}

Follow the agent instructions in: ${agentPath}

Your responsibilities:
1. Analyze the task for ambiguities and unstated assumptions
2. Research existing codebase for context (use Glob, Grep, Read tools)
3. Elicit clear requirements with measurable acceptance criteria
4. Document scope boundaries (in-scope vs out-of-scope)
5. Define test criteria for TDD validation

Requirements for the output:
- Use Given/When/Then format for acceptance criteria
- Each AC must be measurable and testable
- Scope must be clearly bounded
- Include test commands for validation

Write the user story to: ${OUTPUT_FILE}
The output must conform to schema at: ${schemaPath}

IMPORTANT: Generate comprehensive requirements based on the task description.
If assumptions are needed, document them in the "assumptions" field.
Set approved_by to "codex" and approved_at to current timestamp.`;
  }

  const stageConfig = loadCodexStageConfig('requirements');

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

  cmdArgs.push(requirementsPrompt);

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

  // Check output file exists
  if (!fileExists(OUTPUT_FILE)) {
    errors.push('user-story.json not created');
    return { valid: false, errors, warnings };
  }

  const userStory = readJson(OUTPUT_FILE);
  if (!userStory) {
    errors.push('user-story.json is not valid JSON');
    return { valid: false, errors, warnings };
  }

  // Validate required fields
  const requiredFields = ['id', 'title', 'description', 'requirements', 'acceptance_criteria', 'scope'];
  for (const field of requiredFields) {
    if (!userStory[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate requirements.functional exists
  if (userStory.requirements && (!userStory.requirements.functional || userStory.requirements.functional.length === 0)) {
    errors.push('requirements.functional must have at least one item');
  }

  // Validate acceptance_criteria format
  if (userStory.acceptance_criteria) {
    if (!Array.isArray(userStory.acceptance_criteria) || userStory.acceptance_criteria.length === 0) {
      errors.push('acceptance_criteria must be a non-empty array');
    } else {
      for (let i = 0; i < userStory.acceptance_criteria.length; i++) {
        const ac = userStory.acceptance_criteria[i];
        const acFields = ['id', 'scenario', 'given', 'when', 'then'];
        for (const field of acFields) {
          if (!ac[field]) {
            warnings.push(`acceptance_criteria[${i}] missing field: ${field}`);
          }
        }
      }
    }
  }

  // Validate scope
  if (userStory.scope) {
    if (!userStory.scope.in_scope || userStory.scope.in_scope.length === 0) {
      warnings.push('scope.in_scope should have at least one item');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    userStory
  };
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
    pluginRoot: args.pluginRoot,
    platform: platform,
    isResume: isResume,
    sessionActive: sessionActive,
    task: args.task ? args.task.substring(0, 100) + '...' : null,
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
        errorMsg = `Codex requirements timed out after ${TIMEOUT_MS / 1000} seconds`;
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

  // Success
  createSessionMarker();

  const durationMs = Date.now() - startTime;
  const reqStageConfig = loadCodexStageConfig('requirements');
  const tokenUsage = parseTokenUsage(result.stdout);
  const logData = {
    start_time: new Date(startTime).toISOString(),
    model: reqStageConfig?.model || 'default',
    reasoning: reqStageConfig?.reasoning || 'default',
    timeout_ms: TIMEOUT_MS,
    exit_code: 0,
    duration_ms: durationMs,
    title: validation.userStory?.title || 'unknown',
    ac_count: validation.userStory?.acceptance_criteria?.length || 0
  };
  if (tokenUsage) {
    logData.input_tokens = tokenUsage.input_tokens;
    logData.output_tokens = tokenUsage.output_tokens;
    logData.total_tokens = tokenUsage.total_tokens;
  }
  writeExecutionLog('requirements', logData);

  console.log(JSON.stringify({
    event: 'complete',
    output_file: OUTPUT_FILE,
    title: validation.userStory?.title,
    acceptance_criteria_count: validation.userStory?.acceptance_criteria?.length || 0,
    warnings: validation.warnings,
    session_marker_created: true
  }));

  process.exit(0);
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
