#!/usr/bin/env bun
/**
 * Generate Detect Bundle for Codex Detect Sprint
 *
 * INDEPENDENCE: No other model's detect output allowed.
 * Creates a bundle with source code, invariants, public API, and scope info
 * for Codex to perform independent vulnerability detection.
 *
 * Includes:
 *   src/ .sol files (full source code)
 *   test/ .sol files (full test code)
 *   invariants-list.md (if available)
 *   public-api.md (if available)
 *   slither-summary.md (if available)
 *   scope.md (generated from config or README)
 *
 * Excludes:
 *   Other model's detect findings
 *   Spec narrative (threat-model.md prose, design.md narrative)
 *   Previous review outputs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { parseArgs } from 'util';
import { execSync } from 'child_process';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(import.meta.path));
const TASK_DIR = join(PROJECT_DIR, '.task');
const DOCS_DIR = join(PROJECT_DIR, 'docs');
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
Usage: generate-bundle-detect-codex.js --run-id <run_id>

Generates detect bundle for Codex Detect Sprint.
INDEPENDENCE: No other model's detect output included.

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

function copyDirRecursive(src, dest, extensions = ['.sol']) {
  if (!existsSync(src)) return 0;
  ensureDir(dest);
  let count = 0;

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      // Skip common non-source directories
      if (['node_modules', 'cache', 'out', 'artifacts', 'broadcast'].includes(entry.name)) continue;
      count += copyDirRecursive(srcPath, destPath, extensions);
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

function copyFileIfExists(src, dest) {
  if (existsSync(src)) {
    ensureDir(dirname(dest));
    copyFileSync(src, dest);
    return true;
  }
  return false;
}

function generateScopeFile(bundleDir) {
  // Try to find scope info from various sources
  let scopeContent = '# Scope\n\n';
  let scopeFiles = [];

  // Check for existing scope file
  const scopePath = join(PROJECT_DIR, 'scope.md');
  if (existsSync(scopePath)) {
    scopeContent = readFileSync(scopePath, 'utf-8');
    writeFileSync(join(bundleDir, 'scope.md'), scopeContent);
    return;
  }

  // List all .sol files in src/
  if (existsSync(SRC_DIR)) {
    try {
      const files = execSync(`find "${SRC_DIR}" -name "*.sol" -type f`, { encoding: 'utf-8' });
      scopeFiles = files.trim().split('\n').filter(f => f).map(f => relative(PROJECT_DIR, f));
    } catch { /* ignore */ }
  }

  if (scopeFiles.length > 0) {
    scopeContent += '## In-Scope Files\n\n';
    for (const f of scopeFiles) {
      scopeContent += `- \`${f}\`\n`;
    }
  } else {
    scopeContent += 'All Solidity files in the project are in scope.\n';
  }

  writeFileSync(join(bundleDir, 'scope.md'), scopeContent);
}

function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `detect-${Date.now()}`;
  const bundleDir = join(TASK_DIR, runId, 'bundle-detect-codex');

  console.log(`\n=== Generate Codex Detect Bundle ===`);
  console.log(`Run ID: ${runId}`);
  console.log(`Bundle: ${bundleDir}`);

  ensureDir(bundleDir);

  const manifest = {
    bundle_type: 'detect-codex',
    run_id: runId,
    generated_at: new Date().toISOString(),
    independence_validated: true,
    contents: {}
  };

  // 1. Copy source code
  const srcCount = copyDirRecursive(SRC_DIR, join(bundleDir, 'src'));
  manifest.contents.source_files = srcCount;
  console.log(`Source files: ${srcCount}`);

  // 2. Copy test code
  const testCount = copyDirRecursive(TEST_DIR, join(bundleDir, 'test'));
  manifest.contents.test_files = testCount;
  console.log(`Test files: ${testCount}`);

  // 3. Copy invariants list (if available)
  const invariantsPath = join(TASK_DIR, runId, 'invariants-list.md');
  const invariantsAlt = join(DOCS_DIR, 'security', 'invariants-list.md');
  if (copyFileIfExists(invariantsPath, join(bundleDir, 'invariants-list.md'))) {
    manifest.contents.invariants_list = true;
    console.log('Invariants list: included (from .task)');
  } else if (copyFileIfExists(invariantsAlt, join(bundleDir, 'invariants-list.md'))) {
    manifest.contents.invariants_list = true;
    console.log('Invariants list: included (from docs)');
  } else {
    manifest.contents.invariants_list = false;
    console.log('Invariants list: not available');
  }

  // 4. Copy public API (if available)
  const publicApiPath = join(TASK_DIR, runId, 'public-api.md');
  const publicApiAlt = join(DOCS_DIR, 'architecture', 'public-api.md');
  if (copyFileIfExists(publicApiPath, join(bundleDir, 'public-api.md'))) {
    manifest.contents.public_api = true;
    console.log('Public API: included (from .task)');
  } else if (copyFileIfExists(publicApiAlt, join(bundleDir, 'public-api.md'))) {
    manifest.contents.public_api = true;
    console.log('Public API: included (from docs)');
  } else {
    manifest.contents.public_api = false;
    console.log('Public API: not available');
  }

  // 5. Copy Slither summary (if available)
  // Priority: .task/<runId>/slither-summary.md (from generate-slither-summary.js)
  //         > reports/slither-summary.md (from generate-slither-summary.js)
  //         > reports/slither.md (from security-auditor agent: slither --print human-summary)
  const slitherCandidates = [
    join(TASK_DIR, runId, 'slither-summary.md'),
    join(PROJECT_DIR, 'reports', 'slither-summary.md'),
    join(PROJECT_DIR, 'reports', 'slither.md'),
  ];
  let slitherCopied = false;
  for (const candidate of slitherCandidates) {
    if (copyFileIfExists(candidate, join(bundleDir, 'slither-summary.md'))) {
      manifest.contents.slither_summary = true;
      console.log(`Slither summary: included (from ${candidate})`);
      slitherCopied = true;
      break;
    }
  }
  if (!slitherCopied) {
    manifest.contents.slither_summary = false;
    console.log('Slither summary: not available');
  }

  // 6. Generate scope file
  generateScopeFile(bundleDir);
  manifest.contents.scope = true;
  console.log('Scope file: generated');

  // Write manifest
  writeFileSync(join(bundleDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nBundle generated: ${bundleDir}`);
  console.log(JSON.stringify({ success: true, bundle_path: bundleDir, manifest }));
}

main();
