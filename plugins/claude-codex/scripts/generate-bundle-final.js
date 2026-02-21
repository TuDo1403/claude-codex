#!/usr/bin/env bun
/**
 * Generate Final Bundle (Codex Final Gate)
 *
 * COMPLETE BUNDLE - includes everything for final review
 *
 * Includes:
 * - All spec documents (threat-model, design, test-plan)
 * - All source and test code
 * - All review outputs (spec-compliance, exploit-hunt, red-team-issue-log)
 * - All reports (test logs, gas snapshots, slither)
 * - Run metadata and audit trail
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { parseArgs } from 'util';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');
const REPORTS_DIR = join(PROJECT_DIR, 'reports');
const SRC_DIR = join(PROJECT_DIR, 'src');
const TEST_DIR = join(PROJECT_DIR, 'test');

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
Usage: generate-bundle-final.js --run-id <run_id>

Generates final bundle for Codex Final Gate review.

Options:
  --run-id     Run ID for this pipeline execution
  -h, --help   Show this help message
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

function readFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Copy directory recursively
 */
function copyDir(src, dest, filter = () => true) {
  if (!existsSync(src)) return [];
  ensureDir(dest);

  const copied = [];
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copied.push(...copyDir(srcPath, destPath, filter));
    } else if (entry.isFile() && filter(entry.name, srcPath)) {
      copyFileSync(srcPath, destPath);
      copied.push(relative(src, destPath));
    }
  }

  return copied;
}

function copyIfExists(src, dest) {
  if (existsSync(src)) {
    ensureDir(dirname(dest));
    copyFileSync(src, dest);
    return true;
  }
  return false;
}

/**
 * Generate gate status summary
 */
function generateGateStatus(bundleDir, runId) {
  const runMetaPath = join(TASK_DIR, runId, 'run-metadata.json');
  const runMeta = readJson(runMetaPath) || {};

  let output = `# Gate Status Summary\n\n`;
  output += `Run ID: ${runId}\n`;
  output += `Generated: ${new Date().toISOString()}\n\n`;

  // Check each gate
  const gates = [
    {
      name: 'A. Spec Completeness',
      check: () => {
        const threatModel = readFile(join(DOCS_DIR, 'security', 'threat-model.md'));
        const hasInvariants = threatModel && /(IC|IS|IA|IT|IB)-\d+/.test(threatModel);
        const hasAC = threatModel && /AC-(SEC|FUNC)-\d+/.test(threatModel);
        return hasInvariants && hasAC;
      }
    },
    {
      name: 'B. Evidence Presence',
      check: () => {
        const hasTestLog = existsSync(join(REPORTS_DIR, 'forge-test.log'));
        const hasGas = existsSync(join(REPORTS_DIR, '.gas-snapshot')) ||
                       existsSync(join(REPORTS_DIR, '.gas-snapshot-after'));
        return hasTestLog && hasGas;
      }
    },
    {
      name: 'C. Bundle Correctness',
      check: () => {
        const stage3Manifest = readJson(join(TASK_DIR, runId, 'bundle-stage3', 'MANIFEST.json'));
        const stage4Manifest = readJson(join(TASK_DIR, runId, 'bundle-stage4', 'MANIFEST.json'));
        return stage3Manifest?.blindness_validated && stage4Manifest?.blindness_validated;
      }
    },
    {
      name: 'D. Review Schema Compliance',
      check: () => {
        const specReview = readFile(join(DOCS_DIR, 'reviews', 'spec-compliance-review.md'));
        const exploitReview = readFile(join(DOCS_DIR, 'reviews', 'exploit-hunt-review.md'));
        const hasSpecDecision = specReview && /Decision:\s*(APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION)/.test(specReview);
        const hasExploitDecision = exploitReview && /Decision:\s*(APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION)/.test(exploitReview);
        return hasSpecDecision && hasExploitDecision;
      }
    },
    {
      name: 'E. Red-Team Closure',
      check: () => {
        const issueLog = readFile(join(DOCS_DIR, 'reviews', 'red-team-issue-log.md'));
        if (!issueLog) return true; // No issues found = pass
        // Check for any OPEN or FIXED_PENDING_VERIFY HIGH/MED
        const hasOpenHighMed = /Severity:\s*(HIGH|MED)[\s\S]*?Status:\s*(OPEN|FIXED_PENDING_VERIFY)/i.test(issueLog);
        return !hasOpenHighMed;
      }
    },
    {
      name: 'F. Static Analysis',
      check: () => {
        const slither = readJson(join(REPORTS_DIR, 'slither.json'));
        if (!slither) return true; // Not required
        // Check for unsuppressed HIGH findings
        const suppressions = readFile(join(DOCS_DIR, 'security', 'suppressions.md'));
        const highFindings = slither.results?.detectors?.filter(d => d.impact === 'High') || [];
        // If there are high findings, they must be suppressed
        if (highFindings.length > 0 && !suppressions) return false;
        return true;
      }
    }
  ];

  output += `## Gate Checklist\n\n`;
  output += `| Gate | Status |\n`;
  output += `|------|--------|\n`;

  let allPass = true;
  for (const gate of gates) {
    const pass = gate.check();
    allPass = allPass && pass;
    output += `| ${gate.name} | ${pass ? 'PASS' : 'FAIL'} |\n`;
  }

  output += `\n## Overall Status: ${allPass ? 'READY FOR FINAL GATE' : 'NOT READY - FIX FAILURES'}\n`;

  const outputPath = join(bundleDir, 'gate-status.md');
  writeFileSync(outputPath, output);
  return { path: outputPath, allPass };
}

/**
 * Generate audit trail summary
 */
function generateAuditTrail(bundleDir, runId) {
  let output = `# Audit Trail\n\n`;
  output += `Run ID: ${runId}\n`;
  output += `Generated: ${new Date().toISOString()}\n\n`;

  // Collect all reviews and their decisions
  output += `## Review History\n\n`;

  const reviews = [
    { name: 'Spec Compliance Review', file: join(DOCS_DIR, 'reviews', 'spec-compliance-review.md') },
    { name: 'Exploit Hunt Review', file: join(DOCS_DIR, 'reviews', 'exploit-hunt-review.md') },
    { name: 'Red-Team Issue Log', file: join(DOCS_DIR, 'reviews', 'red-team-issue-log.md') },
    { name: 'Opus Attack Plan', file: join(DOCS_DIR, 'reviews', 'opus-attack-plan.md') },
    { name: 'Codex Deep Exploit Review', file: join(DOCS_DIR, 'reviews', 'codex-deep-exploit-review.md') },
    { name: 'Dispute Resolution', file: join(DOCS_DIR, 'reviews', 'dispute-resolution.md') }
  ];

  for (const review of reviews) {
    const content = readFile(review.file);
    if (content) {
      output += `### ${review.name}\n\n`;
      const decisionMatch = content.match(/Decision:\s*(APPROVED|NEEDS_CHANGES|NEEDS_CLARIFICATION)/);
      if (decisionMatch) {
        output += `Decision: **${decisionMatch[1]}**\n\n`;
      }
    }
  }

  // Collect task history from pipeline-tasks.json
  const pipelineTasks = readJson(join(TASK_DIR, 'pipeline-tasks.json'));
  if (pipelineTasks) {
    output += `## Task History\n\n`;
    output += `| Task | ID |\n`;
    output += `|------|----|\n`;
    for (const [name, id] of Object.entries(pipelineTasks)) {
      output += `| ${name} | ${id} |\n`;
    }
  }

  const outputPath = join(bundleDir, 'audit-trail.md');
  writeFileSync(outputPath, output);
  return outputPath;
}

async function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `blind-audit-${Date.now()}`;

  const bundleDir = join(TASK_DIR, runId, 'bundle-final');
  ensureDir(bundleDir);

  console.log(`Generating final bundle for Codex Final Gate: ${runId}`);
  console.log(`Output directory: ${bundleDir}`);

  const manifest = {
    run_id: runId,
    stage: 'final-gate',
    type: 'COMPLETE',
    generated_at: new Date().toISOString(),
    files: []
  };

  // Copy all spec documents
  const specFiles = [
    { src: join(DOCS_DIR, 'security', 'threat-model.md'), dest: 'docs/security/threat-model.md' },
    { src: join(DOCS_DIR, 'architecture', 'design.md'), dest: 'docs/architecture/design.md' },
    { src: join(DOCS_DIR, 'testing', 'test-plan.md'), dest: 'docs/testing/test-plan.md' },
    { src: join(DOCS_DIR, 'security', 'suppressions.md'), dest: 'docs/security/suppressions.md' },
    { src: join(DOCS_DIR, 'performance', 'perf-report.md'), dest: 'docs/performance/perf-report.md' }
  ];

  for (const file of specFiles) {
    const destPath = join(bundleDir, file.dest);
    if (copyIfExists(file.src, destPath)) {
      manifest.files.push(file.dest);
      console.log(`  Copied: ${file.dest}`);
    }
  }

  // Copy all review outputs
  const reviewFiles = [
    { src: join(DOCS_DIR, 'reviews', 'spec-compliance-review.md'), dest: 'reviews/spec-compliance-review.md' },
    { src: join(DOCS_DIR, 'reviews', 'exploit-hunt-review.md'), dest: 'reviews/exploit-hunt-review.md' },
    { src: join(DOCS_DIR, 'reviews', 'red-team-issue-log.md'), dest: 'reviews/red-team-issue-log.md' },
    { src: join(DOCS_DIR, 'reviews', 'design-review-opus.md'), dest: 'reviews/design-review-opus.md' },
    // Adversarial mode outputs (Stage 4A/4B/4C)
    { src: join(DOCS_DIR, 'reviews', 'opus-attack-plan.md'), dest: 'reviews/opus-attack-plan.md' },
    { src: join(DOCS_DIR, 'reviews', 'codex-deep-exploit-review.md'), dest: 'reviews/codex-deep-exploit-review.md' },
    { src: join(DOCS_DIR, 'reviews', 'dispute-resolution.md'), dest: 'reviews/dispute-resolution.md' },
    // Stage 4.5 consolidation output
    { src: join(TASK_DIR, runId, 'consolidated-findings.json'), dest: 'consolidated-findings.json' },
    // Calibration outputs
    { src: join(DOCS_DIR, 'reviews', 'detect-findings.md'), dest: 'reviews/detect-findings.md' },
    { src: join(DOCS_DIR, 'reviews', 'patch-validation.md'), dest: 'reviews/patch-validation.md' },
    { src: join(DOCS_DIR, 'reviews', 'exploit-validation.md'), dest: 'reviews/exploit-validation.md' },
    { src: join(DOCS_DIR, 'reviews', 'discovery-scoreboard.md'), dest: 'reviews/discovery-scoreboard.md' }
  ];

  for (const file of reviewFiles) {
    const destPath = join(bundleDir, file.dest);
    if (copyIfExists(file.src, destPath)) {
      manifest.files.push(file.dest);
      console.log(`  Copied: ${file.dest}`);
    }
  }

  // Copy source code
  const srcDestDir = join(bundleDir, 'src');
  const srcFiles = copyDir(SRC_DIR, srcDestDir, (name) => name.endsWith('.sol'));
  for (const f of srcFiles) {
    manifest.files.push(`src/${f}`);
  }
  console.log(`  Copied: ${srcFiles.length} source files`);

  // Copy test code
  const testDestDir = join(bundleDir, 'test');
  const testFiles = copyDir(TEST_DIR, testDestDir, (name) => name.endsWith('.sol') || name.endsWith('.t.sol'));
  for (const f of testFiles) {
    manifest.files.push(`test/${f}`);
  }
  console.log(`  Copied: ${testFiles.length} test files`);

  // Copy reports
  const reportFiles = [
    { src: join(REPORTS_DIR, 'forge-test.log'), dest: 'reports/forge-test.log' },
    { src: join(REPORTS_DIR, 'invariant-test.log'), dest: 'reports/invariant-test.log' },
    { src: join(REPORTS_DIR, 'slither.json'), dest: 'reports/slither.json' },
    { src: join(REPORTS_DIR, 'gas-snapshots.md'), dest: 'reports/gas-snapshots.md' },
    { src: join(REPORTS_DIR, '.gas-snapshot'), dest: 'reports/.gas-snapshot' },
    { src: join(REPORTS_DIR, '.gas-snapshot-before'), dest: 'reports/.gas-snapshot-before' },
    { src: join(REPORTS_DIR, '.gas-snapshot-after'), dest: 'reports/.gas-snapshot-after' }
  ];

  for (const file of reportFiles) {
    const destPath = join(bundleDir, file.dest);
    if (copyIfExists(file.src, destPath)) {
      manifest.files.push(file.dest);
      console.log(`  Copied: ${file.dest}`);
    }
  }

  // Copy stage bundles' manifests for reference
  const stage3Manifest = join(TASK_DIR, runId, 'bundle-stage3', 'MANIFEST.json');
  const stage4Manifest = join(TASK_DIR, runId, 'bundle-stage4', 'MANIFEST.json');
  if (copyIfExists(stage3Manifest, join(bundleDir, 'stage3-manifest.json'))) {
    manifest.files.push('stage3-manifest.json');
  }
  if (copyIfExists(stage4Manifest, join(bundleDir, 'stage4-manifest.json'))) {
    manifest.files.push('stage4-manifest.json');
  }

  // Generate gate status summary
  const { path: gateStatusPath, allPass } = generateGateStatus(bundleDir, runId);
  manifest.files.push('gate-status.md');
  console.log(`  Generated: gate-status.md`);

  // Generate audit trail
  const auditTrailPath = generateAuditTrail(bundleDir, runId);
  manifest.files.push('audit-trail.md');
  console.log(`  Generated: audit-trail.md`);

  manifest.gates_ready = allPass;

  // Write manifest
  writeFileSync(join(bundleDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nBundle generated successfully: ${bundleDir}`);
  console.log(`Files included: ${manifest.files.length}`);
  console.log(`Gates ready: ${allPass ? 'YES' : 'NO - fix failures before final gate'}`);

  // Output JSON for pipeline consumption
  console.log(JSON.stringify({
    success: true,
    bundle_dir: bundleDir,
    gates_ready: allPass,
    manifest
  }));

  // Exit with error if gates not ready
  if (!allPass) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error generating bundle:', err.message);
  process.exit(1);
});
