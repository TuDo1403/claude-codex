#!/usr/bin/env bun
/**
 * Generate Hints for Cross-Model Escalation
 *
 * EVMbench evidence: Medium hints boost Patch from 39% to 93.9% (Figure 7).
 * Strategy: Strip finding details, keep file locations + mechanism categories.
 * Like EVMbench "medium hints": location + mechanism, not the full answer.
 *
 * Bidirectional:
 *   - Opus findings -> hints for Codex
 *   - Codex findings -> hints for Opus
 *
 * Usage:
 *   bun generate-hints.js --run-id <run_id> --source opus --target codex
 *   bun generate-hints.js --run-id <run_id> --source codex --target opus
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

// Mechanism categories for hint classification
const MECHANISM_CATEGORIES = [
  'reentrancy',
  'access-control',
  'arithmetic',
  'oracle-manipulation',
  'flash-loan',
  'front-running',
  'dos-griefing',
  'state-corruption',
  'upgrade-safety',
  'token-handling',
  'cross-contract',
  'economic',
  'logic-error',
  'initialization',
  'other'
];

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      'source': { type: 'string' },
      'target': { type: 'string' },
      'level': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: generate-hints.js --run-id <run_id> --source <model> --target <model> [--level medium]

Generates hints from one model's findings for another model.

Options:
  --run-id     Run ID for this pipeline execution
  --source     Source model findings (opus|codex|static)
  --target     Target model to receive hints (codex|opus)
  --level      Hint level: low|medium|high (default: medium)
  -h, --help   Show this help message

Sources:
  opus:    Opus model findings
  codex:   Codex model findings
  static:  Slither/Semgrep static analysis findings (reports/slither.json, reports/semgrep.json)

Hint Levels (EVMbench Table 8):
  low:    File locations only
  medium: File locations + mechanism category (default)
  high:   File locations + mechanism + title + description (grading criteria)
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
 * Classify a finding into a mechanism category based on keywords
 */
function classifyMechanism(finding) {
  const text = [
    finding.title || '',
    finding.root_cause || '',
    finding.description || '',
    finding.type || '',
    finding.category || ''
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

/**
 * Extract low-level hints (file location only)
 * EVMbench Table 8: low hints boost detect ~10pp
 */
function extractLowHints(findings) {
  return findings.map((f, i) => ({
    hint_id: `HINT-${i + 1}`,
    file: f.file || f.affected || 'unknown',
    line: f.line || null,
    severity: (f.severity || 'unknown').toUpperCase(),
  }));
}

/**
 * Extract medium-level hints (location + mechanism)
 * EVMbench Table 8: medium hints boost detect from 39.2% to 89.7%
 */
function extractMediumHints(findings) {
  return findings.map((f, i) => ({
    hint_id: `HINT-${i + 1}`,
    file: f.file || f.affected || 'unknown',
    line: f.line || null,
    severity: (f.severity || 'unknown').toUpperCase(),
    mechanism: classifyMechanism(f),
  }));
}

/**
 * Extract high-level hints (location + mechanism + grading criteria)
 * EVMbench Table 8: high hints boost exploit from 62.5% to 95.8%
 * Includes title + description for grading context
 */
function extractHighHints(findings) {
  return findings.map((f, i) => ({
    hint_id: `HINT-${i + 1}`,
    file: f.file || f.affected || 'unknown',
    line: f.line || null,
    severity: (f.severity || 'unknown').toUpperCase(),
    mechanism: classifyMechanism(f),
    title: f.title || 'Untitled',
    description: f.description || f.root_cause || 'No description',
    exploit_scenario: f.exploit_scenario || null,
  }));
}

/**
 * Extract hints at the specified level
 */
function extractHints(findings, level) {
  if (level === 'low') return extractLowHints(findings);
  if (level === 'high') return extractHighHints(findings);
  return extractMediumHints(findings);
}

/**
 * Parse slither JSON into normalized findings array.
 * Maps slither detectors to the same shape as model findings.
 */
function parseSlitherToFindings(slitherPath) {
  if (!existsSync(slitherPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(slitherPath, 'utf-8'));
    const detectors = raw.results?.detectors || raw.detectors || [];

    return detectors
      .filter(d => {
        const impact = (d.impact || '').toUpperCase();
        return impact === 'HIGH' || impact === 'MEDIUM';
      })
      .map((d, i) => {
        const elem = (d.elements || [])[0];
        const file = elem?.source_mapping?.filename_relative || elem?.source_mapping?.filename || 'unknown';
        const lines = elem?.source_mapping?.lines || [];
        return {
          id: `SL-${i + 1}`,
          title: `${d.check || d.detector || 'unknown'}: ${(d.description || '').slice(0, 80)}`,
          severity: (d.impact || 'MEDIUM').toUpperCase(),
          file,
          line: lines[0] || null,
          description: d.description || '',
          category: d.check || d.detector || '',
          source: 'slither'
        };
      });
  } catch {
    return [];
  }
}

/**
 * Parse semgrep JSON into normalized findings array.
 */
function parseSemgrepToFindings(semgrepPath) {
  if (!existsSync(semgrepPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(semgrepPath, 'utf-8'));
    const results = raw.results || [];

    return results
      .filter(r => {
        const sev = (r.extra?.severity || r.severity || '').toUpperCase();
        return sev === 'ERROR' || sev === 'WARNING';
      })
      .map((r, i) => ({
        id: `SG-${i + 1}`,
        title: r.check_id || r.rule_id || 'unknown',
        severity: (r.extra?.severity || r.severity || 'MEDIUM').toUpperCase() === 'ERROR' ? 'HIGH' : 'MEDIUM',
        file: r.path || 'unknown',
        line: r.start?.line || r.line || null,
        description: r.extra?.message || r.message || '',
        category: r.check_id || r.rule_id || '',
        source: 'semgrep'
      }));
  } catch {
    return [];
  }
}

/**
 * Find findings from a source model or static analysis tools.
 */
function findSourceFindings(runId, source) {
  // Static analysis source: combine slither + semgrep findings
  if (source === 'static') {
    const REPORTS_DIR = join(PROJECT_DIR, 'reports');
    const slitherFindings = parseSlitherToFindings(join(REPORTS_DIR, 'slither.json'));
    const semgrepFindings = parseSemgrepToFindings(join(REPORTS_DIR, 'semgrep.json'));
    const combined = [...slitherFindings, ...semgrepFindings];

    if (combined.length > 0) {
      console.log(`Found static analysis findings: ${slitherFindings.length} slither, ${semgrepFindings.length} semgrep`);
      return { findings: combined, source: 'static-analysis' };
    }
    return null;
  }

  // ONLY check run-scoped paths — global .task/ and docs/ fallbacks removed
  // to prevent cross-run contamination (stale findings from prior runs).
  const candidates = source === 'opus'
    ? [
        join(TASK_DIR, runId, 'opus-detect-findings.json'),
        join(TASK_DIR, runId, 'exploit-hunt-review.json'),
      ]
    : [
        join(TASK_DIR, runId, 'codex-detect-findings.json'),
        join(TASK_DIR, runId, 'codex-deep-exploit-review.json'),
      ];

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        console.log(`Found source findings at: ${path}`);
        return data;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `hints-${Date.now()}`;
  const source = args.source || 'opus';
  const target = args.target || 'codex';
  const level = args.level || 'medium';

  if (!['low', 'medium', 'high'].includes(level)) {
    console.error(`Invalid hint level: "${level}". Must be low, medium, or high.`);
    process.exit(1);
  }

  const levelDescriptions = {
    low: 'file locations only',
    medium: 'location + mechanism',
    high: 'location + mechanism + grading criteria'
  };

  console.log(`\n=== Generate Hints (${source} -> ${target}) ===`);
  console.log(`Run ID: ${runId}`);
  console.log(`Hint level: ${level} (${levelDescriptions[level]})`);

  // Load source findings
  const sourceData = findSourceFindings(runId, source);
  if (!sourceData) {
    console.log(`No ${source} findings found. No hints to generate.`);
    console.log(JSON.stringify({ success: true, hints_count: 0, message: 'No source findings' }));
    process.exit(0);
  }

  // Extract findings array
  const findings = sourceData.findings
    || sourceData.exploits_confirmed
    || sourceData.confirmed_exploits
    || [];

  // Filter to HIGH/MED only
  const significant = findings.filter(f => {
    const sev = (f.severity || '').toUpperCase();
    return sev === 'HIGH' || sev === 'MEDIUM' || sev === 'MED' || sev === 'CRITICAL';
  });

  console.log(`Source findings: ${findings.length} total, ${significant.length} HIGH/MED`);

  if (significant.length === 0) {
    console.log('No significant findings to generate hints from.');
    console.log(JSON.stringify({ success: true, hints_count: 0 }));
    process.exit(0);
  }

  // Generate hints
  const hints = extractHints(significant, level);

  // Write hints file
  const runDir = join(TASK_DIR, runId);
  ensureDir(runDir);

  const hintsFile = join(runDir, `hints-${source}-to-${target}.json`);
  const hintsData = {
    id: `hints-${source}-to-${target}-${Date.now()}`,
    source_model: source,
    target_model: target,
    hint_level: level,
    hint_description: levelDescriptions[level],
    hints: hints,
    total_hints: hints.length,
    generated_at: new Date().toISOString()
  };

  writeFileSync(hintsFile, JSON.stringify(hintsData, null, 2));
  console.log(`Hints written: ${hintsFile}`);
  console.log(`Hints count: ${hints.length}`);

  // Also write a markdown version for human review
  const hintLines = hints.map(h => {
    let line = `- **${h.hint_id}** [${h.severity}] \`${h.file}${h.line ? ':' + h.line : ''}\``;
    if (h.mechanism) line += ` - mechanism: ${h.mechanism}`;
    if (h.title) line += `\n  Title: ${h.title}`;
    if (h.description) line += `\n  Description: ${h.description}`;
    return line;
  });

  const levelNotes = {
    low: 'These hints contain ONLY file locations.\nThis matches EVMbench "low hints" level.',
    medium: 'These hints contain file locations and mechanism categories.\nThey do NOT contain titles, descriptions, root causes, or exploit scenarios.\nThis matches EVMbench "medium hints" level which boosts detect from 39.2% to 89.7%.',
    high: 'These hints contain file locations, mechanism categories, titles, and descriptions.\nThis matches EVMbench "high hints" level which boosts exploit from 62.5% to 95.8%.'
  };

  const mdContent = `# Hints: ${source} -> ${target}

**Level:** ${level} (${levelDescriptions[level]})
**Source:** ${source} findings
**Target:** ${target} detect pass
**Generated:** ${new Date().toISOString()}

## Hints

${hintLines.join('\n')}

## Notes

${levelNotes[level]}
`;

  writeFileSync(join(runDir, `hints-${source}-to-${target}.md`), mdContent);

  console.log(JSON.stringify({
    success: true,
    hints_count: hints.length,
    hints_file: hintsFile,
    source,
    target
  }));
}

if (import.meta.main !== false) {
  main();
}

export { classifyMechanism, extractHints, extractLowHints, extractMediumHints, extractHighHints, parseSlitherToFindings, parseSemgrepToFindings };
