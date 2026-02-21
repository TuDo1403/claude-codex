#!/usr/bin/env bun
/**
 * Codex Detect Sprint Script
 *
 * Invokes Codex CLI to perform independent vulnerability detection.
 * Runs in parallel with Opus detect - findings merged + deduplicated after.
 *
 * First pass (blind): No other model's detect output allowed.
 * Second pass (hinted): Accepts hints from other model via --hints-file.
 * Per-vulnerability output format (not thematic) - from EVMbench Section H.3.
 *
 * EVMbench Table 8: medium hints boost detect from 39.2% to 89.7% (2.3x).
 *
 * Usage:
 *   bun codex-detect.js --run-id <run_id> [--timeout 900000]
 *   bun codex-detect.js --run-id <run_id> --hints-file .task/X/hints-opus-to-codex.json
 *   bun codex-detect.js --run-id <run_id> --coverage-hints .task/X/coverage-hints.json
 *
 * Environment:
 *   CLAUDE_PROJECT_DIR - Project directory
 *   CLAUDE_PLUGIN_ROOT - Plugin installation directory
 *   CODEX_API_KEY - Codex API key (optional, uses default if not set)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, relative } from 'path';
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
 * Codex CLI may output token counts in JSON events or summary lines.
 * Returns { input_tokens, output_tokens, total_tokens } or null.
 */
function parseTokenUsage(stdout, stderr) {
  const combined = (stdout || '') + '\n' + (stderr || '');
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let found = false;

  // Try to find JSON objects with token usage (Codex outputs JSON events)
  const jsonPattern = /\{[^{}]*"usage"[^{}]*\}/g;
  let match;
  while ((match = jsonPattern.exec(combined)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.usage) {
        usage.input_tokens += obj.usage.input_tokens || obj.usage.prompt_tokens || 0;
        usage.output_tokens += obj.usage.output_tokens || obj.usage.completion_tokens || 0;
        found = true;
      }
    } catch { /* skip non-JSON matches */ }
  }

  // Also try nested JSON objects
  const nestedPattern = /"usage"\s*:\s*\{([^}]+)\}/g;
  while ((match = nestedPattern.exec(combined)) !== null) {
    try {
      const usageObj = JSON.parse(`{${match[1]}}`);
      usage.input_tokens += usageObj.input_tokens || usageObj.prompt_tokens || 0;
      usage.output_tokens += usageObj.output_tokens || usageObj.completion_tokens || 0;
      found = true;
    } catch { /* skip */ }
  }

  // Try "tokens: N" or "total tokens: N" patterns in plain text
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
      'bundle-path': { type: 'string' },
      'hints-file': { type: 'string' },
      'coverage-hints': { type: 'string' },
      'timeout': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: codex-detect.js --run-id <run_id> [options]

Invokes Codex CLI for independent vulnerability detection (parallel with Opus).
First pass: blind (no hints). Second pass: with hints from other model.

Options:
  --run-id          Run ID for this pipeline execution
  --bundle-path     Path to detect bundle (default: .task/<run_id>/bundle-detect-codex)
  --hints-file      Path to hints JSON from other model (enables hinted mode)
  --coverage-hints  Path to coverage-hints.json (uncovered modules to focus on)
  --timeout         Timeout in milliseconds (default: 900000 = 15 minutes)
  -h, --help        Show this help message

Hint Modes (EVMbench Table 8):
  No hints:  39.2% detect (blind first pass)
  With hints: ~89.7% detect (second pass after merge + hint generation)
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
 * List .sol files recursively from a directory
 */
function listSolFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listSolFiles(fullPath));
    } else if (entry.name.endsWith('.sol')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Load hints from a hints JSON file (generated by generate-hints.js)
 * Returns formatted hint section for injection into prompt, or empty string
 */
function loadHints(hintsFilePath) {
  if (!hintsFilePath || !existsSync(hintsFilePath)) return '';
  try {
    const data = JSON.parse(readFileSync(hintsFilePath, 'utf-8'));
    const hints = data.hints || [];
    if (hints.length === 0) return '';

    const lines = hints.map(h =>
      `- ${h.hint_id} [${h.severity}] \`${h.file}${h.line ? ':' + h.line : ''}\` - mechanism: ${h.mechanism}`
    );

    return `## HINTS FROM OTHER MODEL (medium level - location + mechanism only)

These hints come from an independent model's first-pass analysis. They indicate areas where vulnerabilities were found.

**Use these hints to FOCUS your analysis, but do NOT blindly accept them.** You must independently verify each location and may find additional issues the other model missed.

${lines.join('\n')}

Focus additional analysis on these locations and mechanisms. Also check surrounding code for related issues the hints may not cover.
`;
  } catch {
    return '';
  }
}

/**
 * Load coverage hints from coverage-hints.json (generated by coverage-tracker.js)
 * Returns formatted section for injection into prompt, or empty string
 */
function loadCoverageHints(coverageHintsPath) {
  if (!coverageHintsPath || !existsSync(coverageHintsPath)) return '';
  try {
    const data = JSON.parse(readFileSync(coverageHintsPath, 'utf-8'));
    const uncoveredEntrypoints = data.uncovered_entrypoints || [];
    const uncoveredModules = data.uncovered_modules || [];
    if (uncoveredEntrypoints.length === 0 && uncoveredModules.length === 0) return '';

    let section = `## UNCOVERED MODULES (require focused analysis)

These modules and entrypoints were NOT referenced in any previous detection pass. They may contain undiscovered vulnerabilities.

`;
    if (uncoveredModules.length > 0) {
      section += `### Uncovered Modules\n${uncoveredModules.map(m => `- ${m.name} (\`${m.file}\`) - type: ${m.type || 'contract'}`).join('\n')}\n\n`;
    }
    if (uncoveredEntrypoints.length > 0) {
      section += `### Uncovered Entrypoints\n${uncoveredEntrypoints.map(ep => `- \`${ep.signature}\` (\`${ep.file}:${ep.line}\`)`).join('\n')}\n\n`;
    }
    section += `Prioritize these in your analysis. Previous passes missed them entirely.\n`;
    return section;
  } catch {
    return '';
  }
}

/**
 * Write INSTRUCTIONS.md (and optional hint files) to bundlePath for exec mode.
 * Returns nothing — side-effect: writes files to disk.
 */
function writeInstructions(bundlePath, runId, hintsSection, coverageSection) {
  // Write optional hint files so Codex can read them from disk
  if (hintsSection) {
    writeFileSync(join(bundlePath, 'hints.md'), hintsSection);
  }
  if (coverageSection) {
    writeFileSync(join(bundlePath, 'coverage-hints.md'), coverageSection);
  }

  // List source files
  const srcDir = join(bundlePath, 'src');
  const sourceFiles = listSolFiles(srcDir).map(f => relative(bundlePath, f));

  // List test files
  const testDir = join(bundlePath, 'test');
  const testFiles = listSolFiles(testDir).map(f => relative(bundlePath, f));

  const instructions = `# Codex Detect Sprint — INSTRUCTIONS

You are a Codex Vulnerability Detector performing an independent security audit of fund-sensitive smart contracts.

## CRITICAL RULES

1. **INDEPENDENCE**: You work independently from any other model's detection output. Form your own hypotheses from source code analysis.
2. **PER-VULNERABILITY OUTPUT**: You MUST organize output as one section per distinct vulnerability. NEVER group findings by theme (e.g., "reentrancy issues", "access control"). Each finding is a standalone entry with its own ID.
3. **PRECISION OVER RECALL**: False positives waste time. Only report vulnerabilities that could lead to loss of funds.
4. **CODE REFERENCES REQUIRED**: Every finding MUST have file:line references.

## BUNDLE FILES (read from current directory)

- \`invariants-list.md\` — Invariants for the codebase
- \`public-api.md\` — Public API surface
- \`slither-summary.md\` — Static analysis results
- \`scope.md\` — Scope definition (which contracts to audit)
${hintsSection ? '- `hints.md` — Hints from another model (medium level: location + mechanism only)\n' : ''}${coverageSection ? '- `coverage-hints.md` — Uncovered modules that need focused analysis\n' : ''}

## SOURCE FILES

${sourceFiles.length > 0 ? sourceFiles.map(f => `- \`${f}\``).join('\n') : '(No source files found — check src/ directory)'}

## TEST FILES

${testFiles.length > 0 ? testFiles.map(f => `- \`${f}\``).join('\n') : '(No test files found)'}

## YOUR TASK

Read the files listed above from the current directory. Only search for vulnerabilities that could directly or indirectly lead to a loss of user or platform assets.

### Systematic Analysis Process

1. **Scope review** — Read \`scope.md\` to identify in-scope contracts
2. **Architecture scan** — Understand contract relationships and trust boundaries
3. **Per-contract analysis** — For each in-scope contract:
   - Check access control on all external/public functions
   - Check state update ordering (CEI pattern)
   - Check external call safety (reentrancy, return value handling)
   - Check math operations (overflow, rounding, precision loss)
   - Check cross-contract interactions and composability risks
${hintsSection ? '4. **Review hints** — Read `hints.md` and focus additional analysis on hinted locations\n' : ''}${coverageSection ? `${hintsSection ? '5' : '4'}. **Coverage gaps** — Read \`coverage-hints.md\` and prioritize uncovered modules\n` : ''}${hintsSection || coverageSection ? `${hintsSection && coverageSection ? '6' : '5'}` : '4'}. **Cross-module analysis** — Look for multi-step exploit paths spanning contracts
${hintsSection && coverageSection ? '7' : hintsSection || coverageSection ? '6' : '5'}. **Write findings** — One section per vulnerability

## OUTPUT FORMAT

**CRITICAL:** One section per distinct vulnerability. Do NOT group by theme.

For each vulnerability:

\`\`\`markdown
## VULN-{N}: {Concise Title}

**Severity:** HIGH | MEDIUM
**File:** {file_path}:{line_number}
**Root Cause:** {One sentence explaining the underlying flaw}

### Description
{Precise description of the vulnerability mechanism}

### Impact
{What an attacker can achieve — quantify if possible}

### Exploit Scenario
1. {Step-by-step attack path}
2. {Each step references specific functions/lines}

### Code References
- \`{file}:{line}\` — {what this code does wrong}

### Suggested Fix
{Brief remediation guidance}
\`\`\`

## OUTPUT FILES

You MUST produce two artifacts:

1. **codex-detect-findings.md** — Human-readable report with all findings (write to current directory)
2. **codex-detect-findings.json** — Machine-readable artifact (write to current directory)

The JSON artifact MUST follow this schema:
\`\`\`json
{
  "id": "codex-detect-{timestamp}",
  "reviewer": "codex-detector",
  "model": "codex",
  "findings": [
    {
      "id": "VULN-1",
      "title": "...",
      "severity": "HIGH",
      "file": "src/Contract.sol",
      "line": 42,
      "root_cause": "...",
      "description": "...",
      "impact": "...",
      "exploit_scenario": "..."
    }
  ],
  "total_findings": 0,
  "scope_files_analyzed": [],
  "generated_at": "..."
}
\`\`\`

## QUALITY CRITERIA

- Every finding MUST have file:line references
- Every finding MUST have a concrete exploit scenario (not theoretical)
- Severity MUST be justified (how much value at risk?)
- Do NOT report informational or gas-only issues
- Do NOT report issues that cannot lead to loss of funds
- PREFER precision over recall — false positives waste time

## BEGIN ANALYSIS

Read the source files in the bundle and perform systematic vulnerability detection.
Focus on high-severity issues that could lead to loss of user or platform assets.
`;

  writeFileSync(join(bundlePath, 'INSTRUCTIONS.md'), instructions);
}

/**
 * Invoke Codex CLI in exec mode (G6: filesystem access + iterative tool use).
 * cwd is set to bundlePath so Codex can read bundle files directly.
 */
async function invokeCodex(bundlePath, runId, timeout) {
  return new Promise((resolve, reject) => {
    const codexPath = process.env.CODEX_PATH || 'codex';

    console.log('Invoking Codex CLI (exec mode) for detect sprint...');
    console.log(`Timeout: ${timeout}ms (${Math.round(timeout / 60000)} minutes)`);

    const stageConfig = loadCodexStageConfig('detect');

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

    args.push('Read INSTRUCTIONS.md and perform independent vulnerability detection. Write findings to codex-detect-findings.json and codex-detect-findings.md in the current directory.');

    const child = spawn(codexPath, args, {
      cwd: bundlePath,
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
  const dateStr = timestamp.replace(/[-:]/g, '').split('.')[0].replace('T', '-');

  const mdContent = `# Codex Detect Findings

**Reviewer:** codex-detector
**Model:** codex (FAILED)
**Bundle:** bundle-detect-codex
**Date:** ${timestamp}

## Error

Codex CLI invocation failed:

\`\`\`
${error.message}
\`\`\`

## Action Required

Please run Codex detect sprint manually:

\`\`\`bash
bun "${PLUGIN_ROOT}/scripts/codex-detect.js" --run-id ${runId}
\`\`\`

Or invoke Codex CLI directly with the bundle path.
`;

  writeFileSync(join(reviewsDir, 'codex-detect-findings.md'), mdContent);

  const jsonContent = {
    id: `codex-detect-${dateStr}`,
    reviewer: 'codex-detector',
    model: 'codex',
    bundle: 'bundle-detect-codex',
    error: error.message,
    status: 'FAILED',
    findings: [],
    total_findings: 0,
    scope_files_analyzed: [],
    generated_at: timestamp
  };

  const runDir = join(TASK_DIR, runId);
  ensureDir(runDir);
  writeFileSync(join(runDir, 'codex-detect-findings.json'), JSON.stringify(jsonContent, null, 2));

  return { md: mdContent, json: jsonContent };
}

async function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `detect-${Date.now()}`;
  const bundlePath = args['bundle-path'] || join(TASK_DIR, runId, 'bundle-detect-codex');
  const timeout = parseInt(args.timeout || '900000'); // 15 minutes default

  console.log(`\n=== Codex Detect Sprint ===`);
  console.log(`Run ID: ${runId}`);
  console.log(`Bundle: ${bundlePath}`);
  console.log(`Timeout: ${timeout}ms`);

  // Verify bundle exists, generate if missing
  if (!existsSync(bundlePath)) {
    console.log('Bundle not found. Generating...');

    try {
      execSync(`bun "${join(PLUGIN_ROOT, 'scripts', 'generate-bundle-detect-codex.js')}" --run-id ${runId}`, {
        cwd: PROJECT_DIR,
        stdio: 'inherit'
      });
    } catch (err) {
      console.error('Failed to generate bundle:', err.message);
      process.exit(1);
    }
  }

  // Verify bundle manifest
  const manifestPath = join(bundlePath, 'MANIFEST.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (!manifest.independence_validated) {
        console.error('Bundle independence not validated - other model output may be present');
        process.exit(1);
      }
      console.log('Bundle independence verified: no other model output included');
      console.log(`Source files: ${manifest.contents?.source_files || 0}`);
      console.log(`Test files: ${manifest.contents?.test_files || 0}`);
    } catch (err) {
      console.warn('Could not verify bundle manifest:', err.message);
    }
  }

  // Load hints (G1) and coverage hints (G3) if provided
  const hintsSection = loadHints(args['hints-file']);
  const coverageSection = loadCoverageHints(args['coverage-hints']);

  if (hintsSection) {
    console.log(`Hints loaded from: ${args['hints-file']} (HINTED MODE)`);
  } else {
    console.log('No hints provided (BLIND MODE)');
  }
  if (coverageSection) {
    console.log(`Coverage hints loaded from: ${args['coverage-hints']}`);
  }

  // Write INSTRUCTIONS.md + optional hint files to bundle (G6: exec mode)
  writeInstructions(bundlePath, runId, hintsSection, coverageSection);

  const startTime = Date.now();

  try {
    const result = await invokeCodex(bundlePath, runId, timeout);
    console.log('\nCodex detect sprint completed successfully');

    // Codex writes output to bundlePath in exec mode; copy to canonical locations
    const bundleJsonPath = join(bundlePath, 'codex-detect-findings.json');
    const bundleMdPath = join(bundlePath, 'codex-detect-findings.md');
    const jsonPath = join(TASK_DIR, runId, 'codex-detect-findings.json');
    const mdPath = join(DOCS_DIR, 'reviews', 'codex-detect-findings.md');

    // Copy outputs from bundle to canonical locations
    if (existsSync(bundleJsonPath)) {
      ensureDir(join(TASK_DIR, runId));
      writeFileSync(jsonPath, readFileSync(bundleJsonPath, 'utf-8'));
    }
    if (existsSync(bundleMdPath)) {
      ensureDir(join(DOCS_DIR, 'reviews'));
      writeFileSync(mdPath, readFileSync(bundleMdPath, 'utf-8'));
    }

    if (existsSync(jsonPath)) {
      console.log(`JSON artifact: ${jsonPath}`);
      // Parse and report finding count
      try {
        const findings = JSON.parse(readFileSync(jsonPath, 'utf-8'));
        console.log(`Findings: ${findings.total_findings || findings.findings?.length || 0}`);
      } catch { /* ignore parse error */ }
    } else {
      console.warn('Warning: JSON artifact not created by Codex');
    }

    if (existsSync(mdPath)) {
      console.log(`MD report: ${mdPath}`);
    } else {
      console.warn('Warning: MD report not created by Codex');
    }

    const durationMs = Date.now() - startTime;
    const detectStageConfig = loadCodexStageConfig('detect');
    const hintMode = hintsSection ? 'hinted' : 'blind';
    const tokenUsage = parseTokenUsage(result.stdout, result.stderr);
    const logData = {
      start_time: new Date(startTime).toISOString(),
      model: detectStageConfig?.model || 'default',
      reasoning: detectStageConfig?.reasoning || 'default',
      hint_mode: hintMode,
      hints_file: args['hints-file'] || 'none',
      coverage_hints: args['coverage-hints'] || 'none',
      timeout_ms: timeout,
      exit_code: 0,
      duration_ms: durationMs,
      run_id: runId
    };
    if (tokenUsage) {
      logData.input_tokens = tokenUsage.input_tokens;
      logData.output_tokens = tokenUsage.output_tokens;
      logData.total_tokens = tokenUsage.total_tokens;
    }
    writeExecutionLog('codex-detect', logData);

    console.log(JSON.stringify({
      success: true,
      run_id: runId,
      hint_mode: hintMode,
      json_path: jsonPath,
      md_path: mdPath
    }));
  } catch (error) {
    console.error('\nCodex detect sprint failed:', error.message);

    // Create fallback output
    createFallbackOutput(runId, error);
    console.log('Created fallback output for manual retry');

    const durationMs = Date.now() - startTime;
    const detectStageConfig = loadCodexStageConfig('detect');
    writeExecutionLog('codex-detect', {
      start_time: new Date(startTime).toISOString(),
      model: detectStageConfig?.model || 'default',
      reasoning: detectStageConfig?.reasoning || 'default',
      hint_mode: hintsSection ? 'hinted' : 'blind',
      timeout_ms: timeout,
      exit_code: 1,
      duration_ms: durationMs,
      run_id: runId,
      error: error.message
    });

    console.log(JSON.stringify({
      success: false,
      run_id: runId,
      error: error.message,
      fallback_created: true
    }));

    process.exit(1);
  }
}

if (import.meta.main !== false) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { loadHints, loadCoverageHints, parseTokenUsage, writeInstructions };
