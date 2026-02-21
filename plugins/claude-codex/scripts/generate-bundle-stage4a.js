#!/usr/bin/env bun
/**
 * Generate Stage 4A Bundle (Opus Contrarian Attack Plan)
 *
 * BLINDNESS: NO SPEC NARRATIVE ALLOWED
 * ISOLATION: Same as Stage 4 bundle
 *
 * Includes:
 * - invariants-list.md (ONLY numbered I1..In with formal expressions)
 * - public-api.md (interfaces only, extracted from code)
 * - Full source code (src/**/*.sol)
 * - Full test code (test/**/*.sol)
 * - slither-summary.md (if available)
 *
 * Excludes:
 * - docs/security/threat-model.md prose
 * - docs/architecture/design.md narrative
 * - docs/testing/test-plan.md (except invariants extraction)
 * - Any Codex output (Stage 4B) - ISOLATION ENFORCED
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { parseArgs } from 'util';

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
Usage: generate-bundle-stage4a.js --run-id <run_id>

Generates Stage 4A bundle for Opus Contrarian Attack Plan (blind to spec narrative).
This is the same as Stage 4 bundle - Opus sees code but not spec prose.

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

function extractInvariantsList(bundleDir) {
  const threatModelPath = join(DOCS_DIR, 'security', 'threat-model.md');
  const threatModel = readFile(threatModelPath);

  let output = `# Invariants List\n\n`;
  output += `> This file contains ONLY numbered invariants with formal expressions.\n`;
  output += `> No attack surface descriptions, trust assumptions, or narrative.\n`;
  output += `> Bundle: stage4a (Opus Contrarian Attack Plan)\n\n`;

  if (!threatModel) {
    output += `(No threat-model.md found)\n`;
    const outputPath = join(bundleDir, 'invariants-list.md');
    writeFileSync(outputPath, output);
    return outputPath;
  }

  const categories = [
    { prefix: 'IC', name: 'Conservation Invariants' },
    { prefix: 'IS', name: 'Consistency Invariants' },
    { prefix: 'IA', name: 'Access Invariants' },
    { prefix: 'IT', name: 'Temporal Invariants' },
    { prefix: 'IB', name: 'Bound Invariants' }
  ];

  for (const cat of categories) {
    const regex = new RegExp(`${cat.prefix}-(\\d+)[:\\s]+([^\n]+)`, 'gi');
    const matches = [...threatModel.matchAll(regex)];

    if (matches.length > 0) {
      output += `## ${cat.name} (${cat.prefix}-*)\n\n`;
      for (const match of matches) {
        const id = `${cat.prefix}-${match[1]}`;
        let expression = match[2].trim();
        expression = expression.replace(/^[-*]\s*/, '').trim();
        output += `- **${id}**: ${expression}\n`;
      }
      output += `\n`;
    }
  }

  const formalBlockMatch = threatModel.match(/```[\s\S]*?(IC|IS|IA|IT|IB)-[\s\S]*?```/g);
  if (formalBlockMatch) {
    output += `## Formal Expressions\n\n`;
    output += `\`\`\`\n`;
    for (const block of formalBlockMatch) {
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

function extractPublicApi(bundleDir) {
  let output = `# Public API\n\n`;
  output += `> Extracted function signatures and interfaces from source code.\n`;
  output += `> Bundle: stage4a (Opus Contrarian Attack Plan)\n\n`;

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

          const interfaceMatches = content.matchAll(/interface\s+(\w+)\s*(?:is\s+[^{]+)?\s*\{([^}]*)\}/gs);
          for (const match of interfaceMatches) {
            contractInfo.interfaces.push({
              name: match[1],
              body: match[2].trim()
            });
          }

          const funcMatches = content.matchAll(/function\s+(\w+)\s*\(([^)]*)\)\s*(external|public)[^;{]*/g);
          for (const match of funcMatches) {
            contractInfo.functions.push({
              name: match[1],
              params: match[2].trim(),
              visibility: match[3],
              full: match[0].trim()
            });
          }

          const eventMatches = content.matchAll(/event\s+(\w+)\s*\([^)]*\)/g);
          for (const match of eventMatches) {
            contractInfo.events.push(match[0]);
          }

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

function validateNoSpecProse(bundleDir) {
  const errors = [];
  const forbiddenFiles = ['threat-model.md', 'design.md', 'test-plan.md'];

  function checkDir(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['src', 'test'].includes(entry.name)) {
          checkDir(fullPath);
        }
      } else if (entry.isFile()) {
        for (const forbidden of forbiddenFiles) {
          if (entry.name === forbidden) {
            errors.push(`BLINDNESS VIOLATION: ${fullPath} is a spec file (not allowed in Stage 4A)`);
          }
        }

        const content = readFile(fullPath);
        if (content && !fullPath.includes('src/') && !fullPath.includes('test/')) {
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

/**
 * Validate Stage 4A bundle has NO Codex output (isolation from Stage 4B).
 * Mirrors the approach used in stage4b's validateBundle() for Opus output.
 */
function validateNoCodexOutput(bundleDir) {
  const errors = [];
  const codexOutputFiles = [
    'codex-deep-exploit-review.md',
    'codex-deep-exploit-review.json',
    'codex-detect-findings.json',
    'codex-exploit-proof.json',
    'codex-exploit-proof.md',
    'codex-patch-verify.json'
  ];

  function checkDir(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDir(fullPath);
      } else if (entry.isFile()) {
        // Check filename
        for (const forbidden of codexOutputFiles) {
          if (entry.name === forbidden) {
            errors.push(`ISOLATION VIOLATION: ${fullPath} is a Codex output file (not allowed in Stage 4A)`);
          }
        }
        // Check content for Codex review signatures (skip source/test code)
        if (!fullPath.includes('src/') && !fullPath.includes('test/')) {
          const content = readFile(fullPath);
          if (content) {
            if (/Codex Deep Exploit/i.test(content)) {
              errors.push(`ISOLATION VIOLATION: ${fullPath} contains Codex Deep Exploit references`);
            }
            if (/codex-deep-exploit-review/i.test(content)) {
              errors.push(`ISOLATION VIOLATION: ${fullPath} references Codex review artifact`);
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

  const bundleDir = join(TASK_DIR, runId, 'bundle-stage4a');
  ensureDir(bundleDir);

  console.log(`Generating Stage 4A bundle (Opus Contrarian Attack Plan) for run: ${runId}`);
  console.log(`Output directory: ${bundleDir}`);

  const manifest = {
    run_id: runId,
    stage: 'stage4a-opus-attack-plan',
    blindness_rule: 'NO_SPEC_PROSE',
    isolation_rule: 'NO_CODEX_OUTPUT',
    generated_at: new Date().toISOString(),
    files: []
  };

  const invariantsPath = extractInvariantsList(bundleDir);
  manifest.files.push('invariants-list.md');
  console.log(`  Generated: invariants-list.md`);

  const apiPath = extractPublicApi(bundleDir);
  manifest.files.push('public-api.md');
  console.log(`  Generated: public-api.md`);

  const srcDestDir = join(bundleDir, 'src');
  const srcFiles = copyDir(SRC_DIR, srcDestDir, (name) => name.endsWith('.sol'));
  manifest.files.push(...srcFiles.map(f => `src/${basename(f)}`));
  console.log(`  Copied: ${srcFiles.length} source files`);

  const testDestDir = join(bundleDir, 'test');
  const testFiles = copyDir(TEST_DIR, testDestDir, (name) => name.endsWith('.sol') || name.endsWith('.t.sol'));
  manifest.files.push(...testFiles.map(f => `test/${basename(f)}`));
  console.log(`  Copied: ${testFiles.length} test files`);

  const slitherPath = generateSlitherSummary(bundleDir);
  manifest.files.push('slither-summary.md');
  console.log(`  Generated: slither-summary.md`);

  const violations = validateNoSpecProse(bundleDir);
  const isolationViolations = validateNoCodexOutput(bundleDir);
  const allViolations = [...violations, ...isolationViolations];

  if (allViolations.length > 0) {
    console.error('\nBLINDNESS/ISOLATION VIOLATIONS DETECTED:');
    for (const v of allViolations) {
      console.error(`  - ${v}`);
    }
    manifest.blindness_validated = violations.length === 0;
    manifest.isolation_validated = isolationViolations.length === 0;
    manifest.violations = allViolations;

    writeFileSync(join(bundleDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
    process.exit(1);
  }

  manifest.blindness_validated = true;
  manifest.isolation_validated = true;
  manifest.violations = [];

  writeFileSync(join(bundleDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nBundle generated successfully: ${bundleDir}`);
  console.log(`Files included: ${manifest.files.length}`);
  console.log(`Blindness validated: ${manifest.blindness_validated}`);
  console.log(`Isolation validated: ${manifest.isolation_validated}`);

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
