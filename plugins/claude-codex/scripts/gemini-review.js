#!/usr/bin/env node
/**
 * Gemini Review Wrapper Script
 *
 * Invokes Gemini CLI non-interactively for code review.
 * Supports both diff-based review (PR style) and full codebase review.
 *
 * Usage:
 *   node gemini-review.js --type code --plugin-root /path/to/plugin
 *   node gemini-review.js --type code --plugin-root /path/to/plugin --diff "git diff output"
 *   node gemini-review.js --type code --plugin-root /path/to/plugin --base-branch main
 *
 * Exit codes:
 *   0 - Success (review completed)
 *   1 - Validation error (missing files, invalid output)
 *   2 - Gemini CLI error (not installed, auth failure)
 *   3 - Timeout
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ================== CONFIGURATION ==================

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const TASK_DIR = '.task';
const STDERR_FILE = path.join(TASK_DIR, 'gemini_stderr.log');
const OUTPUT_FILE = path.join(TASK_DIR, 'review-gemini.json');

function loadTimeoutFromConfig(defaultMs) {
  try {
    const configPath = path.join(process.cwd(), '.claude-codex.json');
    if (!fs.existsSync(configPath)) return defaultMs;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config?.stage_timeout_ms?.gemini_review ?? defaultMs;
  } catch {
    return defaultMs;
  }
}

const TIMEOUT_MS = loadTimeoutFromConfig(DEFAULT_TIMEOUT_MS);

// ================== ARGUMENT PARSING ==================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    type: 'code',
    pluginRoot: null,
    diff: null,
    baseBranch: null,
    model: null,
    prompt: null,
    outputFile: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) {
      result.type = args[i + 1];
      i++;
    } else if (args[i] === '--plugin-root' && args[i + 1]) {
      result.pluginRoot = args[i + 1];
      i++;
    } else if (args[i] === '--diff' && args[i + 1]) {
      result.diff = args[i + 1];
      i++;
    } else if (args[i] === '--base-branch' && args[i + 1]) {
      result.baseBranch = args[i + 1];
      i++;
    } else if (args[i] === '--model' && args[i + 1]) {
      result.model = args[i + 1];
      i++;
    } else if (args[i] === '--prompt' && args[i + 1]) {
      result.prompt = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      result.outputFile = args[i + 1];
      i++;
    }
  }

  return result;
}

// ================== PLATFORM DETECTION ==================

function isGeminiInstalled() {
  try {
    execSync('gemini --version', { stdio: 'pipe' });
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

function writeError(error, phase) {
  writeJson(OUTPUT_FILE, {
    status: 'error',
    error: error,
    phase: phase,
    timestamp: new Date().toISOString(),
  });
}

function writeExecutionLog(data) {
  try {
    const logsDir = path.join('reports', 'execution-logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `gemini-review-${timestamp}.log`);
    const content = Object.entries(data)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') + '\n';
    fs.writeFileSync(logFile, content);
  } catch {
    // Non-critical
  }
}

// ================== DIFF GENERATION ==================

function getDiff(baseBranch) {
  try {
    const base = baseBranch || 'main';
    // Try to get diff against base branch
    let diff;
    try {
      diff = execSync(`git diff ${base}...HEAD`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      // Fallback: diff against HEAD~1
      try {
        diff = execSync('git diff HEAD~1', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      } catch {
        // Last resort: staged + unstaged changes
        diff = execSync('git diff', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      }
    }
    return diff;
  } catch (err) {
    console.error(`Warning: Could not generate diff: ${err.message}`);
    return null;
  }
}

// ================== PROMPT BUILDING ==================

function buildReviewPrompt(args, diff) {
  if (args.prompt) {
    return args.prompt;
  }

  const userStory = readJson(path.join(TASK_DIR, 'user-story.json'));
  const implResult = readJson(path.join(TASK_DIR, 'impl-result.json'));

  let prompt = `You are a senior code reviewer. Review the following code changes thoroughly.

Focus on:
1. Security vulnerabilities (injection, XSS, auth bypass, data leaks)
2. Logic errors and edge cases
3. Performance issues and inefficiencies
4. Code quality, readability, maintainability
5. Test coverage gaps
6. Duplicated code that could be deduplicated
7. API design and interface consistency

`;

  if (userStory) {
    prompt += `\n## Requirements Context\nTitle: ${userStory.title || 'N/A'}\nDescription: ${userStory.description || 'N/A'}\n`;
    if (userStory.acceptance_criteria) {
      prompt += `\nAcceptance Criteria:\n`;
      userStory.acceptance_criteria.forEach((ac) => {
        prompt += `- [${ac.id}] ${ac.description}\n`;
      });
    }
  }

  if (implResult) {
    prompt += `\n## Implementation Notes\n${implResult.summary || 'No summary available'}\n`;
    if (implResult.files_changed) {
      prompt += `\nFiles changed: ${implResult.files_changed.join(', ')}\n`;
    }
  }

  if (diff) {
    prompt += `\n## Code Diff\n\`\`\`diff\n${diff}\n\`\`\`\n`;
  }

  prompt += `
## Output Format
Respond with a JSON object (no markdown fences) with this structure:
{
  "status": "approved" | "needs_changes",
  "summary": "brief overall assessment",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "category": "security" | "logic" | "performance" | "quality" | "testing" | "duplication",
      "file": "path/to/file",
      "line": 42,
      "description": "what's wrong",
      "suggestion": "how to fix it"
    }
  ],
  "acceptance_criteria_verification": {
    "total": 0,
    "verified": 0,
    "details": [
      {"ac_id": "AC1", "status": "IMPLEMENTED" | "NOT_IMPLEMENTED" | "PARTIAL", "evidence": "file:line"}
    ]
  }
}

If there are any critical or high severity findings, status MUST be "needs_changes".
Only set status to "approved" if all findings are medium/low/info severity.`;

  return prompt;
}

// ================== GEMINI EXECUTION ==================

function runGemini(prompt, args) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const geminiArgs = ['-p', prompt, '--output-format', 'json'];

    if (args.model) {
      geminiArgs.push('-m', args.model);
    }

    // Use yolo mode to auto-accept tool calls (review is read-only)
    geminiArgs.push('--approval-mode', 'plan');

    console.log(`[gemini-review] Starting Gemini CLI review (timeout: ${TIMEOUT_MS / 1000}s)`);

    const child = spawn('gemini', geminiArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: { ...process.env },
      timeout: TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;

      // Write stderr log
      if (stderr) {
        try {
          fs.mkdirSync(TASK_DIR, { recursive: true });
          fs.writeFileSync(STDERR_FILE, stderr);
        } catch { /* skip */ }
      }

      writeExecutionLog({
        stage: 'gemini-review',
        type: args.type,
        exit_code: code,
        duration_ms: duration,
        stdout_length: stdout.length,
        stderr_length: stderr.length,
        model: args.model || 'default',
      });

      if (code === null) {
        reject(new Error('Gemini CLI timed out'));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      resolve({ stdout, stderr, duration });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ================== OUTPUT PARSING ==================

function parseGeminiOutput(rawOutput) {
  // Gemini with --output-format json returns structured JSON
  // Try to parse the full output first
  try {
    const parsed = JSON.parse(rawOutput);
    // Gemini JSON format: { session_id, response, stats }
    if (parsed.response) {
      return extractReviewFromResponse(parsed.response);
    }
    // Maybe it's already the review object
    if (parsed.status) {
      return parsed;
    }
  } catch { /* fallthrough */ }

  // Try to find JSON in the output
  return extractReviewFromResponse(rawOutput);
}

function extractReviewFromResponse(text) {
  // Try to find a JSON block in the response text
  const jsonPatterns = [
    /```json\s*([\s\S]*?)```/,
    /```\s*([\s\S]*?)```/,
    /(\{[\s\S]*"status"[\s\S]*"findings"[\s\S]*\})/,
    /(\{[\s\S]*"status"[\s\S]*\})/,
  ];

  for (const pattern of jsonPatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch { /* try next */ }
    }
  }

  // Last resort: try parsing the whole thing
  try {
    return JSON.parse(text.trim());
  } catch { /* give up */ }

  // Return a structured error response
  return {
    status: 'needs_changes',
    summary: 'Gemini review completed but output could not be parsed as structured JSON. Raw response preserved.',
    raw_response: text.slice(0, 5000),
    findings: [],
    parse_error: true,
  };
}

// ================== VALIDATION ==================

function validateInputs(args) {
  const errors = [];

  if (!args.pluginRoot) {
    errors.push('Missing --plugin-root');
  }

  if (!fileExists(TASK_DIR)) {
    errors.push('.task directory not found');
  }

  if (!isGeminiInstalled()) {
    errors.push('Gemini CLI not installed. Install from: https://github.com/google-gemini/gemini-cli');
  }

  return errors;
}

// ================== MAIN ==================

async function main() {
  const args = parseArgs();
  const outputFile = args.outputFile || OUTPUT_FILE;

  // Validate
  const errors = validateInputs(args);
  if (errors.length > 0) {
    console.error('[gemini-review] Validation errors:');
    errors.forEach((e) => console.error(`  - ${e}`));
    writeError(errors.join('; '), 'validation');
    process.exit(1);
  }

  // Get diff
  let diff = args.diff;
  if (!diff) {
    diff = getDiff(args.baseBranch);
  }

  if (!diff || diff.trim().length === 0) {
    console.log('[gemini-review] No diff found, reviewing current codebase state');
  }

  // Build prompt
  const prompt = buildReviewPrompt(args, diff);

  // Execute Gemini
  try {
    console.log('[gemini-review] Invoking Gemini CLI...');
    const result = await runGemini(prompt, args);

    console.log(`[gemini-review] Gemini completed in ${(result.duration / 1000).toFixed(1)}s`);

    // Parse output
    const review = parseGeminiOutput(result.stdout);

    // Validate review structure
    if (!review.status) {
      review.status = 'needs_changes';
    }
    if (!review.findings) {
      review.findings = [];
    }

    // Add metadata
    review.reviewer = 'gemini';
    review.timestamp = new Date().toISOString();
    review.duration_ms = result.duration;
    review.model = args.model || 'default';

    // Write output
    writeJson(outputFile, review);
    console.log(`[gemini-review] Review written to ${outputFile}`);
    console.log(`[gemini-review] Status: ${review.status}, Findings: ${review.findings.length}`);

    process.exit(0);
  } catch (err) {
    console.error(`[gemini-review] Error: ${err.message}`);

    if (err.message.includes('timed out')) {
      writeError('Gemini CLI timed out', 'timeout');
      process.exit(3);
    }

    writeError(err.message, 'execution');
    process.exit(2);
  }
}

main();
