#!/usr/bin/env bun
/**
 * Setup Benchmarks — Clone and build benchmark repos (G8)
 *
 * Clones Code4rena repos from registry.json, pins to commit hashes,
 * and verifies builds. Real Solidity source is NOT committed —
 * only ground-truth JSON files are versioned.
 *
 * Usage:
 *   bun setup-benchmarks.js [--bench bench-001] [--force]
 *
 * Environment:
 *   CLAUDE_PLUGIN_ROOT - Plugin installation directory
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parseArgs } from 'util';
import { execSync } from 'child_process';

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(import.meta.path));
const BENCHMARKS_DIR = join(PLUGIN_ROOT, 'benchmarks');
const REGISTRY_PATH = join(BENCHMARKS_DIR, 'registry.json');

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'bench': { type: 'string' },
      'force': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: setup-benchmarks.js [options]

Clones and builds benchmark repos from registry.

Options:
  --bench   Setup single benchmark (default: all)
  --force   Re-clone even if directory exists
  -h, --help Show this help message
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

function setupBenchmark(benchmark, force = false) {
  const benchDir = join(BENCHMARKS_DIR, 'contracts', benchmark.id);
  const repoDir = join(benchDir, 'repo');

  console.log(`\n--- Setting up ${benchmark.id}: ${benchmark.name} ---`);

  // Check if already setup
  if (existsSync(repoDir) && !force) {
    console.log(`  Already cloned: ${repoDir} (use --force to re-clone)`);
    return { id: benchmark.id, status: 'skipped', reason: 'already exists' };
  }

  // Clone repo
  const repoUrl = benchmark.contract_repo || benchmark.repo_url;
  console.log(`  Cloning ${repoUrl}...`);
  try {
    if (existsSync(repoDir)) {
      execSync(`rm -rf "${repoDir}"`, { timeout: 30000 });
    }
    execSync(`git clone --depth 1 "${repoUrl}" "${repoDir}"`, {
      timeout: 120000,
      stdio: 'pipe'
    });

    // Checkout specific commit if provided
    const commit = benchmark.contract_commit || benchmark.commit;
    if (commit && commit !== 'main' && commit !== 'master') {
      execSync(`git -C "${repoDir}" fetch --depth 1 origin ${commit} && git -C "${repoDir}" checkout ${commit}`, {
        timeout: 60000,
        stdio: 'pipe'
      });
    }

    console.log(`  Cloned successfully`);
  } catch (err) {
    console.error(`  Clone failed: ${err.message}`);
    return { id: benchmark.id, status: 'failed', reason: `clone failed: ${err.message}` };
  }

  // Try to build
  const buildCmd = benchmark.build_command || 'forge build';
  console.log(`  Building: ${buildCmd}`);
  try {
    execSync(buildCmd, {
      cwd: repoDir,
      timeout: 300000,
      stdio: 'pipe'
    });
    console.log(`  Build successful`);
    return { id: benchmark.id, status: 'success' };
  } catch (err) {
    console.warn(`  Build failed (may be expected): ${err.message.slice(0, 100)}`);
    return { id: benchmark.id, status: 'build_failed', reason: err.message.slice(0, 200) };
  }
}

async function main() {
  const args = parseArguments();
  const registry = loadRegistry();
  const benchmarks = registry.benchmarks || [];

  console.log(`Benchmark registry: ${benchmarks.length} benchmarks`);

  const toSetup = args.bench
    ? benchmarks.filter(b => b.id === args.bench)
    : benchmarks;

  if (toSetup.length === 0) {
    console.error(`No benchmarks found${args.bench ? ` matching "${args.bench}"` : ''}`);
    process.exit(1);
  }

  const results = [];
  for (const bench of toSetup) {
    results.push(setupBenchmark(bench, args.force));
  }

  console.log('\n=== Setup Summary ===');
  for (const r of results) {
    console.log(`  ${r.id}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
  }

  const failed = results.filter(r => r.status === 'failed');
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
