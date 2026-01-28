#!/usr/bin/env bun
/**
 * Generate Stage 3 Bundle (Spec Compliance Review)
 *
 * BLINDNESS: NO CODE ALLOWED
 *
 * Includes:
 * - docs/security/threat-model.md (full)
 * - docs/architecture/design.md (full)
 * - docs/testing/test-plan.md (full)
 * - test-summary.md (test names + PASS/FAIL only)
 * - gas-summary.md (function names + gas only)
 *
 * Excludes:
 * - src/**/*.sol - NO source code
 * - test/**/*.sol - NO test code
 * - Any file containing Solidity code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { parseArgs } from 'util';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');
const REPORTS_DIR = join(PROJECT_DIR, 'reports');

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
Usage: generate-bundle-stage3.js --run-id <run_id>

Generates Stage 3 bundle for Spec Compliance Review (blind to code).

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

function copyIfExists(src, dest) {
  if (existsSync(src)) {
    ensureDir(dirname(dest));
    copyFileSync(src, dest);
    return true;
  }
  return false;
}

function readFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Generate test-summary.md from forge test output
 * Only includes test names and PASS/FAIL - NO code
 */
function generateTestSummary(bundleDir) {
  const testLogPath = join(REPORTS_DIR, 'forge-test.log');
  const testLog = readFile(testLogPath);

  let summary = `# Test Summary\n\n`;
  summary += `Generated: ${new Date().toISOString()}\n\n`;
  summary += `## Test Results\n\n`;
  summary += `| Test Name | Status |\n`;
  summary += `|-----------|--------|\n`;

  if (testLog) {
    // Parse forge test output for test results
    // Format: [PASS] testName() (gas: XXX)
    // Format: [FAIL] testName()
    const testLines = testLog.split('\n');
    for (const line of testLines) {
      const passMatch = line.match(/\[PASS\]\s+(\w+)\s*\(/);
      const failMatch = line.match(/\[FAIL[^\]]*\]\s+(\w+)/);

      if (passMatch) {
        summary += `| ${passMatch[1]} | PASS |\n`;
      } else if (failMatch) {
        summary += `| ${failMatch[1]} | FAIL |\n`;
      }
    }

    // Also check for suite summaries
    const suiteMatch = testLog.match(/Suite result: (\w+)\. (\d+) passed; (\d+) failed/g);
    if (suiteMatch) {
      summary += `\n## Suite Summary\n\n`;
      for (const match of suiteMatch) {
        summary += `- ${match}\n`;
      }
    }
  } else {
    summary += `| (no test log found) | - |\n`;
  }

  const outputPath = join(bundleDir, 'test-summary.md');
  writeFileSync(outputPath, summary);
  return outputPath;
}

/**
 * Generate gas-summary.md from forge snapshot
 * Only includes function names and gas - NO code
 */
function generateGasSummary(bundleDir) {
  const snapshotPath = join(REPORTS_DIR, '.gas-snapshot');
  const snapshotAfterPath = join(REPORTS_DIR, '.gas-snapshot-after');
  const snapshot = readFile(snapshotPath) || readFile(snapshotAfterPath);

  let summary = `# Gas Summary\n\n`;
  summary += `Generated: ${new Date().toISOString()}\n\n`;
  summary += `## Gas Usage by Function\n\n`;
  summary += `| Contract::Function | Gas |\n`;
  summary += `|-------------------|-----|\n`;

  if (snapshot) {
    // Parse gas snapshot format: ContractTest:testFunction() (gas: 12345)
    const lines = snapshot.split('\n');
    for (const line of lines) {
      const match = line.match(/^([^(]+)\s*\(gas:\s*(\d+)\)/);
      if (match) {
        // Extract just function name, remove test prefix if present
        const fullName = match[1].trim();
        const gas = match[2];
        summary += `| ${fullName} | ${gas} |\n`;
      }
    }
  } else {
    summary += `| (no gas snapshot found) | - |\n`;
  }

  // Also include gas-snapshots.md summary if exists
  const gasSnapshotsPath = join(REPORTS_DIR, 'gas-snapshots.md');
  const gasSnapshots = readFile(gasSnapshotsPath);
  if (gasSnapshots) {
    summary += `\n## Gas Optimization Summary\n\n`;
    // Extract just the summary section, not implementation details
    const summaryMatch = gasSnapshots.match(/## Summary[\s\S]*?(?=##|$)/);
    if (summaryMatch) {
      summary += summaryMatch[0];
    }
  }

  const outputPath = join(bundleDir, 'gas-summary.md');
  writeFileSync(outputPath, summary);
  return outputPath;
}

/**
 * Validate bundle contains NO code
 */
function validateNoCode(bundleDir) {
  const errors = [];

  function checkDir(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDir(fullPath);
      } else if (entry.isFile()) {
        // Check for Solidity files
        if (entry.name.endsWith('.sol')) {
          errors.push(`BLINDNESS VIOLATION: ${fullPath} is a Solidity file`);
        }
        // Check file content for Solidity code patterns
        const content = readFile(fullPath);
        if (content) {
          if (/pragma\s+solidity/i.test(content)) {
            errors.push(`BLINDNESS VIOLATION: ${fullPath} contains Solidity pragma`);
          }
          if (/contract\s+\w+\s*{/.test(content) && !fullPath.includes('design')) {
            errors.push(`BLINDNESS VIOLATION: ${fullPath} may contain contract code`);
          }
          if (/function\s+\w+\s*\([^)]*\)\s*(public|external|internal|private)/.test(content)) {
            // Allow in design.md for interface definitions
            if (!fullPath.includes('design') && !fullPath.includes('api')) {
              errors.push(`BLINDNESS VIOLATION: ${fullPath} may contain function implementations`);
            }
          }
        }
      }
    }
  }

  checkDir(bundleDir);
  return errors;
}

async function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `blind-audit-${Date.now()}`;

  const bundleDir = join(TASK_DIR, runId, 'bundle-stage3');
  ensureDir(bundleDir);

  console.log(`Generating Stage 3 bundle (NO CODE) for run: ${runId}`);
  console.log(`Output directory: ${bundleDir}`);

  const manifest = {
    run_id: runId,
    stage: 'stage3-spec-compliance',
    blindness_rule: 'NO_CODE',
    generated_at: new Date().toISOString(),
    files: []
  };

  // Copy spec documents (allowed)
  const specFiles = [
    { src: join(DOCS_DIR, 'security', 'threat-model.md'), dest: 'docs/security/threat-model.md' },
    { src: join(DOCS_DIR, 'architecture', 'design.md'), dest: 'docs/architecture/design.md' },
    { src: join(DOCS_DIR, 'testing', 'test-plan.md'), dest: 'docs/testing/test-plan.md' }
  ];

  for (const file of specFiles) {
    const destPath = join(bundleDir, file.dest);
    if (copyIfExists(file.src, destPath)) {
      manifest.files.push(file.dest);
      console.log(`  Copied: ${file.dest}`);
    } else {
      console.warn(`  Warning: ${file.src} not found`);
    }
  }

  // Generate summaries (NO code, just results)
  const testSummaryPath = generateTestSummary(bundleDir);
  manifest.files.push(basename(testSummaryPath));
  console.log(`  Generated: test-summary.md`);

  const gasSummaryPath = generateGasSummary(bundleDir);
  manifest.files.push(basename(gasSummaryPath));
  console.log(`  Generated: gas-summary.md`);

  // Validate NO code in bundle
  const violations = validateNoCode(bundleDir);
  if (violations.length > 0) {
    console.error('\nBLINDNESS VIOLATIONS DETECTED:');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    manifest.blindness_validated = false;
    manifest.violations = violations;

    // Write manifest even on failure
    writeFileSync(join(bundleDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
    process.exit(1);
  }

  manifest.blindness_validated = true;
  manifest.violations = [];

  // Write manifest
  writeFileSync(join(bundleDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nBundle generated successfully: ${bundleDir}`);
  console.log(`Files included: ${manifest.files.length}`);
  console.log(`Blindness validated: ${manifest.blindness_validated}`);

  // Output JSON for pipeline consumption
  console.log(JSON.stringify({
    success: true,
    bundle_dir: bundleDir,
    manifest
  }));
}

main().catch(err => {
  console.error('Error generating bundle:', err.message);
  process.exit(1);
});
