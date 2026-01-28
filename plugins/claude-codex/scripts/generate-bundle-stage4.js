#!/usr/bin/env bun
/**
 * Generate Stage 4 Bundle (Exploit Hunt Review)
 *
 * BLINDNESS: NO SPEC NARRATIVE ALLOWED
 *
 * Includes:
 * - invariants-list.md (ONLY numbered I1..In with formal expressions)
 * - public-api.md (interfaces only, extracted from code)
 * - Full source code (src/**\/*.sol)
 * - Full test code (test/**\/*.sol)
 * - slither-summary.md (if available)
 *
 * Excludes:
 * - docs/security/threat-model.md prose (attack surface descriptions, trust assumptions)
 * - docs/architecture/design.md narrative
 * - docs/testing/test-plan.md (except invariants extraction)
 * - Any "why" or "motivation" text
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { parseArgs } from 'util';
import { execSync } from 'child_process';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(import.meta.path));
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
Usage: generate-bundle-stage4.js --run-id <run_id>

Generates Stage 4 bundle for Exploit Hunt Review (blind to spec narrative).

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
      copied.push(relative(PROJECT_DIR, destPath));
    }
  }

  return copied;
}

/**
 * Extract invariants list from threat-model.md
 * ONLY numbered invariants with formal expressions - NO prose
 */
function extractInvariantsList(bundleDir) {
  const threatModelPath = join(DOCS_DIR, 'security', 'threat-model.md');
  const threatModel = readFile(threatModelPath);

  let output = `# Invariants List\n\n`;
  output += `> This file contains ONLY numbered invariants with formal expressions.\n`;
  output += `> No attack surface descriptions, trust assumptions, or narrative.\n\n`;

  if (!threatModel) {
    output += `(No threat-model.md found)\n`;
    const outputPath = join(bundleDir, 'invariants-list.md');
    writeFileSync(outputPath, output);
    return outputPath;
  }

  // Extract invariants by category
  const categories = [
    { prefix: 'IC', name: 'Conservation Invariants' },
    { prefix: 'IS', name: 'Consistency Invariants' },
    { prefix: 'IA', name: 'Access Invariants' },
    { prefix: 'IT', name: 'Temporal Invariants' },
    { prefix: 'IB', name: 'Bound Invariants' }
  ];

  for (const cat of categories) {
    // Match patterns like "IC-1: `sum(balances) == total`" or "- IC-1: description"
    const regex = new RegExp(`${cat.prefix}-(\\d+)[:\\s]+([^\n]+)`, 'gi');
    const matches = [...threatModel.matchAll(regex)];

    if (matches.length > 0) {
      output += `## ${cat.name} (${cat.prefix}-*)\n\n`;
      for (const match of matches) {
        const id = `${cat.prefix}-${match[1]}`;
        let expression = match[2].trim();
        // Remove markdown formatting but keep the expression
        expression = expression.replace(/^[-*]\s*/, '').trim();
        output += `- **${id}**: ${expression}\n`;
      }
      output += `\n`;
    }
  }

  // Also try to extract from formal invariant blocks if present
  const formalBlockMatch = threatModel.match(/```[\s\S]*?(IC|IS|IA|IT|IB)-[\s\S]*?```/g);
  if (formalBlockMatch) {
    output += `## Formal Expressions\n\n`;
    output += `\`\`\`\n`;
    for (const block of formalBlockMatch) {
      // Extract just the invariant lines from code blocks
      const lines = block.split('\n');
      for (const line of lines) {
        if (/(IC|IS|IA|IT|IB)-\d+/.test(line)) {
          output += `${line.replace(/^```|```$/g, '').trim()}\n`;
        }
      }
    }
    output += `\`\`\`\n`;
  }

  const outputPath = join(bundleDir, 'invariants-list.md');
  writeFileSync(outputPath, output);
  return outputPath;
}

/**
 * Extract public API from source code
 * ONLY interfaces and function signatures - minimal context
 */
function extractPublicApi(bundleDir) {
  let output = `# Public API\n\n`;
  output += `> Extracted function signatures and interfaces from source code.\n\n`;

  if (!existsSync(SRC_DIR)) {
    output += `(No src/ directory found)\n`;
    const outputPath = join(bundleDir, 'public-api.md');
    writeFileSync(outputPath, output);
    return outputPath;
  }

  function processDir(dir, contracts = []) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        processDir(fullPath, contracts);
      } else if (entry.name.endsWith('.sol')) {
        const content = readFile(fullPath);
        if (content) {
          const contractName = entry.name.replace('.sol', '');
          const contractInfo = {
            name: contractName,
            file: relative(PROJECT_DIR, fullPath),
            interfaces: [],
            functions: [],
            events: [],
            errors: []
          };

          // Extract interfaces
          const interfaceMatches = content.matchAll(/interface\s+(\w+)\s*(?:is\s+[^{]+)?\s*\{([^}]*)\}/gs);
          for (const match of interfaceMatches) {
            contractInfo.interfaces.push({
              name: match[1],
              body: match[2].trim()
            });
          }

          // Extract public/external functions
          const funcMatches = content.matchAll(/function\s+(\w+)\s*\(([^)]*)\)\s*(external|public)[^;{]*/g);
          for (const match of funcMatches) {
            contractInfo.functions.push({
              name: match[1],
              params: match[2].trim(),
              visibility: match[3],
              full: match[0].trim()
            });
          }

          // Extract events
          const eventMatches = content.matchAll(/event\s+(\w+)\s*\([^)]*\)/g);
          for (const match of eventMatches) {
            contractInfo.events.push(match[0]);
          }

          // Extract custom errors
          const errorMatches = content.matchAll(/error\s+(\w+)\s*\([^)]*\)/g);
          for (const match of errorMatches) {
            contractInfo.errors.push(match[0]);
          }

          if (contractInfo.functions.length > 0 || contractInfo.interfaces.length > 0) {
            contracts.push(contractInfo);
          }
        }
      }
    }
    return contracts;
  }

  const contracts = processDir(SRC_DIR);

  for (const contract of contracts) {
    output += `## ${contract.name}\n\n`;
    output += `File: \`${contract.file}\`\n\n`;

    if (contract.interfaces.length > 0) {
      output += `### Interfaces\n\n`;
      for (const iface of contract.interfaces) {
        output += `\`\`\`solidity\ninterface ${iface.name} {\n${iface.body}\n}\n\`\`\`\n\n`;
      }
    }

    if (contract.functions.length > 0) {
      output += `### Public/External Functions\n\n`;
      output += `| Function | Visibility |\n`;
      output += `|----------|------------|\n`;
      for (const func of contract.functions) {
        output += `| \`${func.name}(${func.params})\` | ${func.visibility} |\n`;
      }
      output += `\n`;
    }

    if (contract.events.length > 0) {
      output += `### Events\n\n`;
      for (const event of contract.events) {
        output += `- \`${event}\`\n`;
      }
      output += `\n`;
    }

    if (contract.errors.length > 0) {
      output += `### Errors\n\n`;
      for (const error of contract.errors) {
        output += `- \`${error}\`\n`;
      }
      output += `\n`;
    }
  }

  const outputPath = join(bundleDir, 'public-api.md');
  writeFileSync(outputPath, output);
  return outputPath;
}

/**
 * Generate slither summary if available
 */
function generateSlitherSummary(bundleDir) {
  const slitherPath = join(REPORTS_DIR, 'slither.json');
  const slitherData = readFile(slitherPath);

  let output = `# Slither Summary\n\n`;

  if (!slitherData) {
    output += `(No slither.json found - static analysis not run)\n`;
    const outputPath = join(bundleDir, 'slither-summary.md');
    writeFileSync(outputPath, output);
    return outputPath;
  }

  try {
    const data = JSON.parse(slitherData);

    // Count by severity
    const bySeverity = { High: [], Medium: [], Low: [], Informational: [] };

    if (data.results?.detectors) {
      for (const finding of data.results.detectors) {
        const severity = finding.impact || 'Informational';
        if (bySeverity[severity]) {
          bySeverity[severity].push({
            check: finding.check,
            description: finding.description,
            elements: finding.elements?.map(e => e.name).filter(Boolean) || []
          });
        }
      }
    }

    output += `## Summary\n\n`;
    output += `| Severity | Count |\n`;
    output += `|----------|-------|\n`;
    output += `| High | ${bySeverity.High.length} |\n`;
    output += `| Medium | ${bySeverity.Medium.length} |\n`;
    output += `| Low | ${bySeverity.Low.length} |\n`;
    output += `| Informational | ${bySeverity.Informational.length} |\n\n`;

    // List HIGH and MEDIUM findings
    if (bySeverity.High.length > 0) {
      output += `## High Severity Findings\n\n`;
      for (const f of bySeverity.High) {
        output += `### ${f.check}\n\n`;
        output += `${f.description}\n\n`;
        if (f.elements.length > 0) {
          output += `Affected: ${f.elements.join(', ')}\n\n`;
        }
      }
    }

    if (bySeverity.Medium.length > 0) {
      output += `## Medium Severity Findings\n\n`;
      for (const f of bySeverity.Medium) {
        output += `### ${f.check}\n\n`;
        output += `${f.description}\n\n`;
        if (f.elements.length > 0) {
          output += `Affected: ${f.elements.join(', ')}\n\n`;
        }
      }
    }
  } catch (e) {
    output += `(Error parsing slither.json: ${e.message})\n`;
  }

  const outputPath = join(bundleDir, 'slither-summary.md');
  writeFileSync(outputPath, output);
  return outputPath;
}

/**
 * Validate bundle contains NO spec prose
 */
function validateNoSpecProse(bundleDir) {
  const errors = [];

  // Check for forbidden files
  const forbiddenFiles = [
    'threat-model.md',
    'design.md',
    'test-plan.md'
  ];

  function checkDir(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Don't recurse into src/ or test/ - those are allowed
        if (!['src', 'test'].includes(entry.name)) {
          checkDir(fullPath);
        }
      } else if (entry.isFile()) {
        // Check for forbidden spec files
        for (const forbidden of forbiddenFiles) {
          if (entry.name === forbidden) {
            errors.push(`BLINDNESS VIOLATION: ${fullPath} is a spec file (not allowed in Stage 4)`);
          }
        }

        // Check for spec-like content in allowed files
        const content = readFile(fullPath);
        if (content && !fullPath.includes('src/') && !fullPath.includes('test/')) {
          // Look for spec-like sections
          if (/##\s*(Trust Assumptions|Attack Surface|Attacker Classes)/i.test(content)) {
            errors.push(`BLINDNESS VIOLATION: ${fullPath} contains spec prose (trust/attack sections)`);
          }
          if (/##\s*(Assets at Risk|Motivation|Why)/i.test(content)) {
            errors.push(`BLINDNESS VIOLATION: ${fullPath} contains spec narrative`);
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

  const bundleDir = join(TASK_DIR, runId, 'bundle-stage4');
  ensureDir(bundleDir);

  console.log(`Generating Stage 4 bundle (NO SPEC PROSE) for run: ${runId}`);
  console.log(`Output directory: ${bundleDir}`);

  const manifest = {
    run_id: runId,
    stage: 'stage4-exploit-hunt',
    blindness_rule: 'NO_SPEC_PROSE',
    generated_at: new Date().toISOString(),
    files: []
  };

  // Extract invariants list (ONLY numbered invariants)
  const invariantsPath = extractInvariantsList(bundleDir);
  manifest.files.push('invariants-list.md');
  console.log(`  Generated: invariants-list.md`);

  // Extract public API from source
  const apiPath = extractPublicApi(bundleDir);
  manifest.files.push('public-api.md');
  console.log(`  Generated: public-api.md`);

  // Copy source code (allowed)
  const srcDestDir = join(bundleDir, 'src');
  const srcFiles = copyDir(SRC_DIR, srcDestDir, (name) => name.endsWith('.sol'));
  manifest.files.push(...srcFiles.map(f => `src/${basename(f)}`));
  console.log(`  Copied: ${srcFiles.length} source files`);

  // Copy test code (allowed)
  const testDestDir = join(bundleDir, 'test');
  const testFiles = copyDir(TEST_DIR, testDestDir, (name) => name.endsWith('.sol') || name.endsWith('.t.sol'));
  manifest.files.push(...testFiles.map(f => `test/${basename(f)}`));
  console.log(`  Copied: ${testFiles.length} test files`);

  // Generate slither summary
  const slitherPath = generateSlitherSummary(bundleDir);
  manifest.files.push('slither-summary.md');
  console.log(`  Generated: slither-summary.md`);

  // Validate NO spec prose in bundle
  const violations = validateNoSpecProse(bundleDir);
  if (violations.length > 0) {
    console.error('\nBLINDNESS VIOLATIONS DETECTED:');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    manifest.blindness_validated = false;
    manifest.violations = violations;

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
