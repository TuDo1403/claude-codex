#!/usr/bin/env bun
/**
 * Coverage Tracker
 *
 * EVMbench evidence: Section 5 - models achieve high scores in specific audits
 * while missing critical vulns in the same codebase. Coverage tracking ensures
 * all public/external functions are analyzed.
 *
 * Tracks % of public/external functions analyzed across detect passes.
 * If below threshold, outputs uncovered modules as hints for additional passes.
 *
 * Usage:
 *   bun coverage-tracker.js --run-id <run_id> [--threshold 90]
 *
 * Environment:
 *   CLAUDE_PROJECT_DIR - Project directory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { parseArgs } from 'util';
import { execSync } from 'child_process';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TASK_DIR = join(PROJECT_DIR, '.task');
const SRC_DIR = join(PROJECT_DIR, 'src');

function parseArguments() {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      'threshold': { type: 'string' },
      'src-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: coverage-tracker.js --run-id <run_id> [options]

Tracks entrypoint and module coverage across detect passes.
If below threshold, outputs uncovered modules for additional detect passes.

Options:
  --run-id       Run ID for this pipeline execution
  --threshold    Minimum coverage percentage (default: 90)
  --src-dir      Source directory (default: src/)
  -h, --help     Show this help message

Config (.claude-codex.json):
  "coverage": {
    "min_entrypoint_coverage": 90,
    "min_module_coverage": 100
  }
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

function loadConfig() {
  try {
    const configPath = join(PROJECT_DIR, '.claude-codex.json');
    if (!existsSync(configPath)) return {};
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return config?.coverage ?? {};
  } catch {
    return {};
  }
}

/**
 * Extract public/external function signatures from Solidity files
 */
function extractEntrypoints(srcDir) {
  if (!existsSync(srcDir)) return [];

  const entrypoints = [];

  function scanDir(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'cache', 'out', 'artifacts', 'broadcast', 'test'].includes(entry.name)) {
          scanDir(fullPath);
        }
      } else if (entry.name.endsWith('.sol')) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const relPath = relative(PROJECT_DIR, fullPath);

          // Extract contract name
          const contractMatch = content.match(/(?:contract|abstract contract|library)\s+(\w+)/);
          const contractName = contractMatch ? contractMatch[1] : basename(entry.name, '.sol');

          // Extract public/external functions
          const funcRegex = /function\s+(\w+)\s*\([^)]*\)\s+(?:public|external)(?:\s+(?:view|pure|payable|virtual|override|returns\s*\([^)]*\)))*\s*/g;
          let match;
          while ((match = funcRegex.exec(content)) !== null) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            entrypoints.push({
              contract: contractName,
              function: match[1],
              file: relPath,
              line: lineNumber,
              signature: `${contractName}.${match[1]}`
            });
          }
        } catch {
          // Skip files that can't be parsed
        }
      }
    }
  }

  scanDir(srcDir);
  return entrypoints;
}

/**
 * Extract modules (contracts/libraries) from source
 */
function extractModules(srcDir) {
  if (!existsSync(srcDir)) return [];

  const modules = [];

  function scanDir(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'cache', 'out', 'artifacts', 'broadcast', 'test'].includes(entry.name)) {
          scanDir(fullPath);
        }
      } else if (entry.name.endsWith('.sol')) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const relPath = relative(PROJECT_DIR, fullPath);

          // Extract all contract/library definitions
          const contractRegex = /(?:contract|abstract contract|library|interface)\s+(\w+)/g;
          let match;
          while ((match = contractRegex.exec(content)) !== null) {
            modules.push({
              name: match[1],
              file: relPath,
              type: content.substring(match.index - 20, match.index + match[0].length).includes('interface') ? 'interface'
                : content.substring(match.index - 20, match.index + match[0].length).includes('library') ? 'library'
                : content.substring(match.index - 20, match.index + match[0].length).includes('abstract') ? 'abstract'
                : 'contract'
            });
          }
        } catch {
          // Skip files that can't be parsed
        }
      }
    }
  }

  scanDir(srcDir);
  return modules;
}

/**
 * Check which entrypoints/modules are referenced in findings
 */
function checkCoverage(entrypoints, modules, findingsFiles) {
  // Collect all file:line references from findings
  const referencedFiles = new Set();
  const referencedContracts = new Set();

  for (const findingsPath of findingsFiles) {
    if (!existsSync(findingsPath)) continue;
    try {
      const data = JSON.parse(readFileSync(findingsPath, 'utf-8'));
      const findings = data.findings || data.exploits_confirmed || data.confirmed_exploits || [];
      const scopeFiles = data.scope_files_analyzed || [];

      // Add scope files
      for (const f of scopeFiles) {
        referencedFiles.add(f.toLowerCase());
      }

      for (const finding of findings) {
        if (finding.file) referencedFiles.add(finding.file.toLowerCase());
        if (finding.affected) {
          // "Contract::function" format
          const parts = finding.affected.split('::');
          if (parts[0]) referencedContracts.add(parts[0].toLowerCase());
        }
      }
    } catch {
      continue;
    }
  }

  // Check entrypoint coverage
  const coveredEntrypoints = entrypoints.filter(ep =>
    referencedFiles.has(ep.file.toLowerCase()) ||
    referencedContracts.has(ep.contract.toLowerCase())
  );

  // Check module coverage
  const coveredModules = modules.filter(m =>
    referencedFiles.has(m.file.toLowerCase()) ||
    referencedContracts.has(m.name.toLowerCase())
  );

  return {
    entrypoints: {
      total: entrypoints.length,
      covered: coveredEntrypoints.length,
      uncovered: entrypoints.filter(ep =>
        !referencedFiles.has(ep.file.toLowerCase()) &&
        !referencedContracts.has(ep.contract.toLowerCase())
      ),
      percentage: entrypoints.length > 0
        ? Math.round((coveredEntrypoints.length / entrypoints.length) * 100)
        : 100
    },
    modules: {
      total: modules.length,
      covered: coveredModules.length,
      uncovered: modules.filter(m =>
        !referencedFiles.has(m.file.toLowerCase()) &&
        !referencedContracts.has(m.name.toLowerCase())
      ),
      percentage: modules.length > 0
        ? Math.round((coveredModules.length / modules.length) * 100)
        : 100
    }
  };
}

function main() {
  const args = parseArguments();
  const runId = args['run-id'] || `coverage-${Date.now()}`;
  const config = loadConfig();
  const srcDir = args['src-dir'] || SRC_DIR;
  const entrypointThreshold = parseInt(args.threshold || config.min_entrypoint_coverage || '90');
  const moduleThreshold = config.min_module_coverage || 100;

  console.log(`\n=== Coverage Tracker ===`);
  console.log(`Run ID: ${runId}`);
  console.log(`Source: ${srcDir}`);
  console.log(`Entrypoint threshold: ${entrypointThreshold}%`);
  console.log(`Module threshold: ${moduleThreshold}%`);

  // Extract entrypoints and modules
  const entrypoints = extractEntrypoints(srcDir);
  const modules = extractModules(srcDir);

  console.log(`Entrypoints found: ${entrypoints.length}`);
  console.log(`Modules found: ${modules.length}`);

  // Find all findings files
  const runDir = join(TASK_DIR, runId);
  const findingsFiles = [
    join(runDir, 'codex-detect-findings.json'),
    join(runDir, 'opus-detect-findings.json'),
    join(runDir, 'codex-deep-exploit-review.json'),
    join(TASK_DIR, 'exploit-hunt-review.json'),
    join(TASK_DIR, 'codex-detect-findings.json'),
  ].filter(f => existsSync(f));

  console.log(`Findings files: ${findingsFiles.length}`);

  // Check coverage
  const coverage = checkCoverage(entrypoints, modules, findingsFiles);

  console.log(`\nEntrypoint coverage: ${coverage.entrypoints.percentage}% (${coverage.entrypoints.covered}/${coverage.entrypoints.total})`);
  console.log(`Module coverage: ${coverage.modules.percentage}% (${coverage.modules.covered}/${coverage.modules.total})`);

  // Determine if additional passes needed
  const needsEntrypointPass = coverage.entrypoints.percentage < entrypointThreshold;
  const needsModulePass = coverage.modules.percentage < moduleThreshold;
  const passRequired = needsEntrypointPass || needsModulePass;

  if (passRequired) {
    console.log(`\nCOVERAGE BELOW THRESHOLD - Additional detect pass recommended`);
    if (needsEntrypointPass) {
      console.log(`  Entrypoint: ${coverage.entrypoints.percentage}% < ${entrypointThreshold}%`);
    }
    if (needsModulePass) {
      console.log(`  Module: ${coverage.modules.percentage}% < ${moduleThreshold}%`);
    }
  } else {
    console.log(`\nCoverage thresholds met.`);
  }

  // Write results
  ensureDir(runDir);

  const result = {
    id: `coverage-${Date.now()}`,
    run_id: runId,
    entrypoint_coverage: coverage.entrypoints,
    module_coverage: coverage.modules,
    thresholds: {
      entrypoint: entrypointThreshold,
      module: moduleThreshold
    },
    pass_required: passRequired,
    uncovered_entrypoints: coverage.entrypoints.uncovered.map(ep => ep.signature),
    uncovered_modules: coverage.modules.uncovered.map(m => `${m.name} (${m.file})`),
    findings_files_checked: findingsFiles.length,
    generated_at: new Date().toISOString()
  };

  writeFileSync(join(runDir, 'coverage-report.json'), JSON.stringify(result, null, 2));

  // Write hints for uncovered modules (for additional detect pass)
  if (passRequired && (coverage.entrypoints.uncovered.length > 0 || coverage.modules.uncovered.length > 0)) {
    const uncoveredHints = {
      id: `coverage-hints-${Date.now()}`,
      hint_type: 'uncovered_modules',
      description: 'These modules/entrypoints were not referenced in any findings. Focus additional detect pass on these.',
      uncovered_entrypoints: coverage.entrypoints.uncovered,
      uncovered_modules: coverage.modules.uncovered,
      generated_at: new Date().toISOString()
    };

    writeFileSync(join(runDir, 'coverage-hints.json'), JSON.stringify(uncoveredHints, null, 2));
    console.log(`Coverage hints written: ${join(runDir, 'coverage-hints.json')}`);
  }

  console.log(`Coverage report: ${join(runDir, 'coverage-report.json')}`);
  console.log(JSON.stringify({
    success: true,
    entrypoint_coverage: coverage.entrypoints.percentage,
    module_coverage: coverage.modules.percentage,
    pass_required: passRequired,
    uncovered_entrypoints: coverage.entrypoints.uncovered.length,
    uncovered_modules: coverage.modules.uncovered.length
  }));
}

if (import.meta.main !== false) {
  main();
}

export { extractEntrypoints, extractModules, checkCoverage };
