#!/usr/bin/env bun
/**
 * Consolidate Findings (Stage 4.5)
 *
 * Collects HIGH/MED findings from all 4 detection stages, normalizes to a
 * common format, deduplicates, and writes unified consolidated-findings.json
 * plus initial red-team-issue-log.md.
 *
 * Sources:
 *   Stage 4  — exploit-hunt-review.json   → exploits_confirmed[]
 *   Stage 4A — opus-attack-plan.json      → attack_hypotheses[] (HIGH/MED only)
 *   Stage 4B — codex-deep-exploit-review.json → confirmed_exploits[]
 *   Stage 4C — dispute-resolution.json    → red_team_issues_created[]
 *
 * Reuses normSeverity / locationKey / broadKey logic from merge-detect-findings.js.
 *
 * Usage:
 *   bun consolidate-findings.js --run-id <run_id>
 *
 * Environment:
 *   CLAUDE_PROJECT_DIR - Project directory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
function getTaskDir() {
  return join(getProjectDir(), '.task');
}
function getDocsDir() {
  return join(getProjectDir(), 'docs');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: consolidate-findings.js --run-id <run_id>

Consolidates HIGH/MED findings from all detection stages (4, 4A, 4B, 4C).
Deduplicates, assigns RT-IDs, writes consolidated-findings.json + red-team-issue-log.md.

Options:
  --run-id    Run ID for this pipeline execution (required)
  -h, --help  Show this help message
    `);
    process.exit(0);
  }

  if (!values['run-id']) {
    console.error('Error: --run-id is required');
    process.exit(1);
  }

  return values;
}

// ---------------------------------------------------------------------------
// Helpers (reused logic from merge-detect-findings.js)
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Normalize severity for comparison */
function normSeverity(s) {
  if (!s) return 'unknown';
  const lower = s.toLowerCase();
  if (lower.startsWith('crit')) return 'critical';
  if (lower.startsWith('hi')) return 'high';
  if (lower.startsWith('med')) return 'medium';
  if (lower.startsWith('lo')) return 'low';
  return lower;
}

/** Normalize severity to schema enum format (HIGH, MED, LOW) */
function schemaSeverity(s) {
  const norm = normSeverity(s);
  if (norm === 'critical' || norm === 'high') return 'HIGH';
  if (norm === 'medium') return 'MED';
  return 'LOW';
}

/** Severity rank for comparison */
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: 0 };

function sevRank(s) {
  return SEV_RANK[normSeverity(s)] || 0;
}

/** Return the higher severity of two values */
function higherSeverity(a, b) {
  return sevRank(a) >= sevRank(b) ? (a || b) : (b || a);
}

/** Create exact dedup key (file:line) */
function locationKey(finding) {
  const file = extractFile(finding).toLowerCase().replace(/\\/g, '/');
  const line = finding.line || 0;
  return line > 0 ? `${file}:${line}` : file;
}

/** Create broad dedup key (file only) */
function broadKey(finding) {
  return extractFile(finding).toLowerCase().replace(/\\/g, '/');
}

/** Extract file path from various schema shapes */
function extractFile(finding) {
  if (finding.file) return finding.file;
  if (finding.affected) {
    // affected can be "Contract::function" or "src/Contract.sol:142" or array
    const aff = Array.isArray(finding.affected) ? finding.affected[0] : finding.affected;
    if (typeof aff === 'string') return aff;
  }
  return '';
}

/** Extract line number from various schema shapes */
function extractLine(finding) {
  if (finding.line) return finding.line;
  // Some schemas put line in affected string "src/Vault.sol:142"
  const file = extractFile(finding);
  const match = file.match(/:(\d+)$/);
  if (match) return parseInt(match[1], 10);
  return 0;
}

/** Extract mechanism/type classification from a finding */
function extractMechanism(finding) {
  return finding.mechanism || finding.type || finding.category || 'unknown';
}

// ---------------------------------------------------------------------------
// Stage-specific loaders
// ---------------------------------------------------------------------------

/** Resolve a file path: check run-scoped first, then global .task/ fallback */
function resolveTaskFile(runId, filename) {
  const runScoped = join(getTaskDir(), runId, filename);
  if (existsSync(runScoped)) return runScoped;
  const global = join(getTaskDir(), filename);
  if (existsSync(global)) return global;
  return null;
}

/** Load from .task/{runId}/exploit-hunt-review.json → exploits_confirmed[] */
function loadExploitHuntFindings(runId) {
  const filePath = resolveTaskFile(runId, 'exploit-hunt-review.json');
  if (!filePath) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const exploits = data.exploits_confirmed || [];
    return exploits
      .filter(e => {
        const sev = normSeverity(e.severity);
        return sev === 'high' || sev === 'medium' || sev === 'critical';
      })
      .map(e => ({
        original_id: e.id,
        source: 'exploit-hunt',
        severity: e.severity,
        title: e.title || '',
        file: extractFile(e),
        line: extractLine(e),
        mechanism: extractMechanism(e),
        description: e.description || '',
        regression_test_required: e.regression_test_required || e.regression_test || ''
      }));
  } catch {
    return [];
  }
}

/** Load from .task/{runId}/opus-attack-plan.json → attack_hypotheses[] (HIGH/MED only) */
function loadAttackPlanFindings(runId) {
  const filePath = resolveTaskFile(runId, 'opus-attack-plan.json');
  if (!filePath) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const hypotheses = data.attack_hypotheses || [];
    return hypotheses
      .filter(h => {
        const sev = normSeverity(h.severity);
        return sev === 'high' || sev === 'medium' || sev === 'critical';
      })
      .map(h => ({
        original_id: h.id,
        source: 'attack-plan',
        severity: h.severity,
        title: h.name || h.title || '',
        file: extractFile(h),
        line: extractLine(h),
        mechanism: extractMechanism(h),
        description: h.why_it_breaks || h.description || '',
        regression_test_required: h.demonstration_test || ''
      }));
  } catch {
    return [];
  }
}

/** Load from .task/{runId}/codex-deep-exploit-review.json → confirmed_exploits[] */
function loadDeepExploitFindings(runId) {
  const filePath = resolveTaskFile(runId, 'codex-deep-exploit-review.json');
  if (!filePath) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const exploits = data.confirmed_exploits || data.findings?.exploits_confirmed || [];
    return exploits
      .filter(e => {
        const sev = normSeverity(e.severity);
        return sev === 'high' || sev === 'medium' || sev === 'critical';
      })
      .map(e => ({
        original_id: e.id,
        source: 'deep-exploit',
        severity: e.severity,
        title: e.title || '',
        file: extractFile(e),
        line: extractLine(e),
        mechanism: extractMechanism(e),
        description: e.deep_analysis || e.description || '',
        regression_test_required: e.regression_test || ''
      }));
  } catch {
    return [];
  }
}

/** Load from .task/{runId}/dispute-resolution.json → red_team_issues_created[] */
function loadDisputeFindings(runId) {
  const filePath = resolveTaskFile(runId, 'dispute-resolution.json');
  if (!filePath) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const rtIssues = data.red_team_issues_created || [];
    // Also extract detail from dispute_details for richer info
    const detailMap = new Map();
    for (const d of (data.dispute_details || [])) {
      if (d.verdict === 'CONFIRMED') {
        detailMap.set(d.red_team_issue || d.id, d);
      }
    }
    return rtIssues
      .filter(rt => {
        const sev = normSeverity(rt.severity);
        return sev === 'high' || sev === 'medium' || sev === 'critical';
      })
      .map(rt => {
        const detail = detailMap.get(rt.id) || detailMap.get(rt.dispute) || {};
        return {
          original_id: rt.id || rt.dispute,
          source: 'dispute',
          severity: rt.severity,
          title: rt.title || detail.title || '',
          file: extractFile(rt.file ? rt : detail),
          line: extractLine(rt.line ? rt : detail),
          mechanism: extractMechanism(detail),
          description: detail.justification || '',
          regression_test_required: detail.reproduction_artifact?.test_file || ''
        };
      });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Consolidation engine
// ---------------------------------------------------------------------------

/**
 * Consolidate findings from all sources.
 * Dedup: 1) exact match (locationKey) → merge, keep highest severity
 *        2) broad match (broadKey) if same mechanism → merge
 * Assign RT-001..RT-N IDs sequentially.
 */
function consolidateFindings(allFindings) {
  const merged = [];
  const exactMap = new Map();   // locationKey → index in merged
  const broadMap = new Map();   // broadKey → [indices in merged]

  for (const finding of allFindings) {
    const exact = locationKey(finding);
    const broad = broadKey(finding);

    // 1) Exact match
    if (exact && exactMap.has(exact)) {
      const idx = exactMap.get(exact);
      const existing = merged[idx];
      existing.severity = higherSeverity(existing.severity, finding.severity);
      if (!existing.sources.includes(finding.source)) {
        existing.sources.push(finding.source);
      }
      if (finding.original_id && !existing.original_ids.includes(finding.original_id)) {
        existing.original_ids.push(finding.original_id);
      }
      if (finding.description && !existing.description) {
        existing.description = finding.description;
      }
      if (finding.regression_test_required && !existing.regression_test_required) {
        existing.regression_test_required = finding.regression_test_required;
      }
      continue;
    }

    // 2) Broad match (same file, same mechanism, but NOT when both have distinct line numbers)
    //    Two bugs at different lines in the same file are distinct vulnerabilities.
    if (broad && broadMap.has(broad)) {
      const indices = broadMap.get(broad);
      let broadMerged = false;
      for (const idx of indices) {
        const existing = merged[idx];
        const existingLine = existing.line || 0;
        const findingLine = finding.line || 0;
        // Skip broad merge if both have specific (non-zero) line numbers that differ
        if (existingLine > 0 && findingLine > 0 && existingLine !== findingLine) continue;
        if (existing.mechanism === finding.mechanism || existing.mechanism === 'unknown' || finding.mechanism === 'unknown') {
          existing.severity = higherSeverity(existing.severity, finding.severity);
          if (!existing.sources.includes(finding.source)) {
            existing.sources.push(finding.source);
          }
          if (finding.original_id && !existing.original_ids.includes(finding.original_id)) {
            existing.original_ids.push(finding.original_id);
          }
          if (finding.description && !existing.description) {
            existing.description = finding.description;
          }
          if (finding.regression_test_required && !existing.regression_test_required) {
            existing.regression_test_required = finding.regression_test_required;
          }
          // Update mechanism if we had unknown
          if (existing.mechanism === 'unknown' && finding.mechanism !== 'unknown') {
            existing.mechanism = finding.mechanism;
          }
          broadMerged = true;
          break;
        }
      }
      if (broadMerged) continue;
    }

    // 3) New entry
    const entry = {
      original_id: finding.original_id,
      original_ids: [finding.original_id].filter(Boolean),
      sources: [finding.source],
      severity: finding.severity,
      title: finding.title,
      file: finding.file,
      line: finding.line,
      mechanism: finding.mechanism,
      description: finding.description,
      regression_test_required: finding.regression_test_required
    };
    const idx = merged.length;
    merged.push(entry);

    if (exact) exactMap.set(exact, idx);
    if (broad) {
      if (!broadMap.has(broad)) broadMap.set(broad, []);
      broadMap.get(broad).push(idx);
    }
  }

  // Assign RT-IDs sequentially, normalize severity to schema enum
  return merged.map((entry, i) => ({
    id: `RT-${String(i + 1).padStart(3, '0')}`,
    original_id: entry.original_ids[0] || '',
    original_ids: entry.original_ids,
    source: entry.sources.length === 1 ? entry.sources[0] : entry.sources.join('+'),
    sources: entry.sources,
    severity: schemaSeverity(entry.severity),
    title: entry.title,
    file: entry.file,
    line: entry.line,
    mechanism: entry.mechanism,
    description: entry.description,
    regression_test_required: entry.regression_test_required,
    multi_source: entry.sources.length > 1
  }));
}

// ---------------------------------------------------------------------------
// Output writers
// ---------------------------------------------------------------------------

function writeConsolidatedJson(runId, findings) {
  const runDir = join(getTaskDir(), runId);
  ensureDir(runDir);

  const highMed = findings.filter(f => {
    const sev = normSeverity(f.severity);
    return sev === 'high' || sev === 'medium' || sev === 'critical';
  });

  const result = {
    id: `consolidated-findings-${Date.now()}`,
    run_id: runId,
    stage: '4.5',
    summary: {
      total: findings.length,
      high: findings.filter(f => normSeverity(f.severity) === 'high' || normSeverity(f.severity) === 'critical').length,
      med: findings.filter(f => normSeverity(f.severity) === 'medium').length,
      low: findings.filter(f => normSeverity(f.severity) === 'low').length,
      multi_source: findings.filter(f => f.multi_source).length,
      by_source: {
        exploit_hunt: findings.filter(f => f.sources.includes('exploit-hunt')).length,
        attack_plan: findings.filter(f => f.sources.includes('attack-plan')).length,
        deep_exploit: findings.filter(f => f.sources.includes('deep-exploit')).length,
        dispute: findings.filter(f => f.sources.includes('dispute')).length,
      }
    },
    findings,
    generated_at: new Date().toISOString()
  };

  const outPath = join(runDir, 'consolidated-findings.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  return outPath;
}

function writeRedTeamIssueLog(runId, findings) {
  const reviewsDir = join(getDocsDir(), 'reviews');
  ensureDir(reviewsDir);

  const now = new Date().toISOString();
  const highMed = findings.filter(f => {
    const sev = normSeverity(f.severity);
    return sev === 'high' || sev === 'medium' || sev === 'critical';
  });

  let md = `# Red-Team Issue Log

**Pipeline Run:** ${runId}
**Last Updated:** ${now}
**Status:** 0 of ${highMed.length} HIGH/MED CLOSED

---

`;

  for (const f of findings) {
    md += `## ${f.id}
- **Original ID:** ${f.original_id}
- **Source:** ${f.sources.join(', ')}
- **Severity:** ${f.severity}
- **Title:** ${f.title}
- **Description:**
  ${f.description || 'See source review for details.'}
- **Affected:** ${f.file}${f.line ? ':' + f.line : ''}
- **Mechanism:** ${f.mechanism}
- **Regression Test Required:** ${f.regression_test_required || 'TBD'}
- **Status:** OPEN
- **Fix Applied:** pending
- **Fix Verified:** No
- **Test Verified:** No
- **Verifier Notes:**
- **Closed At:** -

---

`;
  }

  const outPath = join(reviewsDir, 'red-team-issue-log.md');
  writeFileSync(outPath, md);
  return outPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArguments();
  const runId = args['run-id'];

  console.log(`\n=== Consolidate Findings (Stage 4.5) ===`);
  console.log(`Run ID: ${runId}`);

  // Load from all 4 sources
  const ehFindings = loadExploitHuntFindings(runId);
  const apFindings = loadAttackPlanFindings(runId);
  const deFindings = loadDeepExploitFindings(runId);
  const drFindings = loadDisputeFindings(runId);

  console.log(`\nSource counts:`);
  console.log(`  Exploit Hunt (Stage 4):  ${ehFindings.length}`);
  console.log(`  Attack Plan (Stage 4A):  ${apFindings.length}`);
  console.log(`  Deep Exploit (Stage 4B): ${deFindings.length}`);
  console.log(`  Disputes (Stage 4C):     ${drFindings.length}`);

  const allFindings = [...ehFindings, ...apFindings, ...deFindings, ...drFindings];

  if (allFindings.length === 0) {
    console.log('\nNo HIGH/MED findings from any detection stage.');
    // Still write empty consolidated output
    const jsonPath = writeConsolidatedJson(runId, []);
    console.log(`\nOutput: ${jsonPath}`);
    console.log(JSON.stringify({ success: true, total: 0 }));
    process.exit(0);
  }

  // Consolidate and dedup
  const consolidated = consolidateFindings(allFindings);

  console.log(`\nConsolidation Results:`);
  console.log(`  Input findings:  ${allFindings.length}`);
  console.log(`  After dedup:     ${consolidated.length}`);
  console.log(`  Multi-source:    ${consolidated.filter(f => f.multi_source).length}`);
  console.log(`  HIGH:            ${consolidated.filter(f => normSeverity(f.severity) === 'high' || normSeverity(f.severity) === 'critical').length}`);
  console.log(`  MEDIUM:          ${consolidated.filter(f => normSeverity(f.severity) === 'medium').length}`);

  // Write outputs
  const jsonPath = writeConsolidatedJson(runId, consolidated);
  const mdPath = writeRedTeamIssueLog(runId, consolidated);

  console.log(`\nOutput: ${jsonPath}`);
  console.log(`Issue Log: ${mdPath}`);

  console.log(JSON.stringify({
    success: true,
    total: consolidated.length,
    high: consolidated.filter(f => normSeverity(f.severity) === 'high' || normSeverity(f.severity) === 'critical').length,
    medium: consolidated.filter(f => normSeverity(f.severity) === 'medium').length,
    multi_source: consolidated.filter(f => f.multi_source).length
  }));
}

// Guard main() so imports don't execute it
if (import.meta.main !== false) {
  main();
}

export {
  normSeverity,
  locationKey,
  broadKey,
  extractFile,
  extractLine,
  extractMechanism,
  higherSeverity,
  loadExploitHuntFindings,
  loadAttackPlanFindings,
  loadDeepExploitFindings,
  loadDisputeFindings,
  consolidateFindings,
};
