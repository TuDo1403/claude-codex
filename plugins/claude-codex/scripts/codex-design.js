#!/usr/bin/env node
/**
 * Codex Design/Spec Writing Script
 *
 * Cross-platform script that invokes Codex CLI for design artifact generation.
 * Used by codex-designer (smart-contract-secure) and strategist-codex (blind-audit-sc).
 *
 * Usage:
 *   node codex-design.js --type design --plugin-root /path/to/plugin --task "description"
 *   node codex-design.js --type spec --plugin-root /path/to/plugin --task "description"
 *   node codex-design.js --type design --plugin-root /path/to/plugin --resume
 *
 * Types:
 *   design - For smart-contract-secure pipeline (codex-designer)
 *   spec   - For blind-audit-sc pipeline (strategist-codex)
 *
 * Exit codes:
 *   0 - Success (design artifacts created)
 *   1 - Validation error (missing files, invalid output)
 *   2 - Codex CLI error (not installed, auth failure)
 *   3 - Timeout
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ================== CONFIGURATION ==================

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes for design tasks
const TASK_DIR = '.task';
const DOCS_DIR = 'docs';
const STDERR_FILE = path.join(TASK_DIR, 'codex_design_stderr.log');

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

const TIMEOUT_MS = loadTimeoutFromConfig('design', DEFAULT_TIMEOUT_MS);

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

// Output artifacts by type
const OUTPUT_ARTIFACTS = {
  design: {
    files: [
      'docs/security/threat-model.md',
      'docs/architecture/design.md',
      'docs/testing/test-plan.md'
    ],
    artifact: path.join(TASK_DIR, 'codex-design.json'),
    sessionMarker: path.join(TASK_DIR, '.codex-session-design'),
    template: 'codex-designer'
  },
  spec: {
    files: [
      'docs/security/threat-model.md',
      'docs/architecture/design.md',
      'docs/testing/test-plan.md'
    ],
    artifact: path.join(TASK_DIR, 'codex-spec.json'),
    sessionMarker: path.join(TASK_DIR, '.codex-session-spec'),
    template: 'strategist-codex'
  }
};

// ================== ARGUMENT PARSING ==================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { type: null, pluginRoot: null, forceResume: false, task: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) {
      result.type = args[i + 1];
      i++;
    } else if (args[i] === '--plugin-root' && args[i + 1]) {
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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeError(error, phase, designType) {
  const config = OUTPUT_ARTIFACTS[designType] || OUTPUT_ARTIFACTS.design;
  writeJson(config.artifact, {
    status: 'error',
    error: error,
    phase: phase,
    timestamp: new Date().toISOString()
  });
}

// ================== SESSION MANAGEMENT ==================

function hasActiveSession(designType) {
  const config = OUTPUT_ARTIFACTS[designType];
  return config ? fileExists(config.sessionMarker) : false;
}

function createSessionMarker(designType) {
  const config = OUTPUT_ARTIFACTS[designType];
  if (!config) return;
  try {
    fs.writeFileSync(config.sessionMarker, new Date().toISOString());
  } catch (err) {
    console.error(`Warning: Could not create session marker: ${err.message}`);
  }
}

function removeSessionMarker(designType) {
  const config = OUTPUT_ARTIFACTS[designType];
  if (!config) return;
  try {
    if (fileExists(config.sessionMarker)) {
      fs.unlinkSync(config.sessionMarker);
    }
  } catch (err) {
    console.error(`Warning: Could not remove session marker: ${err.message}`);
  }
}

// ================== INPUT VALIDATION ==================

function validateInputs(args) {
  const errors = [];

  // Check design type
  if (!args.type || !['design', 'spec'].includes(args.type)) {
    errors.push('Invalid or missing --type (must be "design" or "spec")');
  }

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

  // Check docs directory exists (create if not)
  const docsSubdirs = ['security', 'architecture', 'testing', 'reviews', 'performance'];
  for (const subdir of docsSubdirs) {
    const dirPath = path.join(DOCS_DIR, subdir);
    if (!fileExists(dirPath)) {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
      } catch (e) {
        errors.push(`Cannot create ${dirPath}: ${e.message}`);
      }
    }
  }

  // Task description required for fresh design (not resume)
  if (!args.forceResume && !hasActiveSession(args.type) && !args.task) {
    errors.push('Missing --task for initial design (required for fresh runs)');
  }

  // Check agent template exists
  if (args.pluginRoot && args.type) {
    const config = OUTPUT_ARTIFACTS[args.type];
    const agentPath = path.join(args.pluginRoot, 'agents', `${config.template}.md`);
    if (!fileExists(agentPath)) {
      errors.push(`Agent template not found: ${agentPath}`);
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
  const config = OUTPUT_ARTIFACTS[args.type];
  const agentPath = path.join(args.pluginRoot, 'agents', `${config.template}.md`);
  const templateDir = path.join(args.pluginRoot, 'templates');

  // Build the design prompt
  let designPrompt;

  if (isResume) {
    // Resume - continue previous design session
    designPrompt = `Continue the design task. Check current state and complete any remaining work.
Ensure all artifacts exist: ${config.files.join(', ')}
Write completion artifact to: ${config.artifact}`;
  } else {
    // Fresh design - full instructions
    designPrompt = `You are a security strategist for smart contracts. Your task:

${args.task}

Follow the agent instructions in: ${agentPath}
Use templates from: ${templateDir}

You MUST create ALL these files:
${config.files.map(f => `- ${f}`).join('\n')}

Requirements:
1. threat-model.md MUST have numbered invariants (IC-*, IS-*, IA-*, IT-*, IB-*)
2. threat-model.md MUST have acceptance criteria (AC-SEC-*, AC-FUNC-*)
3. design.md MUST have explicit storage layout with slot numbers
4. design.md MUST have external call policy
5. test-plan.md MUST map EVERY invariant to a test
6. All 6 attack simulation categories MUST be covered

When complete, write artifact JSON to: ${config.artifact}
The artifact should have: id, status, invariants[], acceptance_criteria[], artifacts[], completed_at`;
  }

  // Build command args
  const stageConfig = loadCodexStageConfig(args.type === 'spec' ? 'design' : args.type);

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

  // Add resume flag if resuming
  if (isResume) {
    cmdArgs.push('resume', '--last');
  }

  // Add the prompt
  cmdArgs.push(designPrompt);

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

    // Capture stdout for debugging
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

function validateOutput(designType) {
  const config = OUTPUT_ARTIFACTS[designType];
  const errors = [];
  const warnings = [];

  // Check all required files exist
  for (const file of config.files) {
    if (!fileExists(file)) {
      errors.push(`Missing required file: ${file}`);
    }
  }

  // Check threat-model.md for invariants
  const threatModel = readFile('docs/security/threat-model.md');
  if (threatModel) {
    const hasInvariants = /(IC|IS|IA|IT|IB)-\d+/.test(threatModel);
    if (!hasInvariants) {
      errors.push('threat-model.md missing numbered invariants (IC-*, IS-*, IA-*, IT-*, IB-*)');
    }

    const hasAC = /AC-(SEC|FUNC)-\d+/.test(threatModel);
    if (!hasAC) {
      errors.push('threat-model.md missing acceptance criteria (AC-SEC-*, AC-FUNC-*)');
    }
  }

  // Check design.md for storage layout
  const design = readFile('docs/architecture/design.md');
  if (design) {
    const hasStorageLayout = /Storage Layout|Slot\s*\|/i.test(design);
    if (!hasStorageLayout) {
      warnings.push('design.md may be missing Storage Layout section');
    }

    const hasExternalCall = /External Call Policy/i.test(design);
    if (!hasExternalCall) {
      warnings.push('design.md may be missing External Call Policy section');
    }
  }

  // Check test-plan.md for invariant mapping
  const testPlan = readFile('docs/testing/test-plan.md');
  if (testPlan) {
    const hasMapping = /Invariant.*Test.*Mapping|\|(IC|IS|IA|IT|IB)-\d+\|/i.test(testPlan);
    if (!hasMapping) {
      warnings.push('test-plan.md may be missing invariant-test mapping');
    }
  }

  // Check artifact file
  if (!fileExists(config.artifact)) {
    warnings.push(`Artifact file not created: ${config.artifact}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    filesCreated: config.files.filter(f => fileExists(f))
  };
}

// ================== MAIN ==================

let currentDesignType = null;

async function main() {
  const startTime = Date.now();
  const args = parseArgs();
  currentDesignType = args.type;
  const platform = getPlatform();

  const sessionActive = args.type ? hasActiveSession(args.type) : false;
  const isResume = args.forceResume || sessionActive;

  console.log(JSON.stringify({
    event: 'start',
    type: args.type,
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

    removeSessionMarker(args.type);
    const freshCmdConfig = buildCodexCommand(args, false);
    result = await runCodex(freshCmdConfig);
  }

  if (!result.success) {
    let errorMsg;
    let exitCode = 2;

    switch (result.error) {
      case 'timeout':
        errorMsg = `Codex design timed out after ${TIMEOUT_MS / 1000} seconds`;
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

  // Validate output
  const validation = validateOutput(args.type);

  if (!validation.valid) {
    writeError(validation.errors.join('; '), 'output_validation', args.type);
    console.log(JSON.stringify({
      event: 'error',
      phase: 'output_validation',
      errors: validation.errors,
      warnings: validation.warnings
    }));
    process.exit(1);
  }

  // Success - create session marker
  createSessionMarker(args.type);

  const durationMs = Date.now() - startTime;
  const designStageConfig = loadCodexStageConfig(args.type === 'spec' ? 'design' : args.type);
  const tokenUsage = parseTokenUsage(result.stdout);
  const logData = {
    start_time: new Date(startTime).toISOString(),
    model: designStageConfig?.model || 'default',
    reasoning: designStageConfig?.reasoning || 'default',
    timeout_ms: TIMEOUT_MS,
    exit_code: 0,
    duration_ms: durationMs,
    files_created: validation.filesCreated.join(', ')
  };
  if (tokenUsage) {
    logData.input_tokens = tokenUsage.input_tokens;
    logData.output_tokens = tokenUsage.output_tokens;
    logData.total_tokens = tokenUsage.total_tokens;
  }
  writeExecutionLog(`design-${args.type}`, logData);

  const config = OUTPUT_ARTIFACTS[args.type];
  console.log(JSON.stringify({
    event: 'complete',
    files_created: validation.filesCreated,
    artifact_file: config.artifact,
    warnings: validation.warnings,
    session_marker_created: true
  }));

  process.exit(0);
}

main().catch((err) => {
  writeError(err.message, 'unexpected_error', currentDesignType);
  console.log(JSON.stringify({
    event: 'error',
    phase: 'unexpected_error',
    error: err.message
  }));
  process.exit(1);
});
