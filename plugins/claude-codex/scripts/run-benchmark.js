#!/usr/bin/env bun
/**
 * Run Benchmark — Execute detect pipeline against benchmarks (G8)
 *
 * Iterates benchmarks from registry, runs detect pipeline via subprocess,
 * matches findings against ground truth, and outputs scored results.
 *
 * Usage:
 *   bun run-benchmark.js [--bench bench-001] [--skip-pipeline] [--dry-run]
 *
 * Environment:
 *   CLAUDE_PLUGIN_ROOT - Plugin installation directory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parseArgs } from 'util';
import { execSync } from 'child_process';
import { matchFindings, matchFindingsWithJudge, scoreResults } from './match-findings.js';

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(import.meta.path));
const BENCHMARKS_DIR = join(PLUGIN_ROOT, 'benchmarks');
const REGISTRY_PATH = join(BENCHMARKS_DIR, 'registry.json');
const RESULTS_DIR = join(BENCHMARKS_DIR, 'results');

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'bench': { type: 'string' },
      'skip-pipeline': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-judge': { type: 'boolean' },
      'judge-model': { type: 'string' },
      'timeout': { type: 'string' },
      'runs': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: run-benchmark.js [options]

Run detect pipeline against benchmarks and score results.

Options:
  --bench          Run single benchmark (default: all)
  --skip-pipeline  Re-score existing results without re-running pipeline
  --dry-run        Validate registry + ground truth without execution
  --no-judge       Disable model-judge semantic matching (enabled by default per EVMbench §3.2.1)
  --judge-model    Pin judge model (default: codex-mini-latest)
  --timeout        Pipeline timeout per benchmark in ms (default: 900000)
  --runs           Number of independent runs (default: 3, per EVMbench Figure 3 / line 520)
  -h, --help       Show this help message
    `);
    process.exit(0);
  }

  return values;
}

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error(`Registry not found: ${REGISTRY_PATH}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
}

function loadGroundTruth(benchId) {
  const gtPath = join(BENCHMARKS_DIR, 'contracts', benchId, 'ground-truth.json');
  if (!existsSync(gtPath)) {
    console.error(`Ground truth not found: ${gtPath}`);
    return null;
  }
  return JSON.parse(readFileSync(gtPath, 'utf-8'));
}

function validateBenchmark(bench) {
  const errors = [];
  const benchDir = join(BENCHMARKS_DIR, 'contracts', bench.id);

  if (!existsSync(join(benchDir, 'ground-truth.json'))) {
    errors.push(`Missing ground-truth.json`);
  }
  if (!existsSync(join(benchDir, 'benchmark.json'))) {
    errors.push(`Missing benchmark.json`);
  }

  // Validate ground truth structure
  const gt = loadGroundTruth(bench.id);
  if (gt) {
    if (!gt.findings || gt.findings.length === 0) {
      errors.push('Ground truth has no findings');
    }
    for (const f of (gt.findings || [])) {
      if (!f.id) errors.push(`Finding missing id`);
      if (!f.file) errors.push(`Finding ${f.id} missing file`);
      if (!f.mechanism) errors.push(`Finding ${f.id} missing mechanism`);
    }
  }

  return errors;
}

function runPipeline(bench, timeout) {
  const repoDir = join(BENCHMARKS_DIR, 'contracts', bench.id, 'repo');
  if (!existsSync(repoDir)) {
    console.warn(`  Repo not cloned: ${repoDir}. Run setup-benchmarks.js first.`);
    return null;
  }

  const pipelineScript = join(PLUGIN_ROOT, 'scripts', 'run-detect-pipeline.js');
  const runId = `bench-${bench.id}-${Date.now()}`;

  console.log(`  Running pipeline (run-id: ${runId})...`);

  try {
    const output = execSync(
      `bun "${pipelineScript}" --run-id "${runId}" --codex-timeout ${timeout}`,
      {
        cwd: repoDir,
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: repoDir,
          CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT
        },
        timeout: timeout + 60000, // extra minute for overhead
        encoding: 'utf-8',
        stdio: 'pipe'
      }
    );

    // Prefer merged dual-model findings (EVMbench dual-model benefit)
    const mergedPath = join(repoDir, '.task', runId, 'merged-findings.json');
    if (existsSync(mergedPath)) {
      return JSON.parse(readFileSync(mergedPath, 'utf-8'));
    }

    // Fallback to single-model Codex findings
    const findingsPath = join(repoDir, '.task', runId, 'codex-detect-findings.json');
    if (existsSync(findingsPath)) {
      return JSON.parse(readFileSync(findingsPath, 'utf-8'));
    }

    console.warn('  Pipeline completed but no findings file found');
    return { findings: [] };
  } catch (err) {
    console.error(`  Pipeline failed: ${err.message.slice(0, 200)}`);
    return null;
  }
}

/**
 * Build a semantic judge function for model-based matching (EVMbench §3.2.1).
 *
 * EVMbench protocol (line 1272): the judge sees each GT vulnerability alongside the
 * agent's FULL report and decides whether the report contains that vulnerability.
 * This is "GT-against-full-report" matching, NOT pairwise (detected vs GT).
 *
 * The function returned here is called by matchFindingsWithJudge for each
 * (detected, groundTruth) pair. To approximate the paper protocol, we include
 * a summary of all detected findings in the prompt so the judge has full report
 * context, not just the single candidate.
 *
 * Uses Codex CLI via spawn (not shell interpolation) to avoid injection from finding text.
 * Judge model can be pinned via judgeModel parameter.
 */
function buildSemanticJudge(judgeModel, allDetectedFindings) {
  // Build a condensed summary of the full agent report for context
  const reportSummary = (allDetectedFindings || []).map((d, i) =>
    `  ${i + 1}. [${d.severity || '?'}] ${d.title || 'Untitled'} — ${d.file || '?'}${d.line ? ':' + d.line : ''}`
  ).join('\n');

  return async (detected, groundTruth) => {
    const codexPath = process.env.CODEX_PATH || 'codex';
    const prompt = [
      'You are a vulnerability matching judge (EVMbench §3.2.1 protocol).',
      'You are given a GROUND TRUTH vulnerability and a CANDIDATE finding from the agent\'s report.',
      'You also see a summary of the agent\'s FULL report for context.',
      '',
      'Determine if the candidate finding describes the SAME vulnerability as the ground truth:',
      '- Same underlying security flaw/mechanism',
      '- Same code path / function',
      '- Fixable by the same specific fix',
      '',
      'Being in the same contract with similar impact is NOT sufficient.',
      '',
      '=== AGENT FULL REPORT SUMMARY ===',
      reportSummary || '(empty report)',
      '',
      '=== CANDIDATE FINDING ===',
      `- Title: ${detected.title || 'N/A'}`,
      `- Severity: ${detected.severity || 'N/A'}`,
      `- File: ${detected.file || 'N/A'}`,
      `- Line: ${detected.line || 'N/A'}`,
      `- Description: ${(detected.description || detected.root_cause || '').slice(0, 500)}`,
      '',
      '=== GROUND TRUTH VULNERABILITY ===',
      `- Title: ${groundTruth.title || 'N/A'}`,
      `- File: ${groundTruth.file || 'N/A'}`,
      `- Line: ${groundTruth.line || 'N/A'}`,
      `- Mechanism: ${groundTruth.mechanism || 'N/A'}`,
      `- Description: ${(groundTruth.description || '').slice(0, 500)}`,
      '',
      'Respond with ONLY valid JSON: {"match": true/false, "reasoning": "brief explanation"}'
    ].join('\n');

    try {
      const { spawnSync } = await import('child_process');
      const args = ['exec', '--full-auto', '--skip-git-repo-check'];
      if (judgeModel) {
        args.push('-m', judgeModel);
        // Use high reasoning effort for judge accuracy
        args.push('-c', 'model_reasoning_effort="high"');
      }
      args.push(prompt);

      const result = spawnSync(codexPath, args, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const output = result.stdout || '';
      const jsonMatch = output.match(/\{[^}]*"match"\s*:\s*(true|false)[^}]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* judge failure — return no match */ }
    return { match: false, reasoning: 'Judge invocation failed' };
  };
}

/**
 * Execute a single benchmark run and return scored results.
 */
async function runSingleBenchmark(bench, args, timeout) {
  const gt = loadGroundTruth(bench.id);
  if (!gt) {
    return { id: bench.id, status: 'error', error: 'No ground truth' };
  }

  let detectedData;
  if (args['skip-pipeline']) {
    const repoDir = join(BENCHMARKS_DIR, 'contracts', bench.id, 'repo');
    if (existsSync(repoDir)) {
      const taskDir = join(repoDir, '.task');
      if (existsSync(taskDir)) {
        try {
          const dirs = execSync(`ls -t "${taskDir}"`, { encoding: 'utf-8' })
            .trim().split('\n').filter(Boolean);
          for (const d of dirs) {
            // Prefer merged findings over single-model
            const merged = join(taskDir, d, 'merged-findings.json');
            if (existsSync(merged)) {
              detectedData = JSON.parse(readFileSync(merged, 'utf-8'));
              break;
            }
            const fp = join(taskDir, d, 'codex-detect-findings.json');
            if (existsSync(fp)) {
              detectedData = JSON.parse(readFileSync(fp, 'utf-8'));
              break;
            }
          }
        } catch { /* no existing results */ }
      }
    }
    if (!detectedData) {
      console.warn('  No existing results found');
      detectedData = { findings: [] };
    }
  } else {
    detectedData = runPipeline(bench, timeout);
    if (!detectedData) {
      return { id: bench.id, status: 'pipeline_failed' };
    }
  }

  const detectedFindings = detectedData.findings || detectedData.issues || [];
  const gtFindings = gt.findings || [];

  // Model-judge semantic matching enabled by default (EVMbench §3.2.1).
  // Disable with --no-judge for fast heuristic-only scoring.
  const useJudge = !args['no-judge'];
  let match_results;
  if (useJudge) {
    // Default judge model: codex-mini-latest (Codex 5.3 high reasoning)
    const judgeModel = args['judge-model'] || 'codex-mini-latest';
    console.log(`  Using model-judge semantic matching (EVMbench §3.2.1) [model: ${judgeModel}]...`);
    const semanticJudge = buildSemanticJudge(judgeModel, detectedFindings);
    match_results = await matchFindingsWithJudge(detectedFindings, gtFindings, { semanticJudge });
  } else {
    console.log('  Heuristic matching only (--no-judge)');
    match_results = matchFindings(detectedFindings, gtFindings);
  }
  const scores = scoreResults(match_results, detectedFindings.length);

  return {
    id: bench.id,
    name: bench.name,
    status: 'completed',
    ground_truth_count: gtFindings.length,
    detected_count: detectedFindings.length,
    match_results,
    scores,
    judge_enabled: useJudge,
    judge_model: useJudge ? (args['judge-model'] || 'codex-mini-latest') : null
  };
}

/**
 * Compute aggregate scores from completed benchmark results.
 */
function computeAggregate(completed) {
  if (completed.length === 0) return null;

  const totals = completed.reduce((acc, b) => ({
    tp: acc.tp + b.scores.true_positives,
    fp: acc.fp + b.scores.false_positives,
    fn: acc.fn + b.scores.false_negatives,
    gt: acc.gt + b.scores.total_ground_truth,
    det: acc.det + b.scores.total_detected
  }), { tp: 0, fp: 0, fn: 0, gt: 0, det: 0 });

  const precision = totals.det > 0 ? totals.tp / totals.det : 0;
  const recall = totals.gt > 0 ? totals.tp / totals.gt : 0;
  const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  return {
    benchmarks_run: completed.length,
    total_ground_truth: totals.gt,
    total_detected: totals.det,
    true_positives: totals.tp,
    false_positives: totals.fp,
    false_negatives: totals.fn,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000
  };
}

async function main() {
  const args = parseArguments();
  const registry = loadRegistry();
  const benchmarks = registry.benchmarks || [];
  const timeout = parseInt(args.timeout || '900000');
  // Default 3 runs per EVMbench Figure 3 (line 520): "we report across 3 independent runs"
  const numRuns = Math.max(1, parseInt(args.runs || '3'));

  console.log(`\n=== Benchmark Runner ===`);
  console.log(`Registry: ${benchmarks.length} benchmarks`);
  if (numRuns > 1) {
    console.log(`Independent runs: ${numRuns} (EVMbench Figure 3)`);
  }

  const toRun = args.bench
    ? benchmarks.filter(b => b.id === args.bench)
    : benchmarks;

  if (toRun.length === 0) {
    console.error(`No benchmarks found${args.bench ? ` matching "${args.bench}"` : ''}`);
    process.exit(1);
  }

  // Dry run: just validate
  if (args['dry-run']) {
    console.log('\n--- Dry Run: Validating ---\n');
    let hasErrors = false;
    for (const bench of toRun) {
      const errors = validateBenchmark(bench);
      if (errors.length > 0) {
        console.log(`  ${bench.id}: INVALID`);
        errors.forEach(e => console.log(`    - ${e}`));
        hasErrors = true;
      } else {
        console.log(`  ${bench.id}: OK (${bench.vuln_count} vulns)`);
      }
    }
    process.exit(hasErrors ? 1 : 0);
  }

  // Multi-run support (EVMbench Figure 3: 3 independent runs)
  const allRunResults = [];

  for (let run = 1; run <= numRuns; run++) {
    if (numRuns > 1) {
      console.log(`\n========== Run ${run}/${numRuns} ==========`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runResults = {
      id: `benchmark-run-${timestamp}`,
      timestamp: new Date().toISOString(),
      run_number: run,
      total_runs: numRuns,
      benchmarks: [],
      aggregate: null
    };

    for (const bench of toRun) {
      console.log(`\n--- ${bench.id}: ${bench.name}${numRuns > 1 ? ` (run ${run})` : ''} ---`);

      if (args['skip-pipeline']) {
        console.log('  Skipping pipeline (--skip-pipeline)');
      }

      const result = await runSingleBenchmark(bench, args, timeout);

      if (result.status === 'completed') {
        console.log(`  Detected: ${result.detected_count} findings`);
        console.log(`  Ground truth: ${result.ground_truth_count} vulns`);
        console.log(`  Recall: ${(result.scores.recall * 100).toFixed(1)}%  Precision: ${(result.scores.precision * 100).toFixed(1)}%  F1: ${(result.scores.f1 * 100).toFixed(1)}%`);
      }

      runResults.benchmarks.push(result);
    }

    const completed = runResults.benchmarks.filter(b => b.status === 'completed');
    runResults.aggregate = computeAggregate(completed);

    if (runResults.aggregate) {
      console.log(`\n=== Run ${run} Aggregate ===`);
      console.log(`Recall:    ${(runResults.aggregate.recall * 100).toFixed(1)}%`);
      console.log(`Precision: ${(runResults.aggregate.precision * 100).toFixed(1)}%`);
      console.log(`F1:        ${(runResults.aggregate.f1 * 100).toFixed(1)}%`);
    }

    // Write per-run results
    mkdirSync(RESULTS_DIR, { recursive: true });
    const resultsPath = join(RESULTS_DIR, `${timestamp}-results.json`);
    writeFileSync(resultsPath, JSON.stringify(runResults, null, 2));
    console.log(`Results: ${resultsPath}`);

    allRunResults.push(runResults);
  }

  // Multi-run summary
  if (numRuns > 1) {
    console.log(`\n========== Multi-Run Summary (${numRuns} runs) ==========`);

    const runRecalls = allRunResults
      .filter(r => r.aggregate)
      .map(r => r.aggregate.recall);

    if (runRecalls.length > 0) {
      const mean = runRecalls.reduce((a, b) => a + b, 0) / runRecalls.length;
      const min = Math.min(...runRecalls);
      const max = Math.max(...runRecalls);

      console.log(`Recall across runs: mean=${(mean * 100).toFixed(1)}% min=${(min * 100).toFixed(1)}% max=${(max * 100).toFixed(1)}%`);

      // Write multi-run summary
      const summaryTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const summaryPath = join(RESULTS_DIR, `${summaryTimestamp}-multirun-summary.json`);
      writeFileSync(summaryPath, JSON.stringify({
        id: `multirun-${summaryTimestamp}`,
        timestamp: new Date().toISOString(),
        total_runs: numRuns,
        per_run_results: allRunResults.map(r => r.id),
        aggregate_across_runs: {
          recall: { mean, min, max, values: runRecalls },
          precision: {
            mean: allRunResults.filter(r => r.aggregate).reduce((a, r) => a + r.aggregate.precision, 0) / runRecalls.length,
            values: allRunResults.filter(r => r.aggregate).map(r => r.aggregate.precision)
          },
          f1: {
            mean: allRunResults.filter(r => r.aggregate).reduce((a, r) => a + r.aggregate.f1, 0) / runRecalls.length,
            values: allRunResults.filter(r => r.aggregate).map(r => r.aggregate.f1)
          }
        }
      }, null, 2));
      console.log(`Multi-run summary: ${summaryPath}`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
