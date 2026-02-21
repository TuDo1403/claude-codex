#!/usr/bin/env bun
/**
 * Score Benchmark — Compare results across runs with bootstrap CIs (G8)
 *
 * Loads two benchmark result files and prints a comparison table
 * with regression warnings and bootstrap confidence intervals.
 *
 * Per EVMbench Table 9: bootstrap CIs with N=10,000 resamples at 95% level.
 *
 * Usage:
 *   bun score-benchmark.js --baseline results-A.json --current results-B.json
 */

import { readFileSync, existsSync } from 'fs';
import { parseArgs } from 'util';

// ======================== Bootstrap CI ========================

/**
 * Compute bootstrap confidence interval for a score metric.
 * Per EVMbench Appendix J: N=10,000 resamples, 95% CI.
 *
 * @param {number[]} perVulnScores - Array of per-vulnerability scores (0 or 1 for recall)
 * @param {number} nResamples - Number of bootstrap resamples (default: 10000)
 * @param {number} ciLevel - Confidence level (default: 0.95)
 * @returns {{ mean: number, ci_low: number, ci_high: number }}
 */
function bootstrapCI(perVulnScores, nResamples = 10000, ciLevel = 0.95) {
  if (!perVulnScores || perVulnScores.length === 0) {
    return { mean: 0, ci_low: 0, ci_high: 0 };
  }

  const n = perVulnScores.length;
  const means = new Float64Array(nResamples);

  for (let i = 0; i < nResamples; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(Math.random() * n);
      sum += perVulnScores[idx];
    }
    means[i] = sum / n;
  }

  // Sort for percentile computation
  means.sort();

  const alpha = 1 - ciLevel;
  const lowIdx = Math.floor((alpha / 2) * nResamples);
  const highIdx = Math.floor((1 - alpha / 2) * nResamples);

  const pointMean = perVulnScores.reduce((a, b) => a + b, 0) / n;

  return {
    mean: pointMean,
    ci_low: means[lowIdx],
    ci_high: means[Math.min(highIdx, nResamples - 1)]
  };
}

/**
 * Extract per-vulnerability binary scores from benchmark results.
 * Returns array of 0s and 1s for each ground-truth vulnerability.
 */
function extractPerVulnScores(benchmarkResults) {
  const scores = [];
  for (const bench of (benchmarkResults || [])) {
    if (bench.status !== 'completed') continue;
    const matches = bench.match_results || bench.per_vuln || [];
    for (const m of matches) {
      scores.push(m.matched ? 1 : 0);
    }
  }
  return scores;
}

// ======================== Formatting ========================

/**
 * Disclosure volume analysis (EVMbench Figure 5).
 * Correlates vulnerability count per audit with detection success rate.
 */
function analyzeDisclosureVolume(results) {
  const completed = (results.benchmarks || []).filter(b => b.status === 'completed');
  if (completed.length === 0) return null;

  const dataPoints = completed.map(b => ({
    id: b.id,
    vuln_count: b.ground_truth_count || 0,
    recall: b.scores?.recall || 0,
    precision: b.scores?.precision || 0,
    f1: b.scores?.f1 || 0
  }));

  // Sort by vuln count
  dataPoints.sort((a, b) => a.vuln_count - b.vuln_count);

  // Compute Pearson correlation between vuln_count and recall
  const n = dataPoints.length;
  const xs = dataPoints.map(d => d.vuln_count);
  const ys = dataPoints.map(d => d.recall);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let covXY = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covXY += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const correlation = (varX > 0 && varY > 0)
    ? covXY / Math.sqrt(varX * varY)
    : 0;

  return { data_points: dataPoints, correlation, n };
}

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'baseline': { type: 'string' },
      'current': { type: 'string' },
      'resamples': { type: 'string' },
      'analysis': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: score-benchmark.js --baseline <results-A.json> --current <results-B.json>

Compares two benchmark runs with bootstrap confidence intervals.
Per EVMbench Table 9: N=10,000 resamples, 95% CI.

Options:
  --baseline    Path to baseline results JSON
  --current     Path to current results JSON
  --resamples   Number of bootstrap resamples (default: 10000)
  --analysis    Show disclosure volume correlation analysis (EVMbench Figure 5)
  -h, --help    Show this help message
    `);
    process.exit(0);
  }

  return values;
}

function loadResults(path) {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function formatPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function formatCI(ci) {
  return `[${(ci.ci_low * 100).toFixed(1)}-${(ci.ci_high * 100).toFixed(1)}]`;
}

function formatDelta(current, baseline) {
  const delta = current - baseline;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)}%`;
}

async function main() {
  const args = parseArguments();
  const nResamples = parseInt(args.resamples || '10000');

  if (!args.baseline || !args.current) {
    console.error('Error: --baseline and --current are required');
    process.exit(1);
  }

  const baseline = loadResults(args.baseline);
  const current = loadResults(args.current);

  console.log(`\n=== Benchmark Comparison (${nResamples} bootstrap resamples, 95% CI) ===`);
  console.log(`Baseline: ${baseline.id || args.baseline} (${baseline.timestamp || 'unknown'})`);
  console.log(`Current:  ${current.id || args.current} (${current.timestamp || 'unknown'})`);

  // Per-benchmark comparison
  const baselineMap = new Map();
  for (const b of (baseline.benchmarks || [])) {
    if (b.status === 'completed') baselineMap.set(b.id, b);
  }

  const regressions = [];

  console.log(`\n${'Benchmark'.padEnd(15)} ${'Recall(B)'.padEnd(12)} ${'Recall(C)'.padEnd(12)} ${'Delta'.padEnd(10)} ${'F1(B)'.padEnd(10)} ${'F1(C)'.padEnd(10)} ${'Status'}`);
  console.log('-'.repeat(80));

  for (const c of (current.benchmarks || [])) {
    if (c.status !== 'completed') continue;
    const b = baselineMap.get(c.id);
    if (!b) {
      console.log(`${c.id.padEnd(15)} ${'N/A'.padEnd(12)} ${formatPct(c.scores.recall).padEnd(12)} ${'NEW'.padEnd(10)} ${'N/A'.padEnd(10)} ${formatPct(c.scores.f1).padEnd(10)} new`);
      continue;
    }

    const recallDelta = c.scores.recall - b.scores.recall;
    const f1Delta = c.scores.f1 - b.scores.f1;
    const isRegression = recallDelta < -0.05 || f1Delta < -0.05;
    const status = isRegression ? 'REGRESSION' : recallDelta > 0.05 ? 'IMPROVED' : 'stable';

    if (isRegression) regressions.push(c.id);

    console.log(
      `${c.id.padEnd(15)} ${formatPct(b.scores.recall).padEnd(12)} ${formatPct(c.scores.recall).padEnd(12)} ${formatDelta(c.scores.recall, b.scores.recall).padEnd(10)} ${formatPct(b.scores.f1).padEnd(10)} ${formatPct(c.scores.f1).padEnd(10)} ${status}`
    );
  }

  // Aggregate comparison with bootstrap CIs
  console.log('-'.repeat(80));

  const baselineScores = extractPerVulnScores(baseline.benchmarks);
  const currentScores = extractPerVulnScores(current.benchmarks);

  const baselineCI = bootstrapCI(baselineScores, nResamples);
  const currentCI = bootstrapCI(currentScores, nResamples);

  if (baseline.aggregate && current.aggregate) {
    const ba = baseline.aggregate;
    const ca = current.aggregate;
    const aggRegression = ca.recall < ba.recall - 0.05;
    console.log(
      `${'AGGREGATE'.padEnd(15)} ${formatPct(ba.recall).padEnd(12)} ${formatPct(ca.recall).padEnd(12)} ${formatDelta(ca.recall, ba.recall).padEnd(10)} ${formatPct(ba.f1).padEnd(10)} ${formatPct(ca.f1).padEnd(10)} ${aggRegression ? 'REGRESSION' : 'OK'}`
    );
  }

  // Bootstrap CI report
  console.log(`\n=== Bootstrap Confidence Intervals (95%, N=${nResamples}) ===`);
  if (baselineScores.length > 0) {
    console.log(`Baseline recall: ${formatPct(baselineCI.mean)} ${formatCI(baselineCI)} (n=${baselineScores.length} vulns)`);
  }
  if (currentScores.length > 0) {
    console.log(`Current  recall: ${formatPct(currentCI.mean)} ${formatCI(currentCI)} (n=${currentScores.length} vulns)`);
  }

  // Statistical significance check: do CIs overlap?
  if (baselineScores.length > 0 && currentScores.length > 0) {
    const overlaps = currentCI.ci_low <= baselineCI.ci_high && currentCI.ci_high >= baselineCI.ci_low;
    if (!overlaps && currentCI.mean > baselineCI.mean) {
      console.log(`\nStatistically significant improvement (CIs do not overlap)`);
    } else if (!overlaps && currentCI.mean < baselineCI.mean) {
      console.log(`\nStatistically significant regression (CIs do not overlap)`);
    } else {
      console.log(`\nDifference not statistically significant (CIs overlap)`);
    }
  }

  // Disclosure volume analysis (EVMbench Figure 5)
  if (args.analysis) {
    console.log(`\n=== Disclosure Volume Analysis (EVMbench Figure 5) ===`);
    const currentAnalysis = analyzeDisclosureVolume(current);
    if (currentAnalysis) {
      console.log(`\n${'Benchmark'.padEnd(15)} ${'Vulns'.padEnd(8)} ${'Recall'.padEnd(10)} ${'F1'.padEnd(10)}`);
      console.log('-'.repeat(45));
      for (const d of currentAnalysis.data_points) {
        console.log(`${d.id.padEnd(15)} ${String(d.vuln_count).padEnd(8)} ${formatPct(d.recall).padEnd(10)} ${formatPct(d.f1).padEnd(10)}`);
      }
      console.log('-'.repeat(45));
      console.log(`Pearson r(vuln_count, recall) = ${currentAnalysis.correlation.toFixed(3)} (n=${currentAnalysis.n})`);
      if (Math.abs(currentAnalysis.correlation) > 0.5) {
        const direction = currentAnalysis.correlation > 0 ? 'positive' : 'negative';
        console.log(`Strong ${direction} correlation: more vulnerabilities ${currentAnalysis.correlation > 0 ? 'improves' : 'reduces'} detection`);
      } else {
        console.log(`Weak correlation: vulnerability count does not strongly predict detection success`);
      }
    }
  }

  // Regression warning
  if (regressions.length > 0) {
    console.log(`\nWARNING: Regressions detected in: ${regressions.join(', ')}`);
    console.log('Review these benchmarks before merging changes.');
    process.exit(1);
  } else {
    console.log('\nNo regressions detected.');
  }
}

if (import.meta.main !== false) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { bootstrapCI, extractPerVulnScores, analyzeDisclosureVolume };
