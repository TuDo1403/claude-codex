#!/usr/bin/env bun
/**
 * Generate Slither/Semgrep Summary for Detect Bundles
 *
 * Converts raw JSON output from static analyzers into a markdown summary
 * that detect agents can use. This bridges the gap between:
 *   - security-auditor agent output: reports/slither.json, reports/semgrep.json
 *   - detect bundle expectation: slither-summary.md
 *
 * Usage:
 *   bun generate-slither-summary.js [--run-id <run_id>] [--output <path>]
 *
 * Environment:
 *   CLAUDE_PROJECT_DIR - Project directory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parseArgs } from 'util';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const REPORTS_DIR = join(PROJECT_DIR, 'reports');
const TASK_DIR = join(PROJECT_DIR, '.task');

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      'output': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: generate-slither-summary.js [options]

Convert slither.json and semgrep.json into slither-summary.md for detect bundles.

Options:
  --run-id     Run ID (copies summary to .task/<run-id>/ as well)
  --output     Custom output path (default: reports/slither-summary.md)
  -h, --help   Show this help message
    `);
    process.exit(0);
  }

  return values;
}

/**
 * Parse slither JSON output and extract findings by severity.
 */
function parseSlitherFindings(jsonPath) {
  if (!existsSync(jsonPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const detectors = raw.results?.detectors || raw.detectors || [];

    const findings = detectors.map((d, i) => ({
      id: `SL-${i + 1}`,
      tool: 'slither',
      detector: d.check || d.detector || 'unknown',
      impact: (d.impact || 'Unknown').toUpperCase(),
      confidence: (d.confidence || 'Unknown').toUpperCase(),
      description: d.description || '',
      elements: (d.elements || []).map(e => ({
        file: e.source_mapping?.filename_relative || e.source_mapping?.filename || 'unknown',
        lines: e.source_mapping?.lines || [],
        name: e.name || null,
        type: e.type || null
      })).filter(e => e.file !== 'unknown'),
      first_markdown_element: d.first_markdown_element || null
    }));

    return findings;
  } catch {
    return null;
  }
}

/**
 * Parse semgrep JSON output and extract findings.
 */
function parseSemgrepFindings(jsonPath) {
  if (!existsSync(jsonPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const results = raw.results || [];

    const findings = results.map((r, i) => ({
      id: `SG-${i + 1}`,
      tool: 'semgrep',
      rule_id: r.check_id || r.rule_id || 'unknown',
      severity: (r.extra?.severity || r.severity || 'WARNING').toUpperCase(),
      message: r.extra?.message || r.message || '',
      file: r.path || 'unknown',
      line_start: r.start?.line || r.line || null,
      line_end: r.end?.line || null
    }));

    return findings;
  } catch {
    return null;
  }
}

/**
 * Map slither impact/confidence to effective severity.
 */
function effectiveSeverity(impact, confidence) {
  const i = impact.toUpperCase();
  const c = confidence.toUpperCase();

  if (i === 'HIGH' && c === 'HIGH') return 'CRITICAL';
  if (i === 'HIGH' && c === 'MEDIUM') return 'HIGH';
  if (i === 'HIGH' && c === 'LOW') return 'MEDIUM';
  if (i === 'MEDIUM' && c === 'HIGH') return 'HIGH';
  if (i === 'MEDIUM' && c === 'MEDIUM') return 'MEDIUM';
  if (i === 'MEDIUM' && c === 'LOW') return 'LOW';
  if (i === 'LOW') return 'LOW';
  if (i === 'INFORMATIONAL') return 'INFO';
  return 'UNKNOWN';
}

/**
 * Generate markdown summary from parsed findings.
 */
function generateSummary(slitherFindings, semgrepFindings) {
  let md = `# Static Analysis Summary\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;

  const allFindings = [];

  // Process slither findings
  if (slitherFindings && slitherFindings.length > 0) {
    md += `## Slither (${slitherFindings.length} findings)\n\n`;

    const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], INFO: [], UNKNOWN: [] };
    for (const f of slitherFindings) {
      const sev = effectiveSeverity(f.impact, f.confidence);
      (bySeverity[sev] || bySeverity.UNKNOWN).push(f);
      allFindings.push({ ...f, effective_severity: sev });
    }

    md += `| Severity | Count |\n`;
    md += `|----------|-------|\n`;
    for (const [sev, list] of Object.entries(bySeverity)) {
      if (list.length > 0) {
        md += `| ${sev} | ${list.length} |\n`;
      }
    }
    md += `\n`;

    // List HIGH+ findings with details
    const actionable = [...(bySeverity.CRITICAL || []), ...(bySeverity.HIGH || []), ...(bySeverity.MEDIUM || [])];
    if (actionable.length > 0) {
      md += `### Actionable Findings (HIGH+MED)\n\n`;
      for (const f of actionable) {
        const sev = effectiveSeverity(f.impact, f.confidence);
        const locations = f.elements.map(e => {
          const line = e.lines?.length > 0 ? `:${e.lines[0]}` : '';
          return `\`${e.file}${line}\``;
        }).join(', ');

        md += `#### ${f.id}: ${f.detector} [${sev}]\n\n`;
        md += `- **Detector:** \`${f.detector}\`\n`;
        md += `- **Impact:** ${f.impact} | **Confidence:** ${f.confidence}\n`;
        if (locations) md += `- **Location:** ${locations}\n`;
        md += `- **Description:** ${f.description.slice(0, 300)}${f.description.length > 300 ? '...' : ''}\n`;
        md += `\n`;
      }
    }

    // List LOW/INFO as compact table
    const minor = [...(bySeverity.LOW || []), ...(bySeverity.INFO || [])];
    if (minor.length > 0) {
      md += `### Low/Info Findings\n\n`;
      md += `| ID | Detector | Impact | File |\n`;
      md += `|----|----------|--------|------|\n`;
      for (const f of minor) {
        const file = f.elements[0]?.file || 'N/A';
        md += `| ${f.id} | ${f.detector} | ${f.impact}/${f.confidence} | \`${file}\` |\n`;
      }
      md += `\n`;
    }
  } else {
    md += `## Slither\n\nNo findings (or not run).\n\n`;
  }

  // Process semgrep findings
  if (semgrepFindings && semgrepFindings.length > 0) {
    md += `## Semgrep (${semgrepFindings.length} findings)\n\n`;

    const bySeverity = { ERROR: [], WARNING: [], INFO: [] };
    for (const f of semgrepFindings) {
      const sev = f.severity.toUpperCase();
      const key = sev === 'ERROR' ? 'ERROR' : (sev === 'WARNING' ? 'WARNING' : 'INFO');
      (bySeverity[key] || bySeverity.INFO).push(f);
      allFindings.push({ ...f, effective_severity: key === 'ERROR' ? 'HIGH' : (key === 'WARNING' ? 'MEDIUM' : 'LOW') });
    }

    md += `| Severity | Count |\n`;
    md += `|----------|-------|\n`;
    for (const [sev, list] of Object.entries(bySeverity)) {
      if (list.length > 0) {
        md += `| ${sev} | ${list.length} |\n`;
      }
    }
    md += `\n`;

    if (bySeverity.ERROR.length > 0 || bySeverity.WARNING.length > 0) {
      md += `### Actionable Findings\n\n`;
      for (const f of [...bySeverity.ERROR, ...bySeverity.WARNING]) {
        md += `#### ${f.id}: ${f.rule_id} [${f.severity}]\n\n`;
        md += `- **Rule:** \`${f.rule_id}\`\n`;
        md += `- **Location:** \`${f.file}${f.line_start ? ':' + f.line_start : ''}\`\n`;
        md += `- **Message:** ${f.message.slice(0, 300)}${f.message.length > 300 ? '...' : ''}\n`;
        md += `\n`;
      }
    }
  } else {
    md += `## Semgrep\n\nNo findings (or not run).\n\n`;
  }

  // Summary counts for downstream consumers
  const highMed = allFindings.filter(f =>
    ['CRITICAL', 'HIGH', 'MEDIUM'].includes(f.effective_severity)
  );
  md += `## Summary\n\n`;
  md += `- **Total findings:** ${allFindings.length}\n`;
  md += `- **Actionable (HIGH+MED):** ${highMed.length}\n`;
  md += `- **Tools run:** ${slitherFindings ? 'Slither' : ''}${slitherFindings && semgrepFindings ? ', ' : ''}${semgrepFindings ? 'Semgrep' : ''}\n`;

  return { markdown: md, findings: allFindings, actionable_count: highMed.length };
}

function main() {
  const args = parseArguments();
  const runId = args['run-id'];

  console.log(`\n=== Generate Static Analysis Summary ===`);

  // Look for slither/semgrep JSON in reports/
  const slitherPath = join(REPORTS_DIR, 'slither.json');
  const semgrepPath = join(REPORTS_DIR, 'semgrep.json');

  const slitherFindings = parseSlitherFindings(slitherPath);
  const semgrepFindings = parseSemgrepFindings(semgrepPath);

  if (!slitherFindings && !semgrepFindings) {
    console.log('No static analysis output found (reports/slither.json or reports/semgrep.json).');
    console.log('Run security-auditor agent first, or run slither/semgrep manually.');
    console.log(JSON.stringify({ success: false, error: 'No static analysis output found' }));
    process.exit(0); // Not an error — static analysis is optional
  }

  console.log(`Slither findings: ${slitherFindings?.length ?? 'N/A'}`);
  console.log(`Semgrep findings: ${semgrepFindings?.length ?? 'N/A'}`);

  const { markdown, findings, actionable_count } = generateSummary(slitherFindings, semgrepFindings);

  // Write to reports/slither-summary.md (canonical location for bundle generators)
  const outputPath = args.output || join(REPORTS_DIR, 'slither-summary.md');
  if (!existsSync(dirname(outputPath))) {
    mkdirSync(dirname(outputPath), { recursive: true });
  }
  writeFileSync(outputPath, markdown);
  console.log(`Summary written: ${outputPath}`);

  // Also copy to .task/<runId>/ if run-id provided (bundle generators check here first)
  if (runId) {
    const runDir = join(TASK_DIR, runId);
    if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'slither-summary.md'), markdown);
    console.log(`Summary copied: ${join(runDir, 'slither-summary.md')}`);
  }

  console.log(`Total findings: ${findings.length}`);
  console.log(`Actionable (HIGH+MED): ${actionable_count}`);

  console.log(JSON.stringify({
    success: true,
    output: outputPath,
    total_findings: findings.length,
    actionable_count,
    slither_count: slitherFindings?.length ?? 0,
    semgrep_count: semgrepFindings?.length ?? 0
  }));
}

if (import.meta.main !== false) {
  main();
}

export { parseSlitherFindings, parseSemgrepFindings, effectiveSeverity, generateSummary };
