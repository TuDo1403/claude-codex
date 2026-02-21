#!/usr/bin/env bun
/**
 * Match Findings — Benchmark Calibration (G8)
 *
 * Compares detected findings against ground-truth vulnerabilities using
 * three-tier matching: exact, broad, and semantic.
 *
 * Reuses classifyMechanism() pattern from generate-hints.js
 * Reuses normSeverity() pattern from merge-detect-findings.js
 *
 * Usage:
 *   bun match-findings.js --detected findings.json --ground-truth ground-truth.json
 *
 * Exports: matchFindings, classifyMechanism, normSeverity, scoreResults
 */

import { readFileSync, existsSync } from 'fs';
import { parseArgs } from 'util';

// ======================== Mechanism Classification ========================

/**
 * Classify a finding's mechanism category.
 * Reuses pattern from generate-hints.js for consistency.
 */
function classifyMechanism(finding) {
  const text = [
    finding.title || '',
    finding.root_cause || '',
    finding.description || '',
    finding.type || '',
    finding.category || '',
    finding.mechanism || ''
  ].join(' ').toLowerCase();

  if (text.includes('reentran')) return 'reentrancy';
  if (text.includes('access') || text.includes('auth') || text.includes('permission') || text.includes('role')) return 'access-control';
  if (text.includes('overflow') || text.includes('underflow') || text.includes('precision') || text.includes('rounding')) return 'arithmetic';
  if (text.includes('oracle') || text.includes('twap') || text.includes('price')) return 'oracle-manipulation';
  if (text.includes('flash loan') || text.includes('flashloan')) return 'flash-loan';
  if (text.includes('front-run') || text.includes('sandwich') || text.includes('mev')) return 'front-running';
  if (text.includes('dos') || text.includes('grief') || text.includes('unbounded') || text.includes('gas limit')) return 'dos-griefing';
  if (text.includes('state') || text.includes('corrupt') || text.includes('inconsist')) return 'state-corruption';
  if (text.includes('upgrade') || text.includes('proxy') || text.includes('initializ')) return 'upgrade-safety';
  if (text.includes('token') || text.includes('erc20') || text.includes('erc721') || text.includes('transfer')) return 'token-handling';
  if (text.includes('cross-contract') || text.includes('cross-module') || text.includes('callback')) return 'cross-contract';
  if (text.includes('economic') || text.includes('liquidat') || text.includes('collateral')) return 'economic';
  if (text.includes('logic') || text.includes('conditional') || text.includes('branch')) return 'logic-error';
  if (text.includes('init') || text.includes('constructor')) return 'initialization';
  return 'other';
}

// ======================== Severity Normalization ========================

/**
 * Normalize severity string.
 * Reuses pattern from merge-detect-findings.js.
 */
function normSeverity(s) {
  if (!s) return 'unknown';
  const lower = s.toLowerCase();
  if (lower.startsWith('crit')) return 'critical';
  if (lower.startsWith('hi')) return 'high';
  if (lower.startsWith('med')) return 'medium';
  if (lower.startsWith('lo')) return 'low';
  return lower;
}

// ======================== File Path Normalization ========================

function normFile(f) {
  if (!f) return '';
  return f.toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '');
}

// ======================== Three-Tier Matching ========================

/**
 * Exact match: same file + line (±tolerance) + same mechanism
 */
function isExactMatch(detected, groundTruth, lineTolerance = 5) {
  const dFile = normFile(detected.file);
  const gtFile = normFile(groundTruth.file);
  if (!dFile || !gtFile || dFile !== gtFile) return false;

  const dLine = detected.line || 0;
  const gtLine = groundTruth.line || 0;
  if (!dLine || !gtLine) return false;
  if (Math.abs(dLine - gtLine) > lineTolerance) return false;

  const dMech = classifyMechanism(detected);
  const gtMech = groundTruth.mechanism || classifyMechanism(groundTruth);
  return dMech === gtMech;
}

/**
 * Broad match: same file + same mechanism category
 */
function isBroadMatch(detected, groundTruth) {
  const dFile = normFile(detected.file);
  const gtFile = normFile(groundTruth.file);
  if (!dFile || !gtFile || dFile !== gtFile) return false;

  const dMech = classifyMechanism(detected);
  const gtMech = groundTruth.mechanism || classifyMechanism(groundTruth);
  return dMech === gtMech;
}

/**
 * Match detected findings against ground truth using three-tier matching.
 * Returns per-ground-truth match results.
 */
function matchFindings(detectedFindings, groundTruthFindings, options = {}) {
  const lineTolerance = options.lineTolerance || 5;
  const results = [];

  for (const gt of groundTruthFindings) {
    let bestMatch = null;
    let matchTier = 'none';

    // Try exact match first
    for (const det of detectedFindings) {
      if (isExactMatch(det, gt, lineTolerance)) {
        bestMatch = det;
        matchTier = 'exact';
        break;
      }
    }

    // Try broad match
    if (!bestMatch) {
      for (const det of detectedFindings) {
        if (isBroadMatch(det, gt)) {
          bestMatch = det;
          matchTier = 'broad';
          break;
        }
      }
    }

    results.push({
      ground_truth_id: gt.id,
      ground_truth_title: gt.title,
      ground_truth_severity: gt.severity,
      ground_truth_mechanism: gt.mechanism,
      matched: !!bestMatch,
      match_tier: matchTier,
      detected_id: bestMatch?.id || null,
      detected_title: bestMatch?.title || null
    });
  }

  return results;
}

// ======================== Scoring ========================

/**
 * Compute precision, recall, and F1 from match results.
 */
function scoreResults(matchResults, detectedCount) {
  const truePositives = matchResults.filter(r => r.matched).length;
  const totalGroundTruth = matchResults.length;
  const falsePositives = Math.max(0, detectedCount - truePositives);

  const precision = detectedCount > 0 ? truePositives / detectedCount : 0;
  const recall = totalGroundTruth > 0 ? truePositives / totalGroundTruth : 0;
  const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  const exactMatches = matchResults.filter(r => r.match_tier === 'exact').length;
  const broadMatches = matchResults.filter(r => r.match_tier === 'broad').length;

  return {
    true_positives: truePositives,
    false_positives: falsePositives,
    false_negatives: totalGroundTruth - truePositives,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    exact_matches: exactMatches,
    broad_matches: broadMatches,
    total_ground_truth: totalGroundTruth,
    total_detected: detectedCount
  };
}

// ======================== CLI ========================

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'detected': { type: 'string' },
      'ground-truth': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: match-findings.js --detected <findings.json> --ground-truth <ground-truth.json>

Compares detected findings against ground truth with three-tier matching.

Options:
  --detected      Path to detected findings JSON
  --ground-truth  Path to ground truth JSON
  -h, --help      Show this help message
    `);
    process.exit(0);
  }

  return values;
}

async function main() {
  const args = parseArguments();

  if (!args.detected || !args['ground-truth']) {
    console.error('Error: --detected and --ground-truth are required');
    process.exit(1);
  }

  if (!existsSync(args.detected)) {
    console.error(`Error: detected file not found: ${args.detected}`);
    process.exit(1);
  }
  if (!existsSync(args['ground-truth'])) {
    console.error(`Error: ground truth file not found: ${args['ground-truth']}`);
    process.exit(1);
  }

  const detectedData = JSON.parse(readFileSync(args.detected, 'utf-8'));
  const gtData = JSON.parse(readFileSync(args['ground-truth'], 'utf-8'));

  const detectedFindings = detectedData.findings || detectedData.issues || [];
  const gtFindings = gtData.findings || [];

  const matchResults = matchFindings(detectedFindings, gtFindings);
  const scores = scoreResults(matchResults, detectedFindings.length);

  console.log('\n=== Match Results ===\n');
  for (const r of matchResults) {
    const icon = r.matched ? (r.match_tier === 'exact' ? '[EXACT]' : '[BROAD]') : '[MISS]';
    console.log(`${icon} ${r.ground_truth_id}: ${r.ground_truth_title}`);
    if (r.matched) {
      console.log(`       -> ${r.detected_id}: ${r.detected_title}`);
    }
  }

  console.log('\n=== Scores ===\n');
  console.log(`Precision: ${(scores.precision * 100).toFixed(1)}%`);
  console.log(`Recall:    ${(scores.recall * 100).toFixed(1)}%`);
  console.log(`F1:        ${(scores.f1 * 100).toFixed(1)}%`);
  console.log(`Exact:     ${scores.exact_matches}/${scores.total_ground_truth}`);
  console.log(`Broad:     ${scores.broad_matches}/${scores.total_ground_truth}`);
  console.log(`Missed:    ${scores.false_negatives}/${scores.total_ground_truth}`);
  console.log(`FP:        ${scores.false_positives}`);

  console.log(JSON.stringify({ matchResults, scores }, null, 2));
}

if (import.meta.main !== false) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { matchFindings, classifyMechanism, normSeverity, scoreResults, isExactMatch, isBroadMatch, normFile };
