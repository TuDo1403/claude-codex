#!/usr/bin/env bun
/**
 * Detect Pipeline Orchestrator (G2)
 *
 * Wires together all detect scripts into a multi-phase pipeline:
 *
 *   Phase 1 (Detect):
 *     1a. Opus detect — MANUAL: runs via exploit-hunter agent in Claude Code
 *     1b. Codex detect — AUTOMATED: codex-detect.js subprocess
 *     Both run blind (no cross-model hints). Opus findings are picked up
 *     if they exist; otherwise pipeline proceeds with Codex-only.
 *
 *   Phase 2 (Merge):
 *     2. merge-detect-findings.js — dedup + tag DUAL_CONFIRMED/SINGLE_*
 *
 *   Phase 3 (Coverage Check):
 *     3. coverage-tracker.js
 *     IF coverage >= threshold → Phase 5
 *     IF coverage < threshold → Phase 4
 *
 *   Phase 4 (Hinted Re-detect):
 *     4a. generate-hints.js (opus → codex)
 *     4b. generate-hints.js (codex → opus) — saved for manual Opus re-run
 *     4c. Re-run Codex detect WITH opus hints + coverage hints (AUTOMATED)
 *     4d. merge-detect-findings.js (all passes)
 *     NOTE: Opus re-detect with codex hints requires manual agent launch.
 *           Hints file: .task/<runId>/hints-codex-to-opus.json
 *
 *   Phase 5 (Output):
 *     5. Final merged-findings.json
 *
 * EVMbench evidence:
 *   - Different models find different bugs (Table 9)
 *   - Medium hints → 39.2% to 89.7% detect (Table 8)
 *   - Partial coverage is the norm (Section 5)
 *
 * Usage:
 *   bun run-detect-pipeline.js --run-id <run_id> [--max-passes 2] [--skip-opus]
 *
 * Environment:
 *   CLAUDE_PROJECT_DIR - Project directory
 *   CLAUDE_PLUGIN_ROOT - Plugin installation directory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parseArgs } from 'util';
import { execSync, spawn } from 'child_process';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(import.meta.path));
const TASK_DIR = join(PROJECT_DIR, '.task');
const SCRIPTS_DIR = join(PLUGIN_ROOT, 'scripts');

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      'max-passes': { type: 'string' },
      'skip-opus': { type: 'boolean' },
      'skip-codex': { type: 'boolean' },
      'codex-timeout': { type: 'string' },
      'coverage-threshold': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: run-detect-pipeline.js --run-id <run_id> [options]

Orchestrates multi-phase detect pipeline with blind detection,
merge, coverage check, and hinted re-detect.

Options:
  --run-id              Run ID for this pipeline execution
  --max-passes          Maximum detect passes (default: 2)
  --skip-opus           Skip Opus detect (use existing findings only)
  --skip-codex          Skip Codex detect (use existing findings only)
  --codex-timeout       Timeout for Codex detect in ms (default: 900000)
  --coverage-threshold  Coverage threshold percentage (default: 90)
  -h, --help            Show this help message

Phases:
  1. Blind detect (Codex automated, Opus manual/existing)
  2. Merge findings
  3. Coverage check
  4. Hinted re-detect (Codex automated; Opus hints saved for manual re-run)
  5. Final merged output
    `);
    process.exit(0);
  }

  return values;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadConfig() {
  try {
    const configPath = join(PROJECT_DIR, '.claude-codex.json');
    if (!existsSync(configPath)) return {};
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Run a script and return { success, output }
 */
function runScript(scriptPath, args = [], options = {}) {
  const timeout = options.timeout || 120000;
  const label = options.label || scriptPath;

  console.log(`\n--- Running: ${label} ---`);
  const argStr = args.join(' ');

  try {
    const output = execSync(`bun "${scriptPath}" ${argStr}`, {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: PROJECT_DIR,
        CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      encoding: 'utf-8'
    });

    console.log(output);
    return { success: true, output };
  } catch (err) {
    console.error(`${label} failed: ${err.message}`);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    return { success: false, output: err.stdout || '', error: err.message };
  }
}

/**
 * Run Codex detect as async subprocess (longer timeout)
 */
async function runCodexDetect(runId, timeout, extraArgs = []) {
  const scriptPath = join(SCRIPTS_DIR, 'codex-detect.js');
  const args = ['--run-id', runId, '--timeout', String(timeout), ...extraArgs];

  return runScript(scriptPath, args, {
    timeout: timeout + 30000, // Give wrapper extra time beyond Codex timeout
    label: `Codex Detect${extraArgs.includes('--hints-file') ? ' (hinted)' : ' (blind)'}`
  });
}

/**
 * Check if Opus findings exist for this run
 */
function hasOpusFindings(runId) {
  const candidates = [
    join(TASK_DIR, runId, 'opus-detect-findings.json'),
    join(TASK_DIR, runId, 'exploit-hunt-review.json'),
    join(TASK_DIR, 'exploit-hunt-review.json')
  ];
  return candidates.some(p => existsSync(p));
}

/**
 * Check if Codex findings exist for this run
 */
function hasCodexFindings(runId) {
  const candidates = [
    join(TASK_DIR, runId, 'codex-detect-findings.json'),
    join(TASK_DIR, 'codex-detect-findings.json')
  ];
  return candidates.some(p => existsSync(p));
}

/**
 * Parse the last line of script output for JSON result
 */
function parseJsonResult(output) {
  if (!output) return null;
  const lines = output.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      continue;
    }
  }
  return null;
}

async function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `detect-pipeline-${Date.now()}`;
  const maxPasses = parseInt(args['max-passes'] || '2');
  const skipOpus = args['skip-opus'] || false;
  const skipCodex = args['skip-codex'] || false;
  const codexTimeout = parseInt(args['codex-timeout'] || '900000');
  const coverageThreshold = parseInt(args['coverage-threshold'] || '90');
  const config = loadConfig();

  const runDir = join(TASK_DIR, runId);
  ensureDir(runDir);

  const pipelineStart = Date.now();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  DETECT PIPELINE ORCHESTRATOR`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Run ID: ${runId}`);
  console.log(`Max passes: ${maxPasses}`);
  console.log(`Coverage threshold: ${coverageThreshold}%`);
  console.log(`Skip Opus: ${skipOpus}`);
  console.log(`Skip Codex: ${skipCodex}`);
  console.log(`Codex timeout: ${codexTimeout}ms`);

  // ============================================================
  // PHASE 1: Parallel Blind Detect
  // ============================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  PHASE 1: Blind Detect (Codex automated, Opus manual)`);
  console.log(`${'='.repeat(60)}`);

  const phase1Results = { opus: null, codex: null };

  if (!skipOpus) {
    if (hasOpusFindings(runId)) {
      console.log('Opus findings already exist - skipping Opus detect');
      phase1Results.opus = { success: true, skipped: true };
    } else {
      console.log('NOTE: Opus detect runs via exploit-hunter agent in Claude Code.');
      console.log('Launch it separately: Task(subagent_type: "claude-codex:exploit-hunter")');
      console.log('This orchestrator will use any existing Opus findings it finds.');
      phase1Results.opus = { success: true, manual: true };
    }
  } else {
    console.log('Opus detect skipped (--skip-opus)');
    phase1Results.opus = { success: true, skipped: true };
  }

  if (!skipCodex) {
    if (hasCodexFindings(runId)) {
      console.log('Codex findings already exist - skipping Codex detect');
      phase1Results.codex = { success: true, skipped: true };
    } else {
      phase1Results.codex = await runCodexDetect(runId, codexTimeout);
    }
  } else {
    console.log('Codex detect skipped (--skip-codex)');
    phase1Results.codex = { success: true, skipped: true };
  }

  // Check if we have at least one set of findings
  const haveOpus = hasOpusFindings(runId);
  const haveCodex = hasCodexFindings(runId);

  if (!haveOpus && !haveCodex) {
    console.error('\nNo findings from either model. Cannot proceed.');
    console.log(JSON.stringify({ success: false, error: 'No findings from either model' }));
    process.exit(1);
  }

  console.log(`\nPhase 1 Results: Opus=${haveOpus ? 'YES' : 'NO'}, Codex=${haveCodex ? 'YES' : 'NO'}`);

  // ============================================================
  // PHASE 2: Merge Findings
  // ============================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  PHASE 2: Merge Findings`);
  console.log(`${'='.repeat(60)}`);

  const mergeResult = runScript(
    join(SCRIPTS_DIR, 'merge-detect-findings.js'),
    ['--run-id', runId],
    { label: 'Merge Detect Findings', timeout: 60000 }
  );

  const mergeData = parseJsonResult(mergeResult.output);
  if (mergeData) {
    console.log(`Merge: ${mergeData.total || 0} total, ${mergeData.dual_confirmed || 0} dual-confirmed`);
  }

  // ============================================================
  // PHASE 3: Coverage Check
  // ============================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  PHASE 3: Coverage Check`);
  console.log(`${'='.repeat(60)}`);

  const coverageResult = runScript(
    join(SCRIPTS_DIR, 'coverage-tracker.js'),
    ['--run-id', runId, '--threshold', String(coverageThreshold)],
    { label: 'Coverage Tracker', timeout: 60000 }
  );

  let coverageData = parseJsonResult(coverageResult.output);
  // If coverage check failed or returned non-JSON, assume re-detect is needed
  // (fail-closed: unknown coverage should not skip hinted passes)
  const needsRedetect = coverageData ? (coverageData.pass_required === true) : true;

  if (coverageData) {
    console.log(`Entrypoint coverage: ${coverageData.entrypoint_coverage}%`);
    console.log(`Module coverage: ${coverageData.module_coverage}%`);
    console.log(`Re-detect needed: ${needsRedetect}`);
  } else {
    console.warn('Coverage check returned no parseable result; assuming re-detect needed');
  }

  // ============================================================
  // PHASE 4: Hinted Re-detect (iterative until coverage met or max passes)
  // ============================================================
  let pass = 1;
  let finalMergeData = mergeData;
  let currentNeedsRedetect = needsRedetect;

  while (currentNeedsRedetect && pass < maxPasses) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  PHASE 4: Hinted Re-detect (pass ${pass + 1}/${maxPasses})`);
    console.log(`${'='.repeat(60)}`);

    // 4a. Generate hints: opus → codex
    if (haveOpus) {
      runScript(
        join(SCRIPTS_DIR, 'generate-hints.js'),
        ['--run-id', runId, '--source', 'opus', '--target', 'codex'],
        { label: 'Generate Hints (opus → codex)', timeout: 30000 }
      );
    }

    // 4b. Generate hints: codex → opus (saved for manual Opus re-run)
    if (haveCodex) {
      runScript(
        join(SCRIPTS_DIR, 'generate-hints.js'),
        ['--run-id', runId, '--source', 'codex', '--target', 'opus'],
        { label: 'Generate Hints (codex → opus)', timeout: 30000 }
      );
      const opusHintsFile = join(runDir, 'hints-codex-to-opus.json');
      if (existsSync(opusHintsFile)) {
        console.log(`\nOpus re-detect hints available: ${opusHintsFile}`);
        console.log('To run Opus hinted re-detect manually:');
        console.log('  Task(subagent_type: "claude-codex:exploit-hunter") with hints file');
      }
    }

    // 4c. Re-run Codex detect WITH hints + coverage hints (automated)
    if (!skipCodex) {
      const hintsFile = join(runDir, 'hints-opus-to-codex.json');
      const coverageHintsFile = join(runDir, 'coverage-hints.json');

      const extraArgs = [];
      if (existsSync(hintsFile)) {
        extraArgs.push('--hints-file', hintsFile);
      }
      if (existsSync(coverageHintsFile)) {
        extraArgs.push('--coverage-hints', coverageHintsFile);
      }

      if (extraArgs.length > 0) {
        // Use a different bundle path per pass to avoid overwriting
        extraArgs.push('--bundle-path', join(runDir, `bundle-detect-codex-pass${pass + 1}`));
        await runCodexDetect(runId, codexTimeout, extraArgs);
      }
    }

    // 4d. Re-merge all findings
    console.log('\nRe-merging all findings after hinted pass...');
    const reMergeResult = runScript(
      join(SCRIPTS_DIR, 'merge-detect-findings.js'),
      ['--run-id', runId],
      { label: 'Re-Merge Detect Findings', timeout: 60000 }
    );

    finalMergeData = parseJsonResult(reMergeResult.output) || finalMergeData;
    pass++;

    // Always re-check coverage after each pass so final state is accurate
    console.log('\nRe-checking coverage after hinted pass...');
    const reCoverageResult = runScript(
      join(SCRIPTS_DIR, 'coverage-tracker.js'),
      ['--run-id', runId, '--threshold', String(coverageThreshold)],
      { label: 'Coverage Re-check', timeout: 60000 }
    );
    const reCoverageData = parseJsonResult(reCoverageResult.output);
    if (reCoverageData) {
      coverageData = reCoverageData;
      currentNeedsRedetect = reCoverageData.pass_required === true;
      if (!currentNeedsRedetect) {
        console.log('Coverage thresholds now met — stopping re-detect loop');
      }
    } else {
      // Coverage check failed or returned non-JSON — assume still needed
      console.warn('Coverage re-check returned no parseable result; assuming coverage still insufficient');
    }
  }

  if (!needsRedetect) {
    console.log('\nCoverage thresholds met - skipping hinted re-detect');
  } else if (pass >= maxPasses && currentNeedsRedetect) {
    console.log(`\nMax passes (${maxPasses}) reached - stopping`);
  }

  // ============================================================
  // PHASE 5: Final Output
  // ============================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  PHASE 5: Final Output`);
  console.log(`${'='.repeat(60)}`);

  const durationMs = Date.now() - pipelineStart;
  const durationMin = (durationMs / 60000).toFixed(1);

  // Derive final coverage state: if loop ran, use currentNeedsRedetect; otherwise use initial
  const finalCoverageMet = needsRedetect ? !currentNeedsRedetect : true;

  // Write pipeline summary
  const summary = {
    id: `detect-pipeline-${Date.now()}`,
    run_id: runId,
    phases_completed: !needsRedetect ? 3 : (finalCoverageMet ? 5 : (pass >= maxPasses ? 5 : 4)),
    total_passes: pass,
    max_passes: maxPasses,
    duration_ms: durationMs,
    opus_findings: haveOpus,
    codex_findings: haveCodex,
    coverage_threshold: coverageThreshold,
    coverage_met: finalCoverageMet,
    final_merge: finalMergeData || { total: 0 },
    generated_at: new Date().toISOString()
  };

  writeFileSync(join(runDir, 'detect-pipeline-summary.json'), JSON.stringify(summary, null, 2));

  // Write detect-coverage.json for hook validator (validateDetectCoverage)
  // Load validated findings from merged output
  let validatedFindings = [];
  const mergedPath = join(runDir, 'merged-findings.json');
  if (existsSync(mergedPath)) {
    try {
      const merged = JSON.parse(readFileSync(mergedPath, 'utf-8'));
      validatedFindings = (merged.findings || []).filter(f => {
        const sev = (f.severity || '').toUpperCase();
        return sev === 'HIGH' || sev === 'MEDIUM' || sev === 'MED' || sev === 'CRITICAL';
      });
    } catch { /* use empty */ }
  }
  const detectCoverage = {
    status: 'complete',
    high_med_candidates: validatedFindings.length,
    validated_findings: validatedFindings.map(f => ({
      id: f.id, severity: f.severity, file: f.file || f.affected
    })),
    coverage_notes: `${coverageData?.entrypoint_coverage || 0}% entrypoint, ${coverageData?.module_coverage || 0}% module coverage. Passes: ${pass}/${maxPasses}.`
  };
  writeFileSync(join(TASK_DIR, 'detect-coverage.json'), JSON.stringify(detectCoverage, null, 2));
  console.log(`Detect coverage artifact: ${join(TASK_DIR, 'detect-coverage.json')}`);

  console.log(`\nPipeline complete in ${durationMin} minutes`);
  console.log(`Total findings: ${finalMergeData?.total || 0}`);
  console.log(`Dual-confirmed: ${finalMergeData?.dual_confirmed || 0}`);
  console.log(`Single-opus: ${finalMergeData?.single_opus || 0}`);
  console.log(`Single-codex: ${finalMergeData?.single_codex || 0}`);
  console.log(`Detect passes: ${pass}`);
  console.log(`Coverage met: ${finalCoverageMet}`);
  console.log(`\nOutput: ${join(runDir, 'merged-findings.json')}`);
  console.log(`Summary: ${join(runDir, 'detect-pipeline-summary.json')}`);

  console.log(JSON.stringify({
    success: true,
    run_id: runId,
    total_findings: finalMergeData?.total || 0,
    dual_confirmed: finalMergeData?.dual_confirmed || 0,
    passes: pass,
    coverage_met: finalCoverageMet,
    duration_ms: durationMs
  }));
}

main().catch(err => {
  console.error('Pipeline error:', err.message);
  process.exit(1);
});
