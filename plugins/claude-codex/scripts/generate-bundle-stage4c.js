#!/usr/bin/env bun
/**
 * Generate Stage 4C Bundle (Dispute Resolution)
 *
 * BLINDNESS: NO SPEC NARRATIVE ALLOWED
 * INCLUDES: Both Opus and Codex review outputs (for dispute resolution)
 *
 * Includes:
 * - invariants-list.md (ONLY numbered I1..In with formal expressions)
 * - public-api.md (interfaces only, extracted from code)
 * - Full source code (src/**/*.sol)
 * - Full test code (test/**/*.sol)
 * - docs/reviews/opus-attack-plan.md (Opus output - NOW VISIBLE)
 * - docs/reviews/codex-deep-exploit-review.md (Codex output - NOW VISIBLE)
 * - slither-summary.md (if available)
 *
 * Excludes:
 * - docs/security/threat-model.md prose (still blind)
 * - docs/architecture/design.md narrative (still blind)
 * - docs/testing/test-plan.md (still blind)
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
Usage: generate-bundle-stage4c.js --run-id <run_id>

Generates Stage 4C bundle for Dispute Resolution.
BLINDNESS: Still no spec narrative.
INCLUDES: Both Opus and Codex review outputs for dispute resolution.

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
  output += `> Bundle: stage4c (Dispute Resolution)\n\n`;

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

  const outputPath = join(bundleDir, 'invariants-list.md');
  writeFileSync(outputPath, output);
  return outputPath;
}

function extractPublicApi(bundleDir) {
  let output = `# Public API\n\n`;
  output += `> Extracted function signatures and interfaces from source code.\n`;
  output += `> Bundle: stage4c (Dispute Resolution)\n\n`;

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

/**
 * Copy review outputs from Opus and Codex to the bundle
 */
function copyReviewOutputs(bundleDir, runId) {
  const reviewsDir = join(bundleDir, 'reviews');
  ensureDir(reviewsDir);

  const copied = [];
  const missing = [];

  // Copy Opus Attack Plan
  const opusAttackPlanMd = join(DOCS_DIR, 'reviews', 'opus-attack-plan.md');
  if (existsSync(opusAttackPlanMd)) {
    copyFileSync(opusAttackPlanMd, join(reviewsDir, 'opus-attack-plan.md'));
    copied.push('opus-attack-plan.md');
  } else {
    missing.push('opus-attack-plan.md');
  }

  // Copy Opus Attack Plan JSON artifact
  const opusAttackPlanJson = join(TASK_DIR, runId, 'opus-attack-plan.json');
  if (existsSync(opusAttackPlanJson)) {
    copyFileSync(opusAttackPlanJson, join(reviewsDir, 'opus-attack-plan.json'));
    copied.push('opus-attack-plan.json');
  } else {
    // Try alternate location
    const altPath = join(TASK_DIR, 'opus-attack-plan.json');
    if (existsSync(altPath)) {
      copyFileSync(altPath, join(reviewsDir, 'opus-attack-plan.json'));
      copied.push('opus-attack-plan.json');
    }
  }

  // Copy Codex Deep Exploit Review
  const codexReviewMd = join(DOCS_DIR, 'reviews', 'codex-deep-exploit-review.md');
  if (existsSync(codexReviewMd)) {
    copyFileSync(codexReviewMd, join(reviewsDir, 'codex-deep-exploit-review.md'));
    copied.push('codex-deep-exploit-review.md');
  } else {
    missing.push('codex-deep-exploit-review.md');
  }

  // Copy Codex Review JSON artifact
  const codexReviewJson = join(TASK_DIR, runId, 'codex-deep-exploit-review.json');
  if (existsSync(codexReviewJson)) {
    copyFileSync(codexReviewJson, join(reviewsDir, 'codex-deep-exploit-review.json'));
    copied.push('codex-deep-exploit-review.json');
  } else {
    const altPath = join(TASK_DIR, 'codex-deep-exploit-review.json');
    if (existsSync(altPath)) {
      copyFileSync(altPath, join(reviewsDir, 'codex-deep-exploit-review.json'));
      copied.push('codex-deep-exploit-review.json');
    }
  }

  return { copied, missing };
}

/**
 * Validate bundle contains NO spec prose (still blind to spec)
 */
function validateNoSpecProse(bundleDir) {
  const errors = [];
  const forbiddenSpecFiles = ['threat-model.md', 'design.md', 'test-plan.md'];

  function checkDir(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['src', 'test', 'reviews'].includes(entry.name)) {
          checkDir(fullPath);
        }
      } else if (entry.isFile()) {
        // Check for forbidden spec files (not in reviews/)
        if (!fullPath.includes('/reviews/')) {
          for (const forbidden of forbiddenSpecFiles) {
            if (entry.name === forbidden) {
              errors.push(`BLINDNESS VIOLATION: ${fullPath} is a spec file (not allowed in Stage 4C)`);
            }
          }
        }

        const content = readFile(fullPath);
        if (content && !fullPath.includes('src/') && !fullPath.includes('test/') && !fullPath.includes('/reviews/')) {
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

  const bundleDir = join(TASK_DIR, runId, 'bundle-stage4c');
  ensureDir(bundleDir);

  console.log(`Generating Stage 4C bundle (Dispute Resolution) for run: ${runId}`);
  console.log(`Output directory: ${bundleDir}`);
  console.log(`INCLUDES: Both Opus and Codex review outputs`);

  const manifest = {
    run_id: runId,
    stage: 'stage4c-dispute-resolution',
    blindness_rule: 'NO_SPEC_PROSE',
    includes_both_reviews: true,
    generated_at: new Date().toISOString(),
    files: []
  };

  // Extract invariants list
  const invariantsPath = extractInvariantsList(bundleDir);
  manifest.files.push('invariants-list.md');
  console.log(`  Generated: invariants-list.md`);

  // Extract public API
  const apiPath = extractPublicApi(bundleDir);
  manifest.files.push('public-api.md');
  console.log(`  Generated: public-api.md`);

  // Copy source code
  const srcDestDir = join(bundleDir, 'src');
  const srcFiles = copyDir(SRC_DIR, srcDestDir, (name) => name.endsWith('.sol'));
  manifest.files.push(...srcFiles.map(f => `src/${basename(f)}`));
  console.log(`  Copied: ${srcFiles.length} source files`);

  // Copy test code
  const testDestDir = join(bundleDir, 'test');
  const testFiles = copyDir(TEST_DIR, testDestDir, (name) => name.endsWith('.sol') || name.endsWith('.t.sol'));
  manifest.files.push(...testFiles.map(f => `test/${basename(f)}`));
  console.log(`  Copied: ${testFiles.length} test files`);

  // Generate slither summary
  const slitherPath = generateSlitherSummary(bundleDir);
  manifest.files.push('slither-summary.md');
  console.log(`  Generated: slither-summary.md`);

  // Copy BOTH review outputs (Opus + Codex)
  const { copied: reviewsCopied, missing: reviewsMissing } = copyReviewOutputs(bundleDir, runId);
  manifest.files.push(...reviewsCopied.map(f => `reviews/${f}`));
  console.log(`  Copied reviews: ${reviewsCopied.length} files`);

  if (reviewsMissing.length > 0) {
    console.warn(`  WARNING: Missing review files: ${reviewsMissing.join(', ')}`);
    manifest.warnings = manifest.warnings || [];
    manifest.warnings.push(`Missing review files: ${reviewsMissing.join(', ')}`);
  }

  // Validate NO spec prose
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
  manifest.reviews_included = {
    opus: reviewsCopied.some(f => f.includes('opus')),
    codex: reviewsCopied.some(f => f.includes('codex'))
  };

  writeFileSync(join(bundleDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nBundle generated successfully: ${bundleDir}`);
  console.log(`Files included: ${manifest.files.length}`);
  console.log(`Blindness validated: ${manifest.blindness_validated} (no spec prose)`);
  console.log(`Reviews included: Opus=${manifest.reviews_included.opus}, Codex=${manifest.reviews_included.codex}`);

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
