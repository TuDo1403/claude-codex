#!/usr/bin/env bun
/**
 * Merge Detect Findings (Stage 3.5C)
 *
 * Dual-Model Adversarial Detect: merges Opus and Codex independent
 * detection results, deduplicates by location, and classifies confidence.
 *
 * EVMbench evidence: Different models find different bugs.
 * Dual-confirmed findings get HIGH confidence.
 * Single-model findings get extra scrutiny.
 *
 * Usage:
 *   bun merge-detect-findings.js --run-id <run_id>
 *
 * Environment:
 *   CLAUDE_PROJECT_DIR - Project directory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parseArgs } from 'util';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      'opus-findings': { type: 'string' },
      'codex-findings': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: merge-detect-findings.js --run-id <run_id> [options]

Merges Opus and Codex independent detect findings.
Deduplicates by location, classifies confidence level.

Options:
  --run-id           Run ID for this pipeline execution
  --opus-findings    Path to Opus findings JSON (auto-detected if omitted)
  --codex-findings   Path to Codex findings JSON (auto-detected if omitted)
  -h, --help         Show this help message

Confidence Levels:
  DUAL_CONFIRMED  - Both models found same issue at same location
  SINGLE_OPUS     - Only Opus found this (needs Codex scrutiny)
  SINGLE_CODEX    - Only Codex found this (needs Opus scrutiny)
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

/**
 * Normalize severity for comparison
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

/**
 * Create a location key for deduplication
 */
function locationKey(finding) {
  const file = (finding.file || finding.affected || '').toLowerCase().replace(/\\/g, '/');
  const line = finding.line || 0;
  // Use file + line for exact match, or just file for broader matching
  return line > 0 ? `${file}:${line}` : file;
}

/**
 * Create a broader match key (just file, no line) for fuzzy dedup
 */
function broadKey(finding) {
  const file = (finding.file || finding.affected || '').toLowerCase().replace(/\\/g, '/');
  return file;
}

/**
 * Load findings from a file path, auto-detecting format
 */
function loadFindings(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return data.findings || data.exploits_confirmed || data.confirmed_exploits || [];
  } catch {
    return [];
  }
}

/**
 * Find findings file for a model
 */
function findFindingsFile(runId, model, explicitPath) {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;

  const runDir = join(TASK_DIR, runId);
  const candidates = model === 'opus'
    ? [
        join(runDir, 'opus-detect-findings.json'),
        join(runDir, 'exploit-hunt-review.json'),
        join(TASK_DIR, 'exploit-hunt-review.json'),
      ]
    : [
        join(runDir, 'codex-detect-findings.json'),
        join(TASK_DIR, 'codex-detect-findings.json'),
      ];

  for (const path of candidates) {
    if (existsSync(path)) {
      console.log(`${model} findings: ${path}`);
      return path;
    }
  }

  return null;
}

/**
 * Merge and deduplicate findings from two models
 */
function mergeFindings(opusFindings, codexFindings) {
  const merged = [];
  const opusMap = new Map(); // locationKey -> finding
  const opusBroad = new Map(); // broadKey -> finding

  // Index Opus findings
  for (const f of opusFindings) {
    const key = locationKey(f);
    const broad = broadKey(f);
    opusMap.set(key, f);
    if (!opusBroad.has(broad)) opusBroad.set(broad, []);
    opusBroad.get(broad).push(f);
  }

  // Process Codex findings, check for duplicates
  const matchedOpusKeys = new Set();

  for (const codexFinding of codexFindings) {
    const key = locationKey(codexFinding);
    const broad = broadKey(codexFinding);

    // Exact match (same file:line)
    if (opusMap.has(key)) {
      const opusFinding = opusMap.get(key);
      matchedOpusKeys.add(key);

      merged.push({
        ...codexFinding,
        id: `DUAL-${merged.length + 1}`,
        confidence: 'DUAL_CONFIRMED',
        found_by: ['opus', 'codex'],
        severity: higherSeverity(opusFinding.severity, codexFinding.severity),
        opus_id: opusFinding.id,
        codex_id: codexFinding.id,
        opus_title: opusFinding.title,
        codex_title: codexFinding.title,
      });
      continue;
    }

    // Broad match (same file, different line)
    const broadMatches = opusBroad.get(broad) || [];
    if (broadMatches.length > 0) {
      const opusFinding = broadMatches[0];
      const opusKey = locationKey(opusFinding);
      if (!matchedOpusKeys.has(opusKey)) {
        matchedOpusKeys.add(opusKey);

        merged.push({
          ...codexFinding,
          id: `DUAL-${merged.length + 1}`,
          confidence: 'DUAL_CONFIRMED',
          found_by: ['opus', 'codex'],
          severity: higherSeverity(opusFinding.severity, codexFinding.severity),
          opus_id: opusFinding.id,
          codex_id: codexFinding.id,
          match_type: 'broad_file_match',
        });
        continue;
      }
    }

    // No match - Codex-only finding
    merged.push({
      ...codexFinding,
      id: `SINGLE-CODEX-${merged.length + 1}`,
      confidence: 'SINGLE_CODEX',
      found_by: ['codex'],
      needs_scrutiny: true,
    });
  }

  // Add unmatched Opus findings
  for (const [key, opusFinding] of opusMap) {
    if (!matchedOpusKeys.has(key)) {
      merged.push({
        ...opusFinding,
        id: `SINGLE-OPUS-${merged.length + 1}`,
        confidence: 'SINGLE_OPUS',
        found_by: ['opus'],
        needs_scrutiny: true,
      });
    }
  }

  return merged;
}

/**
 * Return the higher severity of two values
 */
function higherSeverity(a, b) {
  const rank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  const ra = rank[normSeverity(a)] || 0;
  const rb = rank[normSeverity(b)] || 0;
  return ra >= rb ? (a || b) : (b || a);
}

function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `merge-${Date.now()}`;

  console.log(`\n=== Merge Detect Findings (Stage 3.5C) ===`);
  console.log(`Run ID: ${runId}`);

  // Find and load findings
  const opusPath = findFindingsFile(runId, 'opus', args['opus-findings']);
  const codexPath = findFindingsFile(runId, 'codex', args['codex-findings']);

  const opusFindings = opusPath ? loadFindings(opusPath) : [];
  const codexFindings = codexPath ? loadFindings(codexPath) : [];

  console.log(`Opus findings: ${opusFindings.length}`);
  console.log(`Codex findings: ${codexFindings.length}`);

  if (opusFindings.length === 0 && codexFindings.length === 0) {
    console.log('No findings from either model.');
    console.log(JSON.stringify({ success: true, total: 0 }));
    process.exit(0);
  }

  // Merge and deduplicate
  const merged = mergeFindings(opusFindings, codexFindings);

  // Classify
  const dualConfirmed = merged.filter(f => f.confidence === 'DUAL_CONFIRMED');
  const singleOpus = merged.filter(f => f.confidence === 'SINGLE_OPUS');
  const singleCodex = merged.filter(f => f.confidence === 'SINGLE_CODEX');

  console.log(`\nMerge Results:`);
  console.log(`  Dual-confirmed: ${dualConfirmed.length} (HIGH confidence)`);
  console.log(`  Single-Opus: ${singleOpus.length} (needs Codex scrutiny)`);
  console.log(`  Single-Codex: ${singleCodex.length} (needs Opus scrutiny)`);
  console.log(`  Total unique: ${merged.length}`);

  // Write output
  const runDir = join(TASK_DIR, runId);
  ensureDir(runDir);

  const result = {
    id: `merged-findings-${Date.now()}`,
    run_id: runId,
    stage: '3.5C',
    opus_source: opusPath,
    codex_source: codexPath,
    summary: {
      total: merged.length,
      dual_confirmed: dualConfirmed.length,
      single_opus: singleOpus.length,
      single_codex: singleCodex.length,
      high_severity: merged.filter(f => normSeverity(f.severity) === 'high' || normSeverity(f.severity) === 'critical').length,
    },
    findings: merged,
    dispute_items: [...singleOpus, ...singleCodex].map(f => ({
      id: f.id,
      confidence: f.confidence,
      severity: f.severity,
      file: f.file,
      title: f.title,
      reason: `Found by ${f.found_by.join(', ')} only - needs cross-model verification`
    })),
    generated_at: new Date().toISOString()
  };

  writeFileSync(join(runDir, 'merged-findings.json'), JSON.stringify(result, null, 2));

  // Write markdown report
  const reviewsDir = join(DOCS_DIR, 'reviews');
  ensureDir(reviewsDir);

  const mdContent = `# Merged Detect Findings (Stage 3.5C)

**Date:** ${new Date().toISOString()}
**Opus findings:** ${opusFindings.length}
**Codex findings:** ${codexFindings.length}
**Total unique:** ${merged.length}

## Summary

| Category | Count | Action |
|----------|-------|--------|
| Dual-confirmed | ${dualConfirmed.length} | HIGH confidence - proceed to red-team |
| Single-Opus | ${singleOpus.length} | Needs Codex scrutiny |
| Single-Codex | ${singleCodex.length} | Needs Opus scrutiny |

## Dual-Confirmed Findings (HIGH Confidence)

${dualConfirmed.length === 0 ? 'No dual-confirmed findings.\n' : dualConfirmed.map(f => `### ${f.id}: ${f.title || 'Untitled'}
**Severity:** ${f.severity}
**File:** ${f.file || 'unknown'}${f.line ? ':' + f.line : ''}
**Found by:** ${f.found_by.join(', ')}
**Opus ID:** ${f.opus_id || 'N/A'} | **Codex ID:** ${f.codex_id || 'N/A'}
`).join('\n')}

## Single-Model Findings (Need Extra Scrutiny)

${[...singleOpus, ...singleCodex].length === 0 ? 'No single-model findings.\n' : [...singleOpus, ...singleCodex].map(f => `### ${f.id}: ${f.title || 'Untitled'}
**Severity:** ${f.severity}
**File:** ${f.file || 'unknown'}${f.line ? ':' + f.line : ''}
**Found by:** ${f.found_by.join(', ')} only
**Action:** Needs cross-model verification
`).join('\n')}
`;

  writeFileSync(join(reviewsDir, 'merged-detect-findings.md'), mdContent);

  console.log(`\nOutput: ${join(runDir, 'merged-findings.json')}`);
  console.log(`Report: ${join(reviewsDir, 'merged-detect-findings.md')}`);

  console.log(JSON.stringify({
    success: true,
    total: merged.length,
    dual_confirmed: dualConfirmed.length,
    single_opus: singleOpus.length,
    single_codex: singleCodex.length
  }));
}

// Guard main() so imports don't execute it
if (import.meta.main !== false) {
  main();
}

export { normSeverity, locationKey, broadKey, loadFindings, mergeFindings, higherSeverity };
